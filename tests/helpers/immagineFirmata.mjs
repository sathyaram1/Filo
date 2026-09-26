// Costruisce PNG di prova con credenziali C2PA VERE: certificato, firma COSE e
// legame duro sui byte, così la prova fallisce se il lettore smette di verificare.
// Niente openssl né file fissi: un certificato salvato scadrebbe da solo.

import crypto from 'node:crypto';
import zlib from 'node:zlib';

// ─────────────────────────────── DER / X.509 ────────────────────────────────

function der(tag, contenuto) {
  const n = contenuto.length;
  let len;
  if (n < 0x80) len = Buffer.from([n]);
  else {
    const b = [];
    let v = n;
    while (v > 0) { b.unshift(v & 0xff); v >>>= 8; }
    len = Buffer.from([0x80 | b.length, ...b]);
  }
  return Buffer.concat([Buffer.from([tag]), len, contenuto]);
}
const seq = (...p) => der(0x30, Buffer.concat(p));
const set = (...p) => der(0x31, Buffer.concat(p));
const oid = (hex) => der(0x06, Buffer.from(hex, 'hex'));
const utf8 = (s) => der(0x0c, Buffer.from(s, 'utf8'));
function intero(n) {
  let b = Buffer.from(n.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
}
function utcTime(d) {
  const p = (x) => String(x).padStart(2, '0');
  return der(0x17, Buffer.from(
    p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
    + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z', 'ascii'));
}

const OID_ECDSA_SHA256 = '2a8648ce3d040302';
const OID_O = '55040a';
const OID_CN = '550403';

/** Certificato autofirmato P-256 valido da ieri a fra un anno. */
export function certificato({ organizzazione = 'OpenAI, Inc.', nomeComune = 'Filo test signer' } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const nome = seq(
    set(seq(oid(OID_O), utf8(organizzazione))),
    set(seq(oid(OID_CN), utf8(nomeComune))),
  );
  const ieri = new Date(Date.now() - 86400000);
  const fraUnAnno = new Date(Date.now() + 365 * 86400000);
  const algFirma = seq(oid(OID_ECDSA_SHA256));
  const tbs = seq(
    der(0xa0, intero(2)),
    intero(Math.floor(Math.random() * 0xffffff) + 1),
    algFirma,
    nome,
    seq(utcTime(ieri), utcTime(fraUnAnno)),
    nome,
    spki,
  );
  const firma = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, algFirma, der(0x03, Buffer.concat([Buffer.from([0]), firma])));
  return { der: cert, privateKey, organizzazione };
}

// ──────────────────────────────── CBOR ──────────────────────────────────────

function cborTesta(mt, n) {
  if (n < 24) return Buffer.from([(mt << 5) | n]);
  if (n < 256) return Buffer.from([(mt << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(mt << 5) | 25, n >> 8, n & 255]);
  return Buffer.from([(mt << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
/** `larghe` forza la codifica a 4 byte: serve a tenere fissa la misura fra i due giri. */
export function cbor(v, larghe = false) {
  if (v === null) return Buffer.from([0xf6]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === false) return Buffer.from([0xf4]);
  if (typeof v === 'number') {
    if (v < 0) return larghe ? Buffer.concat([cborTesta(1, 0xffffffff).subarray(0, 1), Buffer.from([(-1 - v) >>> 24 & 255, (-1 - v) >>> 16 & 255, (-1 - v) >>> 8 & 255, (-1 - v) & 255])]) : cborTesta(1, -1 - v);
    return larghe ? Buffer.concat([Buffer.from([(0 << 5) | 26]), Buffer.from([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])]) : cborTesta(0, v);
  }
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([cborTesta(3, b.length), b]); }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) { const b = Buffer.from(v); return Buffer.concat([cborTesta(2, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([cborTesta(4, v.length), ...v.map((x) => cbor(x, larghe))]);
  const chiavi = Object.keys(v);
  return Buffer.concat([cborTesta(5, chiavi.length), ...chiavi.map((k) => Buffer.concat([cbor(k), cbor(v[k], larghe)]))]);
}

// ──────────────────────────────── JUMBF ─────────────────────────────────────

const UUID = {
  store: '633270610011001080000 0aa00389b71',
  manifest: '63326d61001100108000 00aa00389b71',
  asserzioni: '633261730011001080 0000aa00389b71',
  claim: '633263 6c00110010800000aa00389b71',
  firma: '6332637300110010800000aa00389b71',
  cbor: '63626f7200110010800000aa00389b71',
};
const uuidBuf = (k) => Buffer.from(UUID[k].split(' ').join(''), 'hex');

function box(tipo, contenuto) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(contenuto.length + 8);
  return Buffer.concat([l, Buffer.from(tipo, 'ascii'), contenuto]);
}
function jumd(uuidChiave, etichetta) {
  return box('jumd', Buffer.concat([uuidBuf(uuidChiave), Buffer.from([0x03]), Buffer.from(etichetta, 'utf8'), Buffer.from([0])]));
}
function superbox(uuidChiave, etichetta, ...figli) {
  return box('jumb', Buffer.concat([jumd(uuidChiave, etichetta), ...figli]));
}
const asserzione = (etichetta, dati) => superbox('cbor', etichetta, box('cbor', dati));

// ─────────────────────────────── PNG minimo ─────────────────────────────────

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunkPng(tipo, dati) {
  const l = Buffer.alloc(4); l.writeUInt32BE(dati.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(corpo));
  return Buffer.concat([l, corpo, crc]);
}

/** PNG opaco lato×lato, senza nessun metadato. */
export function pngSpoglio(lato = 8, colore = [200, 90, 40]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lato, 0); ihdr.writeUInt32BE(lato, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const righe = [];
  for (let y = 0; y < lato; y++) {
    const r = Buffer.alloc(1 + lato * 3);
    for (let x = 0; x < lato; x++) { r[1 + x * 3] = colore[0]; r[2 + x * 3] = colore[1]; r[3 + x * 3] = colore[2]; }
    righe.push(r);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng('IHDR', ihdr),
    chunkPng('IDAT', zlib.deflateSync(Buffer.concat(righe))),
    chunkPng('IEND', Buffer.alloc(0)),
  ]);
}

/** Aggiunge un testo (tEXt) prima di IDAT: i parametri dei generatori stanno lì. */
export function pngConTesto(base, chiave, valore) {
  const dove = 8 + 25;
  return Buffer.concat([
    base.subarray(0, dove),
    chunkPng('tEXt', Buffer.concat([Buffer.from(chiave, 'latin1'), Buffer.from([0]), Buffer.from(valore, 'latin1')])),
    base.subarray(dove),
  ]);
}

/** Aggiunge un pacchetto XMP (iTXt non compresso). */
export function pngConXmp(base, xmp) {
  const dove = 8 + 25;
  const dati = Buffer.concat([
    Buffer.from('XML:com.adobe.xmp', 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(xmp, 'utf8'),
  ]);
  return Buffer.concat([base.subarray(0, dove), chunkPng('iTXt', dati), base.subarray(dove)]);
}

// ──────────────────────────── il manifesto firmato ──────────────────────────

const SORGENTE = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

/**
 * PNG con manifesto C2PA firmato davvero. `sorgente` è il vocabolo IPTC
 * (`trainedAlgorithmicMedia`, `digitalCapture`, …).
 */
export function pngFirmato({
  base = pngSpoglio(),
  cert = certificato(),
  sorgente = 'trainedAlgorithmicMedia',
  azione = 'c2pa.created',
  generatore = 'Filo test/1.0',
  guastaFirma = false,
} = {}) {
  const dove = 8 + 25;
  const impronta = crypto.createHash('sha256').update(base).digest();

  const azioni = cbor({ actions: [{ action: azione, digitalSourceType: SORGENTE + sorgente, softwareAgent: generatore }] });

  const costruisci = (hash, lunghezzaChunk) => {
    const legame = cbor({
      exclusions: [{ start: dove, length: lunghezzaChunk }],
      alg: 'sha256', hash, pad: Buffer.alloc(0), name: 'jumbf manifest',
    }, true);
    const boxAzioni = asserzione('c2pa.actions', azioni);
    const boxLegame = asserzione('c2pa.hash.data', legame);
    const store = superbox('asserzioni', 'c2pa.assertions', boxAzioni, boxLegame);
    const sha = (b) => crypto.createHash('sha256').update(b).digest();
    const claim = cbor({
      'dc:title': 'prova.png',
      'dc:format': 'image/png',
      instanceID: 'xmp:iid:00000000-0000-0000-0000-000000000001',
      claim_generator: generatore,
      claim_generator_info: [{ name: 'Filo test', version: '1.0' }],
      assertions: [
        { url: 'self#jumbf=c2pa.assertions/c2pa.actions', hash: sha(boxAzioni), alg: 'sha256' },
        { url: 'self#jumbf=c2pa.assertions/c2pa.hash.data', hash: sha(boxLegame), alg: 'sha256' },
      ],
      signature: 'self#jumbf=c2pa.signature',
      alg: 'sha256',
    });
    const protetto = cbor({ '1': -7, '33': cert.der });
    const daFirmare = Buffer.concat([
      Buffer.from([0x84]), cbor('Signature1'), cbor(protetto), cbor(Buffer.alloc(0)), cbor(claim),
    ]);
    let firma = crypto.sign('sha256', daFirmare, { key: cert.privateKey, dsaEncoding: 'ieee-p1363' });
    if (guastaFirma) { firma = Buffer.from(firma); firma[0] ^= 0xff; }
    const cose = cbor([protetto, {}, null, firma]);
    return superbox('store', 'c2pa',
      superbox('manifest', 'urn:uuid:00000000-0000-0000-0000-0000000000aa',
        store,
        superbox('claim', 'c2pa.claim', box('cbor', claim)),
        superbox('firma', 'c2pa.signature', box('cbor', cose))));
  };

  // Due giri: la misura del chunk entra nell'esclusione che il chunk contiene.
  // Tutti i campi variabili hanno codifica a lunghezza fissa, quindi il secondo
  // giro non cambia più la misura — e l'asserzione qui sotto lo pretende.
  const primo = costruisci(Buffer.alloc(32), 0);
  const lunghezza = primo.length + 12;
  const definitivo = costruisci(impronta, lunghezza);
  if (definitivo.length !== primo.length) throw new Error('manifesto di misura instabile');

  return Buffer.concat([base.subarray(0, dove), chunkPng('caBX', definitivo), base.subarray(dove)]);
}
