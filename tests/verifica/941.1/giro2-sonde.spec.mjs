// Sonda del riallineamento di #941.1: l'avviso di via e quello di «Riprova» (#1287) sono lo stesso avviso.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const GROSSO = 2 * 1024 * 1024;
async function apriServer() {
  let volte = 0;
  const inCorso = [];
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/pagina') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px"><a id="l0" download href="/file/lungo.bin">lungo</a></body></html>');
      return;
    }
    if (++volte === 1) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('non ancora'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': GROSSO, 'Content-Disposition': 'attachment; filename="lungo.bin"' });
    res.write(Buffer.alloc(64 * 1024, 1));
    inCorso.push(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    finisci() { for (const res of inCorso.splice(0)) res.end(Buffer.alloc(GROSSO - 64 * 1024, 1)); },
    async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); },
  };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];

test('dopo «Riprova» su una pagina il via e la fine prendono il posto dell’avviso di fallimento', async ({ shell, openTab, avvisi }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const page = await openTab(`${srv.base}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.locator('#l0').click();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.url.endsWith('/lungo.bin'))?.state, { timeout: 30000 }).toBe('interrupted');
    const vista = await avvisi();
    const fallito = vista.locator('.shell-notif', { hasText: 'Scaricamento non riuscito: lungo.bin' });
    await expect(fallito).toBeVisible({ timeout: 10000 });
    await fallito.locator('.shell-notif-action', { hasText: 'Riprova' }).click();
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Scaricamento avviato: lungo.bin' })).toBeVisible({ timeout: 10000 });
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Scaricamento non riuscito: lungo.bin' })).toHaveCount(0);
    srv.finisci();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.url.endsWith('/lungo.bin'))?.state, { timeout: 20000 }).toBe('completed');
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Scaricato: lungo.bin' })).toHaveCount(1, { timeout: 8000 });
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Scaricamento avviato: lungo.bin' })).toHaveCount(0, { timeout: 4000 });
    expect((await elenco(shell)).filter((x) => x.url.endsWith('/lungo.bin')).length).toBe(1);
  } finally { await srv.close(); }
});
