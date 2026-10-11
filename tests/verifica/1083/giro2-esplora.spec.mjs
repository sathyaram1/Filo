import { test, expect } from '../../fixtures/electron.mjs';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const sfondi = (p) => p.evaluate(() =>
  [...document.querySelectorAll('.tab')].map((t) => ({ testo: t.textContent.trim().slice(0, 40), bg: (t.querySelector('.favicon')?.style.backgroundImage || '').slice(0, 40) })));

async function barraIncognito(app) {
  let p = null;
  await expect.poll(() => {
    p = app.windows().find((w) => { try { return w.url().includes('incognito=1'); } catch (_) { return false; } });
    return !!p;
  }, { timeout: 15000 }).toBe(true);
  return p;
}

test('esplora: pagine interne nella finestra normale', async ({ app, shell, openTab }) => {
  await openTab('filo://history/');
  await openTab('filo://options/');
  await new Promise((r) => setTimeout(r, 4000));
  const s = await sfondi(shell);
  console.log('NORMALE', JSON.stringify(s));
  expect(s.filter((x) => /cronolog|impost|history|option/i.test(x.testo)).every((x) => x.bg.includes('data:image'))).toBe(true);
});

test('esplora: incognito, cookie del profilo normale, redirect, pagina interna', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15000 }).toBe(1);
  await app.evaluate(async ({ BrowserWindow, session, net }, png) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    const inc = session.fromPartition(w._filoTabs.partition);
    const reg = { inc: [], norm: [] };
    globalThis.__reg = reg;
    await session.defaultSession.cookies.set({ url: 'https://sito.test', name: 'conto', value: 'normale', secure: true, sameSite: 'no_restriction' });
    await session.defaultSession.cookies.set({ url: 'https://cdn.test', name: 'conto', value: 'normale', secure: true, sameSite: 'no_restriction' });
    const h = (dove) => (req) => {
      const u = new URL(req.url);
      if (!/\.test$/.test(u.hostname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      reg[dove].push(`${u.hostname}${u.pathname} cookie=${req.headers.get('cookie') || ''}`);
      if (u.pathname === '/r.ico') return new Response(null, { status: 302, headers: { location: 'https://cdn.test/icona.png' } });
      if (u.pathname === '/icona.png') return new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } });
      return new Response('<!doctype html><html><head><meta charset="utf-8"><title>Segreta</title>'
        + '<link rel="icon" href="/r.ico"></head><body>x</body></html>', { headers: { 'content-type': 'text/html' } });
    };
    inc.protocol.handle('https', h('inc'));
    session.defaultSession.protocol.handle('https', h('norm'));
    w._filoTabs.openTab('https://sito.test/');
    w._filoTabs.openTab('filo://history/');
  }, PNG_B64);
  const barra = await barraIncognito(app);
  await new Promise((r) => setTimeout(r, 6000));
  const s = await sfondi(barra);
  const reg = await app.evaluate(() => globalThis.__reg);
  console.log('INCOGNITO', JSON.stringify(s), JSON.stringify(reg));
  expect(reg.norm).toEqual([]);
  expect(s.find((x) => x.testo.includes('Segreta'))?.bg || '').toContain('data:image/png');
});
