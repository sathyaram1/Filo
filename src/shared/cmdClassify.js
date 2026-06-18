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

  // Modifica lo stato ma in modo recuperabile: livello 2.
  const LEVEL2 = new Set([
    'mkdir', 'md', 'touch', 'cp', 'copy', 'xcopy', 'robocopy', 'move', 'mv',
    'ren', 'rename', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'curl', 'wget',
    'ln',
  ]);

  // Flag che alzano a 3 un comando altrimenti ≤2.
  const DANGEROUS_FLAG_RE = /(^|\s)(--force|--hard|--delete|--prune|--no-preserve-root|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*)(\s|$)/i;

  // git: il livello dipende dal sotto-comando.
  const GIT_READ = new Set([
    'status', 'log', 'diff', 'show', 'branch', 'remote', 'config', 'tag',
    'rev-parse', 'describe', 'blame', 'ls-files', 'ls-tree', 'shortlog',
    'reflog', 'whatchanged', 'cat-file', 'name-rev', 'symbolic-ref',
    'version', 'help', 'grep', 'count-objects',
  ]);
  const GIT_WRITE = new Set([
    'add', 'commit', 'push', 'pull', 'fetch', 'checkout', 'switch', 'merge',
    'rebase', 'cherry-pick', 'revert', 'stash', 'init', 'clone', 'mv',
    'apply', 'am', 'pop', 'worktree', 'submodule', 'tag',
  ]);
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
  const GIT_DANGER_RE = /(^|\s)(--force(-with-lease)?|--hard|--delete|--prune|-f|-d|-D|-[a-z]*f[a-z]*d[a-z]*|-[a-z]*d[a-z]*f[a-z]*)(\s|$)/i;

  function classifyGit(cmd) {
    const sub = subcommandOf(cmd);
    if (!sub) return 1; // `git` da solo stampa l'help → lettura
    if (GIT_DESTROY.has(sub)) return 3;
    if (GIT_DANGER_RE.test(cmd)) return 3; // es. push --force, checkout -f, branch -D
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

    if (LEVEL1.has(prog)) return 1; // sola lettura: i flag non la rendono distruttiva
    // Anche un comando LEVEL2 ridotto a `--version`/`--help` è sola lettura → 1.
    if (LEVEL2.has(prog)) {
      if (isVersionQuery(trimmed)) return 1;
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
