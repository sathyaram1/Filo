// Verifica #1057 giro 3, rilievo 1: un accesso fatto nel riquadro di una pagina deve ancora far partire «Resta connesso».
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito() {
  const sessioni = new Set();
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sid = ((req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/) || [])[1];
    const html = (c) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(c); };
    if (u.pathname === '/cornice') {
      html('<!doctype html><title>Servizio</title><iframe id="f" src="/login" style="width:500px;height:240px"></iframe>');
      return;
    }
    if (req.method === 'POST' && u.pathname === '/login') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const n = Math.random().toString(36).slice(2);
        sessioni.add(n);
        res.writeHead(302, { 'Set-Cookie': `sid=${n}; Max-Age=86400; Path=/; HttpOnly`, Location: '/home' });
        res.end();
      });
      return;
    }
    if (u.pathname === '/home' && sid && sessioni.has(sid)) { html('<!doctype html><title>Casa</title><h1 id="dentro">Ciao</h1>'); return; }
    html('<!doctype html><title>Accedi</title><form method="post" action="/login"><input name="u" value="sara"> <input id="pw" type="password" name="p"> <button id="entra">Entra</button></form>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { a: `http://127.0.0.1:${server.address().port}`, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

test('r1 la password scritta nel riquadro della pagina fa comparire la proposta di restare connessi', async ({ app, shell, openTab, avvisi }) => {
  test.setTimeout(90_000);
  const s = await sito();
  try {
    await app.evaluate(async () => {
      await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } });
    });
    const page = await openTab(`${s.a}/cornice`);
    const riquadro = page.frameLocator('#f');
    await riquadro.locator('#pw').fill('giusta');
    await riquadro.locator('#entra').click();
    await expect(riquadro.locator('#dentro')).toBeVisible({ timeout: 15_000 });
    const carta = (await avvisi()).locator('.shell-notif.show', { hasText: "Hai fatto l'accesso a 127.0.0.1" });
    await expect(carta).toBeVisible({ timeout: 15_000 });
  } finally {
    await s.chiudi();
  }
});
