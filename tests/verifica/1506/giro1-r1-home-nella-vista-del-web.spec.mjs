// Verifica #1506 giro 1, rilievo 1: la home nuda, l'unica pagina di Filo che un sito può ancora chiedere, deve arrivare
// come home vera (vista di Filo), non caricata dentro la vista del sito o della finestrella dove non funziona.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const HOME = 'filo://newtab/';

let rinvii;
test.beforeAll(async () => {
  rinvii = createServer((req, res) => {
    if (req.url.split('?')[0] !== '/home') { res.writeHead(404); res.end(); return; }
    res.writeHead(302, { Location: HOME });
    res.end();
  });
  await new Promise((r) => rinvii.listen(0, '127.0.0.1', r));
});
test.afterAll(async () => { await new Promise((r) => rinvii.close(r)); });

test('r1 un rinvio del server verso la home la apre come home vera di Filo, che risponde', async ({ app, openTab, testServer }) => {
  const rinvio = `http://127.0.0.1:${rinvii.address().port}/home`;
  const sito = testServer.html(`<title>Va a casa</title><script>setTimeout(function(){ location.href = ${JSON.stringify(rinvio)}; }, 200)</script>`);
  await openTab(sito);
  const scheda = () => app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === u.id) || tm.tabs[tm.tabs.length - 1];
    let api = '';
    try { api = await t.view.webContents.executeJavaScript('typeof (window.chrome && chrome.runtime && chrome.runtime.sendMessage)'); } catch (_) {}
    return { id: t.id, vista: t.view.webContents.getURL(), interna: t.isInternal, api };
  }, {});
  await expect.poll(async () => (await scheda()).vista, { timeout: 8000 }).toBe(HOME);
  await new Promise((r) => setTimeout(r, 1000));
  const t = await scheda();
  expect(t.interna, 'la scheda della home è una scheda di Filo').toBe(true);
  expect(t.api, 'la home ha i servizi di Filo (la chat, le carte)').toBe('function');
});
