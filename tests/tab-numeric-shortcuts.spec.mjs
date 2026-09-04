// Scorciatoie numeriche per le tab (#feedback scorciatoie numeriche).
//
// Alt+1…9 porta alla N-esima tab, Alt+0 alla decima. Usiamo Alt (non Ctrl)
// così la combinazione funziona anche MENTRE si scrive in una pagina — Alt+cifra
// non produce testo — e non ruba il Ctrl+numero del browser. L'intercettazione
// avviene sia a livello shell (focus sulla barra) sia per-pagina nel main
// (before-input-event), così vale ovunque.
//
// Su Mac la combinazione è un'altra (Cmd+cifra: lì Opzione+cifra SCRIVE), e la
// decide `src/shared/tasti.js`. Questi due test girano su Windows/Linux; il caso
// Mac lo copre `tests/unit/macSupport.test.mjs`, che interroga la stessa regola
// dichiarando il sistema.

import { test, expect } from './fixtures/electron.mjs';

function tabsInfo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tabs = w._filoTabs;
    return { ids: tabs.tabs.map((t) => t.id), activeId: tabs.activeId };
  });
}

test('Alt+numero porta alla tab corrispondente (da una pagina web)', async ({ app, openTab, testServer }) => {
  // Apri tre tab web; l'ultima resta attiva.
  await openTab(testServer.html('<title>UNO</title><h1 id="ok">1</h1>'));
  await openTab(testServer.html('<title>DUE</title><h1 id="ok">2</h1>'));
  const page3 = await openTab(testServer.html('<title>TRE</title><h1 id="ok">3</h1>'));
  await page3.waitForSelector('#ok');

  const before = await tabsInfo(app);
  expect(before.ids.length).toBeGreaterThanOrEqual(3);
  // L'ultima tab aperta è attiva; non è già la prima (altrimenti il test è muto).
  expect(before.activeId).not.toBe(before.ids[0]);

  // Alt+1 mentre il focus è in una pagina → vado alla PRIMA tab. (Alt+cifra non
  // produce testo: funziona anche mentre si scrive.) Inietto l'evento sulla
  // webContents della tab attiva: esercita il before-input-event nel main —
  // lo stesso cammino del tasto reale, ma deterministico in headless.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['alt'] });
  });
  await expect.poll(() => tabsInfo(app).then((i) => i.activeId), { timeout: 10_000 })
    .toBe(before.ids[0]);

  // Alt+3 → terza tab.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: '3', modifiers: ['alt'] });
  });
  await expect.poll(() => tabsInfo(app).then((i) => i.activeId), { timeout: 10_000 })
    .toBe(before.ids[2]);
});

test('Alt+numero dal focus sulla barra (shell) cambia tab', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>A</title><h1 id="ok">a</h1>'));
  const pageB = await openTab(testServer.html('<title>B</title><h1 id="ok">b</h1>'));
  await pageB.waitForSelector('#ok');
  const before = await tabsInfo(app);

  // Dispatcho un keydown reale a livello shell (focus sulla barra di Filo).
  await shell.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: '1', code: 'Digit1', altKey: true, bubbles: true, cancelable: true,
    }));
  });
  await expect.poll(() => tabsInfo(app).then((i) => i.activeId), { timeout: 10_000 })
    .toBe(before.ids[0]);
});
