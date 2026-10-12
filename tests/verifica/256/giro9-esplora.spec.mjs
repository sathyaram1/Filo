import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { apriCronologia, statoCronologia } from '../../helpers/cronologiaAppunti.mjs';

async function seed(app, entries) {
  await app.evaluate(async (_e, list) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const entry of list) {
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }, { url: 'filo://security/security.html' });
    }
  }, entries.map((e) => (typeof e === 'string' ? { type: 'text', text: e } : e)));
}
async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_CLIPBOARD_HISTORY }, { url: 'filo://security/security.html' });
    return (res.items || []).map((e) => e.text);
  });
}

const HTMLX = '<img src=x onerror="document.title=\'PWN\'"><b>grassetto</b>';
const LONG = 'L'.repeat(5000);

test('pagina sicurezza: tema scuro, html, lungo, emoji, clic rimette negli appunti', async ({ app, shell, openTab }) => {
  await seed(app, [HTMLX, LONG, 'emoji 😀👍🏽 ok', '   ', 'password-xyz']);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  const page = await openTab('filo://security/');
  const list = page.locator('#sec-clip-list');
  await expect(list.locator('.sn-clip-item')).toHaveCount(5, { timeout: 8000 });
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await page.locator('#sec-clipboard').scrollIntoViewIfNeeded();
  await page.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/v256-dark.png' });
  await page.screenshot({ path: 'tests/.shots/v256-dark-full.png', fullPage: false });
  expect(await page.title()).not.toBe('PWN');
  await expect(list.locator('img[src="x"]')).toHaveCount(0);
  const row = list.locator('.sn-clip-item', { hasText: 'password-xyz' });
  const box = await row.boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('password-xyz');
  // svuota: testo della conferma senza ricerca
  await page.mouse.move(2, 2);
  await page.locator('#sec-clip-clear').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  const testo = await page.locator(CONFIRM_HOST).evaluate((h) => (h.shadowRoot ? h.shadowRoot.textContent : h.textContent));
  console.log('CONFERMA PAGINA:', testo);
  await page.screenshot({ path: 'tests/.shots/v256-dark-confirm.png' });
  await clickConfirm(page);
  await expect.poll(() => stored(app)).toEqual([]);
  await expect(page.locator('#sec-clip-empty')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/v256-dark-empty.png' });
});

test('menu incolla: x, conferma svuota senza ricerca, html come testo', async ({ app, testServer, openTab }) => {
  await seed(app, [HTMLX, 'secondo', 'password-abc']);
  const url = testServer.html('<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  let st = await apriCronologia(app, page, '#ta');
  console.log('VOCI MENU:', JSON.stringify(st.voci.map((v) => v.testo)));
  expect(await page.title()).not.toBe('PWN');
  await page.screenshot({ path: 'tests/.shots/v256-menu.png' });
  const pw = st.voci.find((v) => v.testo.includes('password-abc'));
  await page.mouse.click(pw.rimuovi.x, pw.rimuovi.y);
  await expect.poll(() => stored(app)).not.toContain('password-abc');
  st = await statoCronologia(app, page);
  await page.mouse.click(st.svuota.x, st.svuota.y);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/v256-menu-confirm.png' });
  await clickConfirm(page);
  await expect.poll(() => stored(app)).toEqual([]);
});
