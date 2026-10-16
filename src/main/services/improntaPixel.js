// L'impronta di un'immagine per i suoi pixel: gli appunti ricodificano una copia, e i byte cambiano mentre i pixel no.
// Decodifica nel processo principale, quindi prima guarda quanti pixel dichiara l'intestazione (#946).
// La usano le credenziali C2PA (firmatariC2pa.js) e la cronologia appunti (appuntiTolti.js).
'use strict';

const crypto = require('node:crypto');

// Un PNG di pochi MB può dichiarare miliardi di pixel.
const MAX_PIXEL = 100_000_000;

// Larghezza per altezza dichiarate nell'intestazione di un PNG o di un JPEG, senza decodificare.
function pixelDichiarati(b) {
  if (b.length >= 24 && b[0] === 0x89 && b.toString('latin1', 12, 16) === 'IHDR') return b.readUInt32BE(16) * b.readUInt32BE(20);
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b.readUInt16BE(i + 5) * b.readUInt16BE(i + 7);
      if (m === 0xd9 || m === 0xda) break;
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return 0;
}

function byteDaDataUrl(s) {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(s);
  if (!m) return null;
  try {
    const b = Buffer.from(m[1], 'base64');
    return b.length ? b : null;
  } catch (_) { return null; }
}

function immagine(x) {
  if (!x) return null;
  if (typeof x.toBitmap === 'function') return x;
  const b = typeof x === 'string' ? byteDaDataUrl(x) : Buffer.from(x);
  if (!b || pixelDichiarati(b) > MAX_PIXEL) return null;
  try { return require('electron').nativeImage.createFromBuffer(b); } catch (_) { return null; }
}

/** Da byte, data URL o immagine già decodificata; '' se non si decodifica o è troppo grande. */
function impronta(x) {
  const img = immagine(x);
  if (!img || img.isEmpty()) return '';
  const { width, height } = img.getSize();
  if (width * height > MAX_PIXEL) return '';
  return crypto.createHash('sha256').update(`${width}x${height}:`).update(img.toBitmap()).digest('hex');
}

module.exports = { impronta, pixelDichiarati, MAX_PIXEL };
