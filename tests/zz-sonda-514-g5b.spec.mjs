// Sonda usa e getta (giro 5, #514): altre porte della stessa famiglia.
import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">parola</p></body></html>';

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

test('editor: menu del tasto destro sul titolo', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForTimeout(1500);
  await page.locator('#docbar').click({ button: 'right' });
  await page.waitForTimeout(300);
  const prima = await page.evaluate(() => !!document.querySelector('.ed-title-ctxmenu'));
  await entra(app);
  await esc(app);
  const dopo = await page.evaluate(() => !!document.querySelector('.ed-title-ctxmenu'));
  const st = await stato(app);
  console.log('EDITOR-TITOLO aperto prima:', prima, '| ancora aperto:', dopo, '| schermo intero:', st.cf);
  expect({ prima, dopo, cf: st.cf }).toEqual({ prima: true, dopo: false, cf: true });
});

test('mazzi: elenco dei mazzi aperto dal titolo', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForTimeout(2000);
  await page.click('#deckName').catch(() => {});
  await page.waitForTimeout(500);
  const prima = await page.evaluate(() => !!document.querySelector('.dk-switcher'));
  await entra(app);
  await esc(app);
  const dopo = await page.evaluate(() => !!document.querySelector('.dk-switcher'));
  const st = await stato(app);
  console.log('MAZZI-SWITCHER aperto prima:', prima, '| ancora aperto:', dopo, '| schermo intero:', st.cf);
  expect({ prima, dopo, cf: st.cf }).toEqual({ prima: true, dopo: false, cf: true });
});

test('sito: immagine ingrandita dentro il riquadro di segnalazione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => !!window.SN_FEEDBACK_UI, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.waitForSelector('.sn-fb-overlay', { timeout: 8000 });
  // Uno screenshot allegato, poi lo si guarda grande.
  await page.evaluate(() => {
    const root = document.querySelector('.sn-fb-overlay');
    const lb = document.createElement('div');
    lb.className = 'sn-fb-lightbox';
    const im = document.createElement('img');
    im.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    lb.appendChild(im);
    root.appendChild(lb);
  });
  const prima = await page.evaluate(() => !!document.querySelector('.sn-fb-lightbox'));
  await entra(app);
  await esc(app);
  const dopo = await page.evaluate(() => !!document.querySelector('.sn-fb-lightbox'));
  const st = await stato(app);
  console.log('SEGNALAZIONE-IMMAGINE aperta prima:', prima, '| ancora aperta:', dopo, '| schermo intero:', st.cf);
  expect({ prima, dopo, cf: st.cf }).toEqual({ prima: true, dopo: false, cf: true });
});
