// #1160 giro 1 — chiedere a Filo «canale veloce: sì» deve lasciare (o rimettere) il canale veloce, non passare allo stabile.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
require('../../../src/shared/preferences.js');
const P = globalThis.SN_PREF;

test('r3 «canale veloce» acceso sceglie il veloce, spento lo stabile', () => {
  for (const v of ['sì', true, 'on']) {
    expect(P.buildPreferencePartial('canale veloce', v)?.partial, `canale veloce: ${v}`)
      .toEqual({ aggiornamenti: { canale: 'veloce' } });
  }
  expect(P.buildPreferencePartial('canale veloce', 'no')?.partial).toEqual({ aggiornamenti: { canale: 'stabile' } });
  // Le altre chiavi restano come sono.
  expect(P.buildPreferencePartial('canale stabile', 'sì')?.partial).toEqual({ aggiornamenti: { canale: 'stabile' } });
  expect(P.buildPreferencePartial('canale_aggiornamenti', 'veloce')?.partial).toEqual({ aggiornamenti: { canale: 'veloce' } });
});
