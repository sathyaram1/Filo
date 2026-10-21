// Riconosce fra i file del repo, che è pubblico, una copia di dati del server (documenti Firestore, campi di feedback) dal contenuto.
// Non legge il server e non sposta niente: dice quali file e commit sono copie e perché. Le copie di lavoro stanno in os.tmpdir().
// Sentinella: tests/unit/copieDiDatiFuoriDalRepo.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dati finti per le prove: l'unico posto del repo dove una copia è ammessa.
export const CARTELLA_FINTI = 'tests/fixtures/';

const VALORI_FIRESTORE = new Set([
  'stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'timestampValue', 'mapValue',
  'arrayValue', 'nullValue', 'referenceValue', 'geoPointValue', 'bytesValue',
]);
// Chi ha scritto: da soli, o accanto al testo, rendono riconoscibile una persona.
const IDENTITA = ['clientId', 'clientIdHash', 'userAgent', 'walletPseudonym'];
const CAMPI = ['text', ...IDENTITA];

const oggetto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const valoreFirestore = (v) => oggetto(v) && Object.keys(v).length === 1 && VALORI_FIRESTORE.has(Object.keys(v)[0]);
const percorsoFirestore = (s) => /\/databases\/[^/]+\/documents\//.test(s);
// Un campo scritto in chiaro o nel formato del server è la stessa persona.
const scritto = (v) => typeof v === 'string' || (valoreFirestore(v) && typeof v.stringValue === 'string');
// Lo stesso campo con un altro nome (user_agent, «User Agent», useragent, client_id_hash) è la stessa persona.
const NOMI_CAMPI = new Map(CAMPI.map((k) => [k.toLowerCase(), k]));
const campoDi = (nome) => NOMI_CAMPI.get(String(nome).toLowerCase().replace(/[^a-z0-9]/g, '')) || '';

// Senza i nomi (un CSV senza intestazione, un elenco di soli valori) la persona si riconosce dai valori: un user agent
// di browser accanto a un testo libero o a un identificativo del server.
const UA_BROWSER = /Mozilla\/5\.0(?: ?\([^()\n]*\)| [\w.\-]+\/[\w.\-]+)+/;
const IDENTIFICATIVO = /^(?:[0-9a-f]{16,64}|[A-Za-z0-9]{20})$/;
const testoLibero = (v) => v.split(/\s+/).filter((p) => /\p{L}{2}/u.test(p)).length >= 3;
function motivoDaiValori(valori) {
  const s = valori.map((v) => (valoreFirestore(v) ? v.stringValue : v)).filter((v) => typeof v === 'string').map((v) => v.trim());
  const ua = (v) => UA_BROWSER.test(v) && v.startsWith('Mozilla/5.0');
  if (!s.some(ua)) return '';
  return s.some((v) => !ua(v) && (testoLibero(v) || IDENTIFICATIVO.test(v)))
    ? 'valori di un feedback senza i nomi dei campi (user agent di un browser accanto a un testo o a un identificativo)' : '';
}
const senzaNomi = (o) => Object.keys(o).every((k) => /^#\d+$/.test(k));

function motivoDiUnNodo(o, chiave) {
  if (typeof o.name === 'string' && percorsoFirestore(o.name)) return 'documento Firestore (percorso del documento)';
  if (oggetto(o.fields)) {
    if (typeof o.name === 'string' && chiave === 'documents') return 'documento Firestore (name + fields)';
    if (Object.values(o.fields).some(valoreFirestore)) return 'campi nel formato di Firestore (stringValue, integerValue…)';
  }
  const campi = Object.create(null);
  for (const [k, v] of Object.entries(o)) {
    const c = campoDi(k);
    if (c && !(c in campi) && scritto(v)) campi[c] = v;
  }
  const presenti = CAMPI.filter((k) => k in campi);
  const chi = presenti.filter((k) => k !== 'text');
  if (chi.some((k) => valoreFirestore(campi[k]))) return `campi di un feedback nel formato di Firestore (${presenti.join(', ')})`;
  if (chi.length && presenti.length >= 2) return `campi di un feedback (${presenti.join(', ')})`;
  return senzaNomi(o) ? motivoDaiValori(Object.values(o)) : '';
}

/** Il motivo per cui un valore è una copia di dati del server, o ''. Scende in tutto l'albero. */
export function motivoCopia(radice) {
  const pila = [[radice, '']];
  while (pila.length) {
    const [v, chiave] = pila.pop();
    if (Array.isArray(v)) {
      if (v.every((x) => !x || typeof x !== 'object' || valoreFirestore(x))) {
        const m = motivoDaiValori(v);
        if (m) return m;
      }
      for (const x of v) pila.push([x, chiave]);
    } else if (oggetto(v)) {
      const m = motivoDiUnNodo(v, chiave);
      if (m) return m;
      for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') pila.push([x, k]);
    }
  }
  return '';
}

/**
 * Come motivoCopia, sul testo di un file in qualunque forma: JSON (anche a righe, o dietro le intestazioni HTTP), la
 * stampa di node o di Python, CSV e tabelle, righe «chiave: valore». Ogni lettore regge un testo interrotto chiudendo
 * quello che resta aperto, così una lettura a metà segue la regola di quella intera.
 */
export function motivoCopiaTesto(testo) {
  // I colori del terminale (una stampa con FORCE_COLOR) spezzerebbero le parentesi.
  const t = String(testo || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  // Un JSON dentro una stringa (una riga di log, un doppio JSON.stringify) ha le virgolette scritte \".
  const viste = t.includes('\\"') ? [t, t.replace(/\\(["\\/])/g, '$1')] : [t];
  for (const vista of viste) {
    for (const leggi of [valoriFraParentesi, valoriSenzaInizio, righeDiTabella, righeSenzaIntestazione, blocchiChiaveValore]) {
      for (const v of leggi(vista)) {
        const m = motivoCopia(v);
        if (m) return m;
      }
    }
  }
  return '';
}

// ─── Lettore delle forme a parentesi: JSON, JS, la stampa di node, Python ────────────────────────────────────────
// Non fallisce mai: una parentesi aperta a fine testo vale come chiusa. A pila e non ricorsivo: mille parentesi
// aperte in fila non devono far saltare il controllo.
const CHIUDE = new Set(['}', ']', ')']);
const APRE = new Set(['{', '[', '(']);
const SPAZIO = /\s/;
const FINE_NUDO = /[\s,;:=(){}[\]'"`]/;
const PREFISSO_STRINGA = /^[bBrRuUfF]{1,2}$/;
const ESCAPE = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\u0000' };

// Una stringa fra virgolette; un a capo la chiude (nessuna di queste forme lo scrive crudo): un apostrofo in un testo
// libero non si porta via il resto del file. → [testo, indice dopo]
function leggiStringa(t, i) {
  const q = t[i];
  let j = i + 1;
  let fuori = '';
  let da = j;
  while (j < t.length) {
    const c = t[j];
    if (c === '\\') {
      fuori += t.slice(da, j);
      const e = t[j + 1];
      if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(t.slice(j + 2, j + 6))) { fuori += String.fromCharCode(parseInt(t.slice(j + 2, j + 6), 16)); j += 6; }
      else if (e === 'x' && /^[0-9a-fA-F]{2}$/.test(t.slice(j + 2, j + 4))) { fuori += String.fromCharCode(parseInt(t.slice(j + 2, j + 4), 16)); j += 4; }
      else { fuori += e === undefined ? '' : (ESCAPE[e] ?? e); j += 2; }
      da = j;
    } else if (c === q) {
      return [fuori + t.slice(da, j), j + 1];
    } else if (c === '\n') {
      return [fuori + t.slice(da, j), j];
    } else j++;
  }
  return [fuori + t.slice(da, j), j];
}

const nuovo = (c) => (c === '[' ? [] : Object.create(null));

function metti(f, v) {
  if (Array.isArray(f.c)) f.c.push(v);
  else if (f.attesa) f.c[f.chiave] = v;
  else f.c[`#${f.n++}`] = v;
  f.chiave = null;
  f.attesa = false;
}

/**
 * Il valore che comincia in t[i] ('{' o '['), e l'indice dopo la fine. Con `aperto` il testo comincia dentro un
 * oggetto già aperto (la coda di un file): ogni parentesi che chiude di troppo chiude quello e ne apre un altro.
 * → [radice, indice dopo, tutte le radici]
 */
function leggiStruttura(t, i, aperto = false) {
  const radici = [];
  let radice = aperto ? Object.create(null) : nuovo(t[i]);
  const pila = [{ c: radice, chiave: null, attesa: false, n: 0 }];
  if (!aperto) i++;
  while (i < t.length && pila.length) {
    const c = t[i];
    const f = pila[pila.length - 1];
    if (SPAZIO.test(c)) { i++; continue; }
    if (CHIUDE.has(c) && aperto && pila.length === 1) {
      radici.push(radice);
      radice = Object.create(null);
      pila[0] = { c: radice, chiave: null, attesa: false, n: 0 };
      i++;
      continue;
    }
    if (CHIUDE.has(c)) { pila.pop(); i++; continue; }
    if (APRE.has(c)) {
      const figlio = nuovo(c);
      // Nell'oggetto supposto aperto un valore senza chiave davanti è un valore a sé: tenerli tutti lì costerebbe.
      if (aperto && pila.length === 1 && !f.attesa) { radici.push(figlio); f.chiave = null; } else metti(f, figlio);
      pila.push({ c: figlio, chiave: null, attesa: false, n: 0 });
      i++;
      continue;
    }
    if (c === ',' || c === ';') { f.chiave = null; f.attesa = false; i++; continue; }
    if (c === ':' || c === '=') {
      if (!Array.isArray(f.c) && f.chiave !== null) f.attesa = true;
      i += c === '=' && t[i + 1] === '>' ? 2 : 1;
      continue;
    }
    let testo;
    let nudo = false;
    if (c === '"' || c === "'" || c === '`') {
      [testo, i] = leggiStringa(t, i);
      // La stampa di node spezzava le stringhe lunghe: 'prima parte' +\n 'seconda'.
      for (;;) {
        let k = i;
        while (k < t.length && SPAZIO.test(t[k])) k++;
        if (t[k] !== '+') break;
        k++;
        while (k < t.length && SPAZIO.test(t[k])) k++;
        if (t[k] !== '"' && t[k] !== "'" && t[k] !== '`') break;
        let altro;
        [altro, i] = leggiStringa(t, k);
        testo += altro;
      }
    } else {
      let j = i;
      while (j < t.length && !FINE_NUDO.test(t[j])) j++;
      if (j === i) j++;
      testo = t.slice(i, j);
      i = j;
      if (PREFISSO_STRINGA.test(testo) && (t[i] === '"' || t[i] === "'")) {
        [testo, i] = leggiStringa(t, i);
      } else {
        nudo = true;
        // Il nome di una classe davanti a un contenitore (Timestamp { … }, Map(2) { … }): la chiave va al contenitore.
        let k = i;
        while (t[k] === ' ' || t[k] === '\t') k++;
        if (APRE.has(t[k])) continue;
      }
    }
    if (Array.isArray(f.c)) f.c.push(nudo ? null : testo);
    else if (f.attesa) { f.c[f.chiave] = nudo ? null : testo; f.chiave = null; f.attesa = false; }
    else f.chiave = testo;
  }
  radici.push(radice);
  return [radice, i, radici];
}

function* valoriFraParentesi(t) {
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{' && t[i] !== '[') continue;
    const [v, fine] = leggiStruttura(t, i);
    yield v;
    i = fine - 1;
  }
}

function* valoriSenzaInizio(t) {
  yield* leggiStruttura(t, 0, true)[2];
}

// ─── Lettore delle tabelle: CSV, TSV, tabelle markdown, console.table di node, colonne allineate (pandas) ──────────
const NOME_COLONNA = /^\(?[A-Za-z_][\w.\-/]*\)?$/;
const SEPARATORE_RIGA = /^[\s:\-+─━═┼╋╬├┤┌┐└┘┬┴]*$/;
const COLONNE_ALLINEATE = /[ \t]{2,}/;
const nomeCampo = (cella) => {
  const n = cella.trim().replace(/^["'`]|["'`]$/g, '');
  return campoDi(n) || n.split(/[./]/).map(campoDi).find(Boolean) || n;
};
const RIGA_CON_IDENTITA = /user[\s_-]?agent|client[\s_-]?id|wallet[\s_-]?pseudonym/i;

// Le celle della riga che comincia in t[i]; le virgolette doppie possono andare a capo (un testo su più righe).
function leggiRiga(t, i, d) {
  if (d === COLONNE_ALLINEATE) {
    const a = t.indexOf('\n', i);
    const fine = a < 0 ? t.length : a;
    return [t.slice(i, fine).trim().split(d), fine + 1];
  }
  const celle = [];
  let cella = '';
  let vuota = true;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' && vuota) {
      cella = '';
      vuota = false;
      i++;
      while (i < t.length) {
        if (t[i] === '"' && t[i + 1] === '"') { cella += '"'; i += 2; }
        else if (t[i] === '"') { i++; break; }
        else cella += t[i++];
      }
      continue;
    }
    if (c === d) { celle.push(cella); cella = ''; vuota = true; i++; continue; }
    if (c === '\n') { i++; break; }
    if (c !== '\r') cella += c;
    if (vuota && !SPAZIO.test(c)) vuota = false;
    i++;
  }
  celle.push(cella);
  return [celle, i];
}

const ha = (riga, d) => (d === COLONNE_ALLINEATE ? d.test(riga.trim()) : riga.includes(d));

function* righeDiTabella(t) {
  for (let i = 0; i < t.length;) {
    const a = t.indexOf('\n', i);
    const fine = a < 0 ? t.length : a + 1;
    const riga = t.slice(i, fine);
    i = fine;
    if (!RIGA_CON_IDENTITA.test(riga)) continue;
    for (const d of [',', ';', '\t', '|', '│', COLONNE_ALLINEATE]) {
      if (!ha(riga, d)) continue;
      const [intestazione] = leggiRiga(riga, 0, d);
      const nomi = intestazione.map(nomeCampo);
      if (!nomi.some((n) => IDENTITA.includes(n))) continue;
      if (!intestazione.every((c) => {
        const n = c.trim().replace(/^["'`]|["'`]$/g, '');
        return !n || NOME_COLONNA.test(n) || (/^[A-Za-z][\w -]*$/.test(n) && campoDi(n));
      })) continue;
      while (i < t.length) {
        const a2 = t.indexOf('\n', i);
        if (!t.slice(i, a2 < 0 ? t.length : a2).trim()) break;
        let celle;
        [celle, i] = leggiRiga(t, i, d);
        if (celle.every((c) => SEPARATORE_RIGA.test(c))) continue;
        // La colonna dell'indice di pandas non ha nome; una cella in più altrove (un separatore non citato dentro un
        // valore) sposta solo le colonne dopo di lei.
        if (d === COLONNE_ALLINEATE && celle.length === nomi.length + 1) celle.shift();
        const r = Object.create(null);
        celle.forEach((c, k) => { if (c.trim() && k < nomi.length) r[nomi[k]] = c.trim(); });
        yield r;
      }
      break;
    }
  }
}

// Le righe senza intestazione (jq @csv, la coda di un file): celle senza nome, riconosciute dai valori. Lo user agent
// si toglie prima di dividere, perché i suoi «;» e «,» non diventino celle.
function* righeSenzaIntestazione(t) {
  for (const riga of t.split(/\r\n|\r|\n/)) {
    const ua = UA_BROWSER.exec(riga);
    if (!ua) continue;
    const segno = '\u0000UA\u0000';
    const coperta = riga.replace(ua[0], segno);
    for (const d of [',', ';', '\t', '|', '│']) {
      if (!coperta.includes(d)) continue;
      yield leggiRiga(coperta, 0, d)[0].map((c) => c.replace(segno, ua[0]));
    }
  }
}

// ─── Lettore delle righe «chiave: valore»: YAML, testi, righe di log chiave=valore ─────────────────────────────────
const RIGA_CHIAVE = /^(\s*)(?:[-*]\s+)?["']?([A-Za-z_][\w-]*(?: [A-Za-z_][\w-]*)?)["']?\s*[:=]\s*(.*)$/;
const COPPIE_LOGFMT = /(?:^|\s)([A-Za-z_]\w*)=("(?:[^"\\]|\\.)*"?|\S+)/g;

function* blocchiChiaveValore(t) {
  let blocco = Object.create(null);
  let margine = -1;
  let pieno = false;
  const chiudi = function* () {
    if (pieno) yield blocco;
    blocco = Object.create(null);
    margine = -1;
    pieno = false;
  };
  for (const riga of t.split(/\r\n|\r|\n/)) {
    if (!riga.trim()) { yield* chiudi(); continue; }
    if (riga.includes('=')) {
      const r = Object.create(null);
      for (const [, k, v] of riga.matchAll(COPPIE_LOGFMT)) r[k] = v.replace(/^"|"$/g, '');
      yield r;
    }
    const m = RIGA_CHIAVE.exec(riga);
    if (!m) {
      if (margine < 0 || riga.search(/\S/) <= margine) yield* chiudi();
      continue;
    }
    const [, rientro, chiave, resto] = m;
    if (/^\s*[-*]\s/.test(riga) || chiave in blocco) yield* chiudi();
    if (margine < 0) margine = rientro.length;
    const valore = resto.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (valore && !/^[{[]/.test(valore)) { blocco[chiave] = valore; pieno = true; }
  }
  yield* chiudi();
}

// Codice del repo: le prove scrivono feedback finti come oggetti JS, quindi lì conta solo un file che è tutto un JSON.
const CODICE = /\.(?:[cm]?js|[jt]sx|ts|css|html?|sh|ps1|py)$/i;

// Il testo di un file, o null se è binario. Un'uscita rediretta da PowerShell 5.1 è UTF-16 col suo BOM.
function testoDi(byte) {
  if (byte[0] === 0xFF && byte[1] === 0xFE) return byte.subarray(2, 2 + ((byte.length - 2) & ~1)).toString('utf16le');
  if (byte[0] === 0xFE && byte[1] === 0xFF) return Buffer.from(byte.subarray(2, 2 + ((byte.length - 2) & ~1))).swap16().toString('utf16le');
  if (byte.subarray(0, 8000).includes(0)) return null;
  return byte.toString('utf8');
}

/** Il motivo per cui il contenuto `byte` del file `f` è una copia, o '': fuori dai dati finti, in qualunque forma. */
export function motivoContenuto(f, byte) {
  if (f.startsWith(CARTELLA_FINTI)) return '';
  const t = testoDi(byte);
  if (t === null || (CODICE.test(f) && !/^﻿?\s*[{[]/.test(t))) return '';
  return motivoCopiaTesto(t);
}

function motivoFile(root, f) {
  let byte;
  try { byte = readFileSync(join(root, f)); } catch (_) { return ''; }
  return motivoContenuto(f, byte);
}

function copieFra(root, file) {
  const trovate = [];
  for (const f of file) {
    const motivo = motivoFile(root, f);
    if (motivo) trovate.push({ file: f, motivo });
  }
  return trovate;
}

const elencoGit = (root, args) => execFileSync('git', [...args, '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);

/** I file tracciati da git in `root` che sono copie di dati del server, fuori dalla cartella dei dati finti. */
export function copieNelRepo(root) {
  return copieFra(root, elencoGit(root, ['ls-files']));
}

/** Come copieNelRepo, sui soli file messi in scena (aggiunti o cambiati): il salvataggio li toglie prima del commit. */
export function copieInScena(root) {
  return copieFra(root, elencoGit(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
}

const gitTesto = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Le copie nei commit che spedire `rif` porterebbe su origin (quelli che nessun ramo di origin conosce),
 * dal commit più vecchio: [{ commit, file, motivo }]. Ogni strada che spedisce lo chiede prima del push.
 */
export function copieDaSpedire(root, rif = 'HEAD', { giaLa = ['--remotes=origin'] } = {}) {
  const commit = gitTesto(root, ['rev-list', '--reverse', rif, '--not', ...giaLa]).split('\n').filter(Boolean);
  const trovate = [];
  const lette = new Map();
  for (const c of commit) {
    const voci = gitTesto(root, ['diff-tree', '-r', '--root', '--no-commit-id', '--raw', '-z', '--diff-filter=ACMR', c]).split('\0');
    for (let i = 0; i < voci.length - 1;) {
      const meta = voci[i].split(' ');
      const rinomina = /^[RC]/.test(meta[4] || '');
      const file = voci[i + (rinomina ? 2 : 1)];
      i += rinomina ? 3 : 2;
      if (!file || file.startsWith(CARTELLA_FINTI)) continue;
      const blob = meta[3];
      if (!lette.has(blob)) {
        const byte = execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        lette.set(blob, motivoContenuto(file, byte));
      }
      if (lette.get(blob)) trovate.push({ commit: c, file, motivo: lette.get(blob) });
    }
  }
  return trovate;
}

/**
 * Prima di spedire: se i commit da spedire portano copie, le toglie dalla loro storia rifacendoli in un commit solo
 * (sono solo locali; il resto del lavoro resta e parte). { stato: 'pulito'|'riparato'|'fermo', avviso }: con 'fermo'
 * (una fusione in mezzo, il primo commit del repo) non si spedisce, e l'avviso dice come toglierle a mano.
 */
export function spedibileSenzaCopie(root, { nome = 'claude-local', email = 'claude@local' } = {}) {
  const copie = copieDaSpedire(root);
  if (!copie.length) return { stato: 'pulito', avviso: '' };
  const fermo = { stato: 'fermo', avviso: avvisoSpedizione(copie) };
  const g = (args) => gitTesto(root, args).trim();
  const primo = copie[0].commit;
  let base;
  try { base = g(['rev-parse', '--verify', '-q', `${primo}~1`]); } catch (_) { return fermo; }
  if (g(['rev-list', '--merges', `${base}..HEAD`])) return fermo;
  const soggetti = g(['log', '--reverse', '--format=%s', `${base}..HEAD`]).split('\n').filter(Boolean);
  const file = [...new Set(copie.map((c) => c.file))];
  const testa = g(['rev-parse', 'HEAD']);
  try {
    g(['reset', '-q', '--soft', base]);
    // Solo i file che in cima sono ancora copie tornano come alla base: uno corretto dopo resta com'è adesso.
    const restano = file.filter((f) => {
      try {
        return motivoContenuto(f, execFileSync('git', ['show', `${testa}:${f}`], { cwd: root, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
      } catch (_) { return false; }
    });
    if (restano.length) g(['reset', '-q', base, '--', ...restano]);
    try { escludiInLocale(root, restano); } catch (_) { /* il controllo sui file in scena li rivede */ }
    let vuoto = true;
    try { g(['diff', '--cached', '--quiet']); } catch (_) { vuoto = false; }
    if (!vuoto) {
      g(['-c', `user.name=${nome}`, '-c', `user.email=${email}`, 'commit', '-q', '-m',
        `${soggetti.join(' + ').slice(0, 200)} (senza la copia dei dati: ${file.join(', ')})`]);
    }
  } catch (_) {
    try { g(['reset', '-q', '--soft', testa]); } catch (__) { /* resta il messaggio */ }
    return fermo;
  }
  if (copieDaSpedire(root).length) return fermo;
  return {
    stato: 'riparato',
    avviso: `${file.join(', ')} ha la forma di una copia dei dati del server (${copie[0].motivo}) e il repo e' pubblico: `
      + `l'ho tolto dai commit non ancora spediti, rifatti in uno solo (il lavoro resta), e il ramo parte senza. `
      + `La copia resta nella cartella, invisibile a git: spostala nella cartella temporanea del sistema (os.tmpdir()).`,
  };
}

const citaShell = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Cosa dire a chi spedisce quando copieDaSpedire ha trovato qualcosa: il ramo non parte, e come toglierle dalla storia. */
export function avvisoSpedizione(copie) {
  const file = [...new Set(copie.map((c) => c.file))];
  const primo = copie[0].commit.slice(0, 10);
  return `NON spedisco il ramo: ${file.join(', ')} (dal commit ${primo}) ha la forma di una copia dei dati del server `
    + `(${copie[0].motivo}), e il repo e' pubblico: una volta spedita resta nella storia anche se tolta dopo. `
    + `Toglila dalla storia del ramo e sposta la copia nella cartella temporanea del sistema (os.tmpdir()): `
    + `git reset --soft ${primo}~1 && git rm -q --cached --ignore-unmatch -- ${file.map(citaShell).join(' ')} && git commit -m "lavoro senza la copia dei dati" `
    + `(rifa' in un commit solo i commit da li' in poi, il lavoro resta). Poi il salvataggio spedisce.`;
}

// Un nome in .gitignore: le / restano, i caratteri speciali e gli spazi in coda si citano.
const comeEsclusione = (f) => `/${f.replace(/[\\*?[]/g, '\\$&').replace(/ $/, '\\ ')}`;

/**
 * Toglie dalla vista di git, in questa copia soltanto (info/exclude, non versionato), le copie lasciate nella
 * cartella: senza, «git add -A» — che la consegna chiede davanti a una cartella sporca — le rimetteva nel commit.
 */
export function escludiInLocale(root, file) {
  const dove = resolve(root, gitTesto(root, ['rev-parse', '--git-path', 'info/exclude']).trim());
  let attuale = '';
  try { attuale = readFileSync(dove, 'utf8'); } catch (_) { mkdirSync(dirname(dove), { recursive: true }); }
  const righe = new Set(attuale.split(/\r?\n/));
  const nuove = file.filter((f) => !/[\r\n]/.test(f)).map(comeEsclusione).filter((r) => !righe.has(r));
  if (!nuove.length) return;
  appendFileSync(dove, `${attuale && !attuale.endsWith('\n') ? '\n' : ''}${nuove.join('\n')}\n`);
}

const VUOTO = /^0+$/;

/**
 * Il controllo di git prima di ogni push (hook pre-push): `righe` è ciò che git passa su stdin. Le copie nei commit che
 * il push porterebbe dove non sono ancora; [] se non ce ne sono. È l'unica regola che vale per ogni strada che spedisce.
 */
export function copieNelPush(root, righe) {
  const trovate = [];
  for (const riga of String(righe || '').split(/\r?\n/)) {
    const [, locale, , remoto] = riga.trim().split(/\s+/);
    if (!locale || VUOTO.test(locale)) continue;
    const giaLa = ['--remotes'];
    if (remoto && !VUOTO.test(remoto)) {
      try { gitTesto(root, ['cat-file', '-e', `${remoto}^{commit}`]); giaLa.push(remoto); } catch (_) { /* non l'abbiamo: conta --remotes */ }
    }
    trovate.push(...copieDaSpedire(root, locale, { giaLa }));
  }
  return trovate;
}

// Il segno che riconosce il pre-push di Filo: uno con un altro contenuto è di qualcun altro e non si tocca.
export const SEGNO_PRE_PUSH = 'filo-copie-di-dati';
// Di riserva, se la cartella che spedisce non ha il controllo (un ramo vecchio): quello di chi ha installato.
const RISERVA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'copie-in-scena.mjs').replace(/\\/g, '/');
const PRE_PUSH = `#!/bin/sh
# ${SEGNO_PRE_PUSH}: una copia dei dati del server non parte per nessuna strada, nemmeno un git push a mano (#1108).
# Lo scrive scripts/lib/copie-di-dati.mjs; il controllo è quello della cartella che spedisce.
radice=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
controllo="$radice/scripts/copie-in-scena.mjs"
[ -f "$controllo" ] || controllo='${RISERVA.replace(/'/g, "'\\''")}'
[ -f "$controllo" ] && command -v node >/dev/null 2>&1 || exit 0
righe=$(cat)
# node costa a ogni push: si chiama solo se i commit da spedire portano qualcosa che non e' codice o immagine.
dati=$(printf '%s\\n' "$righe" | while read -r _ locale _ _; do
  case "$locale" in *[!0]*) ;; *) continue ;; esac
  git log --format= --name-only --diff-filter=ACMR "$locale" --not --remotes 2>/dev/null
done | grep -vE '\\.(js|mjs|cjs|ts|css|html|sh|ps1|png|jpe?g|gif|webp|svg|ico)$' | grep -m1 .)
[ -n "$dati" ] || exit 0
printf '%s\\n' "$righe" | node "$controllo" --pre-push "$radice"
`;

/**
 * Mette il controllo prima di ogni push nella copia del repo di `root` (gli hook di git valgono per tutte le sue cartelle).
 * 'installato' | 'presente' | 'altrui' (un pre-push non nostro: non si tocca) | 'altrove' (core.hooksPath: la cartella
 * degli hook è condivisa con altri repo, non ci si scrive).
 */
export function installaControlloSpedizione(root) {
  try { if (gitTesto(root, ['config', '--get', 'core.hooksPath']).trim()) return 'altrove'; } catch (_) { /* non impostato */ }
  const dove = resolve(root, gitTesto(root, ['rev-parse', '--git-path', 'hooks/pre-push']).trim());
  let attuale = null;
  try { attuale = readFileSync(dove, 'utf8'); } catch (_) { /* non c'è */ }
  if (attuale === PRE_PUSH) return 'presente';
  if (attuale !== null && !attuale.includes(SEGNO_PRE_PUSH)) return 'altrui';
  mkdirSync(dirname(dove), { recursive: true });
  writeFileSync(dove, PRE_PUSH, { mode: 0o755 });
  try { chmodSync(dove, 0o755); } catch (_) { /* su Windows git lo lancia comunque */ }
  return 'installato';
}
