import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');

test('esplora: l\'icona chiesta al sito non porta i cookie e arriva come data:', async ({ app, openTab }) => {
  const viste = [];
  const server = createServer((req, res) => {
    viste.push({ path: req.url, cookie: req.headers.cookie || '' });
    if (req.url === '/favicon.ico') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sess=segreto; Path=/' }); res.end('<!doctype html><title>x</title><h1>x</h1>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await app.evaluate(async ({ session }, o) => {
      await session.defaultSession.cookies.set({ url: o, name: 'sess', value: 'segreto' });
    }, origin);
    const home = await openTab('filo://newtab/');
    const r = await home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.ICONA_SITO, url: u }, ok)), `${origin}/pagina`);
    expect(r.ok).toBe(true);
    expect(r.dato).toMatch(/^data:image\/png;base64,/);
    const ico = viste.filter((v) => v.path === '/favicon.ico');
    expect(ico).toHaveLength(1);
    expect(ico[0].cookie).toBe('');
    // stress: url non validi
    for (const u of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'filo://newtab/', 'https://', '<img src=x onerror=alert(1)>', 'x'.repeat(100000)]) {
      const rr = await home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.ICONA_SITO, url: u }, ok)), u);
      expect(rr).toMatchObject({ ok: true, dato: '' });
    }
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('esplora: riga di chat disegnata mentre la scheda del sito si apre', async ({ app, openTab }) => {
  const PNGB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC';
  await app.evaluate(({ session }, blu) => {
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/icona.png') return new Response(Buffer.from(blu, 'base64'), { headers: { 'content-type': 'image/png' } });
      if (u.pathname === '/favicon.ico') return new Response('no', { status: 404 });
      return new Promise((ok) => setTimeout(() => ok(new Response('<!doctype html><head><link rel="icon" href="/icona.png"></head><h1>s</h1>', { headers: { 'content-type': 'text/html' } })), 800));
    });
  }, PNGB);
  const home = await openTab('filo://newtab/');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w._filoTabs.openTab('https://lento.test/p', { activate: false }); });
  await home.evaluate(() => { const h = document.createElement('div'); h.id = 'rr'; document.body.appendChild(h); window.__filoDashActions.renderActions(h, [{ type: 'NAVIGA', url: 'https://lento.test/p' }]); });
  await home.waitForTimeout(4000);
  const n = await home.locator('#rr img').count();
  console.log('IMG nella riga dopo 4s:', n);
  await home.evaluate(() => { const h = document.createElement('div'); h.id = 'rr2'; document.body.appendChild(h); window.__filoDashActions.renderActions(h, [{ type: 'NAVIGA', url: 'https://lento.test/p' }]); });
  await home.waitForTimeout(1500);
  console.log('IMG nella seconda riga:', await home.locator('#rr2 img').count());
});
