import { test, expect } from '../../fixtures/electron.mjs';

test('esplora: quindici icone pesanti, tempo di un aggiornamento', async ({ app, shell }) => {
  test.setTimeout(120000);
  await app.evaluate(({ BrowserWindow, session, net, nativeImage }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (!/^s\d+\.test$/.test(u.hostname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (u.pathname === '/i.png') {
        const n = 256 * 256 * 4;
        const b = Buffer.alloc(n);
        for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
        return new Response(nativeImage.createFromBitmap(b, { width: 256, height: 256 }).toPNG(), { headers: { 'content-type': 'image/png' } });
      }
      return new Response(`<!doctype html><title>${u.hostname}</title><link rel="icon" href="/i.png">x`, { headers: { 'content-type': 'text/html' } });
    });
    for (let i = 0; i < 15; i++) tm.openTab(`https://s${i}.test/`, { activate: false });
  });
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.tab .favicon')].filter((x) => x.style.backgroundImage.includes('data:image')).length), { timeout: 60000 }).toBeGreaterThanOrEqual(15);
  const dim = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    return tm.tabs.map((t) => (t.favicon || '').length);
  });
  console.log('DIM', JSON.stringify(dim));
  const tempi = [];
  for (let k = 0; k < 5; k++) {
    await shell.evaluate(() => { window.__t0 = null; window.filoShell.tabs.onUpdate(() => { if (!window.__t1) window.__t1 = performance.now(); }); });
    const t0 = Date.now();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs._broadcast(); });
    const t = await shell.evaluate(() => new Promise((r) => { const a = performance.now(); setTimeout(() => r(performance.now() - a), 0); }));
    tempi.push([Date.now() - t0, Math.round(t)]);
  }
  console.log('TEMPI', JSON.stringify(tempi));
});
