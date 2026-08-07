// Esportazione dati Filo come archivio ZIP.
//
// Produce un .zip con:
//   - data.json   → tutto lo storage di Filo (memorie agenti, pagine salvate,
//                   cronologia incolla, costi, ecc.)
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

// Costruisce il Buffer ZIP a partire dallo storage Filo.
function buildExportZip(storageData) {
  const clone = JSON.parse(JSON.stringify(storageData ?? {}));
  const images = [];
  extractImages(clone, images);

  const manifest = {
    app: 'Filo',
    exportedAt: new Date().toISOString(),
    imageCount: images.length,
    note: 'Esportazione dati Filo. data.json contiene tutte le impostazioni e i '
      + 'contenuti; le immagini copiate/salvate sono nella cartella images/.',
  };

  const entries = [
    { name: 'data.json', buffer: Buffer.from(JSON.stringify(clone, null, 2), 'utf8') },
    { name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
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
// Ritorna una Map nome → Buffer. Legge la central directory (la sola struttura
// autorevole di uno zip: i local header possono avere size a 0 con data
// descriptor).
function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('not_a_zip');

  // EOCD: cerca la firma dalla fine (il commento finale può essere fino a 64KB).
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 0xFFFF);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not_a_zip');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) throw new Error('zip64_unsupported');

  const out = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // voce di cartella: nessun contenuto
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);

    let data;
    if (method === 0) data = raw;
    else if (method === 8) { try { data = zlib.inflateRawSync(raw); } catch (_) { continue; } }
    else continue; // metodo esotico (bzip2, lzma…): saltiamo la singola voce
    if (uncompSize && data.length !== uncompSize) continue; // voce corrotta
    out.set(name, data);
  }
  return out;
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

// Cammina l'oggetto e rimette i data-URL al posto dei percorsi "images/…":
// l'inverso di extractImages. `files` è la Map nome→Buffer dello zip, `prefix`
// l'eventuale cartella che contiene data.json.
function inlineImages(node, files, prefix, stats) {
  const restore = (s) => {
    if (typeof s !== 'string' || !/^images\/[^/]+$/.test(s)) return null;
    const buf = files.get(prefix + s);
    if (!buf) return null;
    stats.images++;
    return `data:${mimeOf(s)};base64,${buf.toString('base64')}`;
  };

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'string') { const r = restore(v); if (r) node[i] = r; }
      else if (v && typeof v === 'object') inlineImages(v, files, prefix, stats);
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') { const r = restore(v); if (r) node[k] = r; }
      else if (v && typeof v === 'object') inlineImages(v, files, prefix, stats);
    }
  }
}

// Legge un archivio esportato e ritorna { data, imageCount, exportedAt }.
// Lancia con un codice parlante se il file non è un export di Filo.
function readExportZip(zipBuffer) {
  const files = unzip(zipBuffer);

  // data.json può stare in radice o dentro una cartella (utente che ha
  // scompattato e ri-compresso): prendiamo quello meno profondo.
  let dataName = null;
  for (const name of files.keys()) {
    if (!/(^|\/)data\.json$/.test(name)) continue;
    const depth = name.split('/').length;
    if (!dataName || depth < dataName.split('/').length) dataName = name;
  }
  if (!dataName) throw new Error('no_data_json');
  const prefix = dataName.slice(0, dataName.length - 'data.json'.length);

  let data;
  try { data = JSON.parse(files.get(dataName).toString('utf8')); }
  catch (_) { throw new Error('bad_data_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad_data_json');

  const stats = { images: 0 };
  inlineImages(data, files, prefix, stats);

  let exportedAt = '';
  const manifest = files.get(prefix + 'manifest.json');
  if (manifest) {
    try { exportedAt = String(JSON.parse(manifest.toString('utf8')).exportedAt || ''); } catch (_) {}
  }

  return { data, imageCount: stats.images, exportedAt, sectionCount: Object.keys(data).length };
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

// Fonde i dati importati con lo storage corrente.
// Regole (una sola modalità, spiegata all'utente nella conferma):
//   - una sezione che qui non esiste viene presa dal backup;
//   - le liste si UNISCONO senza duplicati: nulla di ciò che c'è ora va perso;
//   - sui valori in conflitto vince il backup (è un ripristino).
// Ritorna { merged, stats: { added, updated, unchanged } } dove le statistiche
// contano le sezioni di primo livello.
function mergeImportedData(current, imported) {
  const cur = current && typeof current === 'object' ? current : {};
  const imp = imported && typeof imported === 'object' ? imported : {};
  const merged = { ...cur };
  const stats = { added: 0, updated: 0, unchanged: 0 };

  for (const k of Object.keys(imp)) {
    if (!(k in cur)) {
      merged[k] = imp[k];
      stats.added++;
      continue;
    }
    const next = mergeValue(cur[k], imp[k]);
    merged[k] = next;
    if (JSON.stringify(next) === JSON.stringify(cur[k])) stats.unchanged++;
    else stats.updated++;
  }
  return { merged, stats };
}

module.exports = {
  buildExportZip,
  zipStore,
  crc32,
  unzip,
  readExportZip,
  mergeImportedData,
};
