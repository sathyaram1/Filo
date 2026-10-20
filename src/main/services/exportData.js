// Esportazione dati Filo come archivio ZIP.
//
// Produce un .zip con:
//   - data.json   → tutto lo storage di Filo (memorie agenti, pagine salvate,
//                   cronologia incolla, costi, ecc.)
//   - filo/eventi.jsonl → il filo (#866): chat e pagine visitate, così com'è su disco
//   - images/…    → le immagini copiate/salvate, estratte dai data-URL base64
//                   incorporati nello storage. Nel JSON il data-URL viene
//                   sostituito col percorso relativo del file (es.
//                   "images/img-1.png"), così il JSON resta leggero e l'utente
//                   può sfogliare le immagini come file veri.
//
// Modulo puro (niente Electron): riceve i dati e ritorna un Buffer ZIP, così è
// testabile in isolamento. Lo ZIP usa il metodo STORE (nessuna compressione):
// non servono dipendenze esterne ed è perfettamente standard.

'use strict';

// --- CRC32 (tabella standard, polinomio 0xEDB88320) -------------------------
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- ZIP writer (STORE) -----------------------------------------------------
// entries: [{ name: string, buffer: Buffer }]
function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.buffer;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // flags: bit 11 = nomi UTF-8
    local.writeUInt16LE(0, 8);            // method: 0 = store
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc, 14);         // crc32
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len

    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central dir signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0x0800, 8);          // flags
    cd.writeUInt16LE(0, 10);              // method
    cd.writeUInt16LE(0, 12);              // mod time
    cd.writeUInt16LE(0, 14);              // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // extra len
    cd.writeUInt16LE(0, 32);              // comment len
    cd.writeUInt16LE(0, 34);              // disk number
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);         // offset of local header
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central dir signature
  end.writeUInt16LE(0, 4);                // disk number
  end.writeUInt16LE(0, 6);                // disk with central dir
  end.writeUInt16LE(entries.length, 8);   // entries on this disk
  end.writeUInt16LE(entries.length, 10);  // total entries
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);          // offset of central dir
  end.writeUInt16LE(0, 20);               // comment len

  return Buffer.concat([...chunks, centralBuf, end]);
}

// --- estrazione immagini dai data-URL ---------------------------------------
const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

// Cammina ricorsivamente l'oggetto e sostituisce ogni stringa data-URL immagine
// con un percorso relativo, raccogliendo i buffer delle immagini.
function extractImages(node, images) {
  const replaceStr = (s) => {
    const m = DATA_URL_RE.exec(s);
    if (!m) return null;
    const ext = (m[1].split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const name = `images/img-${images.length + 1}.${ext}`;
    let buffer;
    try { buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64'); }
    catch (_) { return null; }
    images.push({ name, buffer });
    return name;
  };

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'string') { const r = replaceStr(v); if (r) node[i] = r; }
      else if (v && typeof v === 'object') extractImages(v, images);
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') { const r = replaceStr(v); if (r) node[k] = r; }
      else if (v && typeof v === 'object') extractImages(v, images);
    }
  }
}

const VOCE_FILO = 'filo/eventi.jsonl';

// I segreti dell'utente (SN_CONST.campiSegreti) entrano nell'archivio solo se chi esporta lo chiede (#905).
// Una chiave incollata in chat o copiata negli appunti è nell'archivio quanto quella delle Opzioni: si toglie ovunque.
const SEGRETO_MIN = 12;
const SEGRETO_TOLTO = '[chiave tolta dall’esportazione]';
const CAMPI_PROXY = ['datacenter', 'residential'];
const pieno = (v) => typeof v === 'string' && v.trim() !== '';

function costanti() {
  if (!globalThis.SN_CONST) require('../../shared/constants.js');
  return globalThis.SN_CONST;
}
const campiSegreti = (settings) => costanti().campiSegreti(settings);
const haSegreti = (storageData) => costanti().haSegreti(storageData && storageData.settings);

function sostituisci(testo, segreti) {
  let t = testo;
  for (const s of segreti) if (t.includes(s)) t = t.split(s).join(SEGRETO_TOLTO);
  return t;
}

function oscura(nodo, segreti) {
  if (Array.isArray(nodo) || isPlainObject(nodo)) {
    for (const k of Object.keys(nodo)) {
      if (typeof nodo[k] === 'string') nodo[k] = sostituisci(nodo[k], segreti);
      else oscura(nodo[k], segreti);
    }
  }
}

// Del proxy il segreto è utente e password, non l'indirizzo: senza, l'archivio rimesso altrove perdeva il proxy (#905.1).
const CREDENZIALI_PROXY = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/i;
const proxySenzaCredenziali = (v) => v.trim().replace(CREDENZIALI_PROXY, '$1');
const haCredenziali = (v) => pieno(v) && CREDENZIALI_PROXY.test(v.trim());

// Toglie i segreti da una copia dei dati, e dal filo. Il campo va via, non diventa vuoto: all'importazione un campo
// assente lascia quello di chi importa. `proxy`: i campi del proxy rimasti col solo indirizzo.
function togliSegreti(dati, filo) {
  const s = dati && dati.settings;
  const campi = campiSegreti(s);
  const segreti = new Set();
  const proxy = [];
  for (const [o, k] of campi) {
    if (!pieno(o[k])) { delete o[k]; continue; }
    const v = o[k].trim();
    segreti.add(v);
    const m = isPlainObject(s) && o === s.proxy ? CREDENZIALI_PROXY.exec(v) : null;
    if (!m) { delete o[k]; continue; }
    segreti.add(m[2]);
    if (m[2].includes(':')) segreti.add(m[2].slice(m[2].indexOf(':') + 1));
    o[k] = proxySenzaCredenziali(v);
    proxy.push(k);
  }
  if (isPlainObject(s)) { delete s.apiKeys; delete s.apiKeysEnc; }
  // Il più lungo prima: l'indirizzo intero del proxy contiene la sua password.
  const daTogliere = [...segreti].filter((v) => v.length >= SEGRETO_MIN).sort((a, b) => b.length - a.length);
  if (daTogliere.length) oscura(dati, daTogliere);
  if (!daTogliere.length || !filo || !filo.length) return { filo, proxy };
  return { filo: Buffer.from(sostituisci(Buffer.isBuffer(filo) ? filo.toString('utf8') : String(filo), daTogliere), 'utf8'), proxy };
}

// Costruisce il Buffer ZIP a partire dallo storage Filo e, se c'è, dal filo. `chiavi`: anche i segreti.
function buildExportZip(storageData, { filo: filoDato = null, chiavi = false } = {}) {
  const clone = JSON.parse(JSON.stringify(storageData ?? {}));
  const { filo, proxy } = chiavi ? { filo: filoDato, proxy: [] } : togliSegreti(clone, filoDato);
  const images = [];
  extractImages(clone, images);

  const manifest = {
    app: 'Filo',
    exportedAt: new Date().toISOString(),
    imageCount: images.length,
    filo: !!(filo && filo.length),
    chiavi: haSegreti(clone),
    ...(proxy.length ? { proxySenzaCredenziali: proxy } : {}),
    note: 'Esportazione dati Filo. data.json contiene le impostazioni e i '
      + 'contenuti (le chiavi API solo se «chiavi» è true); le immagini copiate/salvate sono nella cartella images/; '
      + 'le chat con Filo e le pagine visitate stanno in filo/eventi.jsonl, un evento per riga.',
  };

  const entries = [
    { name: 'data.json', buffer: Buffer.from(JSON.stringify(clone, null, 2), 'utf8') },
    { name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    ...(filo && filo.length ? [{ name: VOCE_FILO, buffer: Buffer.isBuffer(filo) ? filo : Buffer.from(String(filo), 'utf8') }] : []),
    ...images,
  ];
  return zipStore(entries);
}

// ============================================================================
// IMPORTAZIONE — l'inverso esatto di buildExportZip.
//
// Un backup che non si può ripristinare non è un backup: qui viviamo la metà
// mancante. Leggiamo lo zip prodotto da buildExportZip (o una sua versione
// ri-compressa da un qualsiasi gestore di archivi: accettiamo anche DEFLATE, e
// il file dentro una cartella, perché l'utente ha tutto il diritto di
// scompattare, guardare e ri-comprimere), rimettiamo le immagini al loro posto
// come data-URL e fondiamo il risultato con i dati già presenti.
// ============================================================================

const zlib = require('node:zlib');

// --- ZIP reader (STORE + DEFLATE) -------------------------------------------
// Ritorna { voci: Map nome → Buffer, saltate: [{ nome, motivo }], mancanti }: una voce che non si legge si dice, perché chi
// importa deve sapere cosa manca (#1088). Legge la central directory: i local header possono avere size a 0.
const FIRMA_INDICE = 0x02014b50;
const FIRMA_FINE = 0x06054b50;

// Il record finale (EOCD), cercato dalla fine: il commento può arrivare a 64KB. Una firma che punta a un indice che
// non c'è è un byte a caso dentro una voce; con la firma rovinata il record si riconosce dai suoi numeri (#1088.5).
function recordFinale(buf) {
  const minStart = Math.max(0, buf.length - 22 - 0xFFFF);
  const indiceA = (i) => {
    const size = buf.readUInt32LE(i + 12), off = buf.readUInt32LE(i + 16);
    if (off === 0xFFFFFFFF || size === 0xFFFFFFFF) return true;
    return off + size <= i && (size === 0 || buf.readUInt32LE(off) === FIRMA_INDICE);
  };
  let primaFirma = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) !== FIRMA_FINE) continue;
    if (indiceA(i)) return i;
    if (primaFirma < 0) primaFirma = i;
  }
  for (let i = buf.length - 22; i >= minStart; i--) {
    const size = buf.readUInt32LE(i + 12), off = buf.readUInt32LE(i + 16);
    if (size >= 46 && off + size === i && buf.readUInt16LE(i + 20) === buf.length - i - 22
      && buf.readUInt32LE(off) === FIRMA_INDICE) return i;
  }
  return primaFirma;
}

function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('not_a_zip');

  const eocd = recordFinale(buf);
  if (eocd < 0) throw new Error('not_a_zip');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) throw new Error('zip64_unsupported');

  // L'indice si legge fino a dove finisce, non fino al numero di voci che dichiara: un conto rovinato verso il basso
  // non fa saltare le voci dopo (#1088.5).
  const voci = new Map();
  const saltate = [];
  let p = cdOffset;
  let lette = 0;
  for (; p + 46 <= eocd && buf.readUInt32LE(p) === FIRMA_INDICE; lette++) {
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // voce di cartella: nessun contenuto
    const salta = (motivo) => saltate.push({ nome: name, motivo });
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) { salta('illeggibile'); continue; }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    // L'indice e la voce portano ciascuno nome, metodo e cifratura: se non concordano uno dei due è rovinato, e un
    // danno nell'indice non deve diventare «non è di Filo», «compresso» o «password». Saltano entrambi i nomi (#1088).
    const lName = buf.slice(localOff + 30, localOff + 30 + lNameLen).toString('utf8');
    if (lName !== name || buf.readUInt16LE(localOff + 8) !== method || ((buf.readUInt16LE(localOff + 6) ^ flags) & 0x1)) {
      salta('illeggibile');
      if (lName !== name && lName && !lName.endsWith('/')) saltate.push({ nome: lName, motivo: 'illeggibile' });
      continue;
    }
    if (flags & 0x1) { salta('cifrata'); continue; }
    if (method !== 0 && method !== 8) { salta(`metodo ${method}`); continue; } // bzip2 (12), LZMA (14)…
    const start = localOff + 30 + lNameLen + lExtraLen;
    if (start + compSize > buf.length) { salta('illeggibile'); continue; }
    const raw = buf.slice(start, start + compSize);

    let data;
    if (method === 0) data = raw;
    else { try { data = zlib.inflateRawSync(raw); } catch (_) { salta('illeggibile'); continue; } }
    if (data.length !== uncompSize) { salta('dimensione'); continue; }
    if (crc32(data) !== crc) { salta('crc'); continue; }
    voci.set(name, data);
  }
  // L'indice che si interrompe prima della fine che dichiara: le voci dopo non hanno nome, ma si contano (#1088).
  const fine = Math.min(cdOffset + cdSize, eocd);
  let mancanti = 0;
  if (p < fine || cdOffset > eocd) {
    let restanti = 1;
    for (let q = p + 4; q + 4 <= fine; q++) if (buf.readUInt32LE(q) === FIRMA_INDICE) restanti++;
    mancanti = Math.max(count - lette, restanti);
  }
  return { voci, saltate, mancanti };
}

// Estensione file → mime. buildExportZip deriva l'estensione dal mime
// togliendo i caratteri non alfanumerici (image/svg+xml → "svgxml"), quindi qui
// facciamo il cammino inverso sui casi reali e ricadiamo su image/<ext>.
const EXT_TO_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', tiff: 'image/tiff',
  svgxml: 'image/svg+xml', xicon: 'image/x-icon', vndmicrosofticon: 'image/vnd.microsoft.icon',
};
function mimeOf(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return EXT_TO_MIME[ext] || `image/${ext || 'png'}`;
}

// Cammina l'oggetto e rimette i data-URL al posto dei percorsi "images/…": l'inverso di extractImages.
// Un segnaposto nostro senza la sua immagine diventa null, mai un testo «images/img-3.png» al posto della foto.
// È nostro se la sua voce è fra le saltate, se il manifesto dichiara almeno N immagini, o se l'indice si è
// interrotto e il manifesto non dice quante aspettarne. Altrimenti un testo dell'utente resta testo.
function inlineImages(node, files, prefix, stats, perse) {
  const restore = (s) => {
    if (typeof s !== 'string' || !/^images\/[^/]+$/.test(s)) return undefined;
    const buf = files.get(prefix + s);
    if (buf) {
      stats.images++;
      return `data:${mimeOf(s)};base64,${buf.toString('base64')}`;
    }
    const n = /^images\/img-(\d+)\.[a-z0-9]+$/i.exec(s);
    if (perse.nomi.has(prefix + s) || (n && (perse.tutte || Number(n[1]) <= perse.dichiarate))) {
      stats.perse++;
      return null;
    }
    return undefined;
  };

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'string') { const r = restore(v); if (r !== undefined) node[i] = r; }
      else if (v && typeof v === 'object') inlineImages(v, files, prefix, stats, perse);
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') { const r = restore(v); if (r !== undefined) node[k] = r; }
      else if (v && typeof v === 'object') inlineImages(v, files, prefix, stats, perse);
    }
  }
}

// Legge un archivio esportato e ritorna { data, imageCount, immaginiPerse, filoPerso, saltate, exportedAt, … }.
// Lancia con un codice parlante se il file non è un export di Filo (o se il suo data.json non si legge).
function readExportZip(zipBuffer) {
  const { voci: files, saltate, mancanti } = unzip(zipBuffer);

  // data.json può stare in radice o dentro una cartella (utente che ha
  // scompattato e ri-compresso): prendiamo quello meno profondo.
  let dataName = null;
  for (const name of [...files.keys(), ...saltate.map((s) => s.nome)]) {
    if (!/(^|\/)data\.json$/.test(name)) continue;
    const depth = name.split('/').length;
    if (!dataName || depth < dataName.split('/').length) dataName = name;
  }
  if (!dataName) throw new Error(mancanti ? 'zip_damaged' : 'no_data_json');
  if (!files.has(dataName)) {
    // Un archivio sano ricompresso con un metodo che Filo non legge, o con una password, non è «rovinato».
    const motivo = (saltate.find((s) => s.nome === dataName) || {}).motivo || '';
    if (motivo.startsWith('metodo')) throw new Error('zip_method');
    if (motivo === 'cifrata') throw new Error('zip_encrypted');
    throw new Error('zip_damaged');
  }
  const prefix = dataName.slice(0, dataName.length - 'data.json'.length);

  let data;
  try { data = JSON.parse(files.get(dataName).toString('utf8')); }
  catch (_) { throw new Error('bad_data_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad_data_json');

  let exportedAt = '';
  let dichiarate = 0;
  let filoDichiarato = null;
  let contoNoto = false;
  let proxyTolti = [];
  const manifest = files.get(prefix + 'manifest.json');
  if (manifest) {
    try {
      const m = JSON.parse(manifest.toString('utf8'));
      exportedAt = String(m.exportedAt || '');
      dichiarate = Number.isInteger(m.imageCount) && m.imageCount > 0 ? m.imageCount : 0;
      if (typeof m.filo === 'boolean') filoDichiarato = m.filo;
      contoNoto = Number.isInteger(m.imageCount);
      if (Array.isArray(m.proxySenzaCredenziali)) proxyTolti = CAMPI_PROXY.filter((k) => m.proxySenzaCredenziali.includes(k));
    } catch (_) {}
  }

  const stats = { images: 0, perse: 0 };
  inlineImages(data, files, prefix, stats, {
    nomi: new Set(saltate.map((s) => s.nome)), dichiarate, tutte: mancanti > 0 && !contoNoto,
  });

  const filo = files.get(prefix + VOCE_FILO) || null;
  // Un manifesto di prima non dice se il filo c'era: con voci sparite dall'indice si dice che può mancare.
  const filoPerso = !filo && (saltate.some((s) => s.nome === prefix + VOCE_FILO)
    || filoDichiarato === true || (mancanti > 0 && filoDichiarato !== false));
  return {
    data, imageCount: stats.images, immaginiPerse: stats.perse, filoPerso, saltate,
    exportedAt, sectionCount: Object.keys(data).length, filo, proxySenzaCredenziali: proxyTolti,
  };
}

// --- fusione con i dati già presenti ----------------------------------------
// Identità di un elemento di lista: l'id quando c'è (le liste di Filo — pagine
// salvate, cronologia, schede archiviate — sono tutte oggetti con id), altrimenti
// il contenuto serializzato. Serve a non duplicare le voci già presenti quando si
// ripristina un backup sopra dati vivi.
function itemKey(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    for (const k of ['id', 'uuid', 'key']) {
      if (typeof item[k] === 'string' && item[k]) return `${k}:${item[k]}`;
    }
  }
  try { return 'j:' + JSON.stringify(item); } catch (_) { return 'j:?'; }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Unione di due liste: si tengono TUTTE le voci locali (non si perde nulla di
// ciò che c'è ora) e si accodano quelle del backup non ancora presenti.
function mergeLists(local, imported) {
  const seen = new Set(local.map(itemKey));
  const out = local.slice();
  for (const item of imported) {
    const k = itemKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// La cronologia appunti ha un'identità sua (testo a spazi compattati, dato
// dell'immagine): la stessa cosa copiata in due momenti è una voce sola, come
// quando la si copia. Con l'identità generica il backup lasciava due gemelle.
// Il tetto si applica qui, dai più recenti: in fondo la prima copia taglierebbe in silenzio (#1088.4).
function mergeClipboardHistory(local, imported, tetto) {
  require('../../shared/clipboardHistory.js');
  const chiave = globalThis.SN_CLIPBOARD.chiave;
  const qui = Array.isArray(local) ? local : [];
  const seen = new Set();
  const out = [];
  for (const item of [...qui, ...(Array.isArray(imported) ? imported : [])]) {
    const k = chiave(item) || itemKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  const istante = (x) => (x && Number.isFinite(x.ts) ? x.ts : 0);
  out.sort((a, b) => istante(b) - istante(a));
  const fuori = tetto > 0 && out.length > tetto ? out.length - tetto : 0;
  if (!fuori) return { lista: out, fuori: 0, mieFuori: 0 };
  const mie = new Set(qui);
  return { lista: out.slice(0, tetto), fuori, mieFuori: out.slice(tetto).filter((x) => mie.has(x)).length };
}

function mergeValue(local, imported) {
  if (Array.isArray(local) && Array.isArray(imported)) return mergeLists(local, imported);
  if (isPlainObject(local) && isPlainObject(imported)) {
    const out = { ...local };
    for (const k of Object.keys(imported)) {
      out[k] = k in local ? mergeValue(local[k], imported[k]) : imported[k];
    }
    return out;
  }
  // Tipi diversi o valori semplici: vince il backup — è ciò che l'utente ha
  // chiesto di ripristinare.
  return imported;
}

// Un backup vecchio non riavvolge i conti né lo stato di questa installazione (#1088): una regola per nome di
// STORAGE_KEYS, e una chiave che qui non c'è è contenuto. Perché: patterns/se-un-dato-esce-da-filo-deve-poter-rientrare-e-limport.md;
// sentinella su ogni STORAGE_KEYS: tests/unit/importRegole.test.mjs.
const REGOLE_IMPORT = {
  SETTINGS: 'contenuto',
  SAVED_PAGES: 'pagine',
  HISTORY: 'contenuto',
  DOWNLOADS: 'contenuto',
  ARCHIVED_TABS: 'contenuto',
  DECKS: 'contenuto',
  DECKS_UI: 'contenuto',
  MANAGE_UI: 'contenuto',
  SCRYFALL_CARDS: 'contenuto',
  SCRYFALL_SYMBOLS: 'contenuto',
  SCRYFALL_PRINTS: 'contenuto',
  DECK_OPINIONS: 'contenuto',
  DECK_TAG_CACHE: 'contenuto',
  DECK_SEARCH_CACHE: 'contenuto',
  DECK_CHATS: 'contenuto',
  COSTS: 'spesa',
  CREDITS: 'stato',
  FEEDBACK_OUTBOX: 'stato',
  FEEDBACK_SYNC_AT: 'stato',
  PATHS_OUTBOX: 'stato',
  CATEGORIES: 'contenuto',
  BLOCKLIST: 'contenuto',
  // Dice cosa ricordano i cookie di QUESTO profilo, e i cookie non sono nel backup.
  COOKIE_SITES: 'stato',
  AI_CACHE: 'contenuto',
  CLIPBOARD_HISTORY: 'appunti',
  PERSONAL_DICT: 'contenuto',
  AUTOCORRECT: 'contenuto',
  ICON_LAYOUT: 'contenuto',
  OPEN_TABS: 'stato',
  FILO_RAW_LOG: 'stato',
  FILO_LESSONS_BUFFER: 'contenuto',
  FILO_CHATS: 'contenuto',
  FILO_MEMORY: 'contenuto',
  FILO_MEMORY_FONTI: 'contenuto',
  FILO_DASHBOARD_CACHE: 'stato',
  FILO_NOTES: 'contenuto',
  FILO_TIMERS: 'sveglie',
  FILO_NOTIFICATIONS: 'stato',
  FILO_CARTE_HOME: 'contenuto',
  FILO_SESSION: 'stato',
  FILO_WELCOMED: 'stato',
  FILO_ONBOARDING: 'stato',
  FILO_TERMINAL_CWD: 'stato',
  FILO_TERMINALE_SPIEGATO: 'stato',
  SITI_CON_CAMPI: 'contenuto',
  AGGIORNAMENTO_CHIESTO: 'stato',
  LAST_SEEN_VERSION: 'stato',
  LAST_SEEN_NOTES: 'stato',
  FILO_PROXY_RULES: 'contenuto',
  FILO_KEEP_OPEN: 'contenuto',
  FILO_CAMBI: 'stato',
  // Un backup non accende le operazioni automatiche, come non alza l'autonomia (#530).
  AUTO_MODE: 'stato',
  AUTOMATION_CAP3: 'stato',
  AUTOMATION_CAP2: 'stato',
  AUTOMATION_CAP1: 'stato',
  AUTOMATION_CAP0: 'stato',
};
// Fuori da STORAGE_KEYS, per chiave: code e segni del portafoglio, avvisi già dati, bandierine di migrazione.
const REGOLE_ALTRE_CHIAVI = {
  walletLocalDeclared: 'stato',
  walletOwnKeyRefusal: 'stato',
  walletNotice: 'stato',
  walletPendingInvite: 'stato',
  walletUsageQueue: 'stato',
  // I contatori di questa copia di Filo (#969): portati su un'altra, la stessa copia conterebbe due volte.
  contatoriGiornalieri: 'stato',
  avvisoChiaviInChiaro: 'stato',
  'filo.editor.notesMigrated': 'stato',
  sn_qr_in_primary_migrated: 'stato',
  sn_aiuto_di_serie_migrated: 'stato',
};

let regolePerChiave = null;
function regolaImport(chiave) {
  if (!regolePerChiave) {
    regolePerChiave = new Map(Object.entries(REGOLE_ALTRE_CHIAVI));
    for (const [nome, valore] of Object.entries(costanti().STORAGE_KEYS)) {
      if (REGOLE_IMPORT[nome]) regolePerChiave.set(valore, REGOLE_IMPORT[nome]);
    }
  }
  return regolePerChiave.get(chiave) || 'contenuto';
}

// Numeri: il più alto; oggetti: chiave per chiave; il resto resta quello di qui.
function piuAlto(local, imported) {
  if (typeof local === 'number' && typeof imported === 'number') return Math.max(local, imported);
  if (isPlainObject(local) && isPlainObject(imported)) {
    const out = { ...local };
    for (const k of Object.keys(imported)) out[k] = k in local ? piuAlto(local[k], imported[k]) : imported[k];
    return out;
  }
  return local === undefined ? imported : local;
}

function quando(p) {
  const t = Date.parse(p && p.savedAt);
  return Number.isFinite(t) ? t : 0;
}

function unisciPagine(local, imported, tetto) {
  const tutte = mergeLists(Array.isArray(local) ? local : [], Array.isArray(imported) ? imported : []);
  const perIndirizzo = new Map();
  const senza = [];
  for (const p of tutte) {
    const url = p && typeof p === 'object' ? p.url : null;
    if (!url) { senza.push(p); continue; }
    const gia = perIndirizzo.get(url);
    if (!gia || quando(p) > quando(gia)) perIndirizzo.set(url, p);
  }
  const ordinate = [...perIndirizzo.values(), ...senza].sort((a, b) => quando(b) - quando(a));
  const fuori = tetto > 0 && ordinate.length > tetto ? ordinate.length - tetto : 0;
  const lista = fuori ? ordinate.slice(0, tetto) : ordinate;
  // Il tetto può far uscire pagine salvate qui: la conferma lo dice col numero, non promette che nulla si perde.
  const restano = new Set(lista.map((p) => (p && p.url) || itemKey(p)));
  const mieFuori = fuori ? (Array.isArray(local) ? local : []).filter((p) => !restano.has((p && p.url) || itemKey(p))).length : 0;
  return { lista, fuori, mieFuori };
}

// Dal backup esce solo ciò che è già scaduto, che suonerebbe appena importato: una sveglia singola di domani,
// un timer in corso o in pausa restano contenuto; una ricorrente punta sulla prossima volta.
function unisciSveglie(local, imported, prossima, adesso) {
  const out = Array.isArray(local) ? local.slice() : [];
  const ids = new Set(out.map((t) => t && t.id));
  for (const t of Array.isArray(imported) ? imported : []) {
    if (!t || !t.id || ids.has(t.id)) continue;
    let s = null;
    if (t.kind === 'alarm' && Array.isArray(t.repeat) && t.repeat.length) {
      const at = typeof prossima === 'function' ? prossima(t, adesso) : null;
      if (!Number.isFinite(at)) continue;
      s = { ...t, endsAt: new Date(at).toISOString(), paused: false };
      delete s.ringing;
      delete s.remainingMs;
    } else if (t.ringing) {
      continue;
    } else if (t.paused && Number.isFinite(t.remainingMs) && t.remainingMs > 0) {
      s = { ...t };
    } else if (!t.paused && Date.parse(t.endsAt) > adesso) {
      s = { ...t };
    } else continue;
    out.push(s);
    ids.add(t.id);
  }
  return out;
}

// `opzioni`: { tettoPagine, prossimaSveglia(t, adesso) → ms, adesso }. Le statistiche contano le sezioni di primo
// livello; `restano` sono quelle del backup che non si importano perché sono stato.
// Una chiave vuota nel backup (chi esportava non l'aveva) non cancella quella che c'è qui (#905); un proxy arrivato
// senza utente e password non prende il posto di quello di qui che li ha.
function senzaSegretiVuoti(dati, cur) {
  if (!isPlainObject(dati.settings)) return dati;
  const settings = JSON.parse(JSON.stringify(dati.settings));
  const via = (o, campi) => { if (isPlainObject(o)) for (const k of campi) if (k in o && !pieno(o[k])) delete o[k]; };
  via(settings.apiKeys, isPlainObject(settings.apiKeys) ? Object.keys(settings.apiKeys) : []);
  via(settings.proxy, CAMPI_PROXY);
  const proxyQui = isPlainObject(cur) && isPlainObject(cur.settings) && isPlainObject(cur.settings.proxy) ? cur.settings.proxy : {};
  if (isPlainObject(settings.proxy)) {
    for (const k of CAMPI_PROXY) {
      const v = settings.proxy[k];
      if (pieno(v) && !haCredenziali(v) && haCredenziali(proxyQui[k])) delete settings.proxy[k];
    }
  }
  via(isPlainObject(settings.security) ? settings.security.safeBrowse : null, ['safeBrowsingKey']);
  if ('apiKeys' in settings && !isPlainObject(settings.apiKeys)) delete settings.apiKeys;
  return { ...dati, settings };
}

function mergeImportedData(current, imported, opzioni = {}) {
  const cur = current && typeof current === 'object' ? current : {};
  const imp = senzaSegretiVuoti(require('./interruttoreAiuto').perImportazione(imported && typeof imported === 'object' ? imported : {}), cur);
  const adesso = Number.isFinite(opzioni.adesso) ? opzioni.adesso : Date.now();
  const merged = { ...cur };
  const stats = {
    added: 0, updated: 0, unchanged: 0, restano: 0, pagineFuori: 0, pagineMieFuori: 0, appuntiFuori: 0, appuntiMieFuori: 0,
  };

  for (const k of Object.keys(imp)) {
    const regola = regolaImport(k);
    if (regola === 'stato') { stats.restano++; continue; }
    let next;
    if (regola === 'spesa') next = piuAlto(cur[k], imp[k]);
    else if (regola === 'sveglie') next = unisciSveglie(cur[k], imp[k], opzioni.prossimaSveglia, adesso);
    else if (regola === 'pagine') {
      const r = unisciPagine(cur[k], imp[k], opzioni.tettoPagine);
      next = r.lista;
      stats.pagineFuori = r.fuori;
      stats.pagineMieFuori = r.mieFuori;
    } else if (regola === 'appunti') {
      const r = mergeClipboardHistory(cur[k], imp[k], opzioni.tettoAppunti);
      next = r.lista;
      stats.appuntiFuori = r.fuori;
      stats.appuntiMieFuori = r.mieFuori;
    } else next = k in cur ? mergeValue(cur[k], imp[k]) : imp[k];

    if (!(k in cur)) {
      if (Array.isArray(next) && !next.length && !(Array.isArray(imp[k]) && !imp[k].length)) { stats.unchanged++; continue; }
      merged[k] = next;
      stats.added++;
      continue;
    }
    merged[k] = next;
    if (JSON.stringify(next) === JSON.stringify(cur[k])) stats.unchanged++;
    else stats.updated++;
  }
  return { merged, stats };
}

// I campi del proxy che dopo l'importazione restano col solo indirizzo perché l'archivio li portava così: si dice
// prima del sì, ché senza utente e password il proxy non funziona.
function proxyDaCompletare(merged, campi) {
  const proxy = isPlainObject(merged) && isPlainObject(merged.settings) && isPlainObject(merged.settings.proxy) ? merged.settings.proxy : {};
  return (Array.isArray(campi) ? campi : []).filter((k) => pieno(proxy[k]) && !haCredenziali(proxy[k]));
}

module.exports = {
  buildExportZip,
  proxyDaCompletare,
  zipStore,
  crc32,
  unzip,
  readExportZip,
  mergeImportedData,
  haSegreti,
  REGOLE_IMPORT,
  REGOLE_ALTRE_CHIAVI,
  regolaImport,
};
