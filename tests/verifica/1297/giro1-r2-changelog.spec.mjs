// Verifica #1297, giro 1: r2, la novità per chi aggiorna.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('r2 il blocco in cima alle novità racconta l’intervista di benvenuto rifatta, ripresa e dimenticata', () => {
  const sandbox = {};
  vm.runInNewContext(readFileSync('src/shared/patchNotes.js', 'utf8'), sandbox);
  const top = sandbox.SN_PATCH_NOTES.NOTES[0];
  const righe = [...(top.features || []), ...(top.fixes || [])].join('\n');
  expect(righe).toMatch(/Riprendiamola|×|intervista di benvenuto.*(scheda|riprend|togli)/i);
});
