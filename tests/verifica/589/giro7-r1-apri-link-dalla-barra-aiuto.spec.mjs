// Verifica #589 — giro 7: la barra d'aiuto aperta su un sito deve ancora aprire un
// link in una nuova scheda quando l'agente lo chiede («apri quel link»): è
// un'azione della barra, non una richiesta del sito.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;

const nelContentScript = (app, host, codice) => app.evaluate(async ({ BrowserWindow }, { h, codice, mondo }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
  return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
}, { h: host, codice, mondo: MONDO_CONTENT_SCRIPT });

const indirizziAperti = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  return win._filoTabs.tabs.map((t) => String(t.url || ''));
});

test('dalla barra d\'aiuto di un sito «apri il link in una nuova scheda» apre davvero la scheda', async ({ app, openTab, testServer }) => {
  const destinazione = testServer.html('<h1>pagina di destinazione</h1>');
  const web = await testServer.openReady(openTab, `<h1>sito</h1><a id="l" href="${destinazione}">vai</a>`);
  const host = new URL(web.url()).host;

  const esito = await nelContentScript(app, host,
    `globalThis.__filoSidebarTest.runPageAction({ op: 'open_link', selector: '#l' })`);

  await expect.poll(() => indirizziAperti(app), { timeout: 8000 }).toContain(destinazione);
  expect(esito, 'la barra d\'aiuto scrive «apri link in nuova scheda: non riuscita»').toBe(true);
});
