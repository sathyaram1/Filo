// Esplorazione del giro 7 di verifica di #1476.
import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeId: t.activeId, activeUrl: attiva ? attiva.url : null, proxy: attiva ? attiva.proxy : null };
  });
}

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers });
}

function apriEAspetta(app, url) {
  return app.evaluate(async ({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && !tab.loading) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return id;
  }, url);
}

test('A: premuto in fretta dopo un riavvio, l\'archivio non ridà la stessa scheda due volte', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const urls = ['U1', 'U2', 'U3'].map((n) => testServer.html(`<title>${n}</title><h1>${n}</h1>`));
  await app.evaluate(async (_e, urls) => {
    for (let i = 0; i < urls.length; i++) {
      await globalThis.SN_ARCHIVED_TABS.archive({ url: urls[i], title: `U${i + 1}`, closedAt: `2026-10-0${i + 1}T10:00:00.000Z` });
    }
  }, urls);
  const base = (await info(app)).count;
  for (let i = 0; i < 3; i++) { await premi(app, 'T', ['control', 'shift']); await sleep(120); }
  await sleep(3000);
  const dopo = await info(app);
  console.log('A urls', JSON.stringify(dopo.urls));
  expect(dopo.count).toBe(base + 3);
  for (const u of urls) expect(dopo.urls.filter((x) => x === u).length).toBe(1);
});

test('B: Ctrl+L con testo scritto in un editor contenteditable apre la home accanto', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>Mail</title><div id="ed" contenteditable="true" style="min-height:100px;border:1px solid"></div>');
  const page = await openTab(url);
  await page.locator('#ed').click();
  await page.keyboard.type('caro Mario, ti scrivo per');
  await sleep(1500);
  const prima = await info(app);
  await premi(app, 'L', ['control']);
  await sleep(2500);
  const dopo = await info(app);
  console.log('B', prima.count, dopo.count, dopo.urls);
  expect(dopo.count).toBe(prima.count + 1);
  await expect(page.locator('#ed')).toHaveText('caro Mario, ti scrivo per');
});

test('C: Ctrl+L con testo scritto in un campo dentro un riquadro (commenti) apre la home accanto', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<title>Commenti</title><textarea id="c"></textarea>');
  const url = testServer.html(`<title>Articolo</title><h1>Articolo</h1><iframe id="f" src="${dentro}" width="400" height="200"></iframe>`);
  const page = await openTab(url);
  const frame = page.frameLocator('#f');
  await frame.locator('#c').click();
  await page.keyboard.type('un commento lungo');
  await sleep(1500);
  const prima = await info(app);
  await premi(app, 'L', ['control']);
  await sleep(2500);
  const dopo = await info(app);
  console.log('C', prima.count, dopo.count, dopo.urls);
  expect(dopo.count).toBe(prima.count + 1);
});

test('D: dalla home col cursore nel campo Ctrl+Shift+T riapre', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>A</h1>');
  await apriEAspetta(app, a);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(a)), { timeout: 8000 }).toBe(false);
  const { activeId, activeUrl } = await info(app);
  console.log('D attiva', activeUrl);
  const home = await paginaDellaScheda(app, activeId, (p) => p.url().startsWith('filo://newtab/'));
  if (home) await home.locator('#input').fill('bozza');
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(a);
  if (home) expect(await home.locator('#input').inputValue()).toBe('bozza');
});

test('E: una scheda da un altro paese, riaperta con Ctrl+Shift+T, non passa prima dalla rete diretta', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  const dirette = [];
  const proxate = [];
  const sito = http.createServer((req, res) => {
    (req.headers['x-dal-proxy'] ? proxate : dirette).push(req.url);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Estera</title><h1>estera</h1>');
  });
  await new Promise((r) => sito.listen(0, '127.0.0.1', r));
  const portaSito = sito.address().port;
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url);
    const fw = http.request({ host: '127.0.0.1', port: Number(u.port) || 80, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, 'x-dal-proxy': '1' } }, (r2) => {
      res.writeHead(r2.statusCode, r2.headers); r2.pipe(res);
    });
    fw.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(fw);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const portaProxy = proxy.address().port;
  try {
    await app.evaluate(async (_e, p) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: `http://127.0.0.1:${p}`, bypass: '<-loopback>' } });
    }, portaProxy);
    const url = `http://sito-pubblico.test:${portaSito}/estera`;
    const id = await apriEAspetta(app, url);
    const r = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setTabProxy(id, 'us'), id);
    console.log('E setTabProxy', JSON.stringify(r));
    await expect.poll(() => proxate.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await sleep(1000);
    await premi(app, 'W', ['control']);
    await expect.poll(() => info(app).then((i) => i.urls.includes(url)), { timeout: 8000 }).toBe(false);
    const d0 = dirette.length; const p0 = proxate.length;
    await premi(app, 'T', ['control', 'shift']);
    await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(url);
    await sleep(3000);
    const i = await info(app);
    console.log('E dopo', JSON.stringify({ dirette: dirette.slice(d0), proxate: proxate.slice(p0), proxy: i.proxy }));
    expect(i.proxy && i.proxy.country).toBe('us');
    expect(dirette.slice(d0)).toEqual([]);
  } finally {
    sito.close(); proxy.close();
  }
});
