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

const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=x';
test('r1 la finestrella di accesso non mostra la home di Filo dentro la vista del sito', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ session, net }, html) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.hostname === 'accounts.google.com') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, `<title>Accedi</title><h1>Accesso</h1><script>setTimeout(function(){ location.href = ${JSON.stringify(HOME)}; }, 200);</script>`);
  const page = await testServer.openReady(openTab, `<title>Negozio</title><button id="b" style="width:220px;height:60px"
  onclick="window.open(${JSON.stringify(GOOGLE).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi con…</button>`);
  await page.click('#b');
  const finestrella = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w._filoTabs && !w.isDestroyed() && w.webContents._filoFinestrella)
    .map((w) => w.webContents.getURL()));
  await expect.poll(() => finestrella(app), { timeout: 8000 }).not.toEqual([]);
  await new Promise((r) => setTimeout(r, 2000));
  expect(await finestrella(app), 'la finestrella non arriva sulla home di Filo').not.toContain(HOME);
});
