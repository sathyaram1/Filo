// Unit test di src/shared/marchiInvisibili.js (#889): i marchi aperti che i generatori scrivono nei pixel.
// Le immagini marcate le ha scritte la libreria di riferimento lungo il cammino vero di ogni generatore
// (tests/fixtures/marchi/genera.py); le foto vere non devono accendere niente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';
import { letturaIsolata } from '../helpers/letturaIsolata.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

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
  const w = 257, h = 256;
  for (const [tipo, prof] of [[2, 8], [6, 8], [2, 16], [6, 16]]) {
    const riga = w * (tipo === 6 ? 4 : 3) * (prof / 8);
    const pixel = Uint8Array.from({ length: riga * h }, (_, i) => (i * 97 + (i >> 5) * 13 + (i >> 11)) & 255);
    const px = I.pixelPng(new Uint8Array(png(w, h, pixel, { tipo, prof })), zlib);
    assert.ok(px, `tipo ${tipo} a ${prof} bit`);
    const letti = Buffer.concat(Array.from({ length: h }, (_, y) => px.dati.subarray(y * px.passoRiga + 1, (y + 1) * px.passoRiga)));
    assert.equal(Buffer.compare(letti, Buffer.from(pixel)), 0, `tipo ${tipo} a ${prof} bit`);
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
  let r;
  let c = costoInUnita(() => { r = cerca(enorme); }, { tetto: 1 });
  assert.equal(r, null, 'dieci miliardi di pixel dichiarati');
  assert.ok(c.entro, c.come);

  // 1000×1000 dichiarati, ma un flusso che si gonfia a 64 MB: si ferma alla misura dichiarata.
  const bomba = png(1000, 1000, new Uint8Array(0), { idat: zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024)), filtro: () => 0 });
  c = costoInUnita(() => { r = cerca(bomba); }, { tetto: 2 });
  assert.equal(r, null);
  assert.ok(c.entro, c.come);
});

test('la soglia è un test esatto: le probabilità senza marchio sommano a uno e i casi piccoli tornano', () => {
  const t = I.coda(2, 2);
  assert.ok(Math.abs(t[0] - 1) < 1e-12);
  // U per due e due: 1, 1, 2, 1, 1 disposizioni su sei.
  assert.deepEqual(Array.from(t).map((v) => Math.round(v * 6)), [6, 5, 4, 2, 1, 0]);
  const sdxl = I.coda(27, 21);
  assert.ok(Math.abs(sdxl[27 * 21] * 22314239266528 - 1) < 1e-6, 'la separazione perfetta di SDXL: una su C(48, 21)');
  const sd1 = I.coda(68, 68);
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

// ── Dentro Filo: il thread recintato e la lettura che usano menu, Aiuto e chat ──

process.env.NODE_ENV = 'test';
const F = require('../../src/main/services/firmatariC2pa.js');
const isolata = letturaIsolata();

// #1231: cercato alla prima lettura, il pacchetto mancante faceva cadere una prova a metà e il file restava appeso.
test('il pacchetto del thread si cerca al caricamento: se manca, chi importa il modulo cade subito col suo nome', () => {
  const casa = cartellaTemporanea('filo-senza-jpeg-');
  try {
    const copia = join(casa, 'provenienzaIsolata.js');
    copyFileSync(join(import.meta.dirname, '..', '..', 'src', 'main', 'services', 'provenienzaIsolata.js'), copia);
    const env = { ...process.env };
    delete env.NODE_PATH;
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(copia)})`], { env, encoding: 'utf8', timeout: TETTO_ATTESA_MS });
    assert.notEqual(r.status, 0, 'il modulo si è caricato senza il suo pacchetto');
    assert.match(r.stderr, /Cannot find module 'jpeg-js\/lib\/decoder\.js'/);
  } finally {
    togliCartella(casa);
  }
});

test('nel thread recintato il marchio si legge, anche dentro un JPEG', async () => {
  assert.equal((await isolata.cercaMarchi(fixture('marchio-flux.jpg'))).marchio, 'flux');
  assert.equal((await isolata.cercaMarchi(fixture('marchio-sdxl.png'))).marchio, 'sdxl');
  assert.deepEqual(await isolata.cercaMarchi(fixture('foto-gatto.jpg')), { marchio: null });
});

test('la lettura comune: il marchio quando il file tace, e i marchi cercati o no detti per quello che sono', async () => {
  F._dimentica();
  const marcata = await F.analizzaImmagine(fixture('marchio-sdxl.png'));
  assert.equal(marcata.prova, 'marchio');
  assert.equal(P.frase(marcata), 'Generata con l’AI: porta il marchio invisibile che Stable Diffusion XL mette nelle sue immagini.');

  const spoglia = await F.analizzaImmagine(fixture('senza-marchio.png'));
  assert.equal(spoglia.trovato, false);
  assert.equal(spoglia.marchiCercati, true);
  assert.match(P.notaPerModello(spoglia).sistema, /né uno dei marchi invisibili aperti che Filo sa leggere nei pixel \(Stable Diffusion XL, FLUX\.1, Stable Diffusion 1\)/);

  const webp = await F.analizzaImmagine(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 qualcosa che non si decodifica'));
  assert.equal(webp.marchiCercati, false);
  assert.match(P.notaPerModello(webp).sistema, /in questo file non si possono cercare/);
  assert.doesNotMatch(P.notaPerModello(webp).sistema, /né uno dei marchi/);
});

test('se il file dichiara qualcosa, parla l’etichetta e i pixel non si guardano', async (t) => {
  F._dimentica();
  const marcata = fixture('marchio-sdxl.png');
  const testo = Buffer.from('parameters\u0000un gatto, Steps: 20', 'latin1');
  const conEtichetta = Buffer.concat([marcata.subarray(0, 33), blocco('tEXt', testo), marcata.subarray(33)]);
  const vera = isolata.cercaMarchi;
  let chiamate = 0;
  isolata.cercaMarchi = (...a) => { chiamate++; return vera(...a); };
  t.after(() => { isolata.cercaMarchi = vera; });
  const r = await F.analizzaImmagine(conEtichetta);
  assert.equal(r.fonte, 'png');
  assert.equal(r.prova, 'dichiarata');
  assert.equal(chiamate, 0);
});

test('la stessa immagine letta dal menu e poi dalla chat si decodifica una volta sola', async (t) => {
  F._dimentica();
  const vera = isolata.cercaMarchi;
  let chiamate = 0;
  isolata.cercaMarchi = (...a) => { chiamate++; return vera(...a); };
  t.after(() => { isolata.cercaMarchi = vera; });
  const byte = fixture('marchio-sd1.png');
  const [a, b] = await Promise.all([F.analizzaImmagine(byte), F.analizzaImmagine(Buffer.from(byte))]);
  const c = await F.analizzaImmagine(byte);
  assert.equal(chiamate, 1);
  for (const r of [a, b, c]) assert.equal(r.marchio, 'sd1');
});

test('una lettura interrotta non resta ricordata come «nessun marchio»', async (t) => {
  F._dimentica();
  const vera = isolata.cercaMarchi;
  let rompi = true;
  isolata.cercaMarchi = (...a) => (rompi ? Promise.reject(new Error('thread caduto')) : vera(...a));
  t.after(() => { isolata.cercaMarchi = vera; });
  const byte = fixture('marchio-sdxl.png');
  const prima = await F.analizzaImmagine(byte);
  assert.equal(prima.trovato, false);
  assert.equal(prima.marchiCercati, false, 'i pixel non sono stati letti: non si dice che il marchio non c’è');
  rompi = false;
  assert.equal((await F.analizzaImmagine(byte)).marchio, 'sdxl');
});
