// Diagnostica temporanea (#309): quali eventi emette Electron su un 302 → file://?
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test('diag redirect events', async ({ app, openTab }) => {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/start') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>start</title><p>x</p>');
      return;
    }
    if (path === '/to-file') { res.writeHead(302, { Location: 'file://attacker.example/share/x' }); res.end(); return; }
    if (path === '/to-mailto') { res.writeHead(302, { Location: 'mailto:a@b.c' }); res.end(); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const page = await openTab(`${origin}/start`);
  await app.evaluate(({ webContents }) => {
    globalThis.__diag = [];
    for (const wc of webContents.getAllWebContents()) {
      for (const ev of ['will-redirect', 'did-redirect-navigation', 'will-navigate', 'did-fail-load', 'did-start-navigation']) {
        wc.on(ev, (...args) => {
          const flat = args.slice(1, 4).map((a) => (typeof a === 'object' && a ? (a.url || JSON.stringify(Object.keys(a))) : String(a)));
          globalThis.__diag.push([ev, ...flat]);
        });
      }
    }
  });

  await page.evaluate(() => { window.location.href = '/to-file'; });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => { window.location.href = '/to-mailto'; }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const diag = await app.evaluate(() => globalThis.__diag);
  console.log('DIAG:', JSON.stringify(diag, null, 1));
  console.log('FINAL URL:', page.url());
  expect(true).toBe(true);
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});
