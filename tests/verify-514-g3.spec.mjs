// #514, secondo giro di porte: la deroga "l'Esc è della pagina" sopravvive
// alla pagina? (navigazione, ricarica, crash del renderer)
import { test, expect } from './fixtures/electron.mjs';

const SITO_FS = '<html><body><button id="b" style="width:300px;height:120px">fs</button>'
  + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>';

async function stato(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    return { cf: !!t.contentFullscreen, pf: !!t.pageFullscreen, pfTab: t.pageFullscreenTabId, activeId: t.activeId };
  });
}
async function esc(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
}
async function attendiUscita(app, ms = 5000) {
  const fine = Date.now() + ms;
  let s = await stato(app);
  while (Date.now() < fine && s.cf) { await new Promise((r) => setTimeout(r, 100)); s = await stato(app); }
  return s;
}

test('porta 13 — il sito va a schermo pieno e poi NAVIGA altrove: Esc funziona ancora', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  const altra = testServer.html('<html><body><h1>altra pagina</h1></body></html>');
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).cf).toBe(true);

  await page.evaluate((u) => { window.location.href = u; }, altra);
  await new Promise((r) => setTimeout(r, 2500));
  const dopoNav = await stato(app);
  console.log('DOPO NAVIGAZIONE', JSON.stringify(dopoNav));

  await esc(app);
  const s = await attendiUscita(app);
  expect(s.cf, 'dopo la navigazione Esc deve far uscire dallo schermo intero').toBe(false);
});

test('porta 14 — il sito va a schermo pieno e poi RICARICA: Esc funziona ancora', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).cf).toBe(true);

  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.tabs.find((x) => x.id === t.activeId).view.webContents.reload();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const dopo = await stato(app);
  console.log('DOPO RICARICA', JSON.stringify(dopo));

  await esc(app);
  const s = await attendiUscita(app);
  expect(s.cf, 'dopo la ricarica Esc deve far uscire dallo schermo intero').toBe(false);
});

test('porta 15 — a schermo intero di Filo il sito chiede il suo schermo pieno: Esc non lascia nulla appeso', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  // prima lo schermo intero di Filo (menu tasto destro), poi quello del sito
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  const dentro = await stato(app);
  console.log('DENTRO DUE VOLTE', JSON.stringify(dentro));
  await esc(app);
  const s = await attendiUscita(app, 6000);
  console.log('DOPO ESC', JSON.stringify(s));
  expect(s.cf).toBe(false);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
