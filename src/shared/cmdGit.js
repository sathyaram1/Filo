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
    'apply', 'am', 'worktree', 'submodule',
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

  // Le chiavi di un repository che a una lettura non avviano niente; ogni altra chiave locale fa chiedere (#2292).
  const GIT_CHIAVI_INERTI = [
    // core.hooksPath sposta solo la cartella degli hook, che la sonda segue già da sé (husky la imposta).
    /^core\.(repositoryformatversion|filemode|bare|worktree|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|quotepath|longpaths|fscache|checkstat|trustctime|untrackedcache|sparsecheckout|sparsecheckoutcone|abbrev|compression|preloadindex|protecthfs|protectntfs|hidedotfiles|hookspath|commentchar|commentstring)$/,
    // Di un remoto avviano un programma solo i comandi di rete (uploadpack, receivepack, vcs), e una lettura va in
    // rete solo da un remoto promettente: quelle chiavi chiedono. Le altre le scrivono anche VS Code e GitHub CLI
    // (gh-resolved). I rami non avviano niente.
    /^remote\.[^=]+\.(?!(uploadpack|receivepack|vcs|promisor|partialclonefilter)$)[^.=]+$/,
    /^branch\.[^=]+\.[^.=]+$/,
    /^submodule\.[^=]+\.(url|active|branch)$/,
    /^user\.(name|email|signingkey)$/,
    /^(pull\.(rebase|ff)|push\.(default|autosetupremote)|fetch\.prune|init\.defaultbranch|merge\.(ff|conflictstyle)|rebase\.(autosquash|autostash))$/,
    /^(extensions\.(objectformat|refstorage|worktreeconfig)|lfs\.repositoryformatversion|gui\.[^=]+|color\.[^=]+)$/,
    // Sezioni intere che una lettura non usa per avviare niente: valgono per comandi che non sono letture (commit,
    // merge, gc, maintenance…), o sono dati (alias di un nome che una lettura non usa, git-flow, blame, status).
    /^(commit|tag|merge|rebase|pull|push|fetch|gc|maintenance|rerere|init|gitflow|alias|blame|status|index|feature|advice|format|pretty|i18n|column|checkout|clone)\.[^=]+$/,
    /^(remote|branch|submodule)\.[^.=]+$/,
    // diff.external avvia un programma; i driver (`diff.<nome>.*`) restano fuori.
    /^diff\.(?!external$)[^.=]+$/,
    // log.showSignature fa partire gpg a ogni git log.
    /^log\.(?!showsignature$)[^.=]+$/,
    // git-lfs, per indirizzo: come si autentica e il controllo dei lucchetti. Le estensioni di lfs avviano programmi.
    /^lfs\.[^=]+\.(access|locksverify)$/,
    /^core\.(splitindex|multipackindex|commitgraph|fsyncmethod|packedgitlimit|packedgitwindowsize|deltabasecachelimit|bigfilethreshold)$/,
  ];
  // Inerti a una lettura, non ai comandi che scrivono (#2621): gli hook partono a commit, init e clone, un driver di
  // merge a merge, un alias `!` a un nome che il classificatore crede di git (`git pop`).
  const GIT_CHIAVI_LANCIANO_SCRIVENDO = /^(core\.hookspath|init\.templatedir|alias\.[^=]+|merge\.[^=]+\.[^.=]+)$/;
  // `scrivendo`: la chiave la scrive `git config`, e il programma partirebbe a un comando di git che scrive.
  // safe.directory sta solo nelle impostazioni dell'utente e non avvia niente: ai repository che rende leggibili
  // la sonda guarda prima di ogni lettura.
  function gitChiaveInerte(chiave, valore, scrivendo) {
    const k = String(chiave).toLowerCase();
    // `core.fsmonitor` con un valore sì/no accende il demone di git, non un programma scelto dal repository.
    if (k === 'core.fsmonitor') return /^(true|false|yes|no|on|off|1|0)?$/i.test(String(valore || '').trim());
    if (scrivendo && k === 'safe.directory') return true;
    if (scrivendo && GIT_CHIAVI_LANCIANO_SCRIVENDO.test(k)) return false;
    return GIT_CHIAVI_INERTI.some((re) => re.test(k));
  }

  // Scriverla non fa avviare niente dopo (#2619): le inerti a una lettura, meno quelle che lanciano a un comando che
  // scrive, più le globali che una lettura non guarda. Le altre → 3, come la stessa impostazione data con `git -c`.
  const GIT_SCRITTE_INERTI = /^(safe\.directory|core\.(excludesfile|whitespace)|http\.(postbuffer|version|lowspeedlimit|lowspeedtime|maxrequests))$/;
  // Un editor o un helper noto per nome, coi soli interruttori senza valore: `code --wait` resta 2, `vim -c '!…'` no.
  const EDITORI = new Set(['code', 'code-insiders', 'codium', 'cursor', 'windsurf', 'zed', 'subl', 'atom', 'mate', 'nano',
    'pico', 'vi', 'vim', 'nvim', 'gvim', 'mvim', 'emacs', 'micro', 'hx', 'helix', 'kak', 'joe', 'notepad', 'notepad++',
    'gedit', 'kate', 'kwrite', 'mousepad', 'xed', 'pluma']);
  const EDITORE_INTERRUTTORI = new Set(['--wait', '-w', '-n', '--new-window', '-r', '--reuse-window', '-f', '--nofork',
    '-nw', '-multiinst', '-notabbar', '-nosession', '-noplugin']);
  const HELPER_NOTI = new Set(['store', 'cache', 'manager', 'manager-core', 'osxkeychain', 'libsecret', 'wincred']);
  // Un editor col percorso intero vale il suo nome solo in una cartella che scrive soltanto l'amministratore: è la forma
  // che scrive l'installatore di git su Windows. Una cartella qualsiasi può ospitare un programma col nome di un editor.
  const EDITORE_DI_SISTEMA = /^(?:c:[\\/]program files(?: \(x86\))?|\/usr\/bin|\/bin)[\\/](?:[^\\/]*[\\/])*([^\\/\s]+?)(?:\.exe)?(?:\s+|$)/i;
  function editoreNoto(parole) {
    const valore = parole.join(' ');
    const m = /\.\./.test(valore) ? null : EDITORE_DI_SISTEMA.exec(valore);
    const [nome, ...resto] = m ? [m[1], ...valore.slice(m[0].length).split(/\s+/).filter(Boolean)] : parole;
    return Boolean(nome) && EDITORI.has(nome.toLowerCase().replace(/\.exe$/, ''))
      && resto.every((x) => EDITORE_INTERRUTTORI.has(x.toLowerCase()));
  }
  // Pager e ssh coi valori più comuni, che non scelgono un programma qualsiasi: gli interruttori di less non prendono
  // valori (niente `-o file`, `-k file`, `+comando`), di ssh solo la chiave e le opzioni che non avviano comandi.
  const LESS_INTERRUTTORE = /^(-[FRSXrKiIMmNnWwQqs]+|--(RAW-CONTROL-CHARS|raw-control-chars|quit-if-one-screen|no-init|chop-long-lines|ignore-case|LINE-NUMBERS|quiet))$/;
  function pagerNoto(parole) {
    const nome = String(parole[0] || '').toLowerCase().replace(/\.exe$/, '');
    if (nome === 'less') return parole.slice(1).every((x) => LESS_INTERRUTTORE.test(x));
    return parole.length === 1 && ['cat', 'more', 'delta'].includes(nome);
  }
  const SSH_OPZIONE = /^(identitiesonly=(yes|no)|stricthostkeychecking=(yes|no|accept-new)|batchmode=(yes|no)|connecttimeout=\d+|port=\d+)$/i;
  function sshNoto(parole) {
    if (!/^ssh(\.exe)?$/i.test(parole[0] || '')) return false;
    for (let i = 1; i < parole.length; i++) {
      const x = parole[i];
      if (x === '-i' && parole[i + 1] && !parole[i + 1].startsWith('-')) i += 1;
      else if (x === '-o' && SSH_OPZIONE.test(parole[i + 1] || '')) i += 1;
      else if (x === '-p' && /^\d+$/.test(parole[i + 1] || '')) i += 1;
      else if (!/^-[46qvT]+$/.test(x)) return false;
    }
    return true;
  }
  const BOOLEANO = /^(true|false|yes|no|on|off|1|0)$/i;
  function gitChiaveScrittaInerte(chiave, parole) {
    const p = parole.map((x) => x.toLowerCase());
    if (GIT_CHIAVI_LANCIANO_SCRIVENDO.test(chiave)) return false;
    if (/^(core|sequence)\.editor$/.test(chiave)) return editoreNoto(parole);
    // `pager.<comando>` con un sì o un no accende o spegne il pager di sempre; con un altro valore è il pager.
    if (/^pager\.[^.=]+$/.test(chiave)) return (p.length === 1 && BOOLEANO.test(p[0])) || pagerNoto(parole);
    if (chiave === 'core.pager') return pagerNoto(parole);
    if (chiave === 'core.sshcommand') return sshNoto(parole);
    if (/^credential\..*helper$/.test(chiave)) return HELPER_NOTI.has(p[0]) && p.slice(1).every((x) => /^--timeout=\d+$/.test(x));
    if (/^credential\./.test(chiave)) return true; // username, useHttpPath…: dati che l'helper legge
    if (chiave === 'gpg.format') return /^(openpgp|x509|ssh)$/.test(p.join(' '));
    return GIT_SCRITTE_INERTI.test(chiave) || gitChiaveInerte(chiave, p.join(' '), true);
  }

  // Le opzioni di `git config` col valore staccato: senza saltarlo, il file di `-f <file>` passava per la chiave.
  const GIT_CONFIG_COL_VALORE = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
  const GIT_CONFIG_INTERRUTTORE = /^(-z|--(global|local|system|worktree|add|replace-all|append|all|bool|int|bool-or-int|path|expiry-date|no-type|null|fixed-value|show-origin|show-scope|includes|no-includes))$/;
  // Le posizioni degli operandi di `git config` (verbo, chiave, valore), saltati i valori delle opzioni.
  function gitConfigOperandi(args) {
    const pos = [];
    for (let i = 0; i < args.length; i++) {
      if (GIT_CONFIG_COL_VALORE.has(args[i].toLowerCase())) i += 1;
      else if (!args[i].startsWith('-')) pos.push(i);
    }
    return pos;
  }

  // git legge un'opzione lunga anche accorciata (`--unset-a` è `--unset-all`, `--verb` è `--verbose`), ma un nome
  // scritto intero vince sugli altri che comincia: `--get` non è `--get-regexp`, `--unset` non è `--unset-all`.
  const GIT_NOMI_INTERI = new Set(['get', 'unset', 'bool']);
  function gitOpzione(a, nomi) {
    return nomi.some((n) => {
      if (opzioneLunga(a, n, 1) == null) return false;
      const scritto = a.slice(2).split('=')[0].toLowerCase();
      return scritto === n || !GIT_NOMI_INTERI.has(scritto);
    });
  }
  const conOpzione = (args, ...nomi) => args.some((a) => gitOpzione(a, nomi));

  // `git config` nella forma con le opzioni (`--unset`, `chiave valore`…): gli argomenti dopo il sotto-comando.
  function gitConfigForma(args) {
    const low = args.map((a) => a.toLowerCase());
    if (conOpzione(args, 'unset', 'unset-all', 'remove-section')) return 3;
    // Rinominare una sezione sposta le sue chiavi in un'altra: `color.sshcommand` diventa `core.sshcommand` (#2621).
    if (conOpzione(args, 'rename-section')) return 3;
    const pos = gitConfigOperandi(args);
    const ops = pos.map((i) => args[i]);
    const chiave = (ops[0] || '').toLowerCase();
    // Le chiavi che decidono dove va il codice al prossimo push: l'indirizzo è `git remote set-url` per un'altra strada
    // (#530), il remoto di un ramo o quello predefinito accettano anche un indirizzo al posto di un nome, e un file
    // incluso può scrivere ognuna di queste (#2623).
    const scrive = ops.length >= 2 || conOpzione(args, 'add', 'replace-all');
    if (scrive && /^remote\..+\.(push)?url$|^url\..+\.(push)?insteadof$|^branch\..+\.(push)?remote$|^remote\.pushdefault$|^include(if\..+)?\.path$/
      .test(chiave)) return 3;
    // Il valore scritto, tolti gli interruttori senza valore di git config. Un'opzione col valore dopo la chiave resta
    // dentro: potrebbe stare nel valore fra virgolette (`"vim --default +!x"`), e allora il controllo cade.
    // `--get chiave modello` legge: git rifiuta due azioni insieme (#2621).
    if (scrive && !low.some((a) => /^--get(-|$)/.test(a))) {
      return gitChiaveScrittaInerte(chiave, args.slice(pos[0] + 1).filter((a, k) => !GIT_CONFIG_INTERRUTTORE.test(low[pos[0] + 1 + k]))) ? 2 : 3;
    }
    if (low.includes('-e') || conOpzione(args, 'edit')) return 2;
    // Lettura: un dump completo, o una chiave che porta credenziali (URL di un
    // remoto con token, `credential.helper`), stampa un segreto in chiaro nella
    // conversazione → conferma (#587). Una chiave innocua (`user.email`) resta 1.
    if (low.includes('-l') || conOpzione(args, 'list', 'get-regexp', 'get-urlmatch')) return 2;
    return /(^|\.)url$|credential|password|token/.test(chiave) ? 2 : 1;
  }

  // Da git 2.46 il primo operando può essere un verbo (`git config set remote.origin.url …`): una chiave ha
  // sempre un punto, quindi un verbo senza punto non si confonde. Tolto il verbo, vale la forma di prima.
  function gitConfigVerbi(cmd) {
    const args = gitArgsAfterSub(cmd);
    const i = gitConfigOperandi(args)[0];
    const verbo = i === undefined ? '' : args[i].toLowerCase();
    if (!/^(list|get|set|unset|edit|rename-section|remove-section|get-color|get-colorbool)$/.test(verbo)) return gitConfigForma(args);
    const resto = args.filter((_, k) => k !== i);
    const low = resto.map((a) => a.toLowerCase());
    if (verbo === 'unset' || verbo === 'remove-section' || verbo === 'rename-section') return 3;
    if (verbo === 'list' || verbo === 'edit') return 2;
    if (verbo === 'set') return Math.max(2, gitConfigForma(low.includes('--append') ? resto.concat('--add') : resto));
    if (low.some((a) => /^--(regexp|url)(=|$)/.test(a))) return 2;
    return gitConfigForma(resto);
  }

  // Le virgolette restano aperte a fine comando, come le legge bash (il backslash fuori dagli apici protegge il
  // carattere dopo): `"Mario D'Angelo"` è chiuso, `"code` no.
  function virgoletteAperte(cmd) {
    let dentro = '';
    const s = String(cmd);
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (dentro === "'") { if (c === "'") dentro = ''; continue; }
      if (c === '\\') { k += 1; continue; }
      if (dentro === '"') { if (c === '"') dentro = ''; continue; }
      if (c === '"' || c === "'") dentro = c;
    }
    return dentro !== '';
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
    config: gitConfigVerbi,
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

  // I sotto-comandi di scrittura che eseguono un programma scelto nel comando: valgono quanto lanciarlo da soli (#2619.1).
  // Le lunghe si riconoscono anche accorciate, come le accetta git; le corte anche raggruppate (`-ix`), fino alla
  // prima che si prende il resto come valore. `config` e `template` di clone/init il programma lo scelgono senza scriverlo.
  const GIT_ESEGUE = {
    rebase: { lunghe: ['exec'], corte: 'x', conValore: 'sXCS' },
    clone: { lunghe: ['upload-pack', 'config', 'template'], corte: 'uc', conValore: 'objuc' },
    fetch: { lunghe: ['upload-pack'] },
    pull: { lunghe: ['upload-pack'] },
    push: { lunghe: ['receive-pack', 'exec'] },
    init: { lunghe: ['template'] },
  };
  // `t` sono i token dopo `git`, senza virgolette. Il comando che git esegue, dal programma in poi (vuoto se non si
  // legge, come per `config` e `template`), o null se la forma non esegue niente di scritto nel comando.
  function gitProgrammaScritto(t) {
    let k = 0;
    while (k < t.length && String(t[k]).startsWith('-')) k += /^-[Cc]$/.test(t[k]) ? 2 : 1;
    if (k >= t.length) return null;
    const sub = String(t[k]).toLowerCase();
    const args = t.slice(k + 1).map(String);
    if (sub === 'submodule') {
      const j = args.findIndex((a) => !a.startsWith('-'));
      if (j < 0 || !argVariants(args[j]).some((v) => v.toLowerCase() === 'foreach')) return null;
      const dopo = args.slice(j + 1);
      return dopo.slice(Math.max(0, dopo.findIndex((a) => !a.startsWith('-'))));
    }
    const regola = GIT_ESEGUE[sub];
    if (!regola) return null;
    const conAttaccato = (valore, i) => (valore ? [valore, ...args.slice(i + 1)] : args.slice(i + 1));
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      for (const nome of regola.lunghe) {
        const valore = opzioneLunga(a, nome, 1);
        if (valore != null) return conAttaccato(valore, i);
      }
      if (!regola.corte || !/^-[^-]/.test(a)) continue;
      for (let c = 1; c < a.length; c++) {
        if (regola.corte.includes(a[c])) return conAttaccato(a.slice(c + 1), i);
        if (regola.conValore.includes(a[c])) break;
      }
    }
    return null;
  }

  function classifyGit(cmd, grezzo = cmd) {
    const sub = subcommandOf(cmd);
    const globali = tokens(cmd).slice(1).map(unquote);
    const k = globali.findIndex((x) => !x.startsWith('-'));
    if (sub && globali.slice(0, k).some((x) => !GIT_GLOBALI_INNOCUE.has(x) && !VERSION_TOKENS.has(x.toLowerCase()))) return 3;
    if (!sub) return 1; // `git` da solo stampa l'help → lettura
    // git riconosce i suoi comandi solo scritti così, mentre le chiavi non badano alle maiuscole: `git Status` è
    // l'alias `alias.status`, che può avviare un programma (#2619).
    if (globali.find((x) => x && !x.startsWith('-')) !== sub) return 3;
    if (GIT_DESTROY.has(sub)) return 3;
    if (gitPericolosa(cmd)) return 3; // es. push --force, checkout -f, branch -D, tag -d
    const t = tokens(cmd).slice(1);
    if (t.slice(0, t.findIndex((x) => !x.startsWith('-'))).some((x) => !GIT_GLOBALI_INNOCUE.has(x) && !GIT_GLOBALE_CARTELLA.test(x))) return 3;
    if (gitScriveFile(cmd)) return 3;
    if (gitLanciaProgramma(sub, gitArgsAfterSub(cmd))) return 3;
    if (gitProgrammaScritto(globali)) return 3;
    const dual = GIT_DUAL[sub];
    // Una scrittura di config con le virgolette aperte nel testo grezzo è un pezzo: la sequenza è stata spezzata dentro
    // il valore, e quello che git consegnerà alla shell (`"code;evil"`) non è il valore controllato qui.
    if (sub === 'config') { const v = dual(cmd); return v > 1 && virgoletteAperte(grezzo) ? 3 : v; }
    if (dual) return dual(cmd); // tag/branch/remote: dipende dagli argomenti
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

  Object.assign(P, { GIT_READ, GIT_GLOBALE_CARTELLA, gitChiaveInerte, gitScriveFile, gitUscita, gitProgrammaScritto, classifyGit, classifyNpm });
})(typeof globalThis !== 'undefined' ? globalThis : self);
