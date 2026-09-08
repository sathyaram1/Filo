// Sonda usa e getta (giro 5, #514): archivio e mazzi.
import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Archiviato</title></head>
<body style="margin:0"><div style="height:600px">contenuto</div></body></html>`;

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}
async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

test('cronologia: menu del tasto destro su una scheda archiviata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);
  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archiviato' });
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.click({ button: 'right' });
  await archive.waitForTimeout(300);
  const prima = await archive.evaluate(() => !!document.querySelector('.arc-ctxmenu'));
  await entra(app);
  await esc(app);
  const dopo = await archive.evaluate(() => !!document.querySelector('.arc-ctxmenu'));
  const st = await stato(app);
  console.log('CRONOLOGIA-MENU prima:', prima, '| ancora aperto:', dopo, '| schermo intero:', st.cf);
  expect({ prima, dopo, cf: st.cf }).toEqual({ prima: true, dopo: false, cf: true });
});

test('mazzi: elenco dei mazzi aperto dal titolo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await page.locator('#deckName').click({ timeout: 10000 }).catch((e) => console.log('click deckName:', e.message));
  await page.waitForTimeout(800);
  const prima = await page.evaluate(() => !!document.querySelector('.dk-switcher'));
  if (!prima) {
    console.log('MAZZI-SWITCHER non aperto, html:', (await page.evaluate(() => document.body.innerHTML)).slice(0, 400));
  }
  await entra(app);
  await esc(app);
  const dopo = await page.evaluate(() => !!document.querySelector('.dk-switcher'));
  const st = await stato(app);
  console.log('MAZZI-SWITCHER prima:', prima, '| ancora aperto:', dopo, '| schermo intero:', st.cf);
  expect({ prima, dopo, cf: st.cf }).toEqual({ prima: true, dopo: false, cf: true });
});
