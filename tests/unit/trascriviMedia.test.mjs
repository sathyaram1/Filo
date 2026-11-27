// Sentinella dei pezzi di un audio lungo (#1815): coprono tutto, senza buchi né doppioni, e il taglio cade nel silenzio.
// Senza i pezzi un audio oltre la finestra del modello sarebbe stato tagliato da lui, o rifiutato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'dictationSegmenter.js'));
require(join(ROOT, 'src', 'shared', 'trascriviMedia.js'));
const T = globalThis.SN_TRASCRIVI_MEDIA;
const RATE = T.RATE;

function tono(secondi, amp = 0.5) {
  const out = new Float32Array(Math.round(secondi * RATE));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(i / 7);
  return out;
}

function copreTutto(p, n) {
  assert.equal(p[0].da, 0, 'il primo pezzo parte dall\'inizio');
  assert.equal(p[p.length - 1].a, n, 'l\'ultimo arriva alla fine');
  for (let i = 1; i < p.length; i++) assert.equal(p[i].da, p[i - 1].a, `fra il pezzo ${i} e il ${i + 1} niente buchi né doppioni`);
  for (const x of p) assert.ok(x.a > x.da, 'nessun pezzo vuoto');
}

test('N secondi senza pause: pezzi da PEZZO_S esatti, il resto corto attaccato all\'ultimo', () => {
  for (const [secondi, attesi] of [[10, 1], [30, 1], [31, 1], [33, 2], [61, 2], [95, 4], [600, 20], [3601, 120]]) {
    const c = tono(secondi);
    const p = T.pezzi(c, RATE);
    copreTutto(p, c.length);
    assert.equal(p.length, attesi, `${secondi} s → ${attesi} pezzi`);
    for (const x of p) assert.ok((x.a - x.da) / RATE <= T.PEZZO_S + T.RESTO_MIN_S + 1e-9, 'nessun pezzo oltre la finestra');
  }
});

test('il taglio cade nella pausa degli ultimi secondi, non a metà parola', () => {
  const c = tono(70);
  const pausa = [27 * RATE, 27.5 * RATE];
  c.fill(0, pausa[0], pausa[1]);
  const p = T.pezzi(c, RATE);
  copreTutto(p, c.length);
  assert.ok(p[0].a > pausa[0] && p[0].a <= pausa[1], `taglio a ${p[0].a / RATE} s, dentro la pausa`);
});

test('niente audio, niente pezzi', () => {
  assert.deepEqual(T.pezzi(new Float32Array(0), RATE), []);
});

test('il WAV di un pezzo ha i suoi campioni e basta', () => {
  const c = tono(65);
  const p = T.pezzi(c, RATE);
  const tot = p.reduce((s, x) => s + Buffer.from(T.wavDelPezzo(c, RATE, x), 'base64').length - 44, 0);
  assert.equal(tot, c.length * 2, 'i pezzi insieme hanno ogni campione una volta');
});

test('i tetti dicono il numero', () => {
  assert.match(T.troppoGrande(400 * 1024 * 1024).message, /400 MB.*150 MB/);
  assert.match(T.troppoLungo(5 * 3600).message, /5 ore.*3 ore/);
});
