import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const nome = decodeURIComponent(u.pathname.split('/').pop() || 'file.pdf');
    const kb = Number(u.searchParams.get('kb') || 512);
    const ms = Number(u.searchParams.get('ms') || 6000);
    const pezzi = 40;
    const pezzo = Buffer.alloc(Math.ceil((kb * 1024) / pezzi), 0x61);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pezzo.length * pezzi, 'Content-Disposition': `attachment; filename="${nome}"` });
    let n = 0;
    const t = setInterval(() => {
      if (res.destroyed) { clearInterval(t); return; }
      res.write(pezzo);
      if (++n >= pezzi) { clearInterval(t); res.end(); }
    }, ms / pezzi);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

async function trovaPagina(app, prova, tetto = 15000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('pagina non trovata');
}
const incognitoAperta = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && !w.isDestroyed()));

test('incognito: uno in pausa e uno in corso, chiudo con la scorciatoia, «Lascia finire»: arrivano tutti e due', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const url = testServer.html(`<!doctype html><html><body><a id="a" href="${srv.base}/x/fermo-uno.pdf?kb=300&ms=8000">A</a> <a id="b" href="${srv.base}/x/fermo-due.pdf?kb=300&ms=8000">B</a></body></html>`);
    await shell.evaluate(() => window.filoShell.openIncognito());
    const incog = await trovaPagina(app, (u) => u.startsWith('filo://shell/') && u.includes('incognito=1'));
    await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1');
    await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u); }, url.replace(/\/(\d+)$/, '/$1?pagina'));
    const sito = await trovaPagina(app, (u) => u.startsWith('http://127.0.0.1') && u.includes('?pagina'));
    await sito.waitForLoadState('domcontentloaded');
    await sito.locator('#a').click();
    await sito.locator('#b').click();
    const lista = async () => ((await incog.evaluate(() => window.filoShell.downloads.list())).items || []);
    await expect.poll(async () => (await lista()).filter((x) => x.state === 'progressing').length, { timeout: 15000 }).toBe(2);
    const uno = (await lista()).find((x) => x.filename === 'fermo-uno.pdf');
    await incog.evaluate((id) => window.filoShell.downloads.pause(id), uno.id);
    await expect.poll(async () => (await lista()).find((x) => x.id === uno.id)?.state, { timeout: 10000 }).toBe('paused');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close(); });
    const domanda = incog.locator('#dl-panel #dl-chiusura');
    await expect(domanda).toBeVisible({ timeout: 10000 });
    await expect(domanda).toContainText('2 scaricamenti');
    const b = domanda.locator('.dl-row-btn', { hasText: 'Lascia finire' });
    await expect(b).toBeEnabled({ timeout: 5000 });
    await b.click();
    await expect.poll(() => incognitoAperta(app), { timeout: 10000 }).toBe(false);
    for (const n of ['fermo-uno.pdf', 'fermo-due.pdf']) {
      await expect.poll(() => contenuto(dir).includes(n) && statSync(join(dir, n)).size > 250 * 1024, { timeout: 30000 }).toBe(true);
    }
  } finally { await srv.close(); }
});
