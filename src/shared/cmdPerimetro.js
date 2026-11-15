// Parte di cmdClassify.js (#2493): il perimetro di lettura (#587), le variabili e le espansioni della shell, i percorsi.
// Non pubblica niente per conto suo: si registra su SN_CMD_PARTI, e la compone cmdClassify.js, dove stanno le regole.
// Si carica dopo cmdBase.js e cmdGit.js, da cui prende al caricamento.
(function (global) {
  'use strict';
  const P = global.SN_CMD_PARTI;
  const { SENZA_CONTESTO, subcommandOf, dequote, GIT_GLOBALE_CARTELLA, opzioneLunga, qualeWhere, programOf } = P;

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
    git: 'le impostazioni di questa cartella git possono avviare dei programmi',
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
  const SEGNO_GRUPPO = '\uE000';
  const SEGNAPOSTO = `$_${SEGNO_GRUPPO}`;
  // `'` e `\"` dove sono un carattere qualunque (vedi `comeLaShell`): nessun controllo li prende per virgolette.
  const APICE_TESTO = '\u02BC';
  const VIRGOLETTE_TESTO = '\u02BA';

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
  // In PowerShell `$temp` non è `$env:TEMP`: è una variabile qualsiasi, che un comando di lettura della stessa riga
  // imposta con -OutVariable (#1994). Senza `env:` è nota solo un'automatica; `@nome` passa la variabile a pezzi.
  const PS_AUTOMATICHE = new Set(['home', 'pwd', 'null', 'true', 'false', '_', 'psitem']);
  const PS_VARIABILE_RE = /\$(env:)?([A-Za-z_]\w*)|^@[A-Za-z_]/gi;
  // Lo stesso parametro può riscrivere un'automatica che qui si crede nota (`-OutVariable _`): quella riga non si legge.
  const PS_IMPOSTA_AUTOMATICA_RE = /(?:^|[\s;|])-(?:[oewip]v|outv\w*|errorv\w*|warningv\w*|informationv\w*|pipelinev\w*)(?::|\s+)['"]?\+?(?:_|psitem|pwd|home)['"]?(?=$|[\s;|,)])/i;
  function variabilePowerShell(t) {
    for (const m of String(t).matchAll(PS_VARIABILE_RE)) if (!m[1] && !PS_AUTOMATICHE.has(String(m[2]).toLowerCase())) return true;
    return false;
  }
  // cmd ha anche variabili col nome che comincia per `=` (`%=ExitCode%`, `%=C:%`), tagliabili come le altre.
  const PERCENTO_RE = /%(=?[A-Za-z_][\w()]*)(:[^%]*)?%/gi;

  // Una variabile di cmd tagliata o sostituita (`%PATH:~0,0%` vale niente) non è più il valore innocuo: il suo nome
  // esce col `:` e nessuna lista la riconosce (#1994).
  function nomiVariabili(t, { dollaro = true, percento = true } = {}) {
    const out = [];
    if (dollaro) for (const m of String(t).matchAll(DOLLARO_RE)) out.push(m[1].toLowerCase());
    if (percento) for (const m of String(t).matchAll(PERCENTO_RE)) out.push(m[1].toLowerCase() + (m[2] ? ':' : ''));
    return out;
  }

  // sh e bash (anche su Windows) tolgono i backslash e decodificano `$'…'`; PowerShell e cmd no.
  // Fuori da Windows una shell non indicata è POSIX: lì non ce ne sono altre. Senza contesto il sistema non si sa.
  function shellPosix(c) {
    if (c.sistemaIgnoto) return false;
    return c.win ? c.shell === 'sh' || c.shell === 'bash' : c.shell !== 'powershell' && c.shell !== 'cmd';
  }

  // PowerShell, o una shell che può esserlo.
  function forsePowerShell(c) {
    return !!c.sistemaIgnoto || (!shellPosix(c) && c.shell !== 'cmd');
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

  // Lunghezza del nome dopo un `$` che la shell può espandere a niente: `$1`, `$@`, `$!`, una variabile non impostata
  // (bash distingue le maiuscole: `$pwd` è vuota), `$null` e `$env:x` di PowerShell. 0 se non è un'espansione.
  function espansione(s, k) {
    const m = /^(?:[A-Za-z_]\w*(?::[A-Za-z_]\w*)?|[0-9@*#?!$^-])/.exec(s.slice(k));
    return m ? m[0].length : 0;
  }

  // Le graffe di bash aperte come le apre lei (`--{output=x,}` è `--output=x --`, `{s..u}` è `s t u`); null oltre un
  // tetto di parole, che nessun comando di lettura raggiunge. Una graffa senza virgola né intervallo resta testo.
  const GRAFFE_MAX = 256;
  function graffe(parole) {
    const out = [];
    const coda = parole.slice();
    while (coda.length) {
      const w = coda.shift();
      const e = apriGraffa(w);
      if (e) coda.unshift(...e); else out.push(w.replace(//g, '{').replace(//g, '}'));
      if (out.length + coda.length > GRAFFE_MAX) return null;
    }
    return out;
  }
  // Una passata sola con una pila: rifare la parola a ogni coppia di graffe inerte costava il quadrato della lunghezza,
  // e il conto gira nel processo principale (#1994).
  function apriGraffa(w) {
    const pila = [];
    const inerti = new Set();
    const segnata = () => {
      const s = [];
      for (let k = 0; k < w.length; k++) s.push(!inerti.has(k) ? w[k] : SEGNI_INERTI[w[k] === '{' ? 0 : 1]);
      return s.join('');
    };
    for (let j = 0; j < w.length; j++) {
      const ch = w[j];
      if (ch === '{') { pila.push({ i: j, virgola: false, dentroGraffe: false }); continue; }
      if (ch === ',') { if (pila.length) pila[pila.length - 1].virgola = true; continue; }
      if (ch !== '}' || !pila.length) continue;
      const { i, virgola, dentroGraffe } = pila.pop();
      if (virgola) {
        const s = segnata();
        const prima = s.slice(0, i);
        const dopo = s.slice(j + 1);
        return s.slice(i + 1, j).split(',').map((x) => prima + x + dopo);
      }
      // Un intervallo non contiene graffe: solo lì serve leggere il contenuto.
      const r = dentroGraffe ? null : /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(?:\.\.-?\d+)?$/.exec(w.slice(i + 1, j));
      const numeri = r && /\d/.test(r[1]) && /\d/.test(r[2]);
      if (r && (numeri || (!/\d/.test(r[1]) && !/\d/.test(r[2])))) {
        const a = numeri ? Number(r[1]) : r[1].charCodeAt(0);
        const b = numeri ? Number(r[2]) : r[2].charCodeAt(0);
        if (Math.abs(b - a) >= GRAFFE_MAX) return Array(GRAFFE_MAX + 1).fill('');
        const s = segnata();
        const prima = s.slice(0, i);
        const dopo = s.slice(j + 1);
        const passo = a <= b ? 1 : -1;
        const voci = [];
        for (let v = a; v !== b + passo; v += passo) voci.push(prima + (numeri ? String(v) : String.fromCharCode(v)) + dopo);
        return voci;
      }
      inerti.add(i);
      inerti.add(j);
      if (pila.length) pila[pila.length - 1].dentroGraffe = true;
    }
    return inerti.size ? [segnata()] : null;
  }
  // Tutti i segni interni, presi dalle loro definizioni: scritti da chi manda il comando fingerebbero un gruppo già misurato.
  const segniInterni = () => SEGNO_GRUPPO + SEGNI_INERTI;
  // I segni delle graffe inerti mentre si aprono le altre: `graffe` li rimette come erano.
  const SEGNI_INERTI = '';

  // Argomenti come li vede la shell: le virgolette raggruppano (un percorso con
  // spazi è UNO) e `variabile` segna un'espansione che può portare un segreto:
  // fuori da `echo` finisce comunque stampata nei messaggi d'errore.
  // Su Windows `\` prima di uno spazio è la fine di un percorso (`src\ \\host\x` sono due operandi), non un escape.
  function argomenti(raw, c) {
    const win = c.win;
    const posix = shellPosix(c);
    const powershell = forsePowerShell(c);
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
        const variabile = nomi.some((n) => !VAR_INNOCUE.has(n)) || (powershell && variabilePowerShell(espande));
        out.push({ testo: cur, variabile, ignoto });
      }
      cur = ''; espande = ''; aperto = false; ignoto = false;
    };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === q) { q = ''; continue; }
        if (posix && q === '"' && ch === '\\' && /[$`"\\]/.test(s[i + 1] || '')) { cur += s[i + 1]; espande += ch + s[i + 1]; i += 1; continue; }
        if (c.vuote && q === '"' && ch === '$' && espansione(s, i + 1)) { i += espansione(s, i + 1); continue; }
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
      if (c.vuote && ch === '$' && espansione(s, i + 1)) { i += espansione(s, i + 1); continue; }
      if (ch === '"' || ch === '\'') { q = ch; aperto = true; espande += ' '; continue; }
      if (posix && ch === '\\' && i + 1 < s.length) { cur += s[i + 1]; espande += ch + s[i + 1]; i += 1; continue; }
      if (!win && ch === '\\' && /\s/.test(s[i + 1] || '')) { cur += s[i + 1]; i += 1; continue; }
      if (/\s/.test(ch)) { chiudi(); continue; }
      // PowerShell passa a un programma un elenco `a,'--output=x'` come argomenti separati.
      if (c.elenchi && ch === ',') { chiudi(); continue; }
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
    const c = {
      win: !!x.win, maiuscole: !!x.maiuscole, home: null, cwd: null, reti: new Set(reti), shell, sistemaIgnoto: x === SENZA_CONTESTO,
      esiste: typeof x.esiste === 'function' ? x.esiste : null,
      gitLancia: typeof x.gitLancia === 'function' ? x.gitLancia : null,
    };
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

  // Il percorso di un punto risolto (radice e pezzi) come lo vuole il disco: lo stesso per ogni sonda del main.
  function assolutoDi(r, c) {
    return c.win ? `${r.radice}\\${r.segs.join('\\')}` : `/${r.segs.join('/')}`;
  }

  // git: `--no-index` confronta file qualsiasi, `rev:percorso` e ciò che segue `--` sono file.
  function gitPerimetro(raw, c) {
    const sub = subcommandOf(dequote(raw));
    // Le impostazioni di un repository arrivato da fuori possono far partire programmi anche a una lettura (#2292):
    // lo dice la sonda del main, `c.gitLancia(cartella)`; senza sonda il livello resta quello del comando.
    if (typeof c.gitLancia === 'function' && sub) {
      if (!c.cwd || c.cwd.rete || c.cwd.provider) return due(MOTIVI.ignoto);
      let lancia = 'ignoto';
      try { lancia = c.gitLancia(assolutoDi(c.cwd, c)); } catch (_) { lancia = 'ignoto'; }
      if (lancia) return due(MOTIVI.git);
    }
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
    // Di `--git-dir=<x>/.git` conta il repository `<x>`: la sua cartella `.git` è nascosta per costruzione.
    const percorsi = testi.slice(0, Math.max(k, 0)).filter((a) => GIT_GLOBALE_CARTELLA.test(a)).map((a) => {
      const p = a.slice(a.indexOf('=') + 1);
      return /^--git-dir=/.test(a) ? p.replace(/(^|[\\/])\.git[\\/]*$/i, (m, s) => s || '.') : p;
    });
    args.forEach((a, i) => {
      // `git blame --contents <file>` stampa un file qualsiasi come se fosse quello del repository (#1994, #2292).
      const contenuto = opzioneLunga(a, 'contents', 3);
      if (contenuto != null) {
        percorsi.push(a.includes('=') ? contenuto : args[i + 1] || '');
        return;
      }
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
  function cercaNomeInRete(prog, testi, c, raw) {
    if (CERCANO_NOME.has(prog)) {
      return testi.some((t) => {
        const v = valoreDuePunti(t);
        const nome = v != null ? v : (t.startsWith('-') ? null : t);
        return nome != null && dove(nome, c) === MOTIVI.rete;
      });
    }
    // In PowerShell `where` da solo è il filtro, che non cerca file.
    if (prog === 'where' && qualeWhere(raw, c.shell) !== 'filtro') {
      return testi.some((t) => t && !/^[-/]/.test(t));
    }
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
    if (c.cwd && c.cwd.rete && cercaNomeInRete(prog, testi, c, dequote(raw))) return due(MOTIVI.rete);
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

  Object.assign(P, {
    MOTIVI, ELENCA_OGGETTI, LETTI_DAL_TUBO, SPOSTAMENTI, PERCORSO_DAL_TUBO, FONTI_NOTE, CALCOLANO, CERCANO_NOME,
    PROFILO_APERTE, JOLLY, SEGNO_GRUPPO, SEGNAPOSTO, APICE_TESTO, VIRGOLETTE_TESTO, UNO, TRE, due, peggiore, VAR_INNOCUE,
    PS_IMPOSTA_AUTOMATICA_RE, nomiVariabili, shellPosix, forsePowerShell, forseDash, APICE_CHE_DASH_CHIUDE, graffe,
    segniInterni, argomenti, pezzi, dove, dentroCasa, nomeNorm, cartellaDa, contesto, fuoriDa, valoreDuePunti, parametro,
    assolutoDi, perimetroDi,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
