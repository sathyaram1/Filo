// #870 giro 3, rilievo 3: aprire nel filo due volte lo stesso avviso non scrive due volte la stessa frase di Filo.
import { test, expect } from '../../fixtures/electron.mjs';

test('due clic sullo stesso avviso: una bolla sola', async ({ app }) => {
  test.setTimeout(45_000);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }, { timeout: 15_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il backup delle foto è finito.' }); });
  await page.reload();
  const avviso = page.locator('#accade .dash-carta[data-tipo="avviso"]');
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await avviso.click({ position: { x: 30, y: 12 } });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'backup delle foto' })).toHaveCount(1);
  await avviso.click({ position: { x: 30, y: 12 } });
  await page.waitForTimeout(500);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'backup delle foto' })).toHaveCount(1);
});
