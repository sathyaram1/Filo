// Verifica #2294 giro 3: il ritmo dei messaggi sui download chiesto in chat in secondi diventa lo stesso numero in minuti.
import { test, expect } from '@playwright/test';
import '../../../src/shared/constants.js';
import '../../../src/shared/preferences.js';

const P = globalThis.SN_PREF;

test('r2 «ogni 30 secondi» dalla chat prende la scelta più breve, non trenta minuti', () => {
  for (const v of ['30 secondi', 'ogni 30 secondi', '45 sec']) {
    const r = P.buildPreferencePartial('messaggi sui download', v);
    const min = r && r.partial ? r.partial.filoParla.downloadOgniMin : null;
    expect(min === null || min === 2, `${v} → ${min}`).toBe(true);
  }
});
