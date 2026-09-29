// #724.1 — «Quanto fanno 3000 rupie in euro» scritto nella chat arrivava al
// modello senza cambi e senza calcolatrice: rispondeva a memoria. Qui: la chat
// riceve la regola del conto e i cambi del giorno, e il marker diventa il numero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'calcMarkers.js'));
require(join(ROOT, 'src', 'main', 'services', 'fxRates.js'));
const { PROMPTS } = globalThis.SN_CONST;
const Calc = globalThis.SN_CALC;
const Fx = globalThis.SN_FX;

const cambi = Fx.formatForPrompt({ date: '2026-09-26', rates: { INR: 92, USD: 1.08, GBP: 0.85 } });

test('la chat riceve i cambi del giorno, nel contesto e non nelle istruzioni fisse', () => {
  const statico = PROMPTS.filoChatStatic({});
  const intero = PROMPTS.filoChat({ cambi });
  assert.ok(intero.includes(`CAMBI:\n${cambi}`), 'i cambi non arrivano al modello della chat');
  assert.ok(intero.includes('92.00 INR'));
  // I cambi cambiano ogni giorno: nella parte fissa romperebbero il riuso del prefisso.
  assert.ok(!statico.includes('92.00 INR'), 'i cambi sono finiti nella parte fissa del prompt');
  assert.ok(intero.indexOf('CAMBI:\n') > statico.length - 1);
});

test('la chat sa che le rupie sono INR e che il conto si ordina col marker', () => {
  const statico = PROMPTS.filoChatStatic({});
  assert.ok(statico.includes('rupie = INR'));
  assert.ok(statico.includes('[[calc: X/<tasso> | eur]]'), 'manca la regola da valuta a euro');
  assert.ok(statico.includes('| valuta]]'), 'manca la regola da euro (o da un\'altra valuta) a valuta');
  assert.ok(/CERCA_WEB/.test(statico.slice(statico.indexOf('CONTI E CAMBI'))), 'una valuta fuori elenco non ha una strada');
});

test('senza cambi la chat non scrive un blocco CAMBI vuoto', () => {
  assert.ok(!PROMPTS.filoChat({ cambi: '' }).includes('CAMBI:\n'));
});

test('la risposta della chat arriva col numero al posto del marker, scritto come un prezzo', () => {
  const risposta = '3000 rupie sono circa [[calc: 3000/92 | eur]] €, al cambio del 26 settembre.';
  const vista = Calc.resolveCalcMarkers(risposta);
  assert.equal(vista, '3000 rupie sono circa 32,61 €, al cambio del 26 settembre.');
  // Da euro verso un'altra valuta, e fra due valute non euro.
  assert.equal(Calc.resolveCalcMarkers('[[calc: 50*92 | valuta]] INR'), '4.600,00 INR');
  assert.equal(Calc.resolveCalcMarkers('[[calc: 100/1.08*0.85 | valuta]] GBP'), '78,70 GBP');
});

test('in streaming il marker a metà non si vede', () => {
  assert.equal(Calc.resolveCalcMarkers('3000 rupie sono circa [[calc: 3000/9', { streaming: true }), '3000 rupie sono circa …');
});
