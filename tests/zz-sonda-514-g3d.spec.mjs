// Sonda avversariale #514 (giro 2, parte d) — usa e getta.
import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:2000px"><p id="t">ciao</p></body></html>';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 800));
}
async function chiudiMenu(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.sn-menu').forEach((m) => m.remove());
  });
}
async function voce(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  let v = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await v.count() === 0) {
    await page.locator('.sn-menu-row-overflow').first().click();
    await expect(v.first()).toBeVisible({ timeout: 8000 });
  }
  return v.first();
}

test('uscito con la voce del menu, il menu riaperto dice di nuovo «Schermo intero»', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, true);
  const b = await voce(page);
  console.log('SONDA D — dentro →', await b.getAttribute('aria-label'));
  await b.click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 800));
  const aperti = await page.locator('.sn-menu').count();
  console.log('SONDA D — menu rimasti aperti dopo il clic sulla voce:', aperti);
  await chiudiMenu(page);
  const b2 = await voce(page);
  const dopo = await b2.getAttribute('aria-label');
  console.log('SONDA D — riaperto dopo l\'uscita →', dopo);
  expect(dopo).toMatch(/^schermo intero$/i);
});

test('menu aperto a schermo intero, spento da fuori: riaperto dice il vero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, true);
  const b = await voce(page);
  console.log('SONDA D2 — dentro →', await b.getAttribute('aria-label'));
  await chiudiMenu(page);
  await setFs(app, false);
  await new Promise((r) => setTimeout(r, 800));
  const b2 = await voce(page);
  const dopo = await b2.getAttribute('aria-label');
  console.log('SONDA D2 — riaperto dopo lo spegnimento →', dopo);
  expect(dopo).toMatch(/^schermo intero$/i);
});
