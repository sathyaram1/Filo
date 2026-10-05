// #759 giro 1 — «resta connesso su» un servizio che vive su un sottodominio (web.whatsapp.com, mail.google.com):
// dopo la conferma della chat l'utente deve restare connesso chiudendo la scheda.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
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
    html('<!doctype html><title>Accedi</title><form method="post" action="/login"><input id="pw" type="password" name="p"><button id="entra">Entra</button></form>');
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

test('in chat «resta connesso su app.sito.test»: dopo la conferma il login sopravvive alla chiusura della scheda', async () => {
  test.setTimeout(120_000);
  const s = await sito();
  const userData = cartellaTemporanea('filo-v759-');
  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP app.sito.test 127.0.0.1, MAP sito.test 127.0.0.1', '.'],
    cwd: ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await app.evaluate(async () => {
      await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } });
      globalThis.__filoCookies.impostaMargineUscita(800);
    });
    const base = `http://app.sito.test:${s.port}`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${base}/login`);
    const p = await pagina(app, `${base}/login`);
    await p.locator('#pw').fill('x');
    await p.locator('#entra').click();
    await expect.poll(async () => { try { return await (await pagina(app, `${base}/home`)).locator('#dentro').count(); } catch (_) { return -1; } }).toBe(1);

    await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://newtab/');
    const home = await pagina(app, 'filo://newtab/');
    const azione = { type: 'IMPOSTA_PREFERENZA', chiave: 'resta connesso su', valore: 'aggiungi app.sito.test' };
    await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
    const c = await home.evaluate((a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), azione);
    expect(c.executed).toBe(true);
    await sleep(1500);
    // Il menu della scheda deve ora dire «Non restare connesso».
    const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    const scheda = snap.tabs.find((t) => String(t.url).startsWith(base));
    expect.soft(scheda.connesso && scheda.connesso.fidato).toBe(true);

    await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);
    await sleep(3000);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${base}/home`);
    const di = await pagina(app, `${base}/home`);
    await expect(di.locator('#dentro')).toHaveCount(1, { timeout: 10_000 });
  } finally {
    await chiudiApp(app);
    await s.chiudi();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
