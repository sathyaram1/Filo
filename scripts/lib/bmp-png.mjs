// bmp-png.mjs — una BMP rifatta PNG, perché chi lavora apre le immagini con uno strumento che legge png,
// jpeg, gif e webp ma non bmp. Non converte a metà: una BMP che non sa leggere lancia col motivo.
// Regole: tests/unit/immaginiRoutine.test.mjs.

import { deflateSync } from 'node:zlib';

// Un 8K è 33 milioni di pixel: oltre, è un'intestazione falsa che chiederebbe centinaia di MB.
const PIXEL_MAX = 40 * 1000 * 1000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pezzo(tipo, dati) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dati.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG a 8 bit per canale da pixel RGB o RGBA in righe dall'alto. PURA. */
export function png(w, h, pixel, alfa) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alfa ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pezzo('IHDR', ihdr),
    pezzo('IDAT', deflateSync(pixel)),
    pezzo('IEND', Buffer.alloc(0)),
  ]);
}

// Il valore di un canale da una maschera di bit, riportato a 0–255.
function canale(v, maschera) {
  if (!maschera) return 0;
  let shift = 0;
  while (!((maschera >>> shift) & 1)) shift++;
  const max = maschera >>> shift;
  return Math.round((((v & maschera) >>> shift) * 255) / max);
}

/**
 * I byte di una BMP non compressa (1, 4, 8, 16, 24 o 32 bit, anche a maschere) come PNG. PURA.
 * @throws {Error} col motivo leggibile, se la BMP è di una forma che non legge o è troncata
 */
export function bmpInPng(buf) {
  const b = Buffer.from(buf);
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) throw new Error('non è una bmp');
  const inizioPixel = b.readUInt32LE(10);
  const dib = b.readUInt32LE(14);
  const core = dib === 12;
  if (!core && (dib < 40 || b.length < 14 + dib)) throw new Error('intestazione bmp di forma sconosciuta');
  const w = core ? b.readUInt16LE(18) : b.readInt32LE(18);
  const hGrezza = core ? b.readInt16LE(20) : b.readInt32LE(22);
  const bpp = core ? b.readUInt16LE(24) : b.readUInt16LE(28);
  const compressione = core ? 0 : b.readUInt32LE(30);
  const dallAlto = hGrezza < 0;
  const h = Math.abs(hGrezza);
  if (w <= 0 || h <= 0) throw new Error('bmp senza dimensioni');
  if (w * h > PIXEL_MAX) throw new Error(`bmp troppo grande da convertire (${w}×${h})`);
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error(`bmp a ${bpp} bit non supportata`);
  // 3 = maschere di bit, 6 = maschere con alfa; 1, 2 (RLE), 4, 5 (jpeg/png dentro) non si leggono qui.
  if (![0, 3, 6].includes(compressione)) throw new Error(`bmp compressa (metodo ${compressione}) non supportata`);

  let maschere = null;
  if (bpp === 16 || bpp === 32) {
    if (compressione === 3 || compressione === 6) {
      if (b.length < 66) throw new Error('bmp troncata');
      const alfa = (dib >= 56 || compressione === 6) && b.length >= 70 ? b.readUInt32LE(66) : 0;
      maschere = [b.readUInt32LE(54), b.readUInt32LE(58), b.readUInt32LE(62), alfa];
    } else if (bpp === 16) {
      maschere = [0x7c00, 0x03e0, 0x001f, 0];
    } else {
      // A 32 bit senza maschere il quarto byte non è alfa: molti programmi ci lasciano zeri.
      maschere = [0xff0000, 0xff00, 0xff, 0];
    }
  }

  let tavolozza = null;
  if (bpp <= 8) {
    const voce = core ? 3 : 4;
    const usati = core ? 0 : b.readUInt32LE(46);
    const quanti = usati || 2 ** bpp;
    const da = 14 + dib;
    if (da + quanti * voce > b.length) throw new Error('bmp troncata');
    tavolozza = [];
    for (let i = 0; i < quanti; i++) tavolozza.push([b[da + i * voce + 2], b[da + i * voce + 1], b[da + i * voce]]);
  }

  const passo = Math.floor((bpp * w + 31) / 32) * 4;
  if (inizioPixel + passo * h > b.length) throw new Error('bmp troncata');
  const alfa = !!(maschere && maschere[3]);
  const canali = alfa ? 4 : 3;
  const riga = w * canali + 1;
  const out = Buffer.alloc(riga * h);
  for (let y = 0; y < h; y++) {
    const src = inizioPixel + (dallAlto ? y : h - 1 - y) * passo;
    const dst = y * riga + 1;
    for (let x = 0; x < w; x++) {
      let r;
      let g;
      let bl;
      let a = 255;
      if (tavolozza) {
        const bit = x * bpp;
        const idx = (b[src + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, bl] = tavolozza[idx] || [0, 0, 0];
      } else if (bpp === 24) {
        const o = src + x * 3;
        [bl, g, r] = [b[o], b[o + 1], b[o + 2]];
      } else {
        const v = bpp === 16 ? b.readUInt16LE(src + x * 2) : b.readUInt32LE(src + x * 4);
        [r, g, bl] = [canale(v, maschere[0]), canale(v, maschere[1]), canale(v, maschere[2])];
        if (alfa) a = canale(v, maschere[3]);
      }
      const o = dst + x * canali;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = bl;
      if (alfa) out[o + 3] = a;
    }
  }
  // Una maschera d'alfa con tutti i pixel a zero è un'immagine opaca scritta male, non un'immagine invisibile.
  if (alfa) {
    let vista = false;
    for (let y = 0; y < h && !vista; y++) for (let x = 0; x < w; x++) if (out[y * riga + 4 + x * 4]) { vista = true; break; }
    if (!vista) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * riga + 4 + x * 4] = 255;
  }
  return png(w, h, out, alfa);
}
