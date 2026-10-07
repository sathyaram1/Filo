import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

async function seed(app, entries) {
  await app.evaluate(async (_e, list) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const entry of list) {
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }, { url: 'filo://security/security.html' });
    }
  }, entries.map((t) => ({ type: 'text', text: t })));
}

test('esplora: sicurezza con permessi, visite e cronologia appunti', async ({ app, openTab }) => {
  await seed(app, ['uno-alfa', 'due-beta', 'tre-gamma']);
  const page = await openTab('filo://security/');
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3, { timeout: 8000 });
  await expect(page.locator('#sec-visite-title')).not.toBeEmpty();
  await expect(page.locator('#sec-visite-tutto')).not.toBeEmpty();
  await expect(page.locator('#sec-site-perms')).toBeAttached();
  await page.locator('#sec-site-perms').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/verifica/256/.out-sicurezza.png', fullPage: true });
  // live: seme mentre aperta
  await seed(app, ['quattro-delta']);
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(4, { timeout: 8000 });
  // rimozione da tastiera
  const rm = page.locator('#sec-clip-list .sn-clip-item', { hasText: 'due-beta' }).locator('.sn-clip-remove');
  await rm.focus();
  await page.keyboard.press('Enter');
  await page.mouse.move(2, 2);
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3, { timeout: 8000 });
  const fuoco = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  console.log('FUOCO', fuoco);
  // svuota
  await page.locator('#sec-clip-clear').click();
  await clickConfirm(page);
  await expect(page.locator('#sec-clip-empty')).toBeVisible({ timeout: 8000 });
  const st = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    return (await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_CLIPBOARD_HISTORY }, { url: 'filo://security/security.html' })).items.length;
  });
  expect(st).toBe(0);
  console.log('ERRORI', JSON.stringify(errori));
});
