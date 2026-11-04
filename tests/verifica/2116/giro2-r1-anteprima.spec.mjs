// Verifica #2116 giro 2, rilievo 1: la privacy dice di controllare l'anteprima dello screenshot prima di inviare, ma
// il riquadro del feedback non mostra nessuna anteprima: lo scatto si fa solo all'invio.

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, paginaDelloStrato } from '../../helpers/riquadri.mjs';

test('r1 la privacy non promette un\'anteprima dello screenshot che il riquadro non mostra', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"><title>Notizie</title></head>'
    + '<body><h1>Notizie</h1></body></html>');
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-text').fill('Il tasto non risponde');
  await strato.locator('.sn-fb-clear').click();
  await expect(strato.locator('.sn-fb-clear')).toHaveAttribute('aria-pressed', 'true');
  await new Promise((r) => setTimeout(r, 1500));
  const anteprime = await strato.locator('.sn-fb-modal img, .sn-fb-modal canvas').count();
  const privacy = fs.readFileSync(path.resolve('transparency/privacy.md'), 'utf8');
  expect(anteprime > 0 || !/controlla l'anteprima/.test(privacy),
    'la privacy dice «controlla l\'anteprima prima di inviare», ma col screenshot allegato il riquadro non ne mostra una').toBe(true);
});
