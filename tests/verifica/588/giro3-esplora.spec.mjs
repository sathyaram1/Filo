// Esplorazione del giro 3 (#588): cosa vede davvero chi guarda lo schermo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = String(req.url || '');
    if (u.startsWith('/vai')) {
      res.writeHead(302, { Location: `http://127.0.0.1:${srv.address().port}/setup.exe` });
      return res.end();
    }
    const nome = u.split('?')[0].split('/').pop() || 'setup.exe';
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': EXE.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

const shot = (nome) => {
  mkdirSync('tests/.shots', { recursive: true });
  try { execFileSync('scrot', ['-o', `tests/.shots/588-g3-${nome}.png`]); } catch (e) { console.log('scrot', e.message); }
};

test('lo schermo vero: la domanda sopra una pagina web', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w.setPosition(0, 0); w.setSize(1280, 840); w.show(); w.setOpacity?.(1);
    });
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;background:#fff">
      <a id="exe" href="${srv.base}/setup.exe">Scarica il programma</a>
      <a id="red" href="http://blocked.test:${srv.porta}/vai">Scarica da sito con rimando</a></body></html>`);
    await page.locator('#exe').click();
    await expect(shell.locator('.shell-notif', { hasText: 'setup.exe' })).toHaveCount(1, { timeout: 15000 });
    await page.waitForTimeout(800);
    shot('pagina-web');

    // Sito fidato + rimando verso un altro host (come github → githubusercontent).
    await app.evaluate(async () => {});
    const sec = await openTab('filo://security/');
    await sec.locator('#sec-dl-trusted').fill('blocked.test');
    await sec.locator('#sec-dl-trusted').press('Tab');
    await expect.poll(() => sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.trustedSites)), { timeout: 10000 }).toEqual(['blocked.test']);
    await page.bringToFront?.();
    await page.locator('#red').click();
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return (r.items || []).filter((x) => x.filename.startsWith('setup')).map((x) => `${x.state}|${x.site}`);
    }, { timeout: 15000 }).toHaveLength(2);
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    console.log('RIMANDO', JSON.stringify((r.items || []).map((x) => [x.filename, x.state, x.site, x.url])));
  } finally {
    await srv.close();
  }
});
