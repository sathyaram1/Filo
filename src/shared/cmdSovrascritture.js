// Parte di cmdClassify.js (#2493): le sovrascritture (#892.2), il livello di un comando letto come lo riceve il programma, il `cd`.
// Non pubblica niente per conto suo: si registra su SN_CMD_PARTI, e la compone cmdClassify.js, dove stanno le regole.
// Si carica dopo cmdBase.js, cmdGit.js e cmdPerimetro.js, da cui prende al caricamento.
(function (global) {
  'use strict';
  const P = global.SN_CMD_PARTI;
  const {
    dove, assolutoDi, pezzi, JOLLY, shellPosix, opzioneLunga, valoreDuePunti, parametro, programOf, dequote, argomenti,
    uniqUscita, treeUscita, gitUscita, forsePowerShell, graffe, gitScriveFile, perimetroDi, cartellaDa, nomeNorm, peggiore,
    GIT_GLOBALI_INNOCUE,
  } = P;
  // Da una parte caricata dopo: si cerca alla chiamata, perché classifyOne e segmentIsRead si chiamano a vicenda.
  const classifyOne = (raw, shell) => P.classifyOne(raw, shell);

  // ── Sovrascritture (#892.2) ───────────────────────────────────────────────
  // Una copia, uno spostamento o un archivio scritti su un file che c'è già lo sostituiscono o lo svuotano, e quello
  // di prima non torna: costo 3, per l'utente come per Filo. Se ci sia lo dice il disco, `c.esiste` del main, che qui
  // si chiede solo per percorsi locali; senza sonda il livello resta quello del programma.
  const SOVRASCRIVE = "sovrascrive un file che c'è già, e quello di prima si perde";
  const PUO_SOVRASCRIVERE = "può sovrascrivere dei file che ci sono già, e quello di prima si perde";

  function statoDi(p, c) {
    const r = dove(String(p || ''), c);
    if (!r || typeof r !== 'object') return 'ignoto';
    let s = null;
    try { s = c.esiste(assolutoDi(r, c)); } catch (_) { s = 'ignoto'; }
    return s === 'file' || s === 'cartella' || s === null ? s : 'ignoto';
  }
  const nomeDi = (p) => pezzi(p).pop() || '';
  const unisci = (cartella, nome) => `${String(cartella).replace(/[\\/]+$/, '')}/${nome}`;

  // `sorgenti` vanno in `dest`: dentro, se è una cartella (o `inCartella`), altrimenti al suo posto.
  function copiaSovrascrive(sorgenti, dest, c, { inCartella = false, maiDentro = false } = {}) {
    const sd = statoDi(dest, c);
    if (sd === 'ignoto') return PUO_SOVRASCRIVERE;
    if (!inCartella && (sd !== 'cartella' || maiDentro)) return sd ? SOVRASCRIVE : '';
    if (sd !== 'cartella') return '';
    for (const s of sorgenti) {
      const nome = nomeDi(s);
      if (!nome || JOLLY.test(s) || nome === '.' || nome === '..') return PUO_SOVRASCRIVERE;
      const st = statoDi(unisci(dest, nome), c);
      if (st === 'file') return SOVRASCRIVE;
      // Una cartella che c'è già si fonde: i file con lo stesso nome dentro si sostituiscono.
      if (st) return PUO_SOVRASCRIVERE;
    }
    return '';
  }

  // Lo stile della riga: PowerShell (cp e mv sono Copy-Item e Move-Item), cmd (opzioni con la barra) o POSIX.
  function stileDi(c) {
    if (!c.win || shellPosix(c)) return 'posix';
    return c.shell === 'cmd' ? 'cmd' : 'powershell';
  }

  function copiaPosix(testi, c, { forza = null } = {}) {
    let target = null;
    let noClobber = false;
    let maiDentro = false;
    let forzato = false;
    const ops = [];
    let fine = false;
    for (let i = 0; i < testi.length; i++) {
      const t = testi[i];
      if (fine || !t.startsWith('-') || t === '-') { ops.push(t); continue; }
      if (t === '--') { fine = true; continue; }
      if (t.startsWith('--')) {
        const [nome, ...v] = t.split('=');
        if (nome === '--target-directory') target = v.length ? v.join('=') : testi[++i];
        else if (nome === '--no-clobber' || (nome === '--update' && /^none/.test(v.join('=')))) noClobber = true;
        else if (nome === '--no-target-directory') maiDentro = true;
        else if (opzioneLunga(nome, 'force', 2) != null) forzato = true;
        else if (nome === '--suffix' && !v.length) i += 1;
        continue;
      }
      for (let k = 1; k < t.length; k++) {
        const ch = t[k];
        if (ch === 'n') noClobber = true;
        else if (ch === 'T') maiDentro = true;
        else if (ch === 'f') forzato = true;
        else if (ch === 't' || ch === 'S') {
          const valore = t.slice(k + 1) || testi[++i];
          if (ch === 't') target = valore;
          break;
        }
      }
    }
    if (forza && !forzato) return '';
    if (noClobber && !forza) return '';
    if (target != null) return ops.length ? copiaSovrascrive(ops, target, c, { inCartella: true }) : '';
    if (ops.length < 2) return '';
    return copiaSovrascrive(ops.slice(0, -1), ops[ops.length - 1], c, { maiDentro });
  }

  function copiaCmd(prog, testi, c) {
    const ops = testi.filter((t) => !/^\/[-A-Za-z0-9:]+$/.test(t));
    if (!ops.length) return '';
    // Con un operando solo la copia arriva nella cartella di lavoro, col suo nome.
    if (ops.length === 1) return prog === 'move' ? '' : copiaSovrascrive(ops, '.', c, { inCartella: true });
    const sorgenti = ops.slice(0, -1).flatMap((s) => s.split('+')).filter(Boolean);
    const dest = ops[ops.length - 1];
    // cmd copia il CONTENUTO di una cartella dentro l'altra: quali nomi, non si sa.
    if (sorgenti.some((s) => statoDi(s, c) === 'cartella') && statoDi(dest, c) === 'cartella') return PUO_SOVRASCRIVERE;
    return copiaSovrascrive(sorgenti, dest, c);
  }

  // `-Path` e `-LiteralPath` le sorgenti, `-Destination` la meta; il resto con un valore cambia quali file: non si sa.
  const PS_INTERRUTTORI = ['force', 'recurse', 'container', 'passthru', 'confirm', 'verbose', 'debug'];
  function copiaPowerShell(testi, c) {
    const sorgenti = [];
    let dest = null;
    const posizionali = [];
    for (let i = 0; i < testi.length; i++) {
      const t = testi[i];
      if (!/^-[A-Za-z]/.test(t)) { posizionali.push(t); continue; }
      const legato = valoreDuePunti(t);
      const valore = () => (legato != null ? legato : testi[++i]);
      if (parametro(t, 'destination', 1)) dest = valore();
      else if (parametro(t, 'literalpath', 1) || parametro(t, 'path', 1)) sorgenti.push(...String(valore() || '').split(','));
      else if (parametro(t, 'whatif', 1)) return '';
      else if (!PS_INTERRUTTORI.some((n) => parametro(t, n, 2))) return PUO_SOVRASCRIVERE;
    }
    for (const p of posizionali) {
      if (!sorgenti.length) sorgenti.push(...p.split(','));
      else if (dest == null) dest = p;
      else return PUO_SOVRASCRIVERE;
    }
    if (!sorgenti.length) return '';
    return copiaSovrascrive(sorgenti, dest == null ? '.' : dest, c, { inCartella: dest == null });
  }

  // tar: crea l'archivio dato con f (sovrascrivendolo), estrae sopra i file che trova se non gli si dice di tenerli.
  function tarSovrascrive(testi, c) {
    let modo = '';
    let archivio = null;
    let tiene = false;
    const daLeggere = [];
    const lettere = (s, attaccato) => {
      for (let k = 0; k < s.length; k++) {
        const ch = s[k];
        if ('cxtruAd'.includes(ch) && !modo) modo = ch;
        else if (ch === 'k' || ch === 'O') tiene = true;
        else if (ch === 'f' || ch === 'C' || ch === 'T' || ch === 'X' || ch === 'b' || ch === 'L' || ch === 'H') {
          const resto = attaccato ? s.slice(k + 1) : '';
          if (resto) { if (ch === 'f') archivio = resto; return; }
          daLeggere.push(ch);
          if (attaccato) return;
        }
      }
    };
    for (let i = 0; i < testi.length; i++) {
      const t = testi[i];
      if (daLeggere.length) { if (daLeggere.shift() === 'f') archivio = t; continue; }
      if (t.startsWith('--')) {
        const [nome, ...v] = t.split('=');
        const valore = () => (v.length ? v.join('=') : testi[++i]);
        if (nome === '--create') modo = modo || 'c';
        else if (nome === '--extract' || nome === '--get') modo = modo || 'x';
        else if (nome === '--file') archivio = valore();
        else if (/^--(keep-old-files|skip-old-files|to-stdout|keep-newer-files)$/.test(nome)) tiene = true;
        else if (/^--(directory|files-from|exclude-from|blocking-factor|tape-length|use-compress-program)$/.test(nome) && !v.length) i += 1;
        continue;
      }
      if (t.startsWith('-') && t.length > 1) { lettere(t.slice(1), true); continue; }
      if (i === 0 && /^[A-Za-z]+$/.test(t)) { lettere(t, false); continue; }
    }
    if (modo === 'c') return archivio && archivio !== '-' ? copiaSovrascrive([], archivio, c, { maiDentro: true }) : '';
    if (modo === 'x') return tiene ? '' : PUO_SOVRASCRIVERE;
    return '';
  }

  function sovrascrive(raw, c) {
    if (!c.esiste) return '';
    const prog = programOf(dequote(raw));
    const testi = argomenti(raw, c).slice(1).map((a) => (a.variabile || a.ignoto ? '$ignoto' : a.testo));
    const opzione = (re) => testi.some((t) => re.test(t));
    const stile = stileDi(c);
    switch (prog) {
      case 'cp': case 'mv': case 'copy': case 'move': case 'xcopy':
        if (stile === 'powershell') return copiaPowerShell(testi, c);
        if (stile === 'cmd') return copiaCmd(prog, testi, c);
        return copiaPosix(testi, c);
      case 'ln':
        return copiaPosix(testi, c, { forza: true });
      case 'uniq': case 'tree': case 'git': {
        const dest = { uniq: uniqUscita, tree: treeUscita, git: gitUscita }[prog](testi);
        if (dest == null) return '';
        return dest ? copiaSovrascrive([], dest, c, { maiDentro: true }) : PUO_SOVRASCRIVERE;
      }
      case 'robocopy': {
        const ops = testi.filter((t) => !t.startsWith('/'));
        return ops.length >= 2 && statoDi(ops[1], c) !== null ? PUO_SOVRASCRIVERE : '';
      }
      case 'tar':
        return tarSovrascrive(testi, c);
      case 'zip': {
        const ops = [];
        for (let i = 0; i < testi.length; i++) {
          if (/^-(b|n|t|tt|P|O|x|i)$/.test(testi[i])) i += 1;
          else if (!testi[i].startsWith('-')) ops.push(testi[i]);
        }
        return ops.length ? copiaSovrascrive([], /\.[^\\/]+$/.test(ops[0]) ? ops[0] : `${ops[0]}.zip`, c, { maiDentro: true }) : '';
      }
      case 'unzip':
        return opzione(/^-[A-Za-z]*o/) ? PUO_SOVRASCRIVERE : '';
      case 'file': {
        let magia = 'magic';
        // Come la legge file: `--mag=x`, `-Cm x`, `-Cmx`; dopo `-e`, `-f`, `-F` o `-P` il resto del gruppo è il loro valore.
        testi.forEach((t, i) => {
          const lunga = opzioneLunga(t, 'magic-file', 2);
          if (lunga != null) { magia = lunga || testi[i + 1] || ''; return; }
          if (!/^-[^-]/.test(t)) return;
          for (let k = 1; k < t.length; k++) {
            if (t[k] === 'm') { magia = t.slice(k + 1) || testi[i + 1] || ''; return; }
            if ('efFP'.includes(t[k])) return;
          }
        });
        return magia && !magia.includes(':') ? copiaSovrascrive([], `${nomeDi(magia)}.mgc`, c, { maiDentro: true }) : PUO_SOVRASCRIVERE;
      }
      case 'gzip': case 'gunzip':
        return opzione(/^-[A-Za-z]*f/) || testi.some((t) => opzioneLunga(t, 'force', 2) != null) ? PUO_SOVRASCRIVERE : '';
      case 'rename':
        // Il `rename` di Linux sostituisce un file che c'è già; `ren` di Windows no, e lì `rename` è lui.
        return stile === 'posix' && !opzione(/^-[A-Za-z]*[no]|^--(no-act|no-overwrite)$/) ? PUO_SOVRASCRIVERE : '';
      default:
        return '';
    }
  }

  // ── Impostazioni e hook di git (#2619.5) ──────────────────────────────────
  // Scelgono i programmi che partono al prossimo comando git: chi scrive lì vale 3, come la redirezione sullo stesso
  // file. Si guarda ogni parola, sorgenti comprese: le destinazioni sottintese le copre la cartella di lavoro.
  const CUORE_GIT = 'cambia le impostazioni o gli hook di git, che scelgono quali programmi avviare';

  // Come la shell confronta un nome: maiuscole, nome corto 8.3 (`GIT~1`), flusso alternativo (`config:$DATA`), jolly;
  // un jolly in testa non prende un nome col punto, come in bash (`cp * altrove` resta 2).
  function puoEssere(seg, nome) {
    const s = String(seg).replace(/:.*$/, '');
    const corto = /^([^~]+)~\d/.exec(s);
    if (corto) return nome.replace(/^\./, '').startsWith(corto[1].toLowerCase());
    if (!JOLLY.test(s)) return nomeNorm(s) === nome;
    if (nome.startsWith('.') && !s.startsWith('.')) return false;
    let re = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const chiusa = ch === '[' ? s.indexOf(']', i + 2) : -1;
      if (ch === '*') re += '.*';
      else if (ch === '?' || ch === '�') re += '.';
      else if (chiusa > 0) { re += `[${s.slice(i + 1, chiusa).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = chiusa; }
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    try { return new RegExp(`^${re}$`, 'i').test(nome); } catch (_) { return true; }
  }

  // Dentro una cartella `.git` (o il file `.git` di un worktree), gli hook e la configurazione di un repository nudo,
  // la configurazione dell'utente (`~/.gitconfig`, `~/.config/git/config`) e quella di sistema (`etc/gitconfig`).
  function nelCuoreDiGit(segs) {
    return segs.some((s, i) => {
      if (puoEssere(s, '.git') || puoEssere(s, '.gitconfig')) return true;
      const dopo = segs[i + 1];
      if (dopo == null) return false;
      if (/\.git$/.test(nomeNorm(s)) && (puoEssere(dopo, 'config') || puoEssere(dopo, 'hooks'))) return true;
      return (puoEssere(s, 'git') && puoEssere(dopo, 'config')) || (puoEssere(s, 'etc') && puoEssere(dopo, 'gitconfig'));
    });
  }

  function toccaIlCuoreDiGit(raw, c) {
    const parole = new Set(['.', ...dequote(raw).split(/\s+/)]);
    const elenchi = forsePowerShell(c);
    // Senza sistema la shell può anche essere bash, che decodifica `$'\x2egit'` e `.g\it`.
    const shell = c.sistemaIgnoto ? [c, { ...c, sistemaIgnoto: false, win: false, shell: 'sh' }] : [c];
    for (const cs of shell) {
      for (const vuote of [false, true]) {
        const lette = argomenti(raw, { ...cs, vuote, elenchi }).map((a) => a.testo);
        for (const p of lette.concat((shellPosix(cs) || cs.sistemaIgnoto ? graffe(lette) : null) || [])) parole.add(p);
      }
    }
    for (const p of parole) {
      // Il valore di un'opzione: `--target-directory=x`, `-Destination:x`, `/LOG:x`.
      const valore = /^[-/][^=:\\/]*[=:](.+)$/.exec(p);
      for (const t of valore ? [p, valore[1]] : [p]) {
        if (nelCuoreDiGit(pezzi(t))) return true;
        const r = dove(t, c);
        if (r && typeof r === 'object' && nelCuoreDiGit(r.segs)) return true;
      }
    }
    return false;
  }

  // Il programma riceve il comando dopo la shell: escape tolti, `$'…'` e `$"…"` decodificati, le espansioni che possono
  // valere niente tolte (`--out$1put=x` è `--output=x`), le graffe di bash aperte, gli elenchi di PowerShell spezzati.
  // Le opzioni si cercano anche lì, e vale la lettura peggiore (#1994). Ciò che non si sa riprodurre (una variabile di
  // cmd tagliata) è ignoto e chiede (`nomiVariabili`). cmd toglie i suoi `^` prima, in `comeLaShell`.
  function classifyOneLetto(raw, c) {
    const base = classifyOne(raw, c.shell);
    if (base === 3 || c.shell === 'cmd' || !/[\\${,]/.test(raw)) return base;
    const elenchi = forsePowerShell(c);
    let det = base;
    for (const vuote of [false, true]) {
      const parole = argomenti(raw, { ...c, vuote, elenchi }).map((a) => a.testo);
      const aperte = shellPosix(c) || c.sistemaIgnoto ? graffe(parole) : parole;
      if (!aperte) return 3;
      det = Math.max(det, classifyOne(aperte.join(' '), c.shell));
    }
    return det;
  }

  function classifyOneDet(raw, c) {
    const base = classifyOneLetto(raw, c);
    // git cambia le sue impostazioni con `git config`, che misura la chiave.
    if (base === 2 && programOf(dequote(raw)) !== 'git' && toccaIlCuoreDiGit(raw, c)) return { level: 3, motivo: CUORE_GIT };
    // Git con `--output` vale 3 comunque (#1994); sopra un file che c'è già si dice anche perché (#2292).
    const gitOutput = base === 3 && programOf(dequote(raw)) === 'git' && gitScriveFile(dequote(raw));
    if (base === 2 || gitOutput) {
      const motivo = sovrascrive(raw, c);
      if (motivo) return { level: 3, motivo };
    }
    return base === 1 ? perimetroDi(raw, c) : { level: base, motivo: '' };
  }

  // Dopo un `cd` la cartella è quella nuova, o la vecchia se il `cd` fallisce. Dove la shell la risolve in un modo
  // che qui non si ripete (`cd -P` oltre un collegamento, `cd a b` di zsh) la cartella diventa ignota (#2292).
  function spostati(raw, c) {
    const prog = programOf(dequote(raw));
    const args = argomenti(raw, c).slice(1);
    if (prog === 'popd' || args.some((a) => a.variabile || a.ignoto)) return { ...c, cwd: null };
    const cmd = stileDi(c) === 'cmd';
    const posix = shellPosix(c);
    let dest = null;
    for (let i = 0; i < args.length; i++) {
      const t = args[i].testo;
      if (!posix && /^-(literalpath|path|lp)$/i.test(t)) { dest = args[i + 1] ? args[i + 1].testo : null; break; }
      if (t === '-' || t === '') break;
      if (/^\/[A-Za-z]$/.test(t) && !posix) continue;
      if (t.startsWith('-') && !cmd) {
        if (posix && /^-[A-Za-z@]*P/.test(t)) return { ...c, cwd: null };
        continue;
      }
      // cmd prende tutto il resto della riga come nome, spazi compresi; altrove un secondo operando non si segue.
      const resto = args.slice(i + 1).map((a) => a.testo).filter(Boolean);
      if (!cmd && resto.some((a) => !a.startsWith('-'))) return { ...c, cwd: null };
      if (!cmd) { dest = t; break; }
      if (resto.length && prog !== 'cd' && prog !== 'chdir') return { ...c, cwd: null };
      dest = [t, ...resto].join(' ');
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

  Object.assign(P, { classifyOneLetto, classifyOneDet, spostati, chiaveCwd });
})(typeof globalThis !== 'undefined' ? globalThis : self);
