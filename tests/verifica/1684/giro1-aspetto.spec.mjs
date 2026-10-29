import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const nome = decodeURIComponent(u.pathname.split('/').pop() || 'file.pdf');
    if (u.pathname.startsWith('/rotto/')) { res.writeHead(404); res.end('no'); return; }
    if (u.pathname.startsWith('/pagina/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="padding:40px"><a id="r" download href="/rotto/rapporto-trimestrale.pdf">r</a> <a id="l" href="/lento/archivio-foto-vacanze-2026.zip">l</a> <a id="e" href="/file/setup.exe">e</a></body></html>`);
      return;
    }
    const pezzi = 80;
    const pezzo = Buffer.alloc(16 * 1024, 0x61);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': pezzo.length * pezzi, 'Content-Disposition': `attachment; filename="${nome}"` });
    if (!u.pathname.startsWith('/lento/')) { res.end(Buffer.alloc(pezzo.length * pezzi)); return; }
    let n = 0;
    const t = setInterval(() => { if (res.destroyed) { clearInterval(t); return; } res.write(pezzo); if (++n >= pezzi) { clearInterval(t); res.end(); } }, 400);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, openTab, avvisi }) => {
    test.setTimeout(90_000);
    await app.evaluate((_e, t) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }), tema);
    const srv = await apriServer();
    try {
      const page = await openTab(`${srv.base}/pagina/x`);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
      await page.locator('#r').click();
      await page.locator('#l').click();
      const vista = await avvisi();
      await expect(vista.locator('.shell-notif', { hasText: 'Scaricamento non riuscito' }).last()).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(3000);
      await shell.screenshot({ path: join(SHOTS, `v1684-avviso-${tema}.png`) });
      await page.locator('#e').click();
      await expect(shell.locator('#dl-panel')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(2500);
      await shell.screenshot({ path: join(SHOTS, `v1684-pannello-${tema}.png`) });
      const dl = await openTab('filo://downloads/downloads.html');
      await dl.waitForTimeout(2000);
      await dl.screenshot({ path: join(SHOTS, `v1684-pagina-${tema}.png`) });
    } finally { await srv.close(); }
  });
}
