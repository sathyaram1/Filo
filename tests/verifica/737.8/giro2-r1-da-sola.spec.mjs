// #737.8 giro 2: la finestra tenuta dalla pagina che si porta davanti da sola non ruba la scheda al clic sulla pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } };
  const attiva = tm.tabs.find((t) => t.id === tm.activeId);
  return { attiva: attiva ? url(attiva) : '', schede: tm.tabs.map(url), attivaId: tm.activeId, ids: tm.tabs.map((t) => t.id) };
});

const torna = async (app, shell, page) => {
  const s = await stato(app);
  const id = s.ids[s.schede.findIndex((u) => u === page.url())];
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
  await expect.poll(async () => (await stato(app)).attiva).toBe(page.url());
  await page.waitForTimeout(400);
};

test('r1 la chat che si riporta davanti da sola non porta via dalla pagina quando ci si clicca sopra il testo', async ({ app, shell, openTab, testServer }) => {
  const chat = testServer.html('<title>CHAT</title><script>setTimeout(function(){setInterval(function(){window.focus()},150)},4000)</script>');
  const page = await openTab(testServer.html(`<button id="a" style="height:40px" onclick="window.open(${JSON.stringify(chat).replace(/"/g, '&quot;')},'chat')">chat</button>
    <p id="testo" style="height:200px">Un articolo da leggere, con del testo su cui si clicca.</p>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(chat);
  await torna(app, shell, page);
  await page.waitForTimeout(5500);
  await page.click('#testo');
  await page.waitForTimeout(2000);
  expect((await stato(app)).attiva, 'un clic sul testo della pagina non cambia scheda').toBe(page.url());
});
