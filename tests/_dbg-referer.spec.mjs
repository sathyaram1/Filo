import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const DBG = process.env.FILO_DBG_REF;
const log = (s) => { try { appendFileSync(DBG, s + '\n'); } catch (_) {} };

test('dbg referer', async ({ app, openTab, testServer }) => {
  const imgServer = createServer((req, res) => {
    log(`[SERVER] ${req.method} ${req.url} allHeaders=${JSON.stringify(req.headers)}`);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
    res.end(PNG);
  });
  await new Promise((r) => imgServer.listen(0, '127.0.0.1', r));
  const imgUrl = `http://127.0.0.1:${imgServer.address().port}/protected.png`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body><img id="pic" src="${imgUrl}" width="64" height="64"></body></html>`);
    await page.waitForFunction(() => { const i = document.getElementById('pic'); return i && i.complete && i.naturalWidth > 0; });
    await page.locator('#pic').click({ button: 'right' });
    const item = page.locator('.sn-menu button', { hasText: 'Salva immagine come' });
    await expect(item).toBeVisible();
    await item.click();
    await page.waitForTimeout(4000);
  } finally {
    try { imgServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => imgServer.close(r));
  }
});
