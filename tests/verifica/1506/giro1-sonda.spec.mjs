// Sonda della verifica #1506 giro 1: altre strade con cui un sito porta una scheda su un filo://.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const HOME = 'filo://newtab/';

let rinvii;
test.beforeAll(async () => {
  rinvii = createServer((req, res) => {
    const verso = { '/home': HOME, '/homechat': 'filo://newtab/?chat=ciao' }[req.url.split('?')[0]];
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
    return { id: t.id, url: t.url, vista, interna: t.isInternal };
  });
});

test('meta refresh e modulo verso pagine di Filo', async ({ app, openTab, testServer }) => {
  const meta = testServer.html(`<title>Meta</title><meta http-equiv="refresh" content="0;url=${OPZIONI}">`);
  await openTab(meta);
  const modulo = testServer.html(`<title>Modulo</title><form id="f" action="filo://error/error.html" method="get">
<input name="url" value="https://banca.example/"><input name="code" value="-105"><input name="desc" value="Chiama"></form>
<script>setTimeout(function(){ document.getElementById('f').submit(); }, 200)</script>`);
  await openTab(modulo);
  await new Promise((r) => setTimeout(r, 2500));
  const s = await schede(app);
  console.log(JSON.stringify(s));
  expect(s.filter((t) => /^filo:\/\/(options|error)\//.test(t.vista))).toEqual([]);
});

test('la home nuda: da location e da rinvio', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Va a casa</title><script>setTimeout(function(){ location.href = ${JSON.stringify(HOME)}; }, 200)</script>`);
  await openTab(sito);
  const sito2 = testServer.html(`<title>Rinvia</title><script>setTimeout(function(){ location.href = ${JSON.stringify(rinvio('home'))}; }, 200)</script>`);
  await openTab(sito2);
  const sito3 = testServer.html(`<title>Rinvia chat</title><script>setTimeout(function(){ location.href = ${JSON.stringify(rinvio('homechat'))}; }, 200)</script>`);
  await openTab(sito3);
  await new Promise((r) => setTimeout(r, 3000));
  const s = await schede(app);
  console.log(JSON.stringify(s, null, 1));
  for (const t of s.filter((x) => x.vista.startsWith('filo://newtab'))) expect(t.interna, JSON.stringify(t)).toBe(true);
  expect(s.filter((x) => /chat=/.test(x.vista))).toEqual([]);
});

test('window.open della home con parametri e ctrl+clic', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Apre</title>
<button id="b" style="width:220px;height:60px" onclick="window.open('filo://newtab/?chat=ciao')">Apri</button>
<p><a id="l" href="${OPZIONI}">opzioni</a></p>`);
  const page = await openTab(sito);
  await page.click('#b', { noWaitAfter: true });
  await page.click('#l', { modifiers: ['Control'], noWaitAfter: true });
  await page.click('#l', { button: 'middle', noWaitAfter: true });
  await new Promise((r) => setTimeout(r, 2000));
  const s = await schede(app);
  console.log(JSON.stringify(s));
  expect(s.filter((x) => /chat=|options/.test(x.vista))).toEqual([]);
});
