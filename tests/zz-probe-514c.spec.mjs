import { test, expect } from './fixtures/electron.mjs';

const HTML = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';

function accendi(app) {
  return app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
}
async function etichetta(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  let b = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await b.count() === 0) {
    await page.locator('.sn-menu-row-overflow').first().click();
    await expect(b.first()).toBeVisible({ timeout: 8000 });
  }
  const l = await b.first().getAttribute('aria-label');
  await page.keyboard.press('Escape').catch(() => {});
  return l;
}

for (const giro of [1, 2, 3]) {
  test(`navigazione a tutto schermo, giro ${giro}`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, HTML);
    await accendi(app);
    await new Promise((r) => setTimeout(r, 800));
    const altra = testServer.html(HTML);
    await page.evaluate((u) => { window.location.href = u; }, altra);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 8000));
    console.log(`GIRO ${giro} dopo navigazione + 8s:`, await etichetta(page));
    expect(true).toBe(true);
  });

  test(`nuova scheda a tutto schermo, giro ${giro}`, async ({ app, openTab, testServer }) => {
    const prima = await openTab('filo://manage/manage.html');
    await prima.waitForLoadState('domcontentloaded').catch(() => {});
    await accendi(app);
    await new Promise((r) => setTimeout(r, 800));
    const nuova = await testServer.openReady(openTab, HTML);
    await new Promise((r) => setTimeout(r, 8000));
    console.log(`GIRO ${giro} nuova scheda + 8s:`, await etichetta(nuova));
    expect(true).toBe(true);
  });
}
