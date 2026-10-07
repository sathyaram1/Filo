// Verifica #588.3 giro 1: un collegamento che passa da un rimando (un
// accorciatore, un tracciatore) e arriva al file servito da un sito fidato.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = String(req.url || '').split('?')[0];
    const nome = u.split('/').pop();
    if (u.startsWith('/via/')) {
      res.writeHead(302, { Location: `http://blocked.test:${srv.address().port}/f/${nome}` });
      res.end();
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
  return { porta: srv.address().port, close: () => new Promise((r) => { try { srv.closeAllConnections?.(); } catch (_) {} srv.close(r); }) };
}

const voce = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return ((r && r.items) || []).find((it) => it.filename === nome) || null;
};

test('r1 un programma servito dal sito fidato scende senza domande anche se il collegamento passa da un rimando', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const sec = await openTab('filo://security/');
    await sec.locator('#sec-dl-trusted').fill('blocked.test');
    await sec.locator('#sec-dl-trusted').press('Tab');
    await expect.poll(() => sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.trustedSites)), { timeout: 10000 }).toEqual(['blocked.test']);

    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px">
      <a id="via" href="http://localhost:${srv.porta}/via/tramite.exe">via rimando</a></body>`);
    await page.locator('#via').click();
    await expect.poll(async () => (await voce(shell, 'tramite.exe'))?.state ?? null, { timeout: 20000 }).toBe('completed');
    expect(existsSync(dir) ? readdirSync(dir) : []).toContain('tramite.exe');
  } finally {
    await srv.close();
  }
});
