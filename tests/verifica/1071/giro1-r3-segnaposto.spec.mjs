// Verifica #1071 giro 1, rilievo 3: il suggerimento nella casella dell'istruzione della Modifica si legge intero.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, nelMondoDiFilo } from '../../helpers/riquadri.mjs';

test('r3 il segnaposto dell\'istruzione nella Modifica non si tronca alle virgolette', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea></body></html>');
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  const segnaposto = await nelMondoDiFilo(app, page, () => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const el = T ? T.trova('.sn-editbox-instruction') : document.querySelector('.sn-editbox-instruction');
    return el ? el.placeholder : null;
  });
  expect(segnaposto).toContain('rendi più formale');
});
