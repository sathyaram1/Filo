// Verifica #1506 giro 2: porte del confine siti/pagine di Filo che lo spec del lavoro non prova.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const ERRORE = 'filo://error/error.html?url=https%3A%2F%2Fbanca.example%2F&code=-105&desc=Chiama+il+numero+verde';

let rinvii;
test.beforeAll(async () => {
  rinvii = createServer((req, res) => {
    const verso = { '/errore': ERRORE, '/opzioni': OPZIONI }[req.url.split('?')[0]];
    if (!verso) { res.writeHead(404); res.end(); return; }
    res.writeHead(302, { Location: verso });
    res.end();
  });
  await new Promise((r) => rinvii.listen(0, '127.0.0.1', r));
});
test.afterAll(async () => { await new Promise((r) => rinvii.close(r)); });
const rinvio = (verso) => `http://127.0.0.1:${rinvii.address().port}/${verso}`;

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    let vista = '';
    try { vista = t.view.webContents.getURL(); } catch (_) {}
    return { id: t.id, url: t.url, vista, interna: t.isInternal, titolo: t.title };
  });
});
const suFilo = async (app) => (await schede(app)).filter((t) => /^filo:\/\/(options|error)\//.test(t.vista) || /banca\.example/.test(t.url));
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

test('meta refresh verso una pagina di Filo: la scheda resta sul sito', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Meta</title><meta http-equiv="refresh" content="0;url=${OPZIONI}"><h1>x</h1>`);
  await openTab(sito);
  await attendi(2500);
  expect(await suFilo(app)).toEqual([]);
  const t = (await schede(app)).find((x) => x.vista === sito);
  expect(t && t.interna).toBe(false);
});

test('un modulo inviato verso una pagina di Filo: la scheda resta sul sito', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Modulo</title><form id="f" action="${OPZIONI}" method="get"><input name="q" value="1"></form>
<script>setTimeout(function(){ document.getElementById('f').submit(); }, 200)</script>`);
  await openTab(sito);
  await attendi(2500);
  expect(await suFilo(app)).toEqual([]);
});

test('dopo un clic, window.open di un indirizzo web che rinvia a una pagina di Filo non apre una pagina di Filo', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Rinvio</title>
<button id="b" style="width:220px;height:60px" onclick="window.open('${rinvio('errore')}')">Apri</button>`);
  const page = await openTab(sito);
  await page.click('#b', { noWaitAfter: true });
  await attendi(3000);
  expect(await suFilo(app)).toEqual([]);
});

test('un riquadro verso la home, la pagina d’errore o un rinvio a una pagina di Filo non mostra la pagina di Filo', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Cornici</title>
<iframe src="filo://newtab/" style="width:300px;height:200px"></iframe>
<iframe src="${ERRORE}" style="width:300px;height:200px"></iframe>
<iframe src="${rinvio('opzioni')}" style="width:300px;height:200px"></iframe>`);
  await openTab(sito);
  await attendi(3000);
  const origini = await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.view.webContents.getURL() === u);
    return t.view.webContents.mainFrame.framesInSubtree.filter((f) => f !== t.view.webContents.mainFrame).map((f) => ({ o: f.origin, u: f.url }));
  }, sito);
  expect(origini.length).toBe(3);
  for (const f of origini) expect(f.o, JSON.stringify(origini)).not.toMatch(/^filo:/);
});

test('la home con parametri chiesta da un sito resta fuori; la home nuda senza barra finale arriva come home vera', async ({ app, openTab, testServer }) => {
  const conChat = testServer.html(`<title>Chat</title><script>setTimeout(function(){ location.href = 'filo://newtab/?chat=ciao'; }, 200)</script>`);
  await openTab(conChat);
  await attendi(2500);
  const t1 = (await schede(app)).find((x) => x.vista === conChat);
  expect(t1 && t1.interna, 'la home coi parametri del sito non arriva').toBe(false);

  const nuda = testServer.html(`<title>Casa</title><script>setTimeout(function(){ location.href = 'filo://newtab'; }, 200)</script>`);
  await openTab(nuda);
  const ultima = () => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs[tm.tabs.length - 1];
    return { vista: t.view.webContents.getURL(), interna: t.isInternal };
  });
  await expect.poll(ultima, { timeout: 8000 }).toEqual({ vista: 'filo://newtab/', interna: true });
});

test('dalla barra dell’indirizzo l’utente porta ancora una scheda del web sulle opzioni, e Indietro e Avanti funzionano', async ({ app, openTab, testServer }) => {
  const sito = testServer.html('<title>Sito</title><h1>sito</h1>');
  await openTab(sito);
  const id = (await schede(app)).find((x) => x.vista === sito).id;
  await app.evaluate(({ BrowserWindow }, [i, u]) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.navigate(i, u), [id, OPZIONI]);
  const stato = () => app.evaluate(({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    return { vista: t.view.webContents.getURL(), interna: t.isInternal };
  }, id);
  await expect.poll(stato, { timeout: 8000 }).toEqual({ vista: OPZIONI, interna: true });
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.goBack(i), id);
  await expect.poll(stato, { timeout: 8000 }).toEqual({ vista: sito, interna: false });
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.goForward(i), id);
  await expect.poll(stato, { timeout: 8000 }).toEqual({ vista: OPZIONI, interna: true });
});
