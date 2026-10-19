// #800 — una finestra in incognito mostra ai siti un'impronta sua: diversa dalla finestra normale e da ogni
// altra finestra in incognito, stabile dentro la stessa. L'ambito è la partizione della finestra (ipc.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FP = require('../../src/main/services/fingerprint.js');

const PAGINA = 'https://www.example.com/articolo';
const INCOGNITO_A = 'filo-incognito-1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const INCOGNITO_B = 'filo-incognito-6fa459ea-ee8a-3ca4-894e-db77e160355e';
const modo = (mode) => FP.setMode({ security: { fingerprint: { mode } } });

for (const mode of ['default', 'privacy']) {
  test(`${mode}: la stessa pagina in una finestra normale e in una in incognito ha semi diversi`, () => {
    modo(mode);
    const normale = FP.configForHref(PAGINA);
    const incognito = FP.configForHref(PAGINA, INCOGNITO_A);
    assert.ok(normale.seed > 0 && incognito.seed > 0);
    assert.notEqual(incognito.seed, normale.seed);
    assert.equal(incognito.level, normale.level, 'il livello resta quello scelto');
  });

  test(`${mode}: due finestre in incognito hanno semi diversi, la stessa finestra sempre lo stesso`, () => {
    modo(mode);
    const a1 = FP.configForHref(PAGINA, INCOGNITO_A).seed;
    const a2 = FP.configForHref('https://shop.example.com/carrello', INCOGNITO_A).seed;
    const b = FP.configForHref(PAGINA, INCOGNITO_B).seed;
    assert.equal(a1, a2, 'stesso sito nella stessa finestra: impronta stabile');
    assert.notEqual(a1, b);
  });

  test(`${mode}: in incognito siti diversi restano scorrelati e le esenzioni restano`, () => {
    modo(mode);
    assert.notEqual(FP.configForHref(PAGINA, INCOGNITO_A).seed, FP.configForHref('https://altro-sito.org/', INCOGNITO_A).seed);
    assert.deepEqual(FP.configForHref('https://accounts.google.com/signin/oauth', INCOGNITO_A), { level: 0, seed: 0 });
    assert.deepEqual(FP.configForHref('https://docs.google.com/document/d/x', INCOGNITO_A), { level: 0, seed: 0 });
    assert.deepEqual(FP.configForHref('filo://newtab/', INCOGNITO_A), { level: 0, seed: 0 });
  });
}

test('off: nessuna protezione nemmeno in incognito', () => {
  modo('off');
  assert.deepEqual(FP.configForHref(PAGINA, INCOGNITO_A), { level: 0, seed: 0 });
});

test('fuori dall\'incognito il seme non cambia (ambito vuoto)', () => {
  modo('default');
  assert.equal(FP.configForHref(PAGINA, '').seed, FP.configForHref(PAGINA).seed);
});

test('il livello scelto da una finestra in incognito vale solo lì, e alla chiusura torna quello normale', () => {
  modo('default');
  FP.setMode({ security: { fingerprint: { mode: 'off' } } }, true);
  assert.deepEqual(FP.configForHref(PAGINA, INCOGNITO_A), { level: 0, seed: 0 });
  assert.equal(FP.configForHref(PAGINA).level, 1, 'la finestra normale resta protetta');
  modo('privacy');
  assert.equal(FP.configForHref(PAGINA, INCOGNITO_A).level, 0, 'un cambio fuori non scavalca la scelta dell\'incognito');
  FP.resetIncognito();
  assert.equal(FP.configForHref(PAGINA, INCOGNITO_A).level, 2);
});
