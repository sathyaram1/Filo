// #404 — Scorciatoie "da browser" Ctrl/Cmd+T/W/L/R MENTRE si naviga un sito.
//
// Bug: queste scorciatoie erano gestite SOLO nel keydown della shell
// (src/renderer/shell.js), che non riceve eventi quando il focus è dentro una
// pagina (WebContentsView). Risultato: dalla pagina (il caso più comune) non
// facevano nulla. Il fix aggiunge Ctrl/Cmd+T/W/L/R al before-input-event
// per-pagina nel main (come già fatto per Alt+cifra), così valgono ovunque.
//
// Ogni test ASSERISCE il successo dell'azione (nuova tab creata, tab chiusa,
// navigazione alla home, reload) iniettando l'evento sulla webContents della
// tab attiva — lo stesso cammino del tasto reale, deterministico in headless.
// Senza il fix ognuno di questi assert è ROSSO: la scorciatoia non ha effetto.

import { test, expect } from './fixtures/electron.mjs';

function tabsInfo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs;
    const active = t.tabs.find((x) => x.id === t.activeId) || null;
    return { ids: t.tabs.map((x) => x.id), count: t.tabs.length, activeId: t.activeId, activeUrl: active ? active.url : null };
  });
}

// Inietta una combinazione Ctrl+<lettera> sulla webContents della tab ATTIVA
// (dove il focus starebbe navigando la pagina), esercitando il before-input-event.
function pressCtrlKey(app, keyCode) {
  return app.evaluate(({ BrowserWindow }, kc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: ['control'] });
  }, keyCode);
}

test('Ctrl+T da una pagina web apre una nuova scheda', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">x</h1>'));
  await page.waitForSelector('#ok');
  const before = await tabsInfo(app);

  await pressCtrlKey(app, 'T');

  await expect.poll(() => tabsInfo(app).then((i) => i.count), { timeout: 10_000 })
    .toBe(before.count + 1);
  // La nuova scheda è la home di Filo ed è attiva.
  const after = await tabsInfo(app);
  expect(after.activeUrl).toContain('filo://newtab/');
});

test('Ctrl+W da una pagina web chiude la scheda corrente', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<title>UNO</title><h1 id="ok">1</h1>'));
  const page2 = await openTab(testServer.html('<title>DUE</title><h1 id="ok">2</h1>'));
  await page2.waitForSelector('#ok');
  const before = await tabsInfo(app);
  const closingId = before.activeId;
  expect(before.count).toBeGreaterThanOrEqual(2);

  await pressCtrlKey(app, 'W');

  await expect.poll(() => tabsInfo(app).then((i) => i.ids.includes(closingId)), { timeout: 10_000 })
    .toBe(false);
  const after = await tabsInfo(app);
  expect(after.count).toBe(before.count - 1);
});

test('Ctrl+L da una pagina web apre la home (dove si digita l\'indirizzo)', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">x</h1>'));
  await page.waitForSelector('#ok');
  const before = await tabsInfo(app);
  expect(before.activeUrl).not.toContain('filo://newtab/');
  const sameTab = before.activeId;

  await pressCtrlKey(app, 'L');

  // Stessa scheda, ora sulla home di Filo (il punto dove si scrive un indirizzo).
  await expect.poll(() => tabsInfo(app).then((i) => i.activeUrl), { timeout: 10_000 })
    .toContain('filo://newtab/');
  const after = await tabsInfo(app);
  expect(after.activeId).toBe(sameTab);
});

test('Ctrl+R da una pagina web ricarica la scheda', async ({ app, openTab, testServer }) => {
  // La pagina conta i caricamenti in un contatore in sessionStorage e lo mostra:
  // dopo un reload il valore visibile passa da 1 a 2. Senza reload resta 1.
  const html = `<title>RIC</title><script>
    const n = (Number(sessionStorage.getItem('loads')) || 0) + 1;
    sessionStorage.setItem('loads', String(n));
    addEventListener('DOMContentLoaded', () => { document.body.innerHTML = '<h1 id="loads">' + n + '</h1>'; });
  </script>`;
  const page = await openTab(testServer.html(html));
  await expect(page.locator('#loads')).toHaveText('1');

  await pressCtrlKey(app, 'R');

  // Dopo il reload la stessa Page si ricarica: il contatore diventa 2.
  await expect(page.locator('#loads')).toHaveText('2', { timeout: 10_000 });
});
