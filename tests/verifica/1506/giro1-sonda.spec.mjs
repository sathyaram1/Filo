// Sonda della verifica #1506 giro 1: altre strade con cui un sito porta una scheda su un filo://.
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

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

for (const via of ['location', 'rinvio', 'rinviochat']) {
  test(`la home nuda da un sito, via ${via}`, async ({ app, openTab, testServer }) => {
    const verso = via === 'location' ? HOME : rinvio(via === 'rinvio' ? 'home' : 'homechat');
    const sito = testServer.html(`<title>Va</title><script>setTimeout(function(){ location.href = ${JSON.stringify(verso)}; }, 200)</script>`);
    await openTab(sito);
    await new Promise((r) => setTimeout(r, 3500));
    const r = await app.evaluate(async ({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const t = tm.tabs.find((x) => x.view.webContents.getURL().startsWith('filo://newtab'));
      if (!t) return null;
      const img = await t.view.webContents.capturePage();
      const testo = await t.view.webContents.executeJavaScript('document.body ? document.body.innerText.length : -1').catch(() => -2);
      const api = await t.view.webContents.executeJavaScript('typeof window.filoApi + "/" + typeof window.chrome?.runtime?.sendMessage').catch(() => '?');
      return { interna: t.isInternal, url: t.url, png: img.toPNG().toString('base64'), testo, api };
    });
    if (via === 'rinviochat') { const s = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => [t.url, t.view.webContents.getURL(), t.isInternal])); console.log(JSON.stringify(s)); }
    if (!r) return;
    mkdirSync('tests/.shots', { recursive: true });
    writeFileSync(`tests/.shots/1506-home-${via}.png`, Buffer.from(r.png, 'base64'));
    console.log(via, JSON.stringify({ interna: r.interna, url: r.url, testo: r.testo, api: r.api }));
    expect(r.interna, 'la home è una home vera di Filo').toBe(true);
  });
}

test('un rinvio del sito verso la home nuda', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html(`<title>B</title><script>setTimeout(function(){ location.href = ${JSON.stringify(rinvio('home'))}; }, 200)</script>`));
  await new Promise((r) => setTimeout(r, 3000));
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs[tm.tabs.length - 1];
    tm.activate(t.id);
    await new Promise((x) => setTimeout(x, 800));
    const img = await t.view.webContents.capturePage();
    const api = await t.view.webContents.executeJavaScript('typeof window.filoApi + "/" + typeof window.chrome + "/" + document.body.innerText.slice(0,200)').catch((e) => String(e));
    return { tutte: tm.tabs.map((x) => [x.url, x.view.webContents.getURL(), x.isInternal]), png: img.toPNG().toString('base64'), api };
  });
  mkdirSync('tests/.shots', { recursive: true });
  writeFileSync('tests/.shots/1506-home-rinvio.png', Buffer.from(r.png, 'base64'));
  console.log('RINVIO', JSON.stringify(r.tutte), r.api);
});
