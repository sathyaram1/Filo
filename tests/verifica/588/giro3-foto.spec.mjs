// Foto dello schermo vero (#588 giro 3): la domanda nel pannello sopra una pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(2048));

for (const tema of ['light', 'dark']) {
  test(`foto ${tema}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(120_000);
    const srv = createServer((req, res) => {
      const nome = String(req.url || '').split('/').pop();
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': EXE.length, 'Content-Disposition': `attachment; filename="${nome}"` });
      res.end(EXE);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
        w.setPosition(0, 0); w.setSize(1280, 840); w.show(); w.setOpacity?.(1);
      });
      await shell.evaluate((t) => window.SN_STORAGE?.setSettings?.({ theme: t }), tema).catch(() => {});
      const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;background:#fff">
        <h1>Un sito qualunque</h1><a id="exe" href="${base}/setup.exe">Scarica il programma</a>
        <a id="due" href="${base}/Installa-Programma-Con-Un-Nome-Molto-Lungo-Versione-2026.09.26-x64.msi">Altro</a></body></html>`);
      const sec = await openTab('filo://preferences/');
      await sec.evaluate((t) => chrome.runtime.sendMessage({ type: 'settings_update', partial: { theme: t } }), tema).catch(() => {});
      await page.locator('#exe').click();
      await expect(shell.locator('#dl-panel .dl-row[data-chiede="1"]')).toHaveCount(1, { timeout: 15000 });
      await page.waitForTimeout(700);
      mkdirSync('tests/.shots', { recursive: true });
      execFileSync('scrot', ['-o', `tests/.shots/588-g3-fix-scarica-${tema}.png`]);
      await shell.locator('#dl-panel .dl-row[data-chiede="1"] .dl-row-btn', { hasText: /^Scarica$/ }).click();
      await page.locator('#due').click();
      await expect.poll(async () => (await shell.evaluate(() => window.filoShell.downloads.list())).items.find((x) => x.filename === 'setup.exe')?.state).toBe('completed');
      await shell.locator('.dl-row', { hasText: 'setup.exe' }).locator('.dl-row-btn', { hasText: 'Apri file' }).click();
      await page.waitForTimeout(700);
      execFileSync('scrot', ['-o', `tests/.shots/588-g3-fix-apri-${tema}.png`]);
    } finally {
      srv.closeAllConnections?.(); await new Promise((r) => srv.close(r));
    }
  });
}
