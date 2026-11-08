// Verifica #2294 giro 4: il ritmo dei messaggi sui download chiesto in chat con «1h», «un quarto d'ora» o «mezz ora»
// diventa un altro valore (due minuti, un'ora, un'ora).
import { test, expect } from '@playwright/test';
import '../../../src/shared/constants.js';
import '../../../src/shared/preferences.js';

const P = globalThis.SN_PREF;
const min = (v) => {
  const r = P.buildPreferencePartial('messaggi sui download', v);
  return r && r.partial ? r.partial.filoParla.downloadOgniMin : null;
};

test('r2 «1h» dalla chat è un\'ora, non due minuti', () => {
  expect(min('1h')).toBe(60);
  expect(min('ogni 2h')).toBe(60);
});

test('r2 «un quarto d\'ora» e «mezz ora» non diventano un\'ora', () => {
  expect(min("un quarto d'ora")).not.toBe(60);
  expect(min('mezz ora')).toBe(30);
});
