// #876 giro 1 — fra i programmi fidati Filo non deve proporre come «sito preciso» un host che serve i file di chiunque:
// dopo un programma scaricato da una release GitHub, chi scrive githubusercontent.com non deve sentirsi dire di scrivere
// release-assets.githubusercontent.com (fidarsi di lui = fidarsi delle release di tutti).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'tests', '.shots');

test.use({ hostInPiu: ['github.com', 'release-assets.githubusercontent.com'] });

test('r1 dopo una release GitHub, chi scrive githubusercontent.com non si sente proporre l\'host delle release di tutti', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  let porta = 0;
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (p === '/alice/tool/releases') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body><a id="dl" href="http://github.com:${porta}/alice/tool/releases/download/v1/tool.exe">tool.exe</a></body></html>`);
      return;
    }
    if (p === '/alice/tool/releases/download/v1/tool.exe') {
      res.writeHead(302, { Location: `http://release-assets.githubusercontent.com:${porta}/github-production-release-asset/1/tool.exe` });
      res.end();
      return;
    }
    if (p.endsWith('/tool.exe')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="tool.exe"' });
      res.end(Buffer.from('TVoBAgME', 'base64'));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  porta = srv.address().port;
  try {
    const page = await openTab(`http://github.com:${porta}/alice/tool/releases`);
    await page.locator('#dl').click();
    const voce = async () => ((await shell.evaluate(() => window.filoShell.downloads.list()))?.items || [])
      .find((it) => it.filename === 'tool.exe') || null;
    await expect.poll(async () => (await voce())?.servedBy ?? null, { timeout: 20_000 }).toBe('release-assets.githubusercontent.com');

    const sec = await openTab('filo://security/');
    const casella = sec.locator('#sec-dl-trusted');
    await casella.fill('githubusercontent.com');
    await casella.press('Tab');
    const errore = sec.locator('#sec-dl-trusted-error');
    await expect(errore).toBeVisible({ timeout: 10_000 });
    await expect(errore).toContainText('«githubusercontent.com» raccoglie i siti di chiunque');
    mkdirSync(SHOTS, { recursive: true });
    await sec.locator('#sec-dl-exe-sub').screenshot({ path: join(SHOTS, 'verifica876-githubusercontent.png') });
    await expect(errore).not.toContainText('release-assets.githubusercontent.com');
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
