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
//   • una PIPELINE pura (solo `|`) scende a livello 1 SOLO se OGNI segmento è
//     una lettura riconosciuta, scriptblock inclusi (vedi segmentIsRead): la
//     shell di default su Windows è PowerShell, e lì leggere significa scrivere
//     pipeline. Un solo segmento non riconosciuto, o uno scriptblock che
//     potrebbe invocare qualcosa, e la pipeline resta 3.
//   • background (&), redirezioni (>, >>, <), `${...}`, backtick e newline NON
//     sono semplici sequenze: il comando non è "interamente riconoscibile" → 3,
//     sempre. Un falso positivo qui costa solo più attrito (digitare
//     "conferma"), mai un'esecuzione silenziosa indebita. I gruppi `( )`,
//     `@( )`, `$( )` e l'`if` di PowerShell si classificano per ciò che
//     eseguono (vedi `smonta`).
//   • le VIRGOLETTE vengono tolte prima di classificare (vedi `unquote`): tutte
//     le shell supportate eseguono `git checkout "."`, `git checkout .""` e
//     `git checkout .` allo stesso identico modo, quindi devono ricevere lo
//     stesso livello. Non è parsing del quoting — è una normalizzazione che può
//     solo far riconoscere PIÙ bersagli/flag pericolosi, mai di meno.
//   • un backstop di programmi distruttivi (rm/del/format/…) resta 3 anche se
//     per errore comparisse in una whitelist.
//   • la whitelist FIDA di un nome solo se invocato NUDO (nessun separatore di
//     percorso, nessuna estensione eseguibile, nessun prefisso `.\`/`.`/`&`).
//     Un file su disco chiamato come un comando fidato — `.\Get-ChildItem.exe`,
//     `C:\tmp\ls.exe`, `Get-ChildItem.exe` dal PATH — NON è quel comando: è un
//     eseguibile arbitrario e resta al livello 3 di default. Il backstop dei
//     distruttivi invece guarda il basename (così `/bin/rm` resta 3 col
//     percorso): catturare un nome pericoloso travestito è sempre giusto,
//     fidarsi di uno fidato travestito no.
//   • flag pericolosi (--force, --hard, -rf…) alzano un livello ≤2 a 3.
//   • SCARICARE DALLA RETE FACENDO ATTERRARE UN FILE SU DISCO è sempre livello 3
//     (digita "conferma"). L'invariante è sull'EFFETTO, non sul nome del flag:
//     wget scrive un file anche senza alcun flag di output, e la CARTELLA in cui
//     lo scrive la sceglie l'assistente da sé con un `cd` (livello 1, nessuna
//     conferma, persistente).
//     Quindi WGET È SEMPRE 3, senza eccezioni: l'unica sua forma che davvero non
//     fa atterrare niente (`--spider`) NON viene più esentata. Un'esenzione la si
//     decide per forza leggendo il TESTO del comando, ma chi il comando lo compone
//     può far comparire quella parola dove wget non la applica — dopo un `--`
//     (`wget -N -- http://x --spider`: da lì in poi sono indirizzi), dentro le
//     virgolette (`wget "http://x" " --spider "`), dentro l'URL stesso
//     (`wget "http://x#  --spider "`) — e riavere lo scaricamento con un solo
//     clic. Riconoscere "davvero un'opzione" richiederebbe di riprodurre il
//     parsing di getopt e del quoting: fuori dal principio del file. Toglierla
//     costa una conferma in più su un comando raro (per la sola verifica di un
//     indirizzo c'è `curl -I`, che stampa a schermo e resta 2) e chiude la porta.
//     curl invece, SENZA flag che scrivono o mandano dati, stampa a schermo e non
//     fa atterrare niente: resta 2. Due programmi che si comportano diversamente prendono
//     regole diverse — è l'effetto a decidere. Salgono a 3 i flag curl che fanno
//     atterrare qualcosa: output-su-file (-o/-O/--output/--remote-name…), i DATI
//     ACCESSORI il cui contenuto è influenzato dal server (-D/--dump-header,
//     -c/--cookie-jar, --etag-save, --trace/--trace-ascii, --stderr, --libcurl,
//     --hsts, --alt-svc, --metalink, `-w '%output{...}'`) e -K/--config, che nasconde
//     l'output dentro un file di opzioni.

(function (global) {
  'use strict';

  // Metacaratteri che rendono il comando composto o non riconoscibile → 3.
  const CHAIN_RE = /[|;&`<>]|\$\(|\$\{|\r|\n/;

  // Codice arbitrario o distruzione di stato: SEMPRE 3, controllati per primi, backstop
  // anche se finissero in una whitelist.
  const ALWAYS_3 = new Set([
    'rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'deltree', 'shred',
    'format', 'mkfs', 'fdisk', 'diskpart', 'dd', 'shutdown', 'reboot',
    'restart', 'halt', 'poweroff', 'kill', 'killall', 'taskkill', 'pkill',
    'reg', 'regedit', 'sc', 'net', 'netsh', 'fsutil', 'bcdedit', 'mklink',
    'chmod', 'chown', 'chgrp', 'attrib', 'icacls', 'takeown',
    // Shell ed esecutori diretti: SEMPRE 3, senza l'eccezione «versione» — anche `bash` da
    // solo apre una sessione interattiva.
    'sh', 'bash', 'zsh', 'fish', 'powershell', 'pwsh', 'cmd', 'eval', 'exec',
    'ssh', 'scp', 'sudo', 'su', 'doas',
  ]);

  // Interpreti, build tool e runner eseguono codice arbitrario → 3. Eccezione: la pura
  // interrogazione di versione o aiuto è sola lettura → 1.
  const ARBITRARY_CODE = new Set([
    'node', 'deno', 'bun', 'ts-node', 'tsx', 'python', 'python3', 'py', 'ruby',
    'perl', 'php', 'osascript', 'npx', 'pnpm', 'yarn', 'make', 'cmake', 'cargo',
    'go', 'rustc', 'gcc', 'g++', 'clang', 'docker', 'docker-compose', 'podman',
    'kubectl', 'helm', 'terraform', 'ansible', 'java', 'javac', 'dotnet', 'mvn',
    'gradle', 'tsc', 'dart', 'flutter', 'scala', 'kotlin', 'julia', 'lua',
    'code', 'rustup', 'rbenv', 'pyenv', 'nvm', 'composer', 'bundle', 'gem',
  ]);

  // Token che da soli rendono il comando una pura interrogazione. `-v`/`-V` qui valgono
  // «version»: un `cmd -v` senza operandi non compie nessuna azione.
  const VERSION_TOKENS = new Set([
    '--version', '-version', '-v', '-V', 'version', '--help', '-help', '-h',
    'help', '/?', '/version', '--usage', '-?',
  ]);

  // Serve almeno un token di versione o aiuto: un programma nudo come `node` apre un REPL
  // e non è lettura sicura.
  function isVersionQuery(cmd) {
    const rest = tokens(cmd).slice(1);
    if (!rest.length) return false;
    return rest.every((t) => VERSION_TOKENS.has(t.toLowerCase()));
  }

  // Sola lettura, nessun effetto sullo stato: livello 1.
  const LEVEL1 = new Set([
    // `cd` cambia solo la cartella di lavoro ed è la primitiva di navigazione dell'assistente:
    // chiedere conferma a ogni spostamento la renderebbe inutilizzabile.
    'cd', 'chdir',
    'ls', 'dir', 'pwd', 'cat', 'type', 'echo', 'whoami', 'hostname', 'date',
    'where', 'which', 'head', 'tail', 'tree', 'wc', 'ver', 'uname', 'more',
    'clear', 'cls', 'grep', 'findstr', 'stat', 'basename', 'dirname',
    'realpath', 'readlink', 'du', 'df', 'uptime', 'id', 'groups', 'whatis',
    'cal', 'nproc', 'arch',
    'ps', 'free', 'lscpu', 'lsblk', 'lsusb', 'printenv', 'whereis', 'who',
    'w', 'vmstat', 'lsof', 'column', 'cut', 'uniq', 'nl', 'file',
    'md5sum', 'sha1sum', 'sha256sum', 'cksum',
  ]);

  // Alcuni LEVEL1 leggono finché non ricevono gli argomenti che ne cambiano il senso: `date`
  // legge, `date -s` IMPOSTA. Il predicato riceve il comando intero e torna true se MODIFICA.
  const LEVEL1_MUTATES = {
    // `date -s`/`--set` imposta l'orologio; `+%F`, `-u`, `-d` sono letture.
    date: (cmd) => /(^|\s)(-s|--set)(=|\s|$)/i.test(cmd),
    // `hostname <nome>` o `-F file` imposta il nome host; i flag di lettura no.
    // Attenzione: qui `-s` è «short», non «set».
    hostname: (cmd) => {
      const rest = tokens(cmd).slice(1);
      // `-F`/`--file` è case-sensitive: `-f` = fqdn è lettura e non deve combaciare.
      return rest.some((t) => /^(-F|--file)$/.test(t) || !t.startsWith('-'));
    },
  };

  // Modifica lo stato ma in modo recuperabile: livello 2.
  const LEVEL2 = new Set([
    'mkdir', 'md', 'touch', 'cp', 'copy', 'xcopy', 'robocopy', 'move', 'mv',
    'ren', 'rename', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'curl', 'wget',
    'ln',
  ]);

  // Su Windows la shell è PowerShell: senza questa whitelist elencare una cartella costava la
  // frizione di un `rm -rf`. Entra solo il cmdlet che NON ha una forma capace di scrivere.
  const PS_READ = new Set([
    'get-childitem', 'gci', 'get-content', 'gc', 'get-item', 'gi',
    'get-itemproperty', 'gp', 'get-itempropertyvalue', 'get-location', 'gl',
    'get-date', 'get-process', 'gps', 'get-service', 'get-help', 'get-member',
    'get-alias', 'get-variable', 'get-module', 'get-psdrive', 'get-host',
    'get-command', 'get-history', 'get-computerinfo', 'get-culture',
    'get-timezone', 'get-random', 'get-unique',
    'select-string', 'sls', 'select-object', 'select', 'sort-object',
    'measure-object', 'measure', 'group-object', 'group', 'compare-object',
    'test-path', 'resolve-path', 'split-path', 'join-path', 'convert-path',
    'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw',
    'out-string', 'out-host', 'out-null', 'write-output', 'write-host',
    'convertto-json', 'convertfrom-json', 'convertto-csv', 'convertfrom-csv',
    'convertfrom-stringdata', 'get-filehash',
    // Navigazione pura: come `cd`, cambiano solo la cartella di lavoro.
    'set-location', 'sl', 'pushd', 'popd',
  ]);
  // Alias esclusi apposta perché su un'altra shell sono un programma che SCRIVE (`sort`,
  // `gm`, `gcm`, `compare`), e non si sa quale shell eseguirà. I nomi lunghi restano ammessi.

  // Valgono solo DENTRO una pipeline: da soli non ricevono niente da filtrare.
  const PS_PIPE_ONLY = new Set(['where-object', 'where', '?', 'foreach-object', 'foreach', '%']);
  // ForEach-Object senza scriptblock usa la forma «nome di membro», che INVOCA il metodo su
  // ogni oggetto: `gci | % Delete` cancella i file. Lo scriptblock validato è obbligatorio.
  const PS_FOREACH = new Set(['foreach-object', 'foreach', '%']);

  // Uno scriptblock è il buco della pipeline: `gci | % { Remove-Item $_ }` è una cancellazione
  // travestita. Non si interpreta il contenuto: si pretende INERTE, nessun token che invochi.
  function scriptBlockIsInert(inner) {
    const s = String(inner);
    if (/[=(){}`;&|<>@]|::/.test(s)) return false;
    for (const t of s.trim().split(/\s+/).filter(Boolean)) {
      if (/^[A-Za-z_]/.test(t)) return false;              // parola nuda = comando
      if (/^\.{1,2}$/.test(t)) return false;               // dot-sourcing
      if (/[\\/]/.test(t) && !/^-/.test(t)) return false;  // percorso di un eseguibile
    }
    return true;
  }

  // Stessa funzione per il cmdlet isolato e per ogni pezzo di pipeline, così i due cammini
  // non divergono. Riceve il segmento GREZZO: i letterali quotati vanno visti prima.
  function segmentIsRead(seg, inPipeline) {
    // `%{...}` e `?{...}` senza spazio sono PowerShell normale: le graffe si isolano come
    // token a sé prima di guardare programma e blocco.
    const norm = String(seg).replace(/\{/g, ' { ').replace(/\}/g, ' } ');
    // Il primo token dev'essere il comando NUDO: senza `isBareName` un file su disco chiamato
    // come il cmdlet fidato verrebbe scambiato per lui.
    if (!isBareName(tokens(norm)[0])) return false;
    // I letterali fra virgolette sono inerti e diventano `0`: un confronto con una stringa passa
    // e un metacarattere dentro le virgolette non alza il livello. Ciò che invoca sta fuori.
    const noStr = norm.replace(/'[^']*'/g, ' 0 ').replace(/"[^"]*"/g, ' 0 ');
    // Sottoespressioni, chiamate, hashtable, redirezioni, membri statici: dentro può
    // nascondersi qualunque cosa.
    if (/[`()<>;&|@]|\$\(|\$\{|::/.test(noStr)) return false;
    const open = (noStr.match(/\{/g) || []).length;
    const close = (noStr.match(/\}/g) || []).length;
    if (open !== close || open > 1) return false; // graffe sbilanciate o annidate
    if (open === 1) {
      const i = noStr.indexOf('{');
      const j = noStr.lastIndexOf('}');
      if (j < i || !scriptBlockIsInert(noStr.slice(i + 1, j))) return false;
    }
    const prog = programOf(norm);
    if (!prog) return false;
    if (ALWAYS_3.has(prog) || ARBITRARY_CODE.has(prog)) return false;
    if (PS_PIPE_ONLY.has(prog)) {
      if (!inPipeline) return false;
      return PS_FOREACH.has(prog) ? open === 1 : true;
    }
    if (PS_READ.has(prog)) return true;
    // In pipeline vale come lettura anche ciò che è già livello 1: `cat file | grep errore`
    // non compie niente di più di `cat file`.
    return inPipeline && classifyOne(seg) === 1;
  }

  // Pura pipeline (solo `|`), senza sequenze, background, redirezioni o sostituzioni:
  // i segmenti, altrimenti null. `||` produce un segmento vuoto e non passa di qui.
  function splitSafePipeline(cmd) {
    if (/[`<>;&]|\$\(|\$\{|\r|\n/.test(cmd)) return null;
    if (cmd.indexOf('|') === -1) return null;
    const parts = cmd.split('|').map((p) => p.trim());
    if (parts.length < 2 || parts.some((p) => !p)) return null;
    return parts;
  }

  // Flag che alzano a 3 un comando altrimenti ≤2.
  const DANGEROUS_FLAG_RE = /(^|\s)(--force|--hard|--delete|--prune|--no-preserve-root|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*)(\s|$)/i;

  // robocopy usa lo slash, che DANGEROUS_FLAG_RE non vede: `/MIR` e `/PURGE` cancellano la
  // destinazione, `/MOVE` la sorgente. Check a sé e case-insensitive, o falsi positivi Unix.
  const ROBOCOPY_DESTRUCTIVE_RE = /(^|\s)\/(MIR|PURGE|MOVE|MOV)(\s|$)/i;

  // curl con un flag di output-su-file scrive dove decide chi compone il comando e può
  // sovrascrivere chiavi SSH o script d'avvio: un «download» diventa una backdoor → 3.
  const CURL_OUTPUT_RE = /(^|\s)(--output|--remote-name|--remote-header-name|-[a-z]*o)/i;

  // curl con `-D`/`--dump-header <file>` scrive gli header della risposta in un
  // percorso arbitrario: il contenuto lo decide il server (quindi l'attaccante
  // che pilota l'assistente da una pagina ostile), rendendolo un altro primitivo
  // di scrittura-su-file arbitraria → 3. Meno potente di `-o`/`-O` (byte header,
  // non corpo scelto liberamente) ma stessa classe: over-cautela = solo attrito.
  // Check curl-specifico e case-SENSITIVE sulla `D`: la `D` maiuscola in curl è
  // solo `--dump-header`, anche in bundle (`-sD file`); `-d` è CURL_SEND_SHORT_RE.
  const CURL_DUMP_RE = /(^|\s)(--dump-header|-[a-zA-Z]*D)/;

  // Altri flag curl che salvano dati influenzati dal server in un percorso scelto: stessa
  // classe di --dump-header → 3. Case-SENSITIVE: `-C`/--continue-at non deve salire.
  const CURL_ACCESSORY_WRITE_RE = /(^|\s)(--cookie-jar|--etag-save|--trace(-ascii)?|--stderr|--libcurl|--hsts|--alt-svc|--metalink)(=|\s|$)|(^|\s)-[a-zA-Z]*c/;

  // curl `-w` è un formato di stampa, ma da 8.3 `%output{FILE}` lo fa atterrare su un file →
  // stessa classe di `-o` → 3. Si cerca la direttiva, non il flag: `-w` da solo resta 2.
  const CURL_WRITE_OUT_FILE_RE = /%output\{/i;

  // curl `-K`/`--config` legge le opzioni da un file, dove può esserci `output = …`: stesso
  // primitivo di `-o` ma invisibile nel comando → 3. `-k`/`--insecure` non scrive niente.
  const CURL_CONFIG_RE = /(^|\s)(--config(=|\s|$)|-[a-zA-Z]*K)/;

  // curl che MANDA qualcosa al server (dati, un file, una mail, comandi FTP) o gli chiede di cambiare (un metodo
  // diverso da GET/HEAD) non si disfa: un file uscito dal computer non torna indietro → 3 (#530). Case-sensitive:
  // -d/-F/-T/-Q/-X in curl sono solo quelli, anche in un bundle; -x minuscolo è il proxy. Un'opzione lunga vale
  // anche accorciata (`--uplo`): curl accetta un prefisso che non è ambiguo.
  const CURL_SEND_SHORT_RE = /(^|\s)-[a-zA-Z]*[dFTQ]/;
  const CURL_SEND_LONG = ['data', 'form', 'form-string', 'upload-file', 'json', 'mail-rcpt', 'mail-from', 'quote'];
  const CURL_METHOD_RE = /(?:^|\s)(?:--request(?:=|\s+)|-[a-zA-Z]*X\s*)["']?([A-Za-z]*)/g;
  function curlCambiaIlServer(cmd) {
    if (CURL_SEND_SHORT_RE.test(cmd)) return true;
    for (const m of cmd.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
      const w = m[1];
      if (w.startsWith('data') || CURL_SEND_LONG.some((n) => n.startsWith(w))) return true;
      if (w !== 'request' && 'request'.startsWith(w) && w.length >= 3) return true;
    }
    for (const m of cmd.matchAll(CURL_METHOD_RE)) if (!/^(GET|HEAD)$/i.test(m[1])) return true;
    return false;
  }

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
  // `checkout` e `stash` non stanno in GIT_WRITE: hanno forme distruttive e forme innocue,
  // quindi il livello dipende dagli argomenti e lo decide GIT_DUAL.
  const GIT_DESTROY = new Set(['reset', 'clean', 'rm', 'gc', 'filter-branch', 'update-ref', 'prune']);

  // npm/pip: il livello dipende dal sotto-comando. `config` non sta qui: è duale (get legge,
  // set cambia anche il registry dei pacchetti) e lo classifica classifyNpm.
  const NPM_READ = new Set(['list', 'ls', 'view', 'show', 'outdated', 'root', 'bin', 'prefix', 'ping', 'doctor', 'whoami', 'help', 'search']);
  const NPM_WRITE = new Set(['install', 'i', 'ci', 'add', 'update', 'upgrade', 'uninstall', 'remove', 'rm', 'dedupe', 'prune', 'link', 'rebuild']);
  // npm run/exec/start/test/publish eseguono script arbitrari o pubblicano in modo
  // irreversibile: restano fuori → 3.

  function tokens(cmd) {
    // Spezzare sugli spazi basta per leggere programma e flag: i comandi con quoting
    // interessante finiscono comunque a 3.
    return String(cmd).trim().split(/\s+/).filter(Boolean);
  }

  // Le virgolette non cambiano il comando che la shell esegue ma possono nascondere ai
  // controlli programma e bersaglio: toglierle può solo far salire il livello, mai scendere.
  function unquote(tok) {
    return String(tok).replace(/['"]/g, '');
  }

  // La forma su cui girano tutti i controlli: whitelist, flag pericolosi, bersagli.
  function dequote(cmd) {
    return tokens(cmd).map(unquote).join(' ');
  }

  function programOf(cmd) {
    const first = tokens(cmd)[0] || '';
    const bare = unquote(first);
    return bare.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1|com|msi)$/i, '');
  }

  // Se il primo token ha un'estensione eseguibile è un FILE su disco, non il comando di
  // sistema che ne condivide il nome.
  const EXE_EXT_RE = /\.(exe|cmd|bat|ps1|psm1|com|msi|vbs|vbe|wsf|wsh|scr|pif|cpl|msc|jar|js|jse|ps1xml)$/i;

  // `programOf` normalizza per il backstop (`/bin/rm` resta 3), ma per FIDARSI serve di più:
  // un nome è «nudo» solo senza separatori, estensione eseguibile o prefisso di chiamata.
  function isBareName(tok) {
    const t = unquote(String(tok || ''));
    if (!t) return false;
    if (/[\\/]/.test(t)) return false;   // qualunque separatore di percorso
    if (/^[.&]/.test(t)) return false;   // .\  ./  .  &  (chiamata / dot-source)
    if (EXE_EXT_RE.test(t)) return false; // estensione eseguibile = file, non cmdlet
    return true;
  }

  // sotto-comando = primo token che non è una flag (dopo il programma)
  function subcommandOf(cmd) {
    const t = tokens(cmd).slice(1).map(unquote);
    for (const x of t) {
      if (x && !x.startsWith('-')) return x.toLowerCase();
    }
    return '';
  }

  // In git i flag distruttivi sono più ricchi: anche `-f`, `-d`/`-D`, `--delete`, `--prune`.
  // Check git-specifico, perché su `tar -f` quelle lettere vogliono dire altro.
  const GIT_DANGER_RE = /(^|\s)(--force(-with-lease)?|--hard|--delete|--prune|--discard-changes|-f|-d|-D|-[a-z]*f[a-z]*d[a-z]*|-[a-z]*d[a-z]*f[a-z]*)(\s|$)/i;

  // Argomenti dopo il sotto-comando: `git tag v1.0` → ['v1.0'], `git branch` → [].
  function gitArgsAfterSub(cmd) {
    // Token già spogliati: `git checkout ".."` e `git checkout ..` valgono uguale.
    const t = tokens(cmd).slice(1).map(unquote).filter(Boolean);
    const i = t.findIndex((x) => !x.startsWith('-')); // posizione del sotto-comando
    return i < 0 ? [] : t.slice(i + 1);
  }
  const hasOperand = (args) => args.some((a) => !a.startsWith('-'));

  // Varianti di un operando come le leggerebbero le shell: senza virgolette, col backslash
  // come escape (bash) e come separatore (Windows). Se una è distruttiva, si alza.
  function argVariants(arg) {
    const a = String(arg);
    return [a, a.replace(/\\(.)/g, '$1'), a.replace(/\\/g, '/')];
  }

  // L'operando prende di mira FILE invece di un ramo? `git checkout <percorso>` SCARTA le
  // modifiche non salvate. I nomi di ramo comuni non combaciano e restano a conferma leggera.
  function looksLikePathspec(arg) {
    for (const v of argVariants(arg)) {
      const bare = v.replace(/[\\/]+$/, ''); // `./` → `.`, `src/` → `src`
      if (bare === '' || bare === '.' || bare === '..') return true; // cartella corrente
      if (/^\.{1,2}[\\/]/.test(v)) return true;                      // ./x, ../x, .\x
      if (/[*?[\]]/.test(v)) return true;                            // glob: *.js, src/*
      if (/^[\\/]/.test(v) || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('~/')) return true; // assoluti
      if (/[\\/]$/.test(v)) return true;                             // finisce con separatore = cartella
      if (/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(v)) return true;        // file con estensione
    }
    return false;
  }

  // Sotto-comandi il cui livello dipende dagli argomenti: i duali ELENCANO (1) da nudi e
  // CREANO (2) con un operando; `checkout` e `stash` hanno anche forme distruttive (3).
  const GIT_DUAL = {
    tag: (cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
    branch: (cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
    // `git checkout` è distruttivo quando prende di mira un pathspec: ripristina i file dal ref
    // buttando via le modifiche locali → 3. Cambio o creazione di ramo restano 2.
    checkout: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      // `--` separa esplicitamente i pathspec: tutto ciò che segue è un file da ripristinare.
      if (args.includes('--')) return 3;
      // Flag che dichiarano «sto lavorando sui FILE» anche senza scrivere il percorso:
      // `--pathspec-from-file`, `-p`/`--patch`, `--ours`/`--theirs` scartano comunque modifiche.
      if (args.some((a) => /^(--pathspec-from-file(=|$)|--pathspec-file-nul$|-p$|--patch$|--ours$|--theirs$)/.test(a))) return 3;
      // `-b`/`-B`/`--orphan`/`--detach` creano o spostano un ramo, non toccano i path.
      if (args.some((a) => /^(-b|-B|--orphan|--detach)$/.test(a))) return 2;
      const ops = args.filter((a) => !a.startsWith('-'));
      if (ops.some(looksLikePathspec)) return 3; // scarta le modifiche dei file
      if (ops.length >= 2) return 3;             // `<ref> <path>` senza `--`
      return 2;                                  // cambio ramo (0-1 operando)
    },
    // `git stash` salva ed è recuperabile con pop → 2; `drop` e `clear` eliminano stash
    // salvati in modo irreversibile → 3.
    stash: (cmd) => {
      const raw = gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'))[0] || '';
      // Anche qui la lettura «come la farebbe la shell»: `git stash d\rop` elimina lo stash.
      const verbs = argVariants(raw).map((v) => v.toLowerCase());
      return verbs.some((v) => v === 'drop' || v === 'clear') ? 3 : 2;
    },
    config: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      const low = args.map((a) => a.toLowerCase());
      if (low.some((a) => a === '--unset' || a === '--unset-all' || a === '--remove-section')) return 3;
      const ops = args.filter((a) => !a.startsWith('-'));
      // Riscrivere l'indirizzo di un remoto è `git remote set-url` per un'altra strada (#530).
      const scrive = ops.length >= 2 || low.some((a) => a === '--add' || a === '--replace-all');
      if (scrive && /^remote\..+\.(push)?url$|^url\..+\.(push)?insteadof$/.test((ops[0] || '').toLowerCase())) return 3;
      if (low.some((a) => a === '--add' || a === '--replace-all' || a === '--rename-section' || a === '-e' || a === '--edit')) return 2;
      if (ops.length >= 2) return 2; // `chiave valore` imposta
      // Lettura: un dump completo, o una chiave che porta credenziali (URL di un
      // remoto con token, `credential.helper`), stampa un segreto in chiaro nella
      // conversazione → conferma (#587). Una chiave innocua (`user.email`) resta 1.
      if (low.some((a) => a === '--list' || a === '-l' || a === '--get-regexp' || a === '--get-urlmatch')) return 2;
      return /(^|\.)url$|credential|password|token/.test((ops[0] || '').toLowerCase()) ? 2 : 1;
    },
    remote: (cmd) => {
      const ops = gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'));
      // `git remote -v` elenca gli URL, che possono contenere un token → conferma.
      if (!ops.length) return /(^|\s)(-v|--verbose)(\s|$)/.test(cmd) ? 2 : 1;
      const action = ops[0].toLowerCase();
      if (action === 'show' || action === 'get-url') return 2; // stampano l'URL col token
      if (action === 'remove' || action === 'rm' || action === 'prune') return 3; // cancellazioni
      // Un indirizzo nuovo decide dove andrà il codice al prossimo push: un server qualsiasi (#530).
      if (action === 'add' || action === 'set-url') return 3;
      return 2; // rename, set-head, set-branches, update…
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
    // Il push verso il remoto già configurato si rimedia; verso un indirizzo scritto nel comando manda il codice
    // a un server qualsiasi, e non torna indietro (#530).
    if (sub === 'push' && gitArgsAfterSub(cmd).some((a) => /:\/\//.test(a) || /^(--repo=)?[^\s/:=-][^\s/:=]*@[^\s:]+:/.test(a))) return 3;
    if (GIT_WRITE.has(sub)) return 2;
    return 3; // sotto-comando git sconosciuto → cautela
  }

  function classifyNpm(cmd) {
    const sub = subcommandOf(cmd);
    if (!sub) return 1; // `npm` da solo → help
    // `config`: leggere è lettura, ma set/delete/edit cambiano anche il REGISTRY, cioè da dove
    // npm e pip scaricano ed eseguono codice. Reindirizzarlo non è lettura → 2.
    if (sub === 'config') {
      const rest = tokens(cmd).slice(1).map(unquote).filter((t) => !t.startsWith('-'));
      const verb = (rest[1] || '').toLowerCase(); // rest[0] === 'config'
      // `get`/`list`/`ls` stampano la configurazione, dove l'URL del registro o
      // dell'indice porta spesso utente e password o un token → conferma (#587).
      if (verb === 'get' || verb === 'list' || verb === 'ls') return 2;
      if (!verb || verb === 'debug') return 1;
      return 2;
    }
    if (NPM_READ.has(sub)) return 1;
    if (NPM_WRITE.has(sub)) return 2;
    return 3; // run/exec/start/test/publish/sconosciuti → 3
  }

  // Sequenza pura (`&&`/`||`/`;`) senza pipe, background, redirezioni o sostituzioni → i
  // singoli comandi: si prende il massimo, concatenare due letture non le rende un'azione.
  function splitSafeSequence(cmd) {
    // Metacaratteri che non sono sequenziamento: redirezioni, sostituzioni, backtick, newline.
    if (/[`<>]|\$\(|\$\{|\r|\n/.test(cmd)) return null;
    const parts = cmd.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
    // Un `&` o `|` solitario rimasto dopo aver tolto `&&`/`||`/`;` è background o pipe:
    // non è una sequenza sicura.
    for (const p of parts) {
      if (/[&|]/.test(p)) return null;
    }
    return parts;
  }

  // Livello di un SINGOLO comando (senza metacaratteri di sequenza).
  function classifyOne(raw) {
    // Si valuta sempre la forma senza virgolette: `git push "--force"` fa ciò che farebbe senza
    // e deve avere lo stesso livello. I metacaratteri erano già intercettati sul testo grezzo.
    const trimmed = dequote(raw);
    const prog = programOf(trimmed);
    if (!prog) return 3;
    if (ALWAYS_3.has(prog)) return 3; // backstop: vale anche col percorso (`/bin/rm`)

    // Superato il backstop, la whitelist si fida solo di un nome invocato nudo: un file su
    // disco che si chiama come un comando fidato è un eseguibile arbitrario → 3.
    if (!isBareName(tokens(trimmed)[0])) return 3;

    if (prog === 'git') return classifyGit(trimmed);
    if (prog === 'npm' || prog === 'pip' || prog === 'pip3') return classifyNpm(trimmed);

    // Codice arbitrario → 3, salvo la sola interrogazione di versione o aiuto → 1.
    if (ARBITRARY_CODE.has(prog)) return isVersionQuery(trimmed) ? 1 : 3;

    if (LEVEL1.has(prog)) {
      // Quasi tutti i LEVEL1 restano 1 anche con flag; fanno eccezione i pochi che con certi
      // argomenti IMPOSTANO lo stato.
      const mutates = LEVEL1_MUTATES[prog];
      return mutates && mutates(trimmed) ? 2 : 1;
    }
    // Anche un comando LEVEL2 ridotto a `--version`/`--help` è sola lettura → 1.
    if (LEVEL2.has(prog)) {
      if (isVersionQuery(trimmed)) return 1;
      // wget SCARICA SEMPRE SU FILE: anche senza flag crea un file nella cwd, che l'assistente
      // sposta da sé con `cd`. Nessuna eccezione, `--spider` compreso: si deciderebbe dal testo.
      if (prog === 'wget') return 3;
      if (prog === 'curl' && CURL_OUTPUT_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_DUMP_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_ACCESSORY_WRITE_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_WRITE_OUT_FILE_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_CONFIG_RE.test(trimmed)) return 3;
      if (prog === 'curl' && curlCambiaIlServer(trimmed)) return 3;
      // robocopy /MIR /PURGE (cancellano la destinazione) / /MOVE /MOV
      // (cancellano la sorgente): distruzione permanente → 3.
      if (prog === 'robocopy' && ROBOCOPY_DESTRUCTIVE_RE.test(trimmed)) return 3;
      return DANGEROUS_FLAG_RE.test(trimmed) ? 3 : 2;
    }

    // Cmdlet PowerShell di lettura: 1 solo se superano anche i controlli strutturali.
    // Si passa `raw`, con le virgolette: i letterali quotati vanno riconosciuti inerti.
    if (PS_READ.has(prog) && segmentIsRead(raw, false)) return 1;

    return 3; // comando non riconosciuto → livello 3 di default
  }

  // ── Perimetro di lettura (#587) ──────────────────────────────────────────
  // Una lettura resta livello 1 solo se ciò che stampa sta nella cartella
  // personale, fuori da file nascosti e cartelle di profilo; il resto chiede un
  // OK. `cd` resta libero, quindi conta il percorso RISOLTO, non la cartella di
  // lavoro. Il contesto `{ cwd, home, win, maiuscole }` lo inietta il main.
  const MOTIVI = {
    fuori: 'legge fuori dalla tua cartella personale',
    nascosto: 'legge un file nascosto o di configurazione',
    ignoto: 'non si sa prima quali file leggerà',
    ricorsivo: 'cerca dentro intere cartelle, file nascosti compresi',
    variabili: "legge le variabili d'ambiente",
    sistema: 'legge dati del sistema che non sono file',
    processi: 'mostra i programmi aperti con i loro argomenti',
    rete: 'si collega a un altro computer della rete',
  };
  // Stampano il contenuto dei file che ricevono come operandi.
  const LETTORI = new Set(['cat', 'type', 'more', 'head', 'tail', 'nl', 'cut', 'uniq', 'column', 'get-content', 'gc']);
  // Guardano nomi e metadati: contano solo i percorsi che non sono file (`env:`, `HKCU:`).
  const ELENCHI = new Set([
    'ls', 'dir', 'tree', 'gci', 'get-childitem', 'get-item', 'gi', 'get-itemproperty', 'gp',
    'get-itempropertyvalue', 'stat', 'du', 'file', 'wc', 'test-path', 'resolve-path',
    'convert-path', 'md5sum', 'sha1sum', 'sha256sum', 'cksum', 'get-filehash',
  ]);
  const ELENCA_CARTELLA = new Set(['ls', 'dir', 'tree', 'gci', 'get-childitem']);
  // In PowerShell `gci | gc` legge il CONTENUTO dei file elencati: quali, non si sa prima.
  const ELENCA_OGGETTI = new Set(['ls', 'dir', 'gci', 'get-childitem', 'get-item', 'gi']);
  const LETTI_DAL_TUBO = new Set(['cat', 'type', 'gc', 'get-content', 'select-string', 'sls']);
  // Le righe di comando degli altri programmi portano token e password (`ps e` anche l'ambiente).
  const PROCESSI = new Set(['ps', 'get-process', 'gps', 'w']);
  const SPOSTAMENTI = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'popd']);
  // Stampano i loro argomenti e basta: il testo conta solo se qualcuno lo usa (tubo, gruppo).
  const STAMPANO = new Set(['echo', 'write-output', 'write-host', 'out-string', 'out-host']);
  // Usano gli operandi come percorsi (i lettori hanno il loro controllo, `fuoriDa`).
  const PRENDONO_PERCORSI = new Set([...ELENCHI, ...SPOSTAMENTI, 'split-path', 'join-path']);
  // I cmdlet che legano al percorso ciò che arriva dal tubo (`cat`/`ls`/`cd` sono loro alias in PowerShell).
  const PERCORSO_DAL_TUBO = new Set([
    'test-path', 'get-childitem', 'gci', 'ls', 'dir', 'get-item', 'gi', 'get-itemproperty', 'gp',
    'get-itempropertyvalue', 'resolve-path', 'convert-path', 'get-filehash', 'set-location', 'sl', 'cd',
    'chdir', 'pushd', 'split-path', 'join-path', 'cat', 'type', 'gc', 'get-content',
  ]);
  // Danno valori che si leggono nel comando (o elencano file già misurati), non testo preso da un file.
  const FONTI_NOTE = new Set([
    ...ELENCA_OGGETTI, ...SPOSTAMENTI, 'echo', 'write-output', 'join-path', 'split-path', 'resolve-path',
    'convert-path', 'get-location', 'gl', 'pwd', 'test-path', 'get-date', 'where-object', 'where', '?',
    'sort-object', 'select-object', 'select', 'measure-object', 'measure',
  ]);
  // Compongono un percorso: sul valore del tubo il risultato non si legge nel comando (#1072.4).
  const CALCOLANO = new Set(['join-path', 'split-path']);
  // Cercano il comando o lo script indicato anche nella cartella di lavoro (`.\x`).
  const CERCANO_NOME = new Set(['get-command', 'get-help']);
  // Cartelle di profilo appena sotto la home (`Application Data` e `Cookies` sono giunzioni verso AppData).
  const PROFILO = new Set(['appdata', 'application data', 'local settings', 'cookies', 'library', '_netrc']);
  // Dentro la Libreria del Mac stanno anche i documenti nel cloud dell'utente (iCloud Drive; Dropbox, OneDrive e
  // Google Drive da macOS 12): si leggono come Documenti (#947.3).
  const PROFILO_APERTE = { library: ['Mobile Documents', 'CloudStorage'] };
  const JOLLY = /[*?[\]{}\uFFFD]/;
  // Dove stava un gruppo `( \u2026 )`: un valore che si conosce solo eseguendolo (vedi `smonta`).
  const SEGNAPOSTO = '$_\uE000';
  // `'` e `\"` dove sono un carattere qualunque (vedi `comeLaShell`): nessun controllo li prende per virgolette.
  const APICE_TESTO = '\u02BC';
  const VIRGOLETTE_TESTO = '\u02BA';
  // Senza contesto: cartella di lavoro e home coincidono, un relativo si dà per interno.
  const SENZA_CONTESTO = { cwd: '/~', home: '/~', win: false, maiuscole: false };

  const UNO = { level: 1, motivo: '' };
  const TRE = { level: 3, motivo: '' };
  const due = (motivo) => ({ level: 2, motivo });
  const peggiore = (a, b) => (b.level > a.level ? b : a);

  // Variabili che portano percorsi, nomi o valori della shell, non segreti: la
  // cartella personale, le cartelle di sistema, `$_` delle pipeline PowerShell.
  const VAR_INNOCUE = new Set([
    'home', 'userprofile', 'homedrive', 'homepath', 'temp', 'tmp', 'tmpdir', 'appdata', 'localappdata',
    'public', 'onedrive', 'systemroot', 'windir', 'programfiles', 'programdata', 'username', 'user',
    'computername', 'hostname', 'pwd', 'oldpwd', 'path', 'shell', 'lang', '_', 'psitem', 'true', 'false', 'null',
  ]);
  const DOLLARO_RE = /\$(?:env:)?([A-Za-z_]\w*)/gi;
  const PERCENTO_RE = /%([A-Za-z_][\w()]*)(?::[^%]*)?%/gi;

  function nomiVariabili(t, { dollaro = true, percento = true } = {}) {
    const out = [];
    if (dollaro) for (const m of String(t).matchAll(DOLLARO_RE)) out.push(m[1].toLowerCase());
    if (percento) for (const m of String(t).matchAll(PERCENTO_RE)) out.push(m[1].toLowerCase());
    return out;
  }

  // sh e bash (anche su Windows) tolgono i backslash e decodificano `$'…'`; PowerShell e cmd no.
  // Fuori da Windows una shell non indicata è POSIX: lì non ce ne sono altre. Senza contesto il sistema non si sa.
  function shellPosix(c) {
    if (c.sistemaIgnoto) return false;
    return c.win ? c.shell === 'sh' || c.shell === 'bash' : c.shell !== 'powershell' && c.shell !== 'cmd';
  }

  // /bin/sh su Debian e Ubuntu è dash, che non conosce `$'…'`: lì `\'` chiude la stringa e il resto diventa
  // altri argomenti. Dove sh può essere dash si misurano tutte e due le letture (#1511).
  function forseDash(c) {
    return shellPosix(c) && !c.win && c.shell !== 'bash';
  }
  // Senza un `\'` le due letture hanno gli stessi confini, e quella di dash è un nome con `$` e backslash letterali.
  const APICE_CHE_DASH_CHIUDE = /\$'(?:[^'\\]|\\[^'])*\\'/;

  const ESCAPE_ANSI = { a: 7, b: 8, e: 27, E: 27, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '\'': 39, '"': 34, '?': 63 };
  const UTF8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;

  function byteUtf8(cp, b) {
    if (cp < 0x80) b.push(cp);
    else if (cp < 0x800) b.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) b.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else b.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }

  // Il contenuto di `$'…'` come lo produce bash (da `i`, dopo l'apice). `ignoto`: un escape che non si
  // riconosce, un NUL o byte che non sono UTF-8; lì le shell non concordano e il percorso non si sa.
  function ansiC(s, i) {
    const b = [];
    let ignoto = false;
    const hex = (k, max) => { let n = 0; while (n < max && /[0-9A-Fa-f]/.test(s[k + n] || '')) n += 1; return n; };
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\'') break;
      if (ch !== '\\') { const cp = s.codePointAt(i); byteUtf8(cp, b); if (cp > 0xffff) i += 1; continue; }
      const e = s[i + 1];
      if (e === undefined) { ignoto = true; break; }
      i += 1;
      if (Object.prototype.hasOwnProperty.call(ESCAPE_ANSI, e)) { b.push(ESCAPE_ANSI[e]); continue; }
      if (/[0-7]/.test(e)) {
        let v = Number(e);
        for (let n = 0; n < 2 && /[0-7]/.test(s[i + 1] || ''); n++) { i += 1; v = v * 8 + Number(s[i]); }
        b.push(v & 0xff);
        continue;
      }
      if (e === 'x' || e === 'u' || e === 'U') {
        const n = hex(i + 1, e === 'x' ? 2 : e === 'u' ? 4 : 8);
        if (!n) { ignoto = true; continue; }
        const v = parseInt(s.slice(i + 1, i + 1 + n), 16);
        i += n;
        if (e === 'x') b.push(v);
        else if (v > 0x10ffff) ignoto = true;
        else byteUtf8(v, b);
        continue;
      }
      if (e === 'c') {
        const x = s[i + 1];
        // Come bash: `\c\` è 0x1c e quel che segue resta com'è (`\c\/` tiene la barra); `\c\\` è uno solo, `\c\'` tiene l'apice.
        if (x === '\\') {
          b.push(0x1c);
          i += 1;
          if (s[i + 1] === '\\') i += 1;
          else if (s[i + 1] === '\'') { b.push(39); i += 1; }
          continue;
        }
        if (x === undefined || x === '\'' || !/[\x20-\x7e]/.test(x)) { ignoto = true; continue; }
        i += 1;
        b.push(x === '?' ? 0x7f : x.toUpperCase().charCodeAt(0) & 0x1f);
        continue;
      }
      ignoto = true;
    }
    if (i >= s.length) ignoto = true;
    let testo = '';
    if (b.includes(0) || !UTF8) ignoto = true;
    else { try { testo = UTF8.decode(new Uint8Array(b)); } catch (_) { ignoto = true; } }
    return { testo, fine: i, ignoto };
  }

  // Argomenti come li vede la shell: le virgolette raggruppano (un percorso con
  // spazi è UNO) e `variabile` segna un'espansione che può portare un segreto:
  // fuori da `echo` finisce comunque stampata nei messaggi d'errore.
  // Su Windows `\` prima di uno spazio è la fine di un percorso (`src\ \\host\x` sono due operandi), non un escape.
  function argomenti(raw, c) {
    const win = c.win;
    const posix = shellPosix(c);
    const out = [];
    const s = String(raw);
    let cur = '';
    let espande = ''; // il testo fuori dagli apici singoli, dove `$` si espande
    let q = '';
    let aperto = false;
    let ignoto = false;
    const chiudi = () => {
      if (cur || aperto) {
        // `%NOME%` si espande in cmd anche fra virgolette; `+%H:%M` è il formato di `date`.
        const nomi = nomiVariabili(espande, { percento: false })
          .concat(cur.startsWith('+') ? [] : nomiVariabili(cur, { dollaro: false }));
        out.push({ testo: cur, variabile: nomi.some((n) => !VAR_INNOCUE.has(n)), ignoto });
      }
      cur = ''; espande = ''; aperto = false; ignoto = false;
    };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === q) { q = ''; continue; }
        if (posix && q === '"' && ch === '\\' && /[$`"\\]/.test(s[i + 1] || '')) { cur += s[i + 1]; espande += ch + s[i + 1]; i += 1; continue; }
        cur += ch;
        if (q === '"') espande += ch;
        continue;
      }
      // Il classificatore misura il percorso che vedrà la shell: `$'\x2essh'` è `.ssh`, `.\ssh` pure (#1511).
      if (posix && !c.senzaAnsi && ch === '$' && s[i + 1] === '\'') {
        const r = ansiC(s, i + 2);
        cur += r.testo;
        if (r.ignoto) ignoto = true;
        aperto = true;
        i = r.fine;
        continue;
      }
      if (ch === '$' && (s[i + 1] === '\'' || s[i + 1] === '"')) { aperto = true; continue; }
      if (ch === '"' || ch === '\'') { q = ch; aperto = true; espande += ' '; continue; }
      if (posix && ch === '\\' && i + 1 < s.length) { cur += s[i + 1]; espande += ch + s[i + 1]; i += 1; continue; }
      if (!win && ch === '\\' && /\s/.test(s[i + 1] || '')) { cur += s[i + 1]; i += 1; continue; }
      if (/\s/.test(ch)) { chiudi(); continue; }
      cur += ch;
      espande += ch;
    }
    chiudi();
    return out;
  }

  function pezzi(s) {
    return String(s || '').split(/[\\/]+/).filter(Boolean);
  }

  function normalizza(segs) {
    const out = [];
    for (const x of segs) {
      if (x === '.') continue;
      if (x === '..') { out.pop(); continue; }
      out.push(x);
    }
    return out;
  }

  // Dove porta un operando: `{ radice, segs }` assoluto, oppure il motivo per cui non si sa.
  function dove(p0, c) {
    if (!p0) return MOTIVI.ignoto;
    // La cartella personale scritta con una variabile è la cartella personale.
    const p = p0.replace(/^(\$env:userprofile|\$env:home|\$home|%userprofile%|%homedrive%%homepath%)(?=$|[\\/])/i, '~');
    const nomi = nomiVariabili(p);
    if (nomi.length) return nomi.every((n) => VAR_INNOCUE.has(n)) ? MOTIVI.ignoto : MOTIVI.variabili;
    // `FileSystem::x` per PowerShell è il percorso `x`: stesse regole, rete compresa (#1072).
    const prov = /^(?:microsoft\.powershell\.core\\)?filesystem::/i.exec(p);
    if (prov) return dove(p.slice(prov[0].length), c);
    // `\\?\C:\…` è il disco locale; ogni altro doppio separatore (UNC, `\\?\UNC\`, `//server`) e
    // `\??\` fanno contattare a Windows un altro computer: anche solo guardarci chiede un OK (#1072, #810.13).
    if (/^(?:[\\/]{2}[?.]|[\\/]\?\?)[\\/][A-Za-z]:/.test(p)) return MOTIVI.fuori;
    // Senza il nome di un computer dopo le barre (`//`, `// TODO` cercato in un file) non si contatta nessuno.
    if (/^(?:[\\/]{2,}|[\\/]\?\?[\\/]+)[^\s\\/]/.test(p)) return MOTIVI.rete;
    if (/^[A-Za-z][A-Za-z0-9]+:/.test(p)) return MOTIVI.sistema; // `env:`, `HKCU:`, `Registry::`
    let r;
    if (p === '~' || /^~[\\/]/.test(p)) {
      if (!c.home) return MOTIVI.fuori;
      r = { radice: c.home.radice, segs: c.home.segs.concat(pezzi(p.slice(1))) };
    } else if (p.startsWith('~')) {
      return MOTIVI.fuori; // `~utente`, `~+`, `~-`
    } else if (/^[A-Za-z]:/.test(p)) {
      if (!/^[A-Za-z]:[\\/]/.test(p)) return MOTIVI.fuori; // `C:nome` è relativo a un'altra cartella
      r = { radice: `${p[0].toLowerCase()}:`, segs: pezzi(p.slice(2)) };
    } else if (c.win && /^\/mnt\/[A-Za-z](\/|$)/.test(p)) {
      r = { radice: `${p[5].toLowerCase()}:`, segs: pezzi(p.slice(6)) };
    } else if (/^[\\/]/.test(p)) {
      if (!c.win) r = { radice: '/', segs: pezzi(p) };
      else if (c.cwd && c.cwd.radice) r = { radice: c.cwd.radice, segs: pezzi(p) };
      else return c.cwd && c.cwd.rete ? MOTIVI.rete : MOTIVI.fuori;
    } else {
      if (!c.cwd) return MOTIVI.ignoto;
      if (c.cwd.provider) return MOTIVI.sistema;
      if (c.cwd.rete) return MOTIVI.rete;
      r = { radice: c.cwd.radice, segs: c.cwd.segs.concat(pezzi(p)) };
    }
    // Una lettera d'unità che punta a un altro computer (`pushd \\host\x` in cmd ne crea una) è rete anche lei.
    if (c.reti && c.reti.has(r.radice)) return MOTIVI.rete;
    const segs = normalizza(r.segs);
    // Su macOS `/net/<host>` monta da solo le cartelle condivise di quel computer.
    if (!c.win && r.radice === '/' && segs.length > 1 && segs[0] === 'net') return MOTIVI.rete;
    return { radice: r.radice, segs };
  }

  function dentroCasa(r, c) {
    if (!c.home || r.radice !== c.home.radice || r.segs.length < c.home.segs.length) return false;
    const eq = c.maiuscole ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
    return c.home.segs.every((s, i) => eq(s, r.segs[i]));
  }

  // Windows toglie punti e spazi in coda (`AppData.` è AppData); accenti e maiuscole non contano.
  function nomeNorm(seg) {
    return seg.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
      .replace(/[ .]+$/, '').toLowerCase();
  }

  function cartellaDa(r) {
    if (r === MOTIVI.sistema) return { provider: true };
    if (r === MOTIVI.rete) return { rete: true };
    return r && typeof r === 'object' ? r : null;
  }

  function contesto(ctx) {
    const x = ctx && typeof ctx === 'object' ? ctx : SENZA_CONTESTO;
    const reti = Array.isArray(x.reti) ? x.reti.map((u) => String(u).slice(0, 1).toLowerCase() + ':') : [];
    const shell = String(x.shell || '').toLowerCase();
    const c = { win: !!x.win, maiuscole: !!x.maiuscole, home: null, cwd: null, reti: new Set(reti), shell, sistemaIgnoto: x === SENZA_CONTESTO };
    const h = dove(String(x.home || ''), c);
    if (h && typeof h === 'object') c.home = h;
    const cw = String(x.cwd || '');
    if (cw) {
      const r = dove(cw, c);
      c.cwd = cartellaDa(r);
    }
    return c;
  }

  // '' se l'operando sta nel perimetro, altrimenti il motivo (per il popup).
  function fuoriDa(p, c) {
    const op = String(p == null ? '' : p).trim();
    if (!op) return '';
    const r = dove(op, c);
    if (typeof r === 'string') return r;
    if (!dentroCasa(r, c)) return MOTIVI.fuori;
    const sotto = r.segs.slice(c.home.segs.length);
    const propri = new Set(pezzi(op));
    for (let i = 0; i < sotto.length; i++) {
      const s = sotto[i];
      // `~1` è il nome corto 8.3 di Windows: `SSH~1` apre `.ssh`. `:` è un flusso alternativo.
      if (s.startsWith('.') || /~\d/.test(s) || s.includes(':')) return MOTIVI.nascosto;
      // Un jolly in testa può prendere un nome nascosto; appena sotto la home, una
      // cartella di profilo. Eccezione: un jolly che è l'ULTIMO pezzo del percorso
      // e ha un suffisso letterale d'estensione (`*.txt`, `report-*.csv`) prende
      // solo file visibili con quell'estensione — mai `.ssh`, `_netrc`, AppData —
      // ed è la lettura di tutti i giorni («i miei .txt»): resta libera.
      if (propri.has(s) && (JOLLY.test(s[0]) || (i === 0 && JOLLY.test(s)))) {
        const conEstensione = i === sotto.length - 1 && /\.[A-Za-z0-9]+$/.test(s);
        if (!conEstensione) return MOTIVI.ignoto;
      }
      if (i === 0) {
        const n = nomeNorm(s);
        const aperta = sotto.length > 1 && (PROFILO_APERTE[n] || []).some((a) => nomeNorm(a) === nomeNorm(sotto[1]));
        if ((PROFILO.has(n) || n.startsWith('ntuser')) && !aperta) return MOTIVI.nascosto;
      }
    }
    return '';
  }

  // PowerShell lega un parametro col due punti: `-Path:valore` è `-Path valore`.
  // Il valore di QUALUNQUE `-nome:valore` va misurato come un operando: trattarlo
  // da percorso può solo far salire il livello (un valore dentro il perimetro
  // resta 1), mai scenderlo.
  function valoreDuePunti(t) {
    const m = /^-[A-Za-z]+:(.+)$/.exec(String(t || ''));
    return m ? m[1] : null;
  }

  // PowerShell accetta un parametro abbreviato a ogni prefisso non ambiguo: `-N` è `-NoQualifier` (#1072.4).
  function parametro(t, nome, min) {
    const m = /^-([A-Za-z]+)(?::|$)/.exec(String(t || ''));
    return !!m && m[1].length >= min && nome.startsWith(m[1].toLowerCase());
  }

  // Ciò che `Split-Path -NoQualifier` lascia: via `Provider::` o il nome di un'unità qualsiasi (`C:`, `Env:`, `HKCU:`).
  function senzaQualifica(q) {
    const p = /^[^\\/]*?::/.exec(q);
    return p ? q.slice(p[0].length) : q.replace(/^[^\\/:]+:/, '');
  }

  function primoFuori(lista, c) {
    for (const p of lista) {
      // La virgola in PowerShell costruisce un array: `a,b` sono DUE percorsi.
      // Spezzarla aggiunge solo candidati (mai ne toglie), quindi è sicura anche
      // dove la virgola è un carattere valido nel nome di un file.
      for (const q of String(p == null ? '' : p).split(',')) {
        const m = fuoriDa(q, c);
        if (m) return due(m);
      }
    }
    return UNO;
  }

  function operandiLettore(prog, testi) {
    const out = [];
    for (const t of testi) {
      const v = valoreDuePunti(t);
      if (v) { out.push(v); continue; }
      if (t && !t.startsWith('-') && !/^\+\d*$/.test(t) && !(prog === 'more' && /^\/[A-Za-z?]\d*$/.test(t))) out.push(t);
    }
    return out;
  }

  // grep: il primo operando è il modello (salvo `-e`/`-f`), `-f FILE` legge un file.
  function operandiGrep(testi) {
    const file = [];
    const extra = [];
    let modello = false;
    let ricorsivo = false;
    for (let i = 0; i < testi.length; i++) {
      const a = testi[i];
      if (a === '--') { file.push(...testi.slice(i + 1)); break; }
      if (/^--(recursive|dereference-recursive)$/.test(a) || a === '--directories=recurse') { ricorsivo = true; continue; }
      if (a === '--directories') { if (testi[i + 1] === 'recurse') ricorsivo = true; i += 1; continue; }
      if (a === '-e' || a === '--regexp') { modello = true; i += 1; continue; }
      if (a.startsWith('--regexp=')) { modello = true; continue; }
      if (a === '-f' || a === '--file') { modello = true; extra.push(testi[i + 1] || ''); i += 1; continue; }
      if (a.startsWith('--file=')) { modello = true; extra.push(a.slice(7)); continue; }
      if (/^--(max-count|context|after-context|before-context|label|include|exclude|exclude-dir|devices|binary-files)$/.test(a)) { i += 1; continue; }
      if (a.startsWith('--')) continue;
      if (/^-[A-Za-z0-9]+$/.test(a)) {
        if (/[rR]/.test(a)) ricorsivo = true;
        const ultima = a[a.length - 1];
        if (ultima === 'e') { modello = true; i += 1; } else if (ultima === 'f') { modello = true; extra.push(testi[i + 1] || ''); i += 1; } else if ('ABCmdD'.includes(ultima)) {
          if (ultima === 'd' && testi[i + 1] === 'recurse') ricorsivo = true;
          i += 1;
        }
        continue;
      }
      if (a.startsWith('-') && a.length > 1) continue;
      file.push(a);
    }
    if (!modello) file.shift();
    return { file: file.concat(extra), ricorsivo, ignoto: false };
  }

  // findstr: `/s` scende nelle cartelle, `/f:` prende l'elenco dei file da un file.
  function operandiFindstr(testi) {
    const file = [];
    const extra = [];
    let modello = false;
    let ricorsivo = false;
    let ignoto = false;
    for (const a of testi) {
      if (/^[/-]c:/i.test(a)) { modello = true; continue; }
      if (/^[/-]g:/i.test(a)) { modello = true; extra.push(a.slice(3)); continue; }
      if (/^[/-]f:/i.test(a)) { ignoto = true; continue; }
      if (/^[/-]d:/i.test(a)) { extra.push(...a.slice(3).split(',')); continue; }
      if (/^[/-][A-Za-z]+(:\S*)?$/.test(a)) { if (/s/i.test(a.split(':')[0])) ricorsivo = true; continue; }
      file.push(a);
    }
    if (!modello) file.shift();
    return { file: file.concat(extra), ricorsivo, ignoto };
  }

  // Select-String: `-Pattern` o il primo posizionale è il modello; `-Path` o il secondo i file.
  function operandiSls(testi) {
    const file = [];
    const pos = [];
    let modello = false;
    for (let i = 0; i < testi.length; i++) {
      const a = testi[i];
      const low = a.toLowerCase();
      if (!low.startsWith('-') || low.length < 2) { pos.push(a); continue; }
      // `-Path:valore` (due punti) o `-Path valore` (token dopo): stesso legame.
      let nome = low.slice(1);
      let inline = null;
      const dp = nome.indexOf(':');
      if (dp >= 0) { inline = a.slice(1 + dp + 1); nome = nome.slice(0, dp); }
      const prossimo = () => { if (inline != null) return inline; i += 1; return testi[i] || ''; };
      if (nome === 'path' || (nome.length >= 2 && 'literalpath'.startsWith(nome))) { file.push(prossimo()); continue; }
      if (nome.length >= 4 && 'pattern'.startsWith(nome)) { modello = true; prossimo(); continue; }
      if (/^(context|encoding|include|exclude|culture)$/.test(nome)) { prossimo(); continue; }
    }
    if (!modello) pos.shift();
    return { file: file.concat(pos), ricorsivo: false, ignoto: false };
  }

  // git: `--no-index` confronta file qualsiasi, `rev:percorso` e ciò che segue `--` sono file.
  function gitPerimetro(raw, c) {
    const sub = subcommandOf(dequote(raw));
    if (sub === 'grep') return due(MOTIVI.ricorsivo);
    // I percorsi come li legge la shell, come per gli altri lettori.
    const testi = argomenti(raw, c).slice(1).map((a) => a.testo).filter(Boolean);
    const k = testi.findIndex((x) => !x.startsWith('-'));
    const args = k < 0 ? [] : testi.slice(k + 1);
    const libero = args.includes('--no-index');
    const sep = args.indexOf('--');
    // In una cwd di rete ogni nome dato a git va al remoto: come file della cartella
    // o come riferimento (`.git/refs/<nome>`). Lo si misura come un percorso, come `ls` (#1072.4).
    const reteNome = !!(c.cwd && c.cwd.rete);
    const percorsi = [];
    args.forEach((a, i) => {
      if (a.startsWith('-')) return;
      if (libero || (sep >= 0 && i > sep) || (reteNome && (sep < 0 || i < sep))) { percorsi.push(a); return; }
      const m = /^[^:\\/]*:(.+)$/.exec(a);
      if (m && !/^[A-Za-z]:[\\/]/.test(a)) percorsi.push(m[1]);
    });
    return primoFuori(percorsi, c);
  }

  // In git il testo cercato (`-S`, `--grep`, il modello di `git grep`) non si apre come percorso.
  const TESTO_GIT = /^(?:-[SG]|--(?:grep|author|committer|format|pretty))$/;
  function testiGit(testi) {
    const sub = testi.findIndex((x) => !x.startsWith('-'));
    if (sub >= 0 && testi[sub].toLowerCase() === 'grep') return testi.slice(0, sub).concat(operandiGrep(testi.slice(sub + 1)).file);
    return testi.filter((t, i) => !/^(?:-[SG].|--(?:grep|author|committer|format|pretty)=)/.test(t) && !(i > 0 && TESTO_GIT.test(testi[i - 1])));
  }

  // Un percorso di rete scritto per intero, come operando o valore di un flag
  // (`-Path:x`, `--from=x`, `-fx`), per QUALUNQUE lettura: anche `echo` lo passa a un tubo.
  function scriveRete(testi, c) {
    const assoluto = { ...c, cwd: null };
    return testi.some((t) => {
      const m = /^-{1,2}[A-Za-z][\w-]*[=:]?(.*)$/.exec(t);
      const v = m ? m[1] : t;
      return v.split(',').some((x) => dove(x, assoluto) === MOTIVI.rete);
    });
  }

  // Il testo che `Get-Date -Format` stampa: le sequenze di .NET (`\c` è `c`,
  // `'...'`/`"..."` sono letterali) risolte, così un formato costruito per valere
  // `\\host\x` si riconosce (#1072.4). I segnaposto di data (y, M…) restano com'erano:
  // non possono creare `\`, quindi al più aggiungono testo innocuo.
  function formatoData(fmt) {
    let out = '';
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch === '\\') { out += fmt[i + 1] || ''; i += 1; } else if (ch === '\'' || ch === '"') {
        const j = fmt.indexOf(ch, i + 1);
        if (j < 0) { out += fmt.slice(i + 1); break; }
        out += fmt.slice(i + 1, j);
        i = j;
      } else out += ch;
    }
    return out;
  }

  // Un cmdlet di lettura può COMPORRE un percorso di rete da pezzi che da soli non
  // lo sono (#1072.4): Join-Path li concatena, Split-Path -NoQualifier toglie
  // l'unità e scopre un `\\host`, Get-Date -Format stampa un testo fisso. Come
  // echo, da solo stampa e resta libero; ma se lo apre (Join-Path -Resolve) o lo
  // passa a chi lo apre (tubo, gruppo → `c.stampaLibera` è falso) chiede un OK.
  function calcolaRete(prog, testi, c) {
    const assoluto = { ...c, cwd: null };
    const inRete = (p) => !!p && dove(p, assoluto) === MOTIVI.rete;
    if (prog === 'join-path') {
      const resolve = testi.some((t) => parametro(t, 'resolve', 1));
      if (c.stampaLibera && !resolve) return false;
      const parti = [];
      for (const t of testi) {
        if (parametro(t, 'resolve', 1)) continue; // `-Resolve:$true` non è un pezzo del percorso
        const v = valoreDuePunti(t);
        if (v != null) { parti.push(...v.split(',')); continue; }
        if (!t.startsWith('-')) parti.push(...t.split(','));
      }
      return inRete(parti.join('\\'));
    }
    if (prog === 'split-path') {
      if (c.stampaLibera || !testi.some((t) => parametro(t, 'noqualifier', 1))) return false;
      for (const t of testi) {
        const v = valoreDuePunti(t);
        const cand = v != null ? v : (t.startsWith('-') ? null : t);
        // Tolta la qualifica, ciò che resta può essere `\\host`.
        if (cand != null && cand.split(',').some((q) => inRete(senzaQualifica(q)))) return true;
      }
      return false;
    }
    if (prog === 'get-date') {
      if (c.stampaLibera) return false;
      for (let i = 0; i < testi.length; i++) {
        const t = testi[i];
        if (!/^-f/i.test(t)) continue;
        const v = valoreDuePunti(t);
        if (v != null) { if (inRete(formatoData(v))) return true; continue; }
        if ('format'.startsWith(t.slice(1).toLowerCase())) { if (inRete(formatoData(testi[i + 1] || ''))) return true; i += 1; }
      }
      return false;
    }
    return false;
  }

  // Comandi "liberi" che risolvono un nome scelto dal modello contro la cartella
  // di lavoro: in una cwd di rete lo mandano al remoto come farebbe `ls` (#1072.4).
  // Get-Command/Get-Help cercano il file/comando indicato; where.exe (shell cmd)
  // guarda prima nella cartella corrente. git lo fa in gitPerimetro.
  function cercaNomeInRete(prog, testi, c) {
    if (CERCANO_NOME.has(prog)) {
      return testi.some((t) => {
        const v = valoreDuePunti(t);
        const nome = v != null ? v : (t.startsWith('-') ? null : t);
        return nome != null && dove(nome, c) === MOTIVI.rete;
      });
    }
    if (prog === 'where') return testi.some((t) => t && !/^[-/]/.test(t));
    return false;
  }

  // Livello di un comando già riconosciuto come lettura (livello 1 di base).
  function perimetroDi(raw, c) {
    const prog = programOf(dequote(raw));
    const args = argomenti(raw, c).slice(1);
    const testi = args.map((a) => a.testo);
    let cerca = null;
    if (prog === 'grep') cerca = operandiGrep(testi);
    else if (prog === 'findstr') cerca = operandiFindstr(testi);
    else if (prog === 'select-string' || prog === 'sls') cerca = operandiSls(testi);
    // Il testo cercato non si apre mai: `grep "//TODO" a.js` non contatta nessuno, `echo //nota` che nessuno usa neanche.
    const stampaSoltanto = c.stampaLibera && STAMPANO.has(prog);
    if (!stampaSoltanto && scriveRete(cerca ? cerca.file : prog === 'git' ? testiGit(testi) : testi, c)) return due(MOTIVI.rete);
    if (calcolaRete(prog, testi, c)) return due(MOTIVI.rete);
    if (c.cwd && c.cwd.rete && cercaNomeInRete(prog, testi, c)) return due(MOTIVI.rete);
    if (args.some((a) => a.variabile) || prog === 'printenv') return due(MOTIVI.variabili);
    if (!stampaSoltanto && args.some((a) => a.ignoto)) return due(MOTIVI.ignoto);
    if (PROCESSI.has(prog)) return due(MOTIVI.processi);
    if (prog === 'git') return gitPerimetro(raw, c);
    if (LETTORI.has(prog)) return primoFuori(operandiLettore(prog, testi), c);
    if (cerca) {
      if (cerca.ricorsivo) return due(MOTIVI.ricorsivo);
      if (cerca.ignoto) return due(MOTIVI.ignoto);
      return primoFuori(cerca.file, c);
    }
    if (PRENDONO_PERCORSI.has(prog)) {
      const ops = [];
      for (const t of testi) {
        const v = valoreDuePunti(t);
        if (v) ops.push(...v.split(','));
        else if (t && !t.startsWith('-')) ops.push(...t.split(','));
      }
      const elenco = ELENCHI.has(prog);
      for (const t of ops) {
        // Il valore di un gruppo può essere `env:` o `HKCU:`; Test-Path ne dice solo se esiste,
        // ma se viene dal contenuto di un file può essere un percorso di rete (#1072).
        if (t.includes(SEGNAPOSTO) && ((elenco && prog !== 'test-path') || c.valoriIgnoti)) return due(MOTIVI.ignoto);
        // Il valore di un gruppo, se relativo, si risolve contro una cwd di rete (#1072.4).
        if (t.includes(SEGNAPOSTO) && c.cwd && c.cwd.rete) return due(MOTIVI.rete);
        const d = dove(t, c);
        if (d === MOTIVI.rete || (elenco && d === MOTIVI.sistema)) return due(d);
      }
      if (!ops.length && ELENCA_CARTELLA.has(prog)) {
        if (c.cwd && c.cwd.provider) return due(MOTIVI.sistema);
        if (c.cwd && c.cwd.rete) return due(MOTIVI.rete);
        if (!c.cwd) return due(MOTIVI.ignoto);
      }
    }
    return UNO;
  }

  function classifyOneDet(raw, c) {
    const base = classifyOne(raw);
    return base === 1 ? perimetroDi(raw, c) : { level: base, motivo: '' };
  }

  // Dopo un `cd` la cartella è quella nuova, o la vecchia se il `cd` fallisce.
  function spostati(raw, c) {
    const prog = programOf(dequote(raw));
    const args = argomenti(raw, c).slice(1);
    if (prog === 'popd' || args.some((a) => a.variabile || a.ignoto)) return { ...c, cwd: null };
    let dest = null;
    for (let i = 0; i < args.length; i++) {
      const t = args[i].testo;
      if (/^-(literalpath|path|lp)$/i.test(t)) { dest = args[i + 1] ? args[i + 1].testo : null; break; }
      if (t === '-' || t === '') break;
      if (t.startsWith('-') || /^\/[A-Za-z]$/.test(t)) continue;
      dest = t;
      break;
    }
    if (dest === null) return { ...c, cwd: null };
    return { ...c, cwd: cartellaDa(dove(dest, c)) };
  }

  function chiaveCwd(c) {
    if (!c.cwd) return '?';
    if (c.cwd.provider) return 'P';
    return c.cwd.rete ? 'R' : `${c.cwd.radice}/${c.cwd.segs.join('/')}`;
  }

  // ── Gruppi, sottoespressioni e `if` di PowerShell (#516) ─────────────────
  // `( )`, `@( )` e `$( )` ESEGUONO ciò che contengono, anche come argomento di
  // un comando qualunque (`ls (Remove-Item x)` cancella). Ogni gruppo e ogni
  // ramo di un `if` si classifica per ciò che esegue; il comando attorno, con
  // SEGNAPOSTO al posto del gruppo. Una forma che `smonta` non riconosce è 3.
  const PROF_MAX = 8;
  const CD_RE = /(^|[^\w-])(cd|chdir|set-location|sl|pushd|popd)(?![\w-])/i;
  const LETTERALE = String.raw`'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|\$(?:env:)?[A-Za-z_]\w*`;
  const LETTERALI_RE = new RegExp(`^\\s*(?:${LETTERALE})(?:\\s*,\\s*(?:${LETTERALE}))*\\s*$`, 'i');
  const LETTERALE_G = new RegExp(LETTERALE, 'gi');
  const TERMINE_RE = /^(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?(?:kb|mb|gb|tb|pb)?|\$(?:env:)?[A-Za-z_]\w*)/i;
  const MEMBRI_RE = /^(?:\.[A-Za-z_]\w*|\[-?\d+\])*/;
  const OPERATORE_RE = /^\s*(?:-[ci]?(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|join|and|or|xor)(?![\w-])|[+*/%,]|-(?=\s))/i;
  const UNARIO_RE = /^\s*(?:!|-not(?![\w-]))/i;
  const VALORE_RE = new RegExp(`${TERMINE_RE.source}$`, 'i');

  const saltaSpazi = (s, k) => { while (k < s.length && /\s/.test(s[k])) k += 1; return k; };

  // Indice della parentesi che chiude quella in `i`, saltando le stringhe; -1 se manca.
  function chiusura(s, i) {
    const apre = s[i];
    const chiude = apre === '(' ? ')' : '}';
    let prof = 0;
    for (let k = i; k < s.length; k++) {
      const ch = s[k];
      if (ch === '"' || ch === "'") {
        const j = s.indexOf(ch, k + 1);
        if (j < 0) return -1;
        k = j;
      } else if (ch === apre) prof += 1;
      else if (ch === chiude && (prof -= 1) === 0) return k;
    }
    return -1;
  }

  // Un gruppo si apre dopo uno spazio, una virgola, un `!` o il `-Nome:` di un
  // parametro. Attaccato a un nome (`$f.MoveTo(`, `[IO.File]::Delete(`) è una
  // chiamata di metodo, che non si classifica.
  function apreGruppo(s, i) {
    if (i === 0 || /[\s,!]/.test(s[i - 1])) return true;
    if (s[i - 1] !== ':') return false;
    let k = i - 2;
    while (k >= 0 && /[A-Za-z]/.test(s[k])) k -= 1;
    return k < i - 2 && s[k] === '-' && (k === 0 || /\s/.test(s[k - 1]));
  }

  // `if (…) {…} elseif (…) {…} else {…}`: condizioni e corpi diventano pezzi.
  // Ritorna l'indice dopo l'ultima graffa, -1 se la forma non è questa.
  function seIf(s, k, aggiungi) {
    for (let ramo = 'if'; ;) {
      if (ramo !== 'else') {
        k = saltaSpazi(s, k);
        const j = s[k] === '(' ? chiusura(s, k) : -1;
        if (j < 0 || !s.slice(k + 1, j).trim()) return -1;
        aggiungi(s.slice(k + 1, j), false);
        k = j + 1;
      }
      k = saltaSpazi(s, k);
      const j = s[k] === '{' ? chiusura(s, k) : -1;
      if (j < 0) return -1;
      aggiungi(s.slice(k + 1, j), true);
      k = j + 1;
      if (ramo === 'else') return k;
      const m = /^\s*(elseif|else)(?=[\s({]|$)/i.exec(s.slice(k));
      if (!m) return k;
      ramo = m[1].toLowerCase();
      k += m[0].length;
    }
  }

  // Un'espressione a inizio istruzione (`(gci).Count -gt 0`, `-not (Test-Path x)`):
  // apre con un gruppo, e fuori dai gruppi ammette solo operatori, proprietà,
  // numeri, stringhe e variabili. `lasciato` è il testo che non si riclassifica.
  function espressione(s, k, gruppo) {
    let lasciato = '';
    for (let primo = true; ; primo = false) {
      let m;
      while ((m = UNARIO_RE.exec(s.slice(k)))) k += m[0].length;
      k = saltaSpazi(s, k);
      if (s[k] === '(' || ((s[k] === '@' || s[k] === '$') && s[k + 1] === '(')) {
        const j = gruppo(s[k] === '(' ? k : k + 1);
        if (j < 0) return null;
        k = j + 1;
      } else if (!primo && (m = TERMINE_RE.exec(s.slice(k)))) {
        lasciato += ` ${m[0]}`;
        k += m[0].length;
      } else return null;
      k += MEMBRI_RE.exec(s.slice(k))[0].length;
      if (!(m = OPERATORE_RE.exec(s.slice(k)))) return { fine: k, lasciato };
      k += m[0].length;
    }
  }

  // Il comando con ogni gruppo ed ogni `if` sostituiti (`testo`) e ciò che quei
  // costrutti eseguono (`pezzi`). null senza gruppi; TRE se la forma non si
  // riconosce. `mosso`: un pezzo cambia cartella, quindi dopo non la si conosce.
  function smonta(s) {
    let q = '';
    let gruppi = false;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (q) {
        if (ch === q) q = '';
        else if (q === '"' && ch === '$' && /[({]/.test(s[k + 1] || '')) return TRE;
      } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '(' || (ch === '@' && s[k + 1] === '{')) gruppi = true;
    }
    if (!gruppi) return null;
    // Virgolette che qui non si leggono come le legge la shell (tipografiche, che
    // PowerShell accetta; dopo un backslash, in bash; non chiuse), `@{` (i valori
    // di una tabella sono comandi), `${…}` (in PowerShell legge un file).
    if (q || /[`\r\n\u2018-\u201e]|\\['"]|\$\{|@\{/.test(s)) return TRE;
    const pezzi = [];
    let out = '';
    let lasciato = '';
    let spostato = false;
    let mosso = false;
    const aggiungi = (testo, corpo) => {
      pezzi.push({ testo, corpo, spostato });
      // Senza virgolette, come le legge la shell: `c""d` è `cd`.
      if (CD_RE.test(unquote(testo))) { spostato = true; mosso = true; }
    };
    const gruppo = (a) => {
      const j = chiusura(s, a);
      if (j > a) aggiungi(s.slice(a + 1, j), false);
      return j;
    };
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) out += s[i++];
      if (i >= s.length) break;
      const resto = s.slice(i);
      if (/^if\s*\(/i.test(resto)) {
        i = seIf(s, i + 2, aggiungi);
        if (i < 0) return TRE;
        out += `Write-Output ${SEGNAPOSTO}`;
      } else if (/^(?:[@$]?\(|!|-not(?![\w-]))/i.test(resto)) {
        const r = espressione(s, i, gruppo);
        if (!r) return TRE;
        lasciato += r.lasciato;
        out += `Write-Output ${SEGNAPOSTO}`;
        i = r.fine;
      } else {
        const prog = programOf(/^\S*/.exec(resto)[0]);
        while (i < s.length) {
          const ch = s[i];
          if (ch === ';' || ch === '|' || (ch === '&' && s[i + 1] === '&')) break;
          if (ch === ')' || ch === '}') return TRE;
          let j;
          if (ch === '"' || ch === "'") {
            j = s.indexOf(ch, i + 1);
            if (j < 0) return TRE;
            out += s.slice(i, j + 1);
          } else if (ch === '{') {
            // Uno scriptblock resta com'è (lo giudica segmentIsRead), ma senza gruppi dentro.
            j = chiusura(s, i);
            if (j < 0 || /\(/.test(s.slice(i, j).replace(/'[^']*'|"[^"]*"/g, ''))) return TRE;
            out += s.slice(i, j + 1);
          } else if (ch === '(' || ((ch === '@' || ch === '$') && s[i + 1] === '(')) {
            if (!apreGruppo(s, i)) return TRE;
            const a = ch === '(' ? i : i + 1;
            j = chiusura(s, a);
            if (j < 0) return TRE;
            const dentro = s.slice(a + 1, j);
            // Un gruppo di soli letterali (`@("a","b")`) vale quei letterali: un cmdlet li riceve come
            // un elenco, un programma esterno come argomenti separati (`git branch ("-D","x")`).
            if (LETTERALI_RE.test(dentro)) out += dentro.match(LETTERALE_G).join(PS_READ.has(prog) ? ',' : ' ');
            else { aggiungi(dentro, false); out += SEGNAPOSTO; }
          } else {
            out += ch;
            j = i;
          }
          i = j + 1;
        }
        if (SPOSTAMENTI.has(prog)) spostato = true;
      }
      i = saltaSpazi(s, i);
      if (i >= s.length) break;
      const sep = /^(?:;|&&|\|\|?)/.exec(s.slice(i));
      if (!sep) return TRE;
      out += sep[0];
      i += sep[0].length;
    }
    return { testo: out, pezzi, lasciato, mosso };
  }

  // Un gruppo come argomento vale qualcosa che si sa solo eseguendolo: verso un
  // programma esterno (o in bash) può essere un flag (`git checkout $(echo .)`), in
  // PowerShell uno scriptblock (`(Get-Command f).ScriptBlock`), che questi cmdlet
  // eseguono, e con un input dal tubo qualunque cmdlet. Si accetta solo dove nessun
  // valore cambia il livello o il perimetro, e in testa alla pipeline.
  const ESEGUONO_BLOCCHI = new Set([
    'select-object', 'select', 'sort-object', 'group-object', 'group', 'measure-object', 'measure',
    'compare-object', 'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw', 'where',
  ]);
  function gruppoComeArgomento(prog) {
    return (PS_READ.has(prog) || LEVEL1.has(prog) || SPOSTAMENTI.has(prog)) && !ESEGUONO_BLOCCHI.has(prog)
      && !LEVEL1_MUTATES[prog] && prog !== 'grep' && prog !== 'findstr';
  }
  const gruppiAlPosto = (testo) => testo.split(/;|&&|\|\|/).every((istr) => istr.split('|')
    .every((seg, i) => !seg.includes(SEGNAPOSTO) || (i === 0 && gruppoComeArgomento(programOf(dequote(seg))))));

  function valoreNoto(testo) {
    if (/[({]/.test(String(testo).replace(/'[^']*'|"[^"]*"/g, ''))) return false;
    return String(testo).split(/;|&&|\|\|/).every((istr) => istr.split('|').every((seg, i) => {
      const prog = programOf(dequote(seg.trim()));
      return !seg.trim() || (FONTI_NOTE.has(prog) && !(i > 0 && CALCOLANO.has(prog)));
    }));
  }

  function classifica(cmd, c, prof) {
    const trimmed = String(cmd).trim();
    if (!trimmed || prof > PROF_MAX) return TRE;
    const sm = smonta(trimmed);
    if (sm === null) return classificaPiatta(trimmed, c);
    // Il testo lasciato fuori non passa dai controlli dei separatori: non ne deve avere, neanche fra virgolette.
    if (sm === TRE || /[;|&<>]/.test(sm.lasciato)) return TRE;
    if (!gruppiAlPosto(sm.testo)) return TRE;
    // Un gruppo che prende testo da un file può valere un percorso di rete (#1072).
    if (sm.pezzi.some((p) => !valoreNoto(p.testo))) c = { ...c, valoriIgnoti: true };
    const ignota = { ...c, cwd: null };
    let det = classificaPiatta(sm.testo.trim(), sm.mosso ? ignota : c);
    if (nomiVariabili(sm.lasciato).some((n) => !VAR_INNOCUE.has(n))) det = peggiore(det, due(MOTIVI.variabili));
    for (const p of sm.pezzi) {
      if (det.level === 3) break;
      const t = p.testo.trim();
      // Ciò che un gruppo stampa diventa l'argomento del comando attorno.
      const cc = { ...(p.spostato ? ignota : c), stampaLibera: false };
      // Il corpo di un `if` può essere vuoto o un valore solo (stringa, numero, variabile), che PowerShell stampa.
      if (p.corpo && !t) continue;
      const sub = p.corpo && VALORE_RE.test(t) ? `Write-Output ${t}` : t;
      det = peggiore(det, classifica(sub, cc, prof + 1));
    }
    return det;
  }

  // cmd toglie ogni `^` fuori dalle virgolette prima di passare il comando: `^.ssh` è `.ssh`, `^\^\host` è
  // `\\host`, `-^-force` è `--force` (#1072.1). null dove qui non si legge come cmd: un `^` in coda (si
  // prende la riga dopo), su un separatore (diventa testo), accanto alle espansioni `%` (fatte prima) e `!`.
  function comeCmd(cmd) {
    let out = '';
    let virgolette = false;
    let tolti = false;
    for (let i = 0; i < cmd.length; i++) {
      const ch = cmd[i];
      if (ch !== '^' || virgolette) {
        if (ch === '"') virgolette = !virgolette;
        out += ch;
        continue;
      }
      const dopo = cmd[i + 1];
      if (dopo === undefined || /[&|<>()%\r\n]/.test(dopo)) return null;
      out += dopo; // `^"` non apre né chiude le virgolette
      i += 1;
      tolti = true;
    }
    if ((tolti && out.includes('%')) || (out.includes('!') && out.includes('^'))) return null;
    return out;
  }

  // Livello del comando e, se chiede conferma per il perimetro, il perché.
  // PowerShell legge “ ” „ ‟ come `"`, ‘ ’ ‚ ‛ come `'` e – — ― in testa a una parola come `-`: i controlli
  // devono vedere il comando che la shell esegue, non la sua grafia (#1072). Per cmd quei segni sono testo.
  // Per cmd `'` è testo (`' \\host\x '` sono tre argomenti), per i programmi C anche `\"` (findstr); i programmi
  // MSYS (cat, ls di Git) leggono `'` come virgolette. Vale la lettura peggiore, a pari livello la prima (#1072.5).
  function comeLaShell(cmd, c) {
    if (!c.win) return [cmd];
    if (c.shell === 'cmd') {
      const l = comeCmd(cmd);
      if (l == null) return null;
      const interni = l.replace(/'/g, APICE_TESTO);
      const programmiC = interni.replace(/(\\+)"/g, (m, b) => (b.length % 2 ? '\\'.repeat(b.length >> 1) + VIRGOLETTE_TESTO : m));
      return [...new Set([programmiC, interni, l])];
    }
    return [cmd.replace(/[\u201C-\u201F]/g, '"')
      .replace(/[\u2018-\u201B]/g, "'")
      .replace(/(^|[\s(,;|&{=])[\u2013-\u2015]/g, '$1-')];
  }

  function classifyDetail(cmd, ctx) {
    if (typeof cmd !== 'string') return TRE;
    const c = { ...contesto(ctx), stampaLibera: true };
    const letture = comeLaShell(cmd, c);
    if (letture == null) return TRE;
    const contesti = forseDash(c) && APICE_CHE_DASH_CHIUDE.test(cmd) ? [c, { ...c, senzaAnsi: true }] : [c];
    return letture.flatMap((l) => contesti.map((cc) => classifica(l, cc, 0))).reduce(peggiore);
  }

  // Un comando senza gruppi: sequenze, pipeline e comandi singoli.
  function classificaPiatta(trimmed, c) {
    if (!trimmed) return TRE;

    // Sequenza pura → livello massimo dei pezzi. Vale anche con UN solo pezzo: `git checkout .;`
    // va classificato sul comando vero, non sul token `.;` che non somiglia a niente di noto.
    const seq = splitSafeSequence(trimmed);
    if (seq && seq.length) {
      let cands = [c];
      let det = UNO;
      for (const part of seq) {
        for (const cc of cands) det = peggiore(det, classifyOneDet(part, cc));
        if (!SPOSTAMENTI.has(programOf(dequote(part)))) continue;
        const visti = new Map();
        for (const cc of cands.concat(cands.map((x) => spostati(part, x)))) visti.set(chiaveCwd(cc), cc);
        cands = [...visti.values()];
        if (cands.length > 8) cands = [c, { ...c, cwd: null }];
      }
      return det;
    }
    // Pipeline di sole letture → 1: incanalare una lettura in un'altra non produce niente in
    // più. Basta un segmento non riconosciuto, o uno scriptblock che invochi, e si torna a 3.
    const pipe = splitSafePipeline(trimmed);
    if (pipe) {
      if (!pipe.every((p) => segmentIsRead(p, true))) return TRE;
      const progs = pipe.map((p) => programOf(dequote(p)));
      const cp = progs.some((x) => SPOSTAMENTI.has(x)) ? { ...c, cwd: null } : c;
      let det = UNO;
      let elenco = false;
      let noto = true;
      pipe.forEach((p, i) => {
        if (elenco && LETTI_DAL_TUBO.has(progs[i])) det = peggiore(det, due(MOTIVI.ignoto));
        // Testo letto da un file, dato come percorso, può portare in rete (#1072).
        if (!noto && PERCORSO_DAL_TUBO.has(progs[i])) det = peggiore(det, due(MOTIVI.ignoto));
        // Un nome dal tubo si risolve contro la cartella di lavoro: in rete lo riceve il remoto (#1072.4).
        if (i > 0 && (PERCORSO_DAL_TUBO.has(progs[i]) || CERCANO_NOME.has(progs[i])) && cp.cwd && cp.cwd.rete) det = peggiore(det, due(MOTIVI.rete));
        // Join-Path/Split-Path sul valore del tubo compongono ciò che nessun argomento scrive (`'\\' | Join-Path`):
        // chi lo riceve come percorso chiede (noto), e Join-Path -Resolve lo apre da sé.
        if (i > 0 && progs[i] === 'join-path' && argomenti(p, c).some((a) => parametro(a.testo, 'resolve', 1))) det = peggiore(det, due(MOTIVI.ignoto));
        if (!FONTI_NOTE.has(progs[i]) || (i > 0 && CALCOLANO.has(progs[i])) || (c.valoriIgnoti && p.includes(SEGNAPOSTO))) noto = false;
        if (ELENCA_OGGETTI.has(progs[i]) || p.includes(SEGNAPOSTO)) elenco = true;
        if (!PS_PIPE_ONLY.has(progs[i])) det = peggiore(det, perimetroDi(p, i < pipe.length - 1 ? { ...cp, stampaLibera: false } : cp));
      });
      return det;
    }

    // Pipe / background / redirezioni / sostituzioni: non riconoscibili → 3.
    if (!seq && CHAIN_RE.test(trimmed)) return TRE;

    return classifyOneDet(trimmed, c);
  }

  // Livello di sicurezza del comando: 1 | 2 | 3. Mai null: l'ignoto è 3.
  function classify(cmd, ctx) {
    return classifyDetail(cmd, ctx).level;
  }

  // Un percorso scritto da un modello, senza i segni di citazione in testa e in coda, anche spaiati: la stessa pulizia
  // per chi misura il perimetro e per chi tocca il disco, o uno dei due vede un altro percorso (#1499).
  function pulisciPercorso(percorso) {
    return String(percorso == null ? '' : percorso).trim().replace(/^["'«“‘‹]+|["'»”’›]+$/g, '').trim();
  }

  // Un percorso singolo (LEGGI_DOCUMENTO): '' se sta nel perimetro, altrimenti il motivo.
  function fuoriPerimetro(percorso, ctx) {
    return fuoriDa(pulisciPercorso(percorso), contesto(ctx));
  }

  // Il percorso fa contattare a Windows (o al Mac, con /net) un altro computer della rete.
  function diRete(percorso, ctx) {
    const p = pulisciPercorso(percorso);
    return !!p && dove(p, contesto(ctx)) === MOTIVI.rete;
  }

  // Nella cartella personale ma privato per la lettura (nascosto, cartella di profilo come la Libreria del Mac): chi
  // legge in blocco non ci entra se la cartella chiesta non è già lì dentro (#947.3).
  function privato(percorso, ctx) {
    return fuoriPerimetro(percorso, ctx) === MOTIVI.nascosto;
  }

  // Le cartelle aperte dentro `percorso`, se è proprio una cartella di profilo: chi legge in blocco scende solo lì.
  function aperteDentro(percorso, ctx) {
    const c = contesto(ctx);
    const r = dove(String(percorso == null ? '' : percorso).trim(), c);
    if (!r || typeof r !== 'object' || !dentroCasa(r, c) || r.segs.length !== c.home.segs.length + 1) return [];
    return (PROFILO_APERTE[nomeNorm(r.segs[r.segs.length - 1])] || []).slice();
  }

  global.SN_CMD_CLASSIFY = {
    classify, classifyDetail, fuoriPerimetro, pulisciPercorso, diRete, privato, aperteDentro, programOf, subcommandOf, comeCmd,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
