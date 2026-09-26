// Verifica #588 giro 4 — esplorazione: la domanda sui programmi nel pannello
// sopra la pagina (luce/buio, nome lungo, due programmi, scheda in secondo
// piano, link in nuova scheda) e la seconda conferma dal pannello.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(4096));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = String(req.url || '');
    const nome = decodeURIComponent(u.split('?')[0].split('/').pop()) || 'x';
    if (u.startsWith('/img/')) {
      // un'"immagine" che il server consegna come programma
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length,
        'Content-Disposition': 'attachment; filename="setup.exe"' });
      res.end(PNG); return;
    }
    if (u.startsWith('/lento/')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': EXE.length,
        'Content-Disposition': `attachment; filename="${nome}"` });
      res.write(EXE.subarray(0, 100));
      setTimeout(() => res.end(EXE.subarray(100)), 4000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': EXE.length,
      'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const SHOTS = join(process.cwd(), 'tests', '.shots', 'v588g4');
function foto(nome) {
  try { mkdirSync(SHOTS, { recursive: true }); execFileSync('scrot', ['-o', join(SHOTS, nome + '.png')]); } catch (e) { console.log('scrot', e.message); }
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const statoDi = async (shell, nome) => (await elenco(shell)).find((x) => x.filename === nome)?.state ?? null;
const riga = (shell, nome) => shell.locator('#dl-panel .dl-row', { hasText: nome });

async function vistaPagina(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w && w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    return t ? t.view.getBounds() : null;
  });
}
async function sopra(app, loc) {
  const b = await loc.boundingBox();
  const v = await vistaPagina(app);
  if (!b) return false;
  if (!v) return true;
  return !(b.x < v.x + v.width && v.x < b.x + b.width && b.y < v.y + v.height && v.y < b.y + b.height);
}

test('luce e buio, nome lunghissimo, due programmi insieme', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const lungo = 'installatore-' + 'molto-lungo-'.repeat(12) + 'fine.exe';
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px;background:#fff">
      <a id="a" href="${srv.base}/setup.exe">a</a> <a id="b" href="${srv.base}/${encodeURIComponent(lungo)}">b</a></body>`);
    await page.locator('#a').click();
    await page.locator('#b').click();
    await expect(shell.locator('#dl-panel .dl-row[data-chiede="1"]')).toHaveCount(2, { timeout: 15000 });
    for (const r of await shell.locator('#dl-panel .dl-row[data-chiede="1"]').all()) {
      expect(await sopra(app, r), 'riga coperta dalla pagina').toBe(true);
    }
    await shell.waitForTimeout(500);
    foto('due-luce');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await shell.waitForTimeout(800);
    foto('due-buio');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    // rispondo alla prima: la seconda resta e chiede
    await riga(shell, 'setup.exe').locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(shell, 'setup.exe')).toBe('completed');
    await expect(shell.locator('#dl-panel .dl-row[data-chiede="1"]')).toHaveCount(1);
    foto('una-risposta');
  } finally { await srv.close(); }
});

test('scaricamento partito da una scheda in secondo piano: la domanda si vede lo stesso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><body>
      <script>setTimeout(() => { location.href = '${srv.base}/ritardato.exe'; }, 3000);</script>sfondo</body>`);
    // porto davanti un'altra scheda (la Home interna)
    await shell.evaluate(() => window.filoShell.tabs.create && window.filoShell.tabs.create('filo://newtab'));
    await shell.waitForTimeout(4500);
    const r = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'ritardato.exe' });
    await expect(r).toBeVisible({ timeout: 10000 });
    expect(await sopra(app, r)).toBe(true);
    foto('sfondo');
    void page;
  } finally { await srv.close(); }
});

test('link target=_blank a un programma: la scheda vuota si chiude, la domanda resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px">
      <a id="n" target="_blank" href="${srv.base}/nuova.exe">nuova</a></body>`);
    await page.locator('#n').click();
    const r = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'nuova.exe' });
    await expect(r).toBeVisible({ timeout: 10000 });
    await expect(r).toContainText('127.0.0.1');
    expect(await sopra(app, r)).toBe(true);
    foto('blank');
  } finally { await srv.close(); }
});

test('programma lento: «Scarica» prima che finisca, poi Apri file dal pannello chiede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    await app.evaluate(({ shell }) => { globalThis.__aperti = []; shell.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); }; });
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px">
      <a id="l" href="${srv.base}/lento/lento.exe">l</a></body>`);
    await page.locator('#l').click();
    const r = riga(shell, 'lento.exe');
    await expect(r.locator('.dl-row-btn', { hasText: /^Scarica$/ })).toBeVisible({ timeout: 10000 });
    await r.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    foto('lento-in-corso');
    await expect.poll(() => statoDi(shell, 'lento.exe'), { timeout: 20000 }).toBe('completed');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(readdirSync(dir)).toContain('lento.exe');
    await expect(r.locator('.dl-row-btn', { hasText: 'Apri file' })).toBeVisible({ timeout: 10000 });
    await r.locator('.dl-row-btn', { hasText: 'Apri file' }).click();
    await expect(r.locator('.dl-row-btn', { hasText: 'Apri comunque' })).toBeVisible({ timeout: 5000 });
    expect(await app.evaluate(() => globalThis.__aperti.length)).toBe(0);
    expect(await sopra(app, r)).toBe(true);
    foto('apri-chiede');
    await r.locator('.dl-row-btn', { hasText: 'Apri comunque' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length)).toBe(1);
  } finally { await srv.close(); }
});

test('«Salva immagine come» su un\'immagine che il server consegna come setup.exe', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><body><img id="i" src="${srv.base}/img/foto.png"></body>`);
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    // lo stesso messaggio che manda il menu del tasto destro
    const res = await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const tm = w._filoTabs; const t = tm.tabs.find((x) => x.id === tm.activeId);
      const h = globalThis.__filoHandlers || null;
      return { hasHandlers: !!h, wcId: t.view.webContents.id, url };
    }, `${srv.base}/img/foto.png`);
    console.log('info', JSON.stringify(res));
    const r = await page.evaluate(async (url) => {
      try { return await chrome.runtime.sendMessage({ type: 'download_image', url }); } catch (e) { return { err: String(e) }; }
    }, `${srv.base}/img/foto.png`);
    console.log('risposta', JSON.stringify(r));
    await page.waitForTimeout(3000);
    console.log('cartella', JSON.stringify(existsSync(dir) ? readdirSync(dir) : []));
    console.log('elenco', JSON.stringify((await elenco(shell)).map((x) => [x.filename, x.state, x.exe])));
  } finally { await srv.close(); }
});
