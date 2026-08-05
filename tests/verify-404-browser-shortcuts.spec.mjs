// VERIFIER #404 — spec indipendente (black-box dal sintomo utente).
// Sintomo: mentre il focus è DENTRO una pagina web, Ctrl+T/W/L/R non fanno
// nulla; funzionano solo col focus sulla barra delle schede. Verifico che ora
// abbiano effetto reale iniettando l'evento sulla webContents della pagina
// attiva (stesso cammino di un tasto reale, deterministico in headless).

import { test, expect } from './fixtures/electron.mjs';

function tabsInfo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tabs = w._filoTabs;
    return {
      ids: tabs.tabs.map((t) => t.id),
      activeId: tabs.activeId,
      urls: tabs.tabs.map((t) => (t.view && t.view.webContents ? t.view.webContents.getURL() : null)),
    };
  });
}

// Inietta un keyDown sulla webContents della tab ATTIVA (dove è il focus utente).
function pressOnActive(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers });
}

test('Ctrl+T da una pagina web apre una nuova scheda', async ({ openTab, app, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">ciao</h1>'));
  await page.waitForSelector('#ok');
  // Simula il focus reale dentro la pagina: clic dentro il body.
  await page.click('#ok');
  const before = await tabsInfo(app);

  await pressOnActive(app, 't', ['control']);

  await expect.poll(() => tabsInfo(app).then((i) => i.ids.length), { timeout: 10_000 })
    .toBe(before.ids.length + 1);
  const after = await tabsInfo(app);
  // La nuova scheda è la newtab di Filo e diventa attiva.
  const newId = after.ids.find((id) => !before.ids.includes(id));
  expect(newId).toBeTruthy();
  expect(after.activeId).toBe(newId);
});

test('Ctrl+W da una pagina web chiude la scheda che guardi', async ({ openTab, app, testServer }) => {
  await openTab(testServer.html('<title>A</title><h1 id="ok">a</h1>'));
  const pageB = await openTab(testServer.html('<title>B</title><h1 id="ok">b</h1>'));
  await pageB.waitForSelector('#ok');
  await pageB.click('#ok');
  const before = await tabsInfo(app);
  const activeBefore = before.activeId;

  await pressOnActive(app, 'w', ['control']);

  await expect.poll(() => tabsInfo(app).then((i) => i.ids.length), { timeout: 10_000 })
    .toBe(before.ids.length - 1);
  const after = await tabsInfo(app);
  // La scheda attiva (quella guardata) è quella sparita.
  expect(after.ids).not.toContain(activeBefore);
});

test('Ctrl+L da una pagina web porta alla home (dove si scrive l’indirizzo)', async ({ openTab, app, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">ciao</h1>'));
  await page.waitForSelector('#ok');
  await page.click('#ok');
  const before = await tabsInfo(app);
  const activeId = before.activeId;

  await pressOnActive(app, 'l', ['control']);

  // La STESSA scheda naviga verso la home interna (non si apre una scheda nuova).
  await expect.poll(async () => {
    const i = await tabsInfo(app);
    const url = i.urls[i.ids.indexOf(activeId)] || '';
    return url;
  }, { timeout: 10_000 }).toContain('filo://newtab');
  const after = await tabsInfo(app);
  expect(after.ids.length).toBe(before.ids.length); // nessuna scheda in più
});

test('Ctrl+R da una pagina web ricarica davvero la pagina', async ({ openTab, app, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">ciao</h1>'));
  await page.waitForSelector('#ok');
  await page.click('#ok');
  // Marca lo stato in-memory della pagina: un reload vero lo cancella.
  await page.evaluate(() => { window.__notReloaded = true; });
  expect(await page.evaluate(() => window.__notReloaded === true)).toBe(true);

  await pressOnActive(app, 'r', ['control']);

  // Dopo il reload la pagina ricarica il documento: il marker sparisce.
  await expect.poll(() => page.evaluate(() => window.__notReloaded === true).catch(() => 'nav'), { timeout: 10_000 })
    .not.toBe(true);
  await page.waitForSelector('#ok');
});

test('Ctrl+Alt+T (AltGr) NON viene scambiato per la scorciatoia', async ({ openTab, app, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">ciao</h1>'));
  await page.waitForSelector('#ok');
  await page.click('#ok');
  const before = await tabsInfo(app);

  // AltGr = Ctrl+Alt: su layout europei serve a digitare @ # ecc, NON deve aprire tab.
  await pressOnActive(app, 't', ['control', 'alt']);

  // Diamo tempo a un'eventuale (errata) apertura di manifestarsi.
  await new Promise((r) => setTimeout(r, 800));
  const after = await tabsInfo(app);
  expect(after.ids.length).toBe(before.ids.length);
});
