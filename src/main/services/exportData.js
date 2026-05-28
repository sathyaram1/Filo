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

module.exports = { buildExportZip, zipStore, crc32 };
