// Verifica #630 giro 2, rilievo 3: chiesta a Filo, una durata con un numero e «resta» non diventa «per sempre».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/preferences.js');

test('«resta 8 secondi» imposta 8 secondi, «non restano» non li rende eterni', () => {
  const P = globalThis.SN_PREF;
  expect(P.buildPreferencePartial('durata_notifiche', 'resta 8 secondi')?.partial?.notifications?.durationSec).toBe(8);
  expect(P.buildPreferencePartial('durata_notifiche', 'restano 10 secondi')?.partial?.notifications?.durationSec).toBe(10);
  expect(P.buildPreferencePartial('durata_notifiche', 'non restano')?.partial?.notifications?.durationSec).not.toBe(0);
});
