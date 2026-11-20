// Parte di cmdClassify.js (#2493): il livello di git e di npm/pip, che dipende dal sotto-comando e dai suoi argomenti.
// Non pubblica niente per conto suo: si registra su SN_CMD_PARTI, e la compone cmdClassify.js, dove stanno le regole.
// Si carica dopo cmdBase.js, da cui prende al caricamento.
(function (global) {
  'use strict';
  const P = global.SN_CMD_PARTI;
  const { LUNGHE_PERICOLOSE, lungaPericolosa, tokens, unquote, opzioneLunga, subcommandOf, VERSION_TOKENS } = P;

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

  // In git i flag distruttivi sono più ricchi: anche `-f`, `-d`/`-D`, `--delete`, `--prune`.
  // Check git-specifico, perché su `tar -f` quelle lettere vogliono dire altro.
  const GIT_DANGER_RE = /(^|\s)(-f|-d|-D|-[a-z]*f[a-z]*d[a-z]*|-[a-z]*d[a-z]*f[a-z]*)(\s|$)/i;
  const GIT_DANGER_LUNGHE = [...LUNGHE_PERICOLOSE, 'force-with-lease', 'discard-changes'];
  const gitPericolosa = (cmd) => GIT_DANGER_RE.test(cmd) || lungaPericolosa(cmd, GIT_DANGER_LUNGHE);

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

  // `git config` nella forma con le opzioni (`--unset`, `chiave valore`…): gli argomenti dopo il sotto-comando.
  function gitConfigForma(args) {
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
  }

  // Sotto-comandi il cui livello dipende dagli argomenti: i duali ELENCANO (1) da nudi e
  // CREANO (2) con un operando; `checkout` e `stash` hanno anche forme distruttive (3).
  const GIT_DUAL = {
    tag:(cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
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
    // Da git 2.46 il primo operando può essere un verbo (`git config set remote.origin.url …`): una chiave ha
    // sempre un punto, quindi un verbo senza punto non si confonde. Tolto il verbo, vale la forma di prima.
    config: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      const i = args.findIndex((a) => !a.startsWith('-'));
      const verbo = i < 0 ? '' : args[i].toLowerCase();
      if (!/^(list|get|set|unset|edit|rename-section|remove-section|get-color|get-colorbool)$/.test(verbo)) return gitConfigForma(args);
      const resto = args.filter((_, k) => k !== i);
      const low = resto.map((a) => a.toLowerCase());
      if (verbo === 'unset' || verbo === 'remove-section') return 3;
      if (verbo === 'list' || verbo === 'edit' || verbo === 'rename-section') return 2;
      if (verbo === 'set') return Math.max(2, gitConfigForma(low.includes('--append') ? resto.concat('--add') : resto));
      if (low.some((a) => /^--(regexp|url)(=|$)/.test(a))) return 2;
      return gitConfigForma(resto);
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

  // Le opzioni globali che non cambiano repository né impostazioni: le altre (`--git-dir`, `--bare`, `--config-env`, …)
  // portano git dove la sonda delle impostazioni non ha guardato (#2292); `--config-env=core.pager=SHELL` esegue (#1994).
  const GIT_GLOBALI_INNOCUE = new Set([
    '-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks',
    '--no-advice', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
    '-v', '--version', '-h', '--help', '--exec-path', '--html-path', '--man-path', '--info-path',
  ]);
  // Il repository di `--git-dir=`/`--work-tree=` lo misura anche il perimetro, come la cartella di `cd`.
  const GIT_GLOBALE_CARTELLA = /^--(git-dir|work-tree)=/;
  // `--output` (e le sue abbreviazioni) scrive l'uscita in un file scelto dal comando, col testo che sceglie
  // `--format`: con log, show, diff, shortlog… una lettura diventa la scrittura di un file qualsiasi (#1994).
  function gitScriveFile(cmd) {
    return tokens(cmd).slice(1).some((t) => opzioneLunga(t, 'output', 2) != null);
  }
  // Il file su cui scrive una lettura di git con `--output` ('' se non si sa quale), o null se stampa e basta (#2292).
  function gitUscita(args) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--output') return args[i + 1] || '';
      const m = /^--output=(.*)$/.exec(args[i]);
      if (m) return m[1];
    }
    return null;
  }
  // Le opzioni con cui git lancia un programma scritto nel comando: verso un remoto locale `--upload-pack`/`--receive-pack`
  // li esegue la shell della macchina, `clone -c core.sshCommand=…` ne imposta uno, `--template` porta gli hook. È codice
  // arbitrario come ARBITRARY_CODE (#2618). Le lunghe valgono accorciate fino a una lettera (git accetta ogni prefisso
  // unico); le corte anche dentro un gruppo (`-qu`), fino alla prima lettera che prende un valore.
  const GIT_LANCIA = {
    push: { lunghe: ['receive-pack', 'exec'] },
    fetch: { lunghe: ['upload-pack'] },
    pull: { lunghe: ['upload-pack'] },
    'ls-remote': { lunghe: ['upload-pack', 'exec'] },
    archive: { lunghe: ['exec'] },
    clone: { lunghe: ['upload-pack', 'config', 'template'], corte: 'uc', conValore: 'jobuc' },
    init: { lunghe: ['template'] },
    rebase: { lunghe: ['exec'], corte: 'x', conValore: 'SxsXC' },
  };
  function cortaNelGruppo(t, corte, conValore) {
    if (!/^-[^-]/.test(t)) return false;
    for (const ch of t.slice(1)) {
      if (corte.includes(ch)) return true;
      if (conValore.includes(ch)) return false;
    }
    return false;
  }
  function gitLanciaProgramma(sub, args) {
    // `git submodule foreach <comando>` fa girare il comando nella shell, in ogni sotto-modulo.
    if (sub === 'submodule') return argVariants(args.find((a) => !a.startsWith('-')) || '').some((v) => v.toLowerCase() === 'foreach');
    const o = GIT_LANCIA[sub];
    return !!o && args.some((a) => argVariants(a).some((v) =>
      o.lunghe.some((n) => opzioneLunga(v, n, 1) != null) || (!!o.corte && cortaNelGruppo(v, o.corte, o.conValore))));
  }

  // Le letture di git che con certe forme scrivono o eseguono: il livello a cui salgono, 0 se restano letture.
  // Sentinella: ogni nome di GIT_READ sta nella tabella di letturaCheScrive.test.mjs.
  const GIT_READ_MUTATES = {
    // `-O`/`--open-files-in-pager` (anche accorciato) apre i risultati nel programma scritto nel comando.
    grep: (args) => (args.some((a) => /^-[^-]*O/.test(a) || /^--op[a-z-]*(=|$)/.test(a)) ? 3 : 0),
    // Leggono solo `show`, `list`, `exists` e un riferimento (`HEAD`, `HEAD@{1}`, `refs/…`, `origin/main`): gli altri
    // verbi (expire, delete, drop, write…) cancellano o scrivono la storia che serve a recuperare i commit persi,
    // e uno nuovo di git nasce già fra questi. Un altro nome nudo può essere un ramo o un verbo nuovo: chiede.
    reflog: (args) => {
      const primo = args.find((a) => !a.startsWith('-')) || '';
      // Un numero è il valore di un'opzione (`-n 5`), non un verbo.
      if (!primo || /^(show|list|exists)$/i.test(primo) || /^HEAD$|[@/~^]|^\d+$/.test(primo)) return 0;
      return /^(expire|delete|drop|write)$/i.test(primo) ? 3 : 2;
    },
    // Con due operandi `symbolic-ref` sposta HEAD: cambia il ramo corrente.
    'symbolic-ref': (args) => (args.filter((a) => !a.startsWith('-')).length >= 2 ? 2 : 0),
  };

  function classifyGit(cmd) {
    const sub = subcommandOf(cmd);
    const globali = tokens(cmd).slice(1).map(unquote);
    const k = globali.findIndex((x) => !x.startsWith('-'));
    if (sub && globali.slice(0, k).some((x) => !GIT_GLOBALI_INNOCUE.has(x) && !VERSION_TOKENS.has(x.toLowerCase()))) return 3;
    if (!sub) return 1; // `git` da solo stampa l'help → lettura
    if (GIT_DESTROY.has(sub)) return 3;
    if (gitPericolosa(cmd)) return 3; // es. push --force, checkout -f, branch -D, tag -d
    const t = tokens(cmd).slice(1);
    if (t.slice(0, t.findIndex((x) => !x.startsWith('-'))).some((x) => !GIT_GLOBALI_INNOCUE.has(x) && !GIT_GLOBALE_CARTELLA.test(x))) return 3;
    if (gitScriveFile(cmd)) return 3;
    const dual = GIT_DUAL[sub];
    if (dual) return dual(cmd); // tag/branch/config/remote: dipende dagli argomenti
    if (GIT_READ.has(sub)) {
      const args = gitArgsAfterSub(cmd);
      const sale = GIT_READ_MUTATES[sub] ? GIT_READ_MUTATES[sub](args) : 0;
      if (sale) return sale;
      return gitUscita(args) == null ? 1 : 2;
    }
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

  Object.assign(P, { GIT_READ, GIT_GLOBALE_CARTELLA, gitScriveFile, gitUscita, classifyGit, classifyNpm });
})(typeof globalThis !== 'undefined' ? globalThis : self);
