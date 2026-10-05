// #758 giro 4, rilievo 2: un sito «resta connesso» scritto col sottodominio (come mail.google.com) protegge
// anche i contenuti incorporati del suo sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('un sito fidato scritto con il sottodominio tiene i cookie dei suoi contenuti incorporati', async ({ app, openTab }) => {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/riquadro')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['mid=1; Max-Age=3600; Path=/; SameSite=None; Secure'] });
      res.end('<p>riquadro</p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><iframe src="http://b.localhost:${porta}/riquadro"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  try {
    const sec = await openTab('filo://security/');
    await sec.waitForSelector('#cookie-wl-input');
    await sec.fill('#cookie-wl-input', 'www2.b.localhost');
    await sec.press('#cookie-wl-input', 'Enter');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.trustedSites || []),
      { timeout: 5_000 }).not.toEqual([]);
    await openTab(`http://a.localhost:${porta}/`);
    const mid = () => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost', name: 'mid' }))
      .map((c) => (c.session ? 'sessione' : 'scadenza')));
    await expect.poll(mid, { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mid()).toEqual(['scadenza']);
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
