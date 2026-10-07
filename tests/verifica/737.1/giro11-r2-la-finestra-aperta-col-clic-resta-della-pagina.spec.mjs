// #737.1 giro 11: la finestra che il clic dell'utente apre resta in mano alla pagina che l'ha chiesta (la riempie, la
// porta dove serve). Oggi la pagina riceve niente e resta una scheda bianca.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return [t.view.webContents.getURL(), t.view.webContents.getTitle()]; } catch (_) { return [t.url || '', '']; } });
});

test('r2 «Stampa ricevuta»: la finestra vuota che la pagina apre col clic e riempie mostra la ricevuta', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px">Stampa ricevuta</button>
    <script>document.getElementById('b').onclick=function(){var w=window.open('');
    w.document.write('<title>RICEVUTA</title><h1>Ricevuta</h1>');w.document.close();}</script>`));
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some(([, t]) => t === 'RICEVUTA'), { timeout: 8000 }).toBe(true);
  expect((await schede(app)).filter(([u]) => u === 'about:blank' || u === '').length, 'nessuna scheda bianca').toBe(0);
});

test('r2 la finestra aperta col clic e portata dopo una risposta all\'indirizzo giusto arriva lì', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>REPORT</title>');
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px">Apri il report</button>
    <script>document.getElementById('b').onclick=function(){var w=window.open('');setTimeout(function(){w.location=${JSON.stringify(dest)}},800)}</script>`));
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some(([u]) => u === dest), { timeout: 8000 }).toBe(true);
});
