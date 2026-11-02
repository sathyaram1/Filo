// #1654 — quando Filo scrive da sé di un download finito: solo se l'utente non lo sa già. Logica pura di
// src/main/services/downloads.js; il cammino vero (screenshot, clic, download lungo a Filo lasciato) sta in
// tests/download-filo-parla-1654.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DL = require('../../src/main/services/downloads.js');
const dice = DL._daRaccontare;

const ADESSO = Date.parse('2026-11-01T12:00:00.000Z');
const fa = (ms) => new Date(ADESSO - ms).toISOString();
const rec = (over = {}) => ({ url: 'https://esempio.it/file.zip', startedAt: fa(5 * 60_000), _partitoDavanti: true, ...over });

test('uno screenshot non fa mai parlare Filo, nemmeno lungo, partito senza di lui o a Filo lasciato', () => {
  for (const url of ['data:image/png;base64,iVBORw0KGgo=', 'blob:https://esempio.it/1234', 'DATA:image/png;base64,AA']) {
    assert.equal(dice(rec({ url, _partitoDavanti: false }), false, ADESSO), false, url);
    assert.equal(dice(rec({ url, startedAt: fa(10 * 60_000) }), false, ADESSO), false, url);
  }
});

test('davanti a Filo nessun download lo fa parlare: basta l\'avviso «Scaricato»', () => {
  assert.equal(dice(rec(), true, ADESSO), false, 'lungo');
  assert.equal(dice(rec({ _partitoDavanti: false }), true, ADESSO), false, 'partito senza di lui');
});

test('a Filo lasciato parla solo il download lungo o quello partito senza l\'utente', () => {
  assert.equal(dice(rec({ startedAt: fa(DL.DOWNLOAD_LUNGO_MS) }), false, ADESSO), true, 'lungo: un minuto');
  assert.equal(dice(rec({ startedAt: fa(DL.DOWNLOAD_LUNGO_MS - 1) }), false, ADESSO), false, 'appena sotto il minuto');
  assert.equal(dice(rec({ startedAt: fa(3_000) }), false, ADESSO), false, 'cliccato e finito subito');
  assert.equal(dice(rec({ startedAt: fa(3_000), _partitoDavanti: false }), false, ADESSO), true, 'partito mentre non c\'era');
  assert.equal(dice(rec({ url: 'http://esempio.it/a.pdf', startedAt: fa(2 * 60_000) }), false, ADESSO), true, 'anche in http');
});

test('una voce senza inizio o senza indirizzo resta muta', () => {
  assert.equal(dice(rec({ startedAt: '' }), false, ADESSO), false);
  assert.equal(dice(rec({ url: '' }), false, ADESSO), false);
  assert.equal(dice(null, false, ADESSO), false);
});
