// #1446 — dai segni blu e ocra ai due del correttore: il blu spento diventa «Errori» del solo codice, l'ocra spento è già
// «Suggerimenti» spento, i colori dell'ocra passano ai suggerimenti; una volta sola, e un backup di dopo non si tocca.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
const M = require('../../src/main/services/correttoreMigrazione.js');
const K = globalThis.SN_CONST.STORAGE_KEYS;

test('blu spento: errori accesi ma senza modello e senza ripetizioni; l\'ocra spento resta suggerimenti spenti', () => {
  const s = M.convertite({ featureFlags: { spellcheck: false, spellcheckContext: false, help: true }, correttore: { pausaRapidoMs: 800 } });
  assert.deepEqual(s.featureFlags, { spellcheck: true, spellcheckContext: false, help: true });
  assert.deepEqual(s.correttore, { pausaRapidoMs: 800, modelloErrori: false, ripetizioni: false });
  assert.equal(M.convertite({ featureFlags: { spellcheck: true } }), null, 'niente da cambiare');
});

test('i colori scelti per l\'ocra passano ai suggerimenti, senza scavalcare una scelta già fatta per loro', () => {
  const s = M.convertite({ themeTokens: { 'correttore.ocra.color': '#aa00aa', 'correttore.ocra.stile': 'dashed', accent: '#111111' } });
  assert.deepEqual(s.themeTokens, { accent: '#111111', 'correttore.suggerimenti.color': '#aa00aa', 'correttore.suggerimenti.stile': 'dashed' });
  const t = M.convertite({ themeTokens: { 'correttore.ocra.color': '#aa00aa', 'correttore.suggerimenti.color': '#00aa00' } });
  assert.deepEqual(t.themeTokens, { 'correttore.suggerimenti.color': '#00aa00' });
});

test('all\'avvio una volta sola: poi un «Errori» spento è una scelta e resta', async () => {
  let dati = { [K.SETTINGS]: { featureFlags: { spellcheck: false } } };
  const storage = { get: async () => ({ ...dati }), set: async (x) => { dati = { ...dati, ...x }; } };
  const registro = { con: async (_m, fn) => fn() };
  assert.equal(await M.migra({ storage, registro }), true);
  assert.equal(dati[K.SETTINGS].featureFlags.spellcheck, true);
  assert.equal(dati[M.SEGNO], true);
  dati[K.SETTINGS] = { featureFlags: { spellcheck: false } };
  assert.equal(await M.migra({ storage, registro }), false);
  assert.equal(dati[K.SETTINGS].featureFlags.spellcheck, false);
});

test('un backup di prima si converte all\'importazione, uno di dopo (col segno) no', () => {
  const prima = { [K.SETTINGS]: { featureFlags: { spellcheck: false } } };
  assert.equal(M.perImportazione(prima)[K.SETTINGS].correttore.modelloErrori, false);
  const dopo = { [K.SETTINGS]: { featureFlags: { spellcheck: false } }, [M.SEGNO]: true };
  assert.equal(M.perImportazione(dopo), dopo);
});
