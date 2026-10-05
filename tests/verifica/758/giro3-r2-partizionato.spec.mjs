// #758 giro 3 — un riquadro di un sito senza accesso che mette un cookie persistente «partizionato» (legato al sito
// che lo ospita): deve durare la visita come gli altri, non restare con la sua scadenza.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/riquadro')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['mid=1; Max-Age=3600; Path=/; SameSite=None; Secure', 'chips=1; Max-Age=3600; Path=/; SameSite=None; Secure; Partitioned'] });
      res.end('<p>riquadro</p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><iframe id="ri" width="200" height="120" src="http://b.localhost:${porta}/riquadro"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return { articolo: `http://a.localhost:${porta}/`, async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); } };
}

const cookieB = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({}))
  .filter((c) => /b\.localhost/.test(c.domain)).map((c) => `${c.name}:${c.session ? 'sessione' : 'scadenza'}`).sort());

test('il cookie partizionato del riquadro dura la visita e poi se ne va, come gli altri', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await openTab(srv.articolo);
    await expect.poll(() => cookieB(app), { timeout: 10_000 }).toContain('mid:sessione');
    await new Promise((r) => setTimeout(r, 1000));
    const durante = await cookieB(app);
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs; if (!tm) continue;
        for (const t of [...tm.tabs]) if (String(t.url).includes('a.localhost')) tm.closeTab(t.id);
      }
    });
    await app.evaluate(async () => {
      const S = globalThis.__filoCookieIncorporati;
      S.margineTest(800);
      for (let i = 0; i < 25; i++) { await S.giroDiPulizia(); await new Promise((r) => setTimeout(r, 150)); }
    });
    expect({ durante, dopo: await cookieB(app) }).toEqual({ durante: ['chips:sessione', 'mid:sessione'], dopo: [] });
  } finally { await srv.chiudi(); }
});
