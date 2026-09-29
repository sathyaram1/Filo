// Verifica #839 giro 3, rilievo 2 — con la finestra in incognito davanti, Alt+S salva e chiude la pagina di QUELLA finestra.
// Rossa senza la cura: la scorciatoia va sempre alla finestra normale, che sta dietro.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body><h1>${t}</h1></body></html>`;

test('Alt+S con la finestra in incognito davanti agisce su quella', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60000);
  await testServer.openReady(openTab, PAGINA('Finestra normale'));
  const urlInc = testServer.html(PAGINA('In incognito'));
  await app.evaluate(({ BrowserWindow }) => { globalThis.__finestraPrincipale = BrowserWindow.getAllWindows().find((w) => w._filoTabs); });
  await shell.evaluate(() => window.filoShell.message({ type: 'open_incognito' }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs).length), { timeout: 8000 }).toBe(2);
  await app.evaluate(({ BrowserWindow }, u) => {
    const inc = BrowserWindow.getAllWindows().find((w) => w._filoTabs && w !== globalThis.__finestraPrincipale);
    inc._filoTabs.openTab(u);
    inc.show(); inc.focus();
  }, urlInc);
  await new Promise((r) => setTimeout(r, 3000));
  const titoli = () => app.evaluate(({ BrowserWindow }) => {
    const main = globalThis.__finestraPrincipale;
    const inc = BrowserWindow.getAllWindows().find((w) => w._filoTabs && w !== main);
    return { normale: main._filoTabs.tabs.map((t) => t.title), incognito: inc._filoTabs.tabs.map((t) => t.title) };
  });
  expect((await titoli()).incognito).toContain('In incognito');
  // Il tasto registrato per tutto il sistema chiama dispatch con la finestra principale.
  await app.evaluate(() => { globalThis.__filoShortcuts.dispatch('save-for-later', globalThis.__finestraPrincipale); });
  await new Promise((r) => setTimeout(r, 6000));
  const dopo = await titoli();
  expect(dopo.normale, 'Alt+S ha chiuso la pagina della finestra normale, che l’utente non stava guardando').toContain('Finestra normale');
  expect(dopo.incognito, 'la pagina in incognito davanti all’utente doveva essere quella salvata e chiusa').not.toContain('In incognito');
});
