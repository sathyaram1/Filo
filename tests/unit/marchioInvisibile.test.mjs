// Unit test di src/shared/marchioInvisibile.js: il marchio aperto di Stable Diffusion letto dai pixel (#711).
// Le immagini in tests/fixtures/provenienza le ha scritte la libreria di riferimento (invisible-watermark,
// dwtDct), che le rilegge intere: se il lettore di Filo si allontana dal suo algoritmo, questi sono rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { decodificaPng } from '../helpers/pixelPng.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/marchioInvisibile.js');
require('../../src/shared/provenienzaImmagine.js');
const M = globalThis.SN_MARCHIO;
const P = globalThis.SN_PROVENIENZA;

const QUI = join(process.cwd(), 'tests', 'fixtures', 'provenienza');
const pixel = (nome) => decodificaPng(readFileSync(join(QUI, nome)));
const leggi = ({ pixel: px, larghezza, altezza }) => M.leggi(px, larghezza, altezza);

test('il marchio «StableDiffusionV1» si legge dai pixel', () => {
  assert.deepEqual(leggi(pixel('marchio-stable-diffusion.png')), { ente: 'Stable Diffusion' });
});

test('il marchio di SDXL si legge anche se chi l’ha scritto ha passato i canali in ordine RGB', () => {
  assert.deepEqual(leggi(pixel('marchio-sdxl.png')), { ente: 'Stable Diffusion' });
});

test('lo stesso marchio si legge coi canali in ordine BGRA, come li dà qualche decoder', () => {
  const d = pixel('marchio-stable-diffusion.png');
  const bgra = Buffer.from(d.pixel);
  for (let i = 0; i < bgra.length; i += 4) { const r = bgra[i]; bgra[i] = bgra[i + 2]; bgra[i + 2] = r; }
  assert.deepEqual(M.leggi(bgra, d.larghezza, d.altezza), { ente: 'Stable Diffusion' });
});

test('la stessa immagine senza marchio non dice niente', () => {
  assert.equal(leggi(pixel('senza-marchio.png')), null);
});

test('un colore pieno, un’immagine minuscola o dati mancanti non dicono niente', () => {
  const w = 256; const h = 256;
  assert.equal(M.leggi(new Uint8Array(w * h * 4).fill(200), w, h), null);
  assert.equal(M.leggi(new Uint8Array(4 * 4 * 4), 4, 4), null);
  assert.equal(M.leggi(new Uint8Array(10), 256, 256), null);
  assert.equal(M.leggi(null, 0, 0), null);
});

test('rumore qualsiasi, anche su una foto grande, non passa mai per un marchio e resta veloce', () => {
  const w = 4000; const h = 3000;
  const px = new Uint8Array(w * h * 4);
  let x = 12345;
  for (let i = 0; i < px.length; i++) { x = (x * 1103515245 + 12345) >>> 0; px[i] = x >>> 24; }
  const t = Date.now();
  assert.equal(M.leggi(px, w, h), null);
  assert.ok(Date.now() - t < 2000, `lettura lenta: ${Date.now() - t} ms`);
});

test('il main accetta dall’esterno solo un ente che il lettore conosce', () => {
  assert.equal(P.frase(P.daMarchio({ ente: 'Stable Diffusion' })),
    'Generata con l’AI secondo il marchio invisibile di Stable Diffusion, senza firma che lo confermi.');
  assert.equal(P.daMarchio({ ente: 'OpenAI' }), null);
  assert.equal(P.daMarchio({ ente: '<b>Stable Diffusion</b>' }), null);
  assert.equal(P.daMarchio(null), null);
  assert.equal(P.daMarchio('Stable Diffusion'), null);
});
