// Esplorazione del giro 4 di #1476: casi della riapertura non coperti dagli spec del lavoro.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeUrl: attiva ? attiva.url : null };
  });
}

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers });
}
const chiudi = (app) => premi(app, 'W', ['control']);
const riapri = (app) => premi(app, 'T', ['control', 'shift']);

function apriEAspetta(app, url) {
  return app.evaluate(async ({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
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

test('ultima scheda chiusa e riaperta', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>a</h1>');
  await apriEAspetta(app, a);
  // Chiude tutte le altre
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    for (const t of tm.tabs.slice()) if (t.url !== u) tm.closeTab(t.id);
  }, a);
  console.log('prima', JSON.stringify(await info(app)));
  await chiudi(app);
  await sleep(1500);
  console.log('dopo chiusura', JSON.stringify(await info(app)));
  await riapri(app);
  await sleep(2000);
  const i = await info(app);
  console.log('dopo riapertura', JSON.stringify(i));
  expect(i.activeUrl).toBe(a);
});

test('scheda chiusa mentre carica', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  const server = createServer((req, res) => {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Lenta</title><h1>lenta</h1>'); }, 6000);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/lenta`;
  try {
    await app.evaluate(({ BrowserWindow }, url) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
      tm.openTab(url);
    }, url);
    await sleep(800);
    const prima = await info(app);
    console.log('mentre carica', JSON.stringify(prima));
    await chiudi(app);
    await sleep(800);
    await riapri(app);
    await sleep(1500);
    const i = await info(app);
    console.log('dopo riapertura', JSON.stringify(i));
    expect(i.activeUrl).toBe(url);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('chiudi tutto e riapri tre volte', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const urls = ['X', 'Y', 'Z'].map((n) => testServer.html(`<title>${n}</title><h1>${n}</h1>`));
  for (const u of urls) await apriEAspetta(app, u);
  console.log('prima', JSON.stringify(await info(app)));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.closeAllTabs();
  });
  await sleep(1000);
  for (let k = 0; k < 4; k++) { await riapri(app); await sleep(1500); }
  console.log('dopo', JSON.stringify(await info(app)));
});

test('Ctrl+Shift+T dalla home con il campo a fuoco non scrive nel campo', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>a</h1>');
  await apriEAspetta(app, a);
  await chiudi(app);
  await sleep(800);
  const home = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return t.url;
  });
  console.log('attiva', home);
  await riapri(app);
  await sleep(1500);
  console.log('dopo', JSON.stringify(await info(app)));
  expect((await info(app)).activeUrl).toBe(a);
});
