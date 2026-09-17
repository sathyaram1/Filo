// Classificatore di comandi shell → livello di sicurezza (#146.6): lo calcola il main sul
// comando EFFETTIVO, mai l'LLM. È una WHITELIST: 1 lettura, 2 modifica recuperabile, e 3 per
// cancellazioni, comandi pericolosi e qualunque comando non riconosciuto.

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

  // curl `-D`/`--dump-header` scrive gli header, decisi dal server, in un percorso arbitrario.
  // Case-SENSITIVE sulla `D`: `-d`/`--data` è il corpo POST e non deve salire.
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

  // git: il livello dipende dal sotto-comando. I duali (tag, branch, config, remote) non
  // stanno qui: leggono da nudi e scrivono con un operando, li classifica GIT_DUAL.
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
      if (low.some((a) => a === '--add' || a === '--replace-all' || a === '--rename-section' || a === '-e' || a === '--edit')) return 2;
      // `chiave valore` (≥2 operandi) imposta; `--list`/`--get`/`chiave` (≤1) legge.
      return args.filter((a) => !a.startsWith('-')).length >= 2 ? 2 : 1;
    },
    remote: (cmd) => {
      const ops = gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'));
      if (!ops.length) return 1; // `git remote`, `git remote -v`
      const action = ops[0].toLowerCase();
      if (action === 'show' || action === 'get-url') return 1;
      if (action === 'remove' || action === 'rm' || action === 'prune') return 3;
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
    // `config`: leggere è lettura, ma set/delete/edit cambiano anche il REGISTRY, cioè da dove
    // npm e pip scaricano ed eseguono codice. Reindirizzarlo non è lettura → 2.
    if (sub === 'config') {
      const rest = tokens(cmd).slice(1).map(unquote).filter((t) => !t.startsWith('-'));
      const verb = (rest[1] || '').toLowerCase();
      if (!verb || verb === 'get' || verb === 'list' || verb === 'ls' || verb === 'debug') return 1;
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
      if (prog === 'robocopy' && ROBOCOPY_DESTRUCTIVE_RE.test(trimmed)) return 3;
      return DANGEROUS_FLAG_RE.test(trimmed) ? 3 : 2;
    }

    // Cmdlet PowerShell di lettura: 1 solo se superano anche i controlli strutturali.
    // Si passa `raw`, con le virgolette: i letterali quotati vanno riconosciuti inerti.
    if (PS_READ.has(prog) && segmentIsRead(raw, false)) return 1;

    return 3; // comando non riconosciuto → livello 3 di default
  }

  // Livello di sicurezza del comando: 1 | 2 | 3. Mai null: l'ignoto è 3.
  function classify(cmd) {
    if (typeof cmd !== 'string') return 3;
    const trimmed = cmd.trim();
    if (!trimmed) return 3;

    // Sequenza pura → livello massimo dei pezzi. Vale anche con UN solo pezzo: `git checkout .;`
    // va classificato sul comando vero, non sul token `.;` che non somiglia a niente di noto.
    const seq = splitSafeSequence(trimmed);
    if (seq && seq.length) {
      return seq.reduce((max, part) => Math.max(max, classifyOne(part)), 1);
    }
    // Pipeline di sole letture → 1: incanalare una lettura in un'altra non produce niente in
    // più. Basta un segmento non riconosciuto, o uno scriptblock che invochi, e si torna a 3.
    const pipe = splitSafePipeline(trimmed);
    if (pipe) return pipe.every((p) => segmentIsRead(p, true)) ? 1 : 3;

    // Pipe / background / redirezioni / sostituzioni: non riconoscibili → 3.
    if (!seq && CHAIN_RE.test(trimmed)) return 3;

    return classifyOne(trimmed);
  }

  global.SN_CMD_CLASSIFY = { classify, programOf, subcommandOf };
})(typeof globalThis !== 'undefined' ? globalThis : self);
