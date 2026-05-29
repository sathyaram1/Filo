import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Server con CSP restrittiva (come youtube/reddit): blocca i <link filo://style>.
let server, origin;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    });
    res.end(`<!doctype html><html><body style="padding:40px"><h1>CSP site</h1><p id="p">right click</p></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('repro CSP: menu Filo stile applicato su sito con CSP restrittiva', async ({ app, shell }) => {
  const port = new URL(origin).port;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origin);
  const deadline = Date.now() + 12000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => { try { return new URL(w.url()).port === port; } catch { return false; } });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(page).toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  await page.locator('#p').click({ button: 'right' });
  await page.waitForTimeout(400);
  const menu = page.locator('.sn-menu').first();
  const count = await page.locator('.sn-menu').count();
  console.log('MENU COUNT', count);
  if (count > 0) {
    const style = await menu.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, zIndex: cs.zIndex, bg: cs.backgroundColor, display: cs.display };
    });
    console.log('MENU STYLE', JSON.stringify(style));
    // menu.css impone position:fixed e uno z-index alto. Se la CSP ha bloccato
    // il <link filo://style/menu.css>, position sarà 'static' (default) → rotto.
    expect(style.position, 'menu.css non applicato (CSP ha bloccato lo stylesheet)').toBe('fixed');
  }
  expect(count).toBeGreaterThan(0);
});
