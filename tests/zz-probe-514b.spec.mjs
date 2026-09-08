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
  return b.first().getAttribute('aria-label');
}

test('probe A — scheda NUOVA aperta a tutto schermo, con attesa lunga', async ({ app, openTab, testServer }) => {
  const prima = await openTab('filo://manage/manage.html');
  await prima.waitForLoadState('domcontentloaded').catch(() => {});
  await accendi(app);
  await new Promise((r) => setTimeout(r, 600));
  const nuova = await testServer.openReady(openTab, HTML);
  await new Promise((r) => setTimeout(r, 4000)); // molto più di una corsa stretta
  console.log('ETICHETTA scheda nuova:', await etichetta(nuova));
  expect(true).toBe(true);
});

test('probe B — la scheda che NAVIGA mentre si è a tutto schermo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await accendi(app);
  await new Promise((r) => setTimeout(r, 600));
  console.log('ETICHETTA prima di navigare:', await etichetta(page));
  await page.keyboard.press('Escape'); // chiude il menu
  const altra = testServer.html(HTML);
  await page.evaluate((u) => { window.location.href = u; }, altra);
  await new Promise((r) => setTimeout(r, 4000));
  console.log('ETICHETTA dopo la navigazione:', await etichetta(page));
  expect(true).toBe(true);
});

test('probe C — la scheda che RICARICA mentre si è a tutto schermo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await accendi(app);
  await new Promise((r) => setTimeout(r, 600));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 4000));
  console.log('ETICHETTA dopo la ricarica:', await etichetta(page));
  expect(true).toBe(true);
});
