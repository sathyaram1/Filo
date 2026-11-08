// Verifica #2294 giro 2: il ritmo dei messaggi sui download cambiato dalla chat a parole.
import { test, expect } from '@playwright/test';
import '../../../src/shared/constants.js';
import '../../../src/shared/preferences.js';

const P = globalThis.SN_PREF;

test('r2 «mezz\'ora» dalla chat vale trenta minuti, non un\'ora', () => {
  for (const v of ['mezz\'ora', 'mezz’ora', 'ogni mezz\'ora']) {
    const r = P.buildPreferencePartial('messaggi sui download', v);
    expect(r && r.partial.filoParla.downloadOgniMin, v).toBe(30);
  }
});

test('r3 la conferma in chat dice «al più ogni ora», non «al più ogni un\'ora»', () => {
  const r = P.buildPreferencePartial('messaggi sui download', '60');
  expect(r.label).not.toContain('ogni un\'ora');
});
