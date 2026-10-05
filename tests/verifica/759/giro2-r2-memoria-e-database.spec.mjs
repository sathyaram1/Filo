// #759 giro 2 — «Resta connesso qui» su un sito che tiene l'accesso nella memoria della scheda o nel suo database: l'utente deve restare dentro.
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
        res.writeHead(302, { 'Set-Cookie': `sid=${n}; Max-Age=86400; Path=/; HttpOnly`, Location: '/home' }); res.end();
      });
      return;
    }
    if (u.pathname === '/home' && sid && sessioni.has(sid)) { html('<!doctype html><title>Casa</title><h1 id="dentro">Ciao</h1>'); return; }
    // Accesso tenuto nella memoria della scheda (sessionStorage), come le app con MSAL.
    if (u.pathname === '/ss') {
      html(`<!doctype html><title>SS</title><div id="out"></div><script>
        if (sessionStorage.getItem('authToken')) document.getElementById('out').innerHTML = '<h1 id="dentro">Dentro SS</h1>';
        else document.getElementById('out').innerHTML = '<input id="pw" type="password"><button id="entra" onclick="sessionStorage.setItem(\\'authToken\\',\\'t\\');location.reload()">Entra</button>';
      </script>`);
      return;
    }
    // Accesso nel database del sito (IndexedDB), come Firebase o WhatsApp Web.
    if (u.pathname === '/idb') {
      html(`<!doctype html><title>IDB</title><div id="out"></div><script>
        const r = indexedDB.open('auth', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('k');
        r.onsuccess = () => { const db = r.result; const g = db.transaction('k').objectStore('k').get('user');
          g.onsuccess = () => {
            if (g.result) document.getElementById('out').innerHTML = '<h1 id="dentro">Dentro IDB</h1>';
            else { document.getElementById('out').innerHTML = '<input id="pw" type="password"><button id="entra">Entra</button>';
              document.getElementById('entra').onclick = () => { const t = db.transaction('k','readwrite'); t.objectStore('k').put('sara','user'); t.oncomplete = () => location.reload(); }; }
          }; };
      </script>`);
      return;
    }
    html('<!doctype html><title>Accedi</title><form method="post" action="/login"><input name="u" value="sara"> <input id="pw" type="password" name="p"><button id="entra">Entra</button></form>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }) };
}

async function pagina(app, pre, timeout = 15_000) {
  const scade = Date.now() + timeout;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(pre); } catch (_) { return false; } });
    if (p) { try { await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 4000 }); return p; } catch (_) {} }
    await sleep(100);
  }
  throw new Error('nessuna scheda su ' + pre);
}
const privacy = (app, ms) => app.evaluate(async (_e, m) => {
  await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } });
  if (m) globalThis.__filoCookies.impostaMargineUscita(m);
}, ms);
const idDi = async (shell, pre) => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs.find((t) => String(t.url).startsWith(pre)).id;

for (const [percorso, nome] of [['/ss', 'memoria di scheda'], ['/idb', 'database del sito']]) {
  test(`login nella ${nome}: «Resta connesso qui» non deve far uscire l'utente`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    const s = await sito();
    try {
      await privacy(app);
      const url = `http://127.0.0.1:${s.port}${percorso}`;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      const p = await pagina(app, url);
      await p.locator('#pw').fill('x');
      await p.locator('#entra').click();
      await expect.poll(async () => { try { return await (await pagina(app, url, 3000)).locator('#dentro').count(); } catch (_) { return -1; } }).toBe(1);
      const id = await idDi(shell, url);
      const r = await shell.evaluate((i) => window.filoShell.tabs.restaConnesso(i, true), id);
      expect(r.ok).toBe(true);
      await sleep(2500);
      await expect.poll(async () => { try { return await (await pagina(app, url, 3000)).locator('#dentro').count(); } catch (_) { return -1; } }, { timeout: 10_000 }).toBe(1);
    } finally { await s.chiudi(); }
  });
}
