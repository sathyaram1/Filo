// Verifica #941 giro 1: esplorazione. Download lento su una pagina: fila in alto senza tasto, avanzamento
// sull'icona della finestra, fila fotografata in chiaro e scuro e a finestra stretta.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');

async function apriServerLento() {
  const TOT = 400_000;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': TOT, 'Content-Disposition': 'attachment; filename="grosso.zip"' });
    let inviati = 0;
    const t = setInterval(() => {
      const pezzo = Math.min(20_000, TOT - inviati);
      res.write(Buffer.alloc(pezzo, 1)); inviati += pezzo;
      if (inviati >= TOT) { clearInterval(t); res.end(); }
    }, 300);
    req.on('close', () => clearInterval(t));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

test('download lento: niente tasto in alto, avanzamento sull’icona, fila pulita', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina</title></head><body style="padding:40px">
      <a id="z" href="${srv.base}/grosso.zip">Scarica</a></body></html>`);
    await page.locator('#z').click();
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return (((r && r.items) || [])[0] || {}).state;
    }, { timeout: 15_000 }).toBe('progressing');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w._filoBarraDownload).filter(Boolean).join('|')), { timeout: 10_000 }).toMatch(/^normal:0\.\d+/);
    const fila = shell.locator('.tab-row');
    const dentro = await fila.evaluate((el) => Array.from(el.querySelectorAll('button, [data-tip]')).filter((x) => x.offsetParent !== null).map((x) => x.id || x.className));
    console.log('elementi visibili nella fila:', dentro.join(', '));
    await expect(shell.locator('.tab-row [data-tip*="ownload"], .tab-row [aria-label*="ownload"]')).toHaveCount(0);
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await fila.screenshot({ path: join(SHOTS, 'verifica-941-fila-chiaro.png') });
    await shell.emulateMedia({ colorScheme: 'dark' });
    await fila.screenshot({ path: join(SHOTS, 'verifica-941-fila-scuro.png') });
    await shell.emulateMedia({ colorScheme: 'light' });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setSize(520, 500); });
    await new Promise((r) => setTimeout(r, 600));
    await fila.screenshot({ path: join(SHOTS, 'verifica-941-fila-stretta.png') });
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return (((r && r.items) || [])[0] || {}).state;
    }, { timeout: 30_000 }).toBe('completed');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w._filoBarraDownload).filter(Boolean).join('|')), { timeout: 10_000 }).toMatch(/^none:/);
  } finally {
    await srv.close();
  }
});
