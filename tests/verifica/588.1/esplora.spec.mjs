// Verifica #588.1 giro 1 — esplorazione: ogni tipo nominato si ferma, anche in
// maiuscolo e a raffica; la pagina elenco chiede prima di aprire un disco.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';

const BIN = Buffer.from('MZ finto\n' + 'z'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = decodeURIComponent((String(req.url || '').split('?')[0].split('/').pop()) || 'x.bin');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': BIN.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(BIN);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

const NOMI = ['SETUP.ISO', 'disco.img', 'macchina.vhd', 'macchina.vhdx', 'app.appref-ms',
  'addin.xll', 'cartella.library-ms', 'impostazioni.settingcontent-ms', 'ripara.diagcab', 'setup.iso.'];

test('ogni tipo nominato si ferma, a raffica e in maiuscolo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const links = NOMI.map((n, i) => `<a id="l${i}" href="${srv.base}/${encodeURIComponent(n)}">${n}</a><br>`).join('');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">${links}</body></html>`);
    for (let i = 0; i < NOMI.length; i++) await page.locator(`#l${i}`).click();
    await expect.poll(async () => (await elenco(shell)).length, { timeout: 30000 }).toBeGreaterThanOrEqual(NOMI.length);
    await page.waitForTimeout(1500);
    const items = await elenco(shell);
    console.log(JSON.stringify(items.map((x) => [x.filename, x.state, x.exe])));
    for (const it of items) {
      expect.soft(it.exe, it.filename).toBe(true);
      expect.soft(it.state, it.filename).toBe('pending');
    }
    console.log('in cartella:', JSON.stringify(contenuto(dir)));
    expect(contenuto(dir).filter((n) => !n.endsWith('.crdownload'))).toEqual([]);
    mkdirSync('tests/.shots', { recursive: true });
    await shell.screenshot({ path: 'tests/.shots/588-1-chiaro.png' });
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await shell.waitForTimeout(800);
    await shell.screenshot({ path: 'tests/.shots/588-1-scuro.png' });
  } finally { await srv.close(); }
});

test('dalla pagina elenco «Apri file» su un disco chiede, col titolo del disco', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__aperti = [];
      shell.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
    });
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="v" href="${srv.base}/macchina.vhdx">vhdx</a></body></html>`);
    await page.locator('#v').click();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.filename === 'macchina.vhdx')?.state, { timeout: 20000 }).toBe('pending');
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'macchina.vhdx' }) });
    await riga.locator('.dl-btn', { hasText: /^Scarica$/ }).click();
    const finita = dl.locator('.dl-item[data-state="completed"]', { has: dl.locator('.dl-name', { hasText: 'macchina.vhdx' }) });
    await expect(finita).toBeVisible({ timeout: 20000 });
    await finita.locator('.dl-btn', { hasText: 'Apri file' }).first().click();
    await dl.waitForTimeout(800);
    mkdirSync('tests/.shots', { recursive: true });
    await dl.screenshot({ path: 'tests/.shots/588-1-pagina.png' });
    await expect(dl.getByText('Aprire un\'immagine disco?')).toBeVisible({ timeout: 5000 });
    expect(await app.evaluate(() => globalThis.__aperti.slice())).toEqual([]);
    await dl.getByText('Apri comunque').click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length), { timeout: 10000 }).toBe(1);
  } finally { await srv.close(); }
});
