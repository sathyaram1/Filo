// Unit test di src/shared/marchiInvisibili.js (#889): i marchi aperti che i generatori scrivono nei pixel.
// Le immagini marcate le ha scritte la libreria di riferimento lungo il cammino vero di ogni generatore
// (tests/fixtures/marchi/genera.py); le foto vere non devono accendere niente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
require('../../src/shared/provenienzaImmagine.js');
require('../../src/shared/marchiInvisibili.js');
const M = globalThis.SN_MARCHI_INVISIBILI;
const I = M._interni;
const P = globalThis.SN_PROVENIENZA;
const jpeg = require('jpeg-js/lib/decoder.js');

const CARTELLA = join(import.meta.dirname, '..', 'fixtures', 'marchi');
const fixture = (nome) => readFileSync(join(CARTELLA, nome));
const cerca = (byte) => M.cerca(byte, { jpeg });

function crc32(b) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function blocco(tipo, dati) {
  const t = Buffer.from(tipo, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(dati.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dati])));
  return Buffer.concat([len, t, dati, crc]);
}
// Un PNG scritto qui, riga per riga, col filtro scelto: così la prova sa quali pixel ci sono dentro.
function png(w, h, pixel, { tipo = 2, prof = 8, filtro = (y) => y % 5, interlacciato = 0, idat } = {}) {
  const canali = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipo];
  const bpp = canali * (prof / 8);
  const riga = w * bpp;
  const grezzo = Buffer.alloc((riga + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = filtro(y);
    grezzo[y * (riga + 1)] = f;
    for (let i = 0; i < riga; i++) {
      const x = pixel[y * riga + i];
      const a = i >= bpp ? pixel[y * riga + i - bpp] : 0;
      const c = y ? pixel[(y - 1) * riga + i] : 0;
      const ac = y && i >= bpp ? pixel[(y - 1) * riga + i - bpp] : 0;
      const pa = Math.abs(c - ac), pb = Math.abs(a - ac), pc = Math.abs(a + c - 2 * ac);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? c : ac;
      const pred = [0, a, c, (a + c) >> 1, paeth][f];
      grezzo[y * (riga + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = prof; ihdr[9] = tipo; ihdr[12] = interlacciato;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', ihdr), blocco('IDAT', idat || zlib.deflateSync(grezzo)), blocco('IEND', Buffer.alloc(0)),
  ]);
}
// I pixel RGB di un PNG di prova, letti dal lettore di Filo.
function rgbDi(byte) {
  const px = I.pixelPng(new Uint8Array(byte), zlib);
  const out = new Uint8Array(px.w * px.h * 3);
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      const p = y * px.passoRiga + px.inizio + x * px.passoPixel;
      for (let c = 0; c < 3; c++) out[(y * px.w + x) * 3 + c] = px.dati[p + c * px.passoCanale];
    }
  }
  return { w: px.w, h: px.h, rgb: out };
}

test('le immagini marcate dalla libreria di riferimento dicono chi le ha generate', () => {
  assert.equal(cerca(fixture('marchio-sdxl.png')).marchio, 'sdxl');
  assert.equal(cerca(fixture('marchio-sdxl.png')).chi, 'Stable Diffusion XL');
  assert.equal(cerca(fixture('marchio-sd1.png')).marchio, 'sd1');
  assert.equal(cerca(fixture('marchio-flux.jpg')).marchio, 'flux', 'FLUX salva in JPEG: il marchio regge e si legge');
  for (const nome of ['marchio-sdxl.png', 'marchio-sd1.png', 'marchio-flux.jpg']) {
    assert.ok(cerca(fixture(nome)).p <= I.ALFA, `${nome}: sotto la soglia fissata`);
  }
});

test('la stessa immagine senza marchio non dice niente', () => {
  assert.deepEqual(cerca(fixture('senza-marchio.png')), { marchio: null });
});

test('le foto vere di prova non accendono nessun marchio', () => {
  for (const nome of ['foto-astronauta.jpg', 'foto-gatto.jpg', 'foto-caffe.jpg', 'foto-razzo.jpg']) {
    assert.deepEqual(cerca(fixture(nome)), { marchio: null }, nome);
  }
});

test('il marchio di SDXL messo con i canali nell’ordine delle prime versioni di diffusers si legge lo stesso', () => {
  // Scambiare R e B di un'immagine marcata in BGR dà quella che il codificatore avrebbe marcato ricevendo RGB.
  const { w, h, rgb } = rgbDi(fixture('marchio-sdxl.png'));
  const girati = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) { girati[i] = rgb[i + 2]; girati[i + 1] = rgb[i + 1]; girati[i + 2] = rgb[i]; }
  assert.equal(cerca(png(w, h, girati, { filtro: () => 0 })).marchio, 'sdxl');
});

test('un ritaglio di un pixel fa perdere il marchio, e allora non si dice niente', () => {
  const { w, h, rgb } = rgbDi(fixture('marchio-sdxl.png'));
  const tagliato = rgb.subarray(3 * w * 3).slice();
  assert.deepEqual(cerca(png(w, h - 3, tagliato, { filtro: () => 0 })), { marchio: null });
});

test('senza il decodificatore JPEG, un JPEG non si legge: null, non «niente marchio»', () => {
  assert.equal(M.cerca(fixture('marchio-flux.jpg')), null);
});

test('formati e misure dove il marchio non sta non si leggono', () => {
  const grigio = png(300, 300, new Uint8Array(300 * 300).fill(90), { tipo: 0 });
  assert.equal(cerca(grigio), null, 'un PNG in grigi non ha la U');
  const piccolo = png(200, 200, new Uint8Array(200 * 200 * 3).fill(120));
  assert.equal(cerca(piccolo), null, 'sotto 256×256 il codificatore di riferimento non marca');
  const interlacciato = png(300, 300, new Uint8Array(300 * 300 * 3).fill(120), { interlacciato: 1 });
  assert.equal(cerca(interlacciato), null);
  assert.equal(cerca(Buffer.from('RIFF0000WEBPVP8 ')), null);
});

test('il lettore PNG ricostruisce i pixel con ogni filtro, a 8 e 16 bit, con e senza alfa', () => {
  const w = 37, h = 11;
  for (const [tipo, prof] of [[2, 8], [6, 8], [2, 16], [6, 16]]) {
    const canali = tipo === 6 ? 4 : 3;
    const n = w * h * canali * (prof / 8);
    const pixel = Uint8Array.from({ length: n }, (_, i) => (i * 97 + (i >> 5) * 13) & 255);
    const px = I.pixelPng(new Uint8Array(png(w, h, pixel, { tipo, prof })), zlib, { minimo: 0 });
    assert.ok(px, `tipo ${tipo} a ${prof} bit`);
    for (let y = 0; y < h; y++) {
      const riga = px.dati.subarray(y * px.passoRiga + 1, (y + 1) * px.passoRiga);
      assert.deepEqual(Array.from(riga), Array.from(pixel.subarray(y * (n / h), (y + 1) * (n / h))), `riga ${y}, tipo ${tipo}/${prof}`);
    }
  }
});

test('file rotti, enormi o gonfiati apposta finiscono in fretta e senza eccezioni', () => {
  const buono = fixture('marchio-sdxl.png');
  assert.equal(cerca(buono.subarray(0, 4000)), null, 'tagliato a metà');
  assert.equal(cerca(fixture('marchio-flux.jpg').subarray(0, 3000)), null);
  assert.equal(cerca(new Uint8Array(0)), null);
  assert.equal(cerca(Buffer.from('non sono un’immagine, sono un testo abbastanza lungo')), null);

  const enorme = png(20, 20, new Uint8Array(20 * 20 * 3));
  enorme.writeUInt32BE(100000, 16); enorme.writeUInt32BE(100000, 20);
  let t = Date.now();
  assert.equal(cerca(enorme), null, 'dieci miliardi di pixel dichiarati');
  assert.ok(Date.now() - t < 200);

  // 1000×1000 dichiarati, ma un flusso che si gonfia a 600 MB.
  const bomba = png(1000, 1000, new Uint8Array(0), { idat: zlib.deflateSync(Buffer.alloc(600 * 1024 * 1024)), filtro: () => 0 });
  t = Date.now();
  assert.equal(cerca(bomba), null);
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
});

test('la soglia è un test esatto: le probabilità senza marchio sommano a uno e i casi piccoli tornano', () => {
  const t = I.coda(2, 2);
  assert.ok(Math.abs(t[0] - 1) < 1e-12);
  // U per due e due: 1, 1, 2, 1, 1 disposizioni su sei.
  assert.deepEqual(Array.from(t).map((v) => Math.round(v * 6)), [6, 5, 4, 2, 1, 0]);
  const sdxl = I.coda(27, 21);
  assert.ok(Math.abs(sdxl[27 * 21] - 1 / 8.71e12) / (1 / 8.71e12) < 0.01, 'la separazione perfetta di SDXL: una su C(48, 21)');
  const sd1 = I.coda(64, 72);
  assert.ok(Math.abs(sd1[0] - 1) < 1e-9);
});

test('la frase e la nota per il modello presentano il marchio come dichiarazione di chi l’ha messo', () => {
  const esito = P.esitoDaMarchio(cerca(fixture('marchio-sdxl.png')));
  assert.equal(P.frase(esito), 'Generata con l’AI: porta il marchio invisibile che Stable Diffusion XL mette nelle sue immagini.');
  const nota = P.notaPerModello(esito);
  assert.match(nota.sistema, /marchio che il generatore scrive nei pixel/);
  assert.doesNotMatch(nota.sistema, /Stable Diffusion XL/, 'il nome sta nella busta, non nella voce di Filo');
  assert.equal(P.esitoDaMarchio({ marchio: null }), null);
  assert.equal(P.esitoDaMarchio(null), null);
});
