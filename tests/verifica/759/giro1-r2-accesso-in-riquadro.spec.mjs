// #759 giro 1 — un accesso fatto in un riquadro della pagina (come su icloud.com): la proposta deve arrivare.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sito() {
  const sessioni = new Set();
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sid = ((req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/) || [])[1];
    const html = (c) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(c); };
    if (req.method === 'POST' && u.pathname === '/login') {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const n = Math.random().toString(36).slice(2); sessioni.add(n);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `sid=${n}; Max-Age=86400; Path=/; HttpOnly` });
        res.end('<!doctype html><script>top.location.href = "/home";</script>');
      });
      return;
    }
    if (u.pathname === '/cornice') { html('<!doctype html><title>Accedi</title><h1>Servizio</h1><iframe id="f" src="/modulo" style="width:400px;height:200px"></iframe>'); return; }
    if (u.pathname === '/modulo') { html('<!doctype html><form method="post" action="/login"><input id="pw" type="password" name="p"><button id="entra">Entra</button></form>'); return; }
    if (u.pathname === '/home' && sid && sessioni.has(sid)) { html('<!doctype html><title>Casa</title><h1 id="dentro">Ciao</h1>'); return; }
    html('<!doctype html><title>Fuori</title><p>fuori</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }) };
}

async function pagina(app, pre) {
  const scade = Date.now() + 15_000;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(pre); } catch (_) { return false; } });
    if (p) { try { await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 4000 }); return p; } catch (_) {} }
    await sleep(100);
  }
  throw new Error('nessuna scheda su ' + pre);
}

test('accesso dentro un riquadro della pagina: Filo propone «Resta connesso»', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  const s = await sito();
  try {
    await app.evaluate(async () => {
      await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } });
    });
    const base = `http://127.0.0.1:${s.port}`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${base}/cornice`);
    const p = await pagina(app, `${base}/cornice`);
    const f = p.frameLocator('#f');
    await f.locator('#pw').fill('giusta');
    await f.locator('#entra').click();
    await expect.poll(async () => { try { return await (await pagina(app, `${base}/home`)).locator('#dentro').count(); } catch (_) { return -1; } }).toBe(1);
    // Senza proposta la vista degli avvisi non nasce nemmeno: anche quello è il rosso.
    const vista = await avvisi();
    const carta = vista.locator('.shell-notif.show', { hasText: 'Hai fatto l\'accesso a 127.0.0.1' });
    await expect(carta).toBeVisible({ timeout: 30_000 });
  } finally {
    await s.chiudi();
  }
});
