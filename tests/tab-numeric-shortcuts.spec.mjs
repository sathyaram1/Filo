// Scorciatoie numeriche per le tab (#feedback scorciatoie numeriche).
//
// Alt+1…9 porta alla N-esima tab, Alt+0 alla decima. Usiamo Alt (non Ctrl/Cmd)
// così la combinazione funziona anche MENTRE si scrive in una pagina — Alt+cifra
// non produce testo — e non ruba il Ctrl/Cmd+numero del browser. L'intercettazione
// avviene sia a livello shell (focus sulla barra) sia per-pagina nel main
// (before-input-event), così vale ovunque.

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

  // Dalla pagina attiva premo Alt+1 → vado alla PRIMA tab.
  await page3.bringToFront();
  await page3.keyboard.press('Alt+1');
  await expect.poll(() => tabsInfo(app).then((i) => i.activeId), { timeout: 10_000 })
    .toBe(before.ids[0]);

  // Alt+3 → terza tab. (La pagina ora attiva è la prima.)
  const first = app.windows ? null : null; // no-op, leggibilità
  // Premo sulla shell-side via la pagina attualmente attiva, qualunque sia.
  const active1 = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    try { t.view.webContents.focus(); } catch (_) {}
    return t.url;
  });
  expect(active1).toBeTruthy();
  // Invio Alt+3 alla webContents attiva tramite un input sintetico nel main.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: '3', modifiers: ['alt'] });
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
