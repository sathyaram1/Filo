// Verifica #2595 giro 1: a schermo intero una domanda sopra la pagina si vede senza portare il puntatore in alto.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const SHOTS = join(process.cwd(), 'tests', '.shots');

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = String(req.url || '').split('?')[0].split('/').pop() || 'setup.exe';
    if (nome === 'notifiche') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Posta</title><body style="margin:0;background:#f3ead8;height:1400px">
<button id="attiva" style="position:fixed;top:200px;left:200px">Attiva le notifiche</button>
<script>document.getElementById('attiva').addEventListener('click', () => Notification.requestPermission().then((x) => { window.__esito = x; }));</script>`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': EXE.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const pagina = (base) => `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px;background:#f3ead8">
  <h1>Pagina</h1><a id="exe" href="${base}/setup.exe">Scarica il programma</a>
  <a id="exe2" href="${base}/installa.exe">Un altro programma</a></body></html>`;

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return { schermoIntero: !!tm.contentFullscreen, visibili: tm.schedeInAlto.visibili, alto: t.view.getBounds().y, fila: tm.chromeCompact ? tm.tabRowHeight : tm.shellHeight, inset: tm.topInset, url: t.view.webContents.getURL() };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);
const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};

async function foto(app, nome) {
  const b64 = await app.evaluate(async ({ BrowserWindow, nativeImage }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const base = await w.webContents.capturePage();
    const { width, height } = base.getSize();
    const buf = Buffer.from(base.toBitmap());
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const b = t.view.getBounds();
    const img = (await t.view.webContents.capturePage()).resize({ width: b.width, height: b.height });
    const src = img.toBitmap();
    for (let y = 0; y < b.height && b.y + y < height; y++) {
      const da = y * b.width * 4;
      src.copy(buf, ((b.y + y) * width + b.x) * 4, da, da + Math.min(b.width, width - b.x) * 4);
    }
    return nativeImage.createFromBitmap(buf, { width, height }).toPNG().toString('base64');
  });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, nome), Buffer.from(b64, 'base64'));
}

// La domanda è visibile se la pagina comincia sotto il suo riquadro.
async function domandaVisibile(app, shell, sel) {
  const s = await stato(app);
  const box = await shell.locator(sel).boundingBox();
  return { s, box, sotto: !!box && s.alto >= Math.floor(box.y + box.height) - 1 };
}

test('scaricarlo? a schermo intero si vede senza toccare il bordo alto, e risposta la pagina risale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await page.mouse.move(400, 500);
    await page.locator('#exe2').click();
    const riga = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'installa.exe' });
    await expect(riga).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await domandaVisibile(app, shell, '#dl-panel')).sotto, { timeout: 5000 }).toBe(true);
    const s = await stato(app);
    expect(s.visibili).toBe(false);
    await foto(app, 'v2595-scaricarlo.png');
    await riga.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click({ timeout: 10000 });
    await expect.poll(() => statoDi(shell, 'installa.exe'), { timeout: 20000 }).toBe('completed');
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
  } finally {
    await srv.close();
  }
});

test('scaricarlo? a schermo intero: la x e l Esc chiudono e la pagina risale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await schermoIntero(app, true);
    await page.locator('#exe').click();
    await expect(shell.locator('#dl-panel .dl-row[data-chiede="1"]')).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await stato(app)).alto).toBeGreaterThan(0);
    await shell.locator('#dl-panel #dl-panel-close').click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    // uscendo e rientrando dallo schermo intero, la domanda chiusa non riabbassa niente
    await schermoIntero(app, false);
    await expect.poll(async () => { const x = await stato(app); return x.alto === x.fila; }).toBe(true);
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
  } finally {
    await srv.close();
  }
});

test('aprirlo? dalla carta della home a schermo intero si vede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await page.locator('#exe').click();
    const riga = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'setup.exe' });
    await expect(riga).toBeVisible({ timeout: 20000 });
    await shell.mouse.move(200, 10);
    await riga.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click({ timeout: 10000 });
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await shell.locator('#dl-panel #dl-panel-close').click().catch(() => {});
    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    let home = null;
    await expect.poll(() => { home = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } }); return !!home; }, { timeout: 15000 }).toBe(true);
    const carta = home.locator('.dash-carta[data-tipo="download"]', { hasText: 'setup.exe' });
    await expect(carta).toBeVisible({ timeout: 15000 });
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await carta.getByRole('button', { name: 'Apri', exact: true }).click();
    await home.waitForTimeout(1500);
    await foto(app, 'v2595-aprirlo-home.png');
    const s = await stato(app);
    const inPagina = await home.locator('.sn-confirm, [class*="confirm"]').count();
    const inShell = await shell.locator('#dl-panel').isVisible();
    console.log('APRIRLO', JSON.stringify({ s, inPagina, inShell }));
    // una delle due: o la conferma sta nella home (visibile), o il pannello sta sopra la pagina scesa
    if (inShell) expect((await domandaVisibile(app, shell, '#dl-panel')).sotto).toBe(true);
    else expect(inPagina).toBeGreaterThan(0);
  } finally {
    await srv.close();
  }
});

test('la domanda di un permesso a schermo intero si vede, e risposta la pagina risale', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await openTab(srv.base + '/notifiche');
    await page.waitForLoadState('domcontentloaded');
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await page.locator('#attiva').click();
    await expect(shell.locator('#permesso-bar')).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => (await domandaVisibile(app, shell, '#permesso-bar')).sotto, { timeout: 5000 }).toBe(true);
    await foto(app, 'v2595-permesso.png');
    await shell.emulateMedia({ colorScheme: 'dark' });
    await foto(app, 'v2595-permesso-scuro.png');
    await shell.emulateMedia({ colorScheme: 'light' });
    await shell.locator('#permesso-bar').getByRole('button', { name: 'Consenti', exact: true }).click({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => window.__esito), { timeout: 10000 }).toBe('granted');
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
  } finally {
    await srv.close();
  }
});

test('dopo una domanda a schermo intero, il puntatore sulla parte alta di un riquadro di un altro sito non fa scendere le schede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Riquadro</body></html>', { pubblico: true });
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px">
      <a id="exe" href="${srv.base}/setup.exe" style="display:block;height:30px">Scarica il programma</a>
      <iframe id="emb" src="${dentro}" style="display:block;width:600px;height:300px;border:0;margin:20px 0 0 100px"></iframe></body></html>`);
    await expect.poll(() => page.frames().length).toBeGreaterThan(1);
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await page.mouse.move(50, 600);
    await page.locator('#exe').click();
    const riga = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'setup.exe' });
    await expect(riga).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await stato(app)).alto).toBeGreaterThan(0);
    const alto = (await stato(app)).alto;
    // Il puntatore passa sul riquadro mentre la domanda aspetta.
    await page.mouse.move(300, 250, { steps: 4 });
    await new Promise((r) => setTimeout(r, 800));
    await page.mouse.move(310, 260, { steps: 2 });
    await new Promise((r) => setTimeout(r, 800));
    console.log('CIMA', JSON.stringify(await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      const c = tm.schedeInAlto.cimaSulloSchermo;
      return { y: c ? c.y : null, mosse: tm.schedeInAlto.mossePagina };
    })));
    await shell.locator('#dl-panel #dl-panel-close').click();
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    // Ora il riquadro comincia a 50 px dall'alto: il puntatore a metà della sua parte alta, lontano dal bordo.
    const box = await page.locator('#emb').boundingBox();
    const y = Math.round(box.y + Math.min(80, alto / 2));
    await page.mouse.move(300, y + 40, { steps: 3 });
    await page.mouse.move(300, y, { steps: 3 });
    await new Promise((r) => setTimeout(r, 1500));
    console.log('RIQUADRO', JSON.stringify({ alto, box, y, st: await stato(app) }));
    expect((await stato(app)).visibili, 'a metà di un riquadro, lontano dal bordo, le schede non scendono').toBe(false);
  } finally {
    await srv.close();
  }
});

test('permesso in sospeso su una scheda: a schermo intero passare a un altra scheda fa risalire, tornare la riabbassa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const altra = await testServer.openReady(openTab, pagina(srv.base));
    const page = await openTab(srv.base + '/notifiche');
    await page.waitForLoadState('domcontentloaded');
    await schermoIntero(app, true);
    await page.locator('#attiva').click();
    await expect(shell.locator('#permesso-bar')).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => (await stato(app)).alto).toBeGreaterThan(0);
    const ids = await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      return { attiva: tm.activeId, tutte: tm.tabs.map((t) => t.id) };
    });
    const altraId = ids.tutte.find((x) => x !== ids.attiva && x);
    const cambia = (id) => app.evaluate(({ BrowserWindow }, i) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      tm.activate ? tm.activate(i) : tm.setActive(i);
    }, id);
    // l'altra scheda con la pagina dei programmi
    const idAltra = await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      const t = tm.tabs.find((x) => /Pagina|127\.0\.0\.1.*(?<!notifiche)$/.test(x.view.webContents.getURL()) && x.id !== tm.activeId && !x.view.webContents.getURL().startsWith('filo://'));
      return t ? t.id : null;
    });
    await cambia(idAltra || altraId);
    await expect(shell.locator('#permesso-bar')).toBeHidden();
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await cambia(ids.attiva);
    await expect(shell.locator('#permesso-bar')).toBeVisible();
    await expect.poll(async () => (await stato(app)).alto).toBeGreaterThan(0);
    void altra;
  } finally {
    await srv.close();
  }
});
