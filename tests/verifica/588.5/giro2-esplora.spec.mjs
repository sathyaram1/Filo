// Esplorazione del giro 2 di #588.5: passi della segnalazione e strade vicine.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));

async function server(handler) {
  const srv = createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

function posa(app, incognito = false) {
  return app.evaluate(({ BrowserWindow }, inc) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !!w._filoIncognito === inc);
    const tm = win._filoTabs;
    const v = tm.avvisi.vista;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const figli = win.contentView.children;
    const [W, H] = win.getContentSize();
    return {
      inCima: !!v && figli[figli.length - 1] === v,
      visibile: !!v && v.getVisible?.(),
      vista: v ? v.getBounds() : null,
      scheda: tab ? tab.view.getBounds() : null,
      W, H,
    };
  }, incognito);
}

test('un collegamento a un pdf qualunque (senza allegato): «Scaricato» sopra la pagina, e «Apri file» apre', async ({ app, openTab, testServer, avvisi }) => {
  const srv = await server((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length });
    res.end(PDF);
  });
  try {
    await app.evaluate(({ shell: sh }) => { globalThis.__aperti = []; sh.openPath = async (p) => { globalThis.__aperti.push(p); return ''; }; });
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="dl" href="${srv.base}/guida.pdf">guida</a></body></html>`);
    await page.locator('#dl').click();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/Scaricato: guida/, { timeout: 15000 });
    await expect.poll(async () => (await posa(app)).inCima).toBe(true);
    const p = await posa(app);
    expect(p.visibile).toBe(true);
    expect(p.vista.width).toBeGreaterThan(100);
    const b = vista.locator('.shell-notif-action', { hasText: 'Apri file' });
    await expect(b).toBeEnabled({ timeout: 3000 });
    await b.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length)).toBe(1);
  } finally { await srv.close(); }
});

test('uno scaricamento che si interrompe: «Scaricamento non riuscito» sopra la pagina', async ({ app, openTab, testServer, avvisi }) => {
  const srv = await server((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': 200000, 'Content-Disposition': 'attachment; filename="rotto.pdf"' });
    res.write(PDF);
    setTimeout(() => { try { res.socket.destroy(); } catch (_) {} }, 300);
  });
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="dl" href="${srv.base}/rotto.pdf">rotto</a></body></html>`);
    await page.locator('#dl').click();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/Scaricamento non riuscito: rotto/, { timeout: 20000 });
    await expect.poll(async () => (await posa(app)).inCima).toBe(true);
    expect((await posa(app)).vista.width).toBeGreaterThan(100);
  } finally { await srv.close(); }
});

test('cambiando scheda con un avviso aperto, resta sopra', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body><p>A</p></body></html>');
  const primaId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
  await shell.evaluate(() => window.filoNotify('Resta', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<!doctype html><html><body><p>B</p></body></html>'));
  await expect.poll(async () => (await posa(app)).inCima).toBe(true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(id), primaId);
  await expect.poll(async () => (await posa(app)).inCima).toBe(true);
  const p = await posa(app);
  expect(p.vista.width).toBeGreaterThan(100);
  expect(p.visibile).toBe(true);
});

test('in incognito lo scaricamento si annuncia sopra la pagina, coi colori dell’incognito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const srv = await server((req, res) => {
    if (!req.url.endsWith('.pdf')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<a id="dl" href="/x.pdf">x</a>`); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length });
    res.end(PDF);
  });
  try {
    await shell.evaluate(() => window.filoShell.openIncognito());
    const trova = async (prova) => {
      for (let i = 0; i < 100; i++) {
        const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
        if (p) return p;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('non trovata');
    };
    const incog = await trova((u) => u.includes('incognito=1'));
    await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1');
    await app.evaluate(({ BrowserWindow }, url) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(url); }, srv.base + '/');
    const page = await trova((u) => u.startsWith(srv.base));
    await page.locator('#dl').click();
    const vista = await app.evaluate(async ({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs;
      for (let i = 0; i < 100 && !(tm.avvisi.vista && tm.avvisi.altezza); i++) await new Promise((r) => setTimeout(r, 150));
      return tm.avvisi.vista ? tm.avvisi.vista.webContents.getURL() : '';
    });
    expect(vista).toContain('avvisi.html');
    await expect.poll(async () => (await posa(app, true)).inCima).toBe(true);
    expect((await posa(app, true)).vista.width).toBeGreaterThan(100);
    const colori = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
      const v = await win._filoTabs.avvisi.vista.webContents.executeJavaScript('getComputedStyle(document.querySelector(".shell-notif")).backgroundColor');
      const s = await win.webContents.executeJavaScript('(() => { const c = document.querySelector(".shell-notif"); return c ? getComputedStyle(c).backgroundColor : ""; })()');
      return { v, s };
    });
    console.log('incognito colori', JSON.stringify(colori));
    expect(colori.v).toBe(colori.s);
  } finally { await srv.close(); }
});

test('finestra bassa con cinque avvisi: la vista resta nell’area della pagina e la più recente si vede', async ({ app, shell, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setContentSize(700, 320); });
  for (let i = 1; i <= 6; i++) await shell.evaluate((n) => window.filoNotify('Avviso numero ' + n + ' con un testo abbastanza lungo da andare a capo su due righe', { durationSec: 0 }), i);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(5);
  await expect.poll(async () => { const p = await posa(app); return p.vista.y >= p.scheda.y && p.vista.y + p.vista.height === p.H; }).toBe(true);
  const ultima = await vista.evaluate(() => {
    const c = [...document.querySelectorAll('.shell-notif')].pop();
    const r = c.getBoundingClientRect();
    return { testo: c.textContent, dentro: r.bottom <= innerHeight + 1 && r.top >= -1 };
  });
  console.log('ultima', JSON.stringify(ultima));
  expect(ultima.testo).toContain('numero 6');
  expect(ultima.dentro).toBe(true);
});

test('pagina a schermo intero: l’avviso compare nell’angolo della pagina', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><div id="v" style="width:200px;height:100px;background:#000"></div><button id="fs" onclick="document.getElementById(\'v\').requestFullscreen()">fs</button></body></html>');
  await page.locator('#fs').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.contentFullscreen), { timeout: 8000 }).toBe(true);
  await shell.evaluate(() => window.filoNotify('Durante lo schermo intero', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => (await posa(app)).inCima).toBe(true);
  const p = await posa(app);
  console.log('fullscreen posa', JSON.stringify(p));
  expect(p.vista.y + p.vista.height).toBe(p.H);
});
