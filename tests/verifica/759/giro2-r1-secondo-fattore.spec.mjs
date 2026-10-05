// #759 giro 2 — accesso con secondo fattore: la proposta non deve arrivare sulla pagina del codice, prima che l'accesso sia finito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function banca() {
  const pre = new Set();
  const sessioni = new Set();
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ck = req.headers.cookie || '';
    const val = (n) => (ck.match(new RegExp(`(?:^|;\\s*)${n}=([^;]+)`)) || [])[1];
    const html = (c) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(c); };
    const corpo = (req2, fn) => { let b = ''; req2.on('data', (c) => { b += c; }); req2.on('end', () => fn(b)); };
    if (req.method === 'POST' && u.pathname === '/login') {
      corpo(req, () => {
        const n = Math.random().toString(36).slice(2); pre.add(n);
        res.writeHead(302, { 'Set-Cookie': `pre=${n}; Path=/; HttpOnly`, Location: '/codice' }); res.end();
      });
      return;
    }
    if (u.pathname === '/codice' && pre.has(val('pre'))) {
      if (req.method === 'POST') {
        corpo(req, () => {
          const n = Math.random().toString(36).slice(2); sessioni.add(n);
          res.writeHead(302, { 'Set-Cookie': `sid=${n}; Max-Age=86400; Path=/; HttpOnly`, Location: '/home' }); res.end();
        });
        return;
      }
      html('<!doctype html><title>Codice</title><p>Ti abbiamo mandato un codice. Oppure conferma sull\'app.</p><form method="post" action="/codice"><input id="otp" name="c" inputmode="numeric"><button id="ok">Conferma</button></form>');
      return;
    }
    if (u.pathname === '/home' && sessioni.has(val('sid'))) { html('<!doctype html><title>Conto</title><h1 id="dentro">Saldo</h1>'); return; }
    html('<!doctype html><title>Accedi</title><form method="post" action="/login"><input name="u" value="sara"> <input id="pw" type="password" name="p"><button id="entra">Entra</button></form>');
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

test('secondo fattore: niente proposta sulla pagina del codice, arriva dopo il codice', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  const s = await banca();
  try {
    await app.evaluate(async () => { await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } }); });
    const base = `http://127.0.0.1:${s.port}`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${base}/login`);
    const p = await pagina(app, `${base}/login`);
    await p.locator('#pw').fill('giusta');
    await p.locator('#entra').click();
    const c = await pagina(app, `${base}/codice`);
    await sleep(6000);
    const vista = await avvisi();
    const carta = vista.locator('.shell-notif.show', { hasText: "Hai fatto l'accesso a 127.0.0.1" });
    expect(await carta.count(), 'proposta arrivata sulla pagina del codice, prima di aver finito l\'accesso').toBe(0);
    await c.locator('#otp').fill('123456');
    await c.locator('#ok').click();
    await pagina(app, `${base}/home`);
    await expect(carta).toBeVisible({ timeout: 15_000 });
  } finally { await s.chiudi(); }
});
