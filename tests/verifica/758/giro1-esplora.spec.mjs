// Verifica #758 giro 1: cookie dei contenuti incorporati. Prove della critica (vedi i nomi dei casi).
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = resolve(APP_ROOT, 'tests', '.shots');

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/riquadro-rinfresca')) {
      // Il riquadro di un sito dove sei già entrato rinfresca il suo cookie d'accesso (come fanno i servizi veri).
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['sessionid=abc; Max-Age=86400; Path=/; SameSite=None; Secure'],
      });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/riquadro')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['mid=1; Max-Age=3600; Path=/; SameSite=None; Secure'],
      });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/visita')) {
      // Cookie da visitatore che un sito mette dopo il caricamento (bootstrap di una SPA): nessun accesso.
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': ['_session_id=v1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end('ok');
      return;
    }
    if (req.url.startsWith('/home-con-login')) {
      // La home di un social per chi non ha account: il modulo d'accesso è nella pagina stessa.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>HOME</title><form><input type="password" id="pw"></form><script>setTimeout(()=>fetch("/visita"),1500)</script>');
      return;
    }
    const rif = req.url.startsWith('/art-rinfresca') ? 'riquadro-rinfresca' : 'riquadro';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" src="http://b.localhost:${porta}/${rif}"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    porta,
    articolo: `http://a.localhost:${porta}/`,
    articoloRinfresca: `http://a.localhost:${porta}/art-rinfresca`,
    homeB: `http://b.localhost:${porta}/home-con-login`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const cookieDiB = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
  .map((c) => ({ name: c.name, session: !!c.session })));

function chiudiSchede(app, pezzo) {
  return app.evaluate(({ BrowserWindow }, f) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs; if (!tm) continue;
      for (const t of [...(tm.tabs || [])]) if (String(t.url || '').includes(f)) { try { tm.closeTab(t.id); } catch (_) {} }
    }
  }, pezzo);
}

async function pulisci(app) {
  await app.evaluate(async () => {
    const S = globalThis.__filoCookieIncorporati;
    S.margineTest(800);
    for (let i = 0; i < 20; i++) { await S.giroDiPulizia(); await new Promise((r) => setTimeout(r, 150)); }
  });
}

async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna scheda per ' + url);
}

function lancia(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
}

test('r1 — chiudere Filo durante il margine: al riavvio il cookie del riquadro non c\'è più', async () => {
  test.setTimeout(90_000);
  const srv = await serve();
  const userData = cartellaTemporanea('filo-ver758-');
  try {
    let app = await lancia(userData);
    let shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await apri(app, shell, srv.articolo);
    await expect.poll(() => cookieDiB(app), { timeout: 10_000 }).toEqual([{ name: 'mid', session: true }]);
    await chiudiSchede(app, 'a.localhost');
    await new Promise((r) => setTimeout(r, 500));
    await chiudiApp(app, { tetto: 10_000 });

    app = await lancia(userData);
    shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((r) => setTimeout(r, 1500));
    // La visita è finita (scheda chiusa, app chiusa): dal punto di vista dell'utente il riquadro non lo segue più.
    expect(await cookieDiB(app)).toEqual([]);
    await chiudiApp(app);
  } finally {
    await srv.chiudi();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('r2 — chi era già entrato prima dell\'aggiornamento: il riquadro che rinfresca l\'accesso non lo fa uscire', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    // Accesso fatto prima di questa versione: il cookie d'accesso persistente c'è, Filo non l'ha «visto» nascere.
    await app.evaluate(async ({ session }) => {
      await session.defaultSession.cookies.set({ url: 'http://b.localhost/', name: 'sessionid', value: 'abc', path: '/', expirationDate: Date.now() / 1000 + 86400 * 30 });
    });
    await openTab(srv.articoloRinfresca);
    await expect.poll(() => cookieDiB(app).then((l) => l.find((c) => c.name === 'sessionid')?.session), { timeout: 10_000 }).toBeDefined();
    await new Promise((r) => setTimeout(r, 800));
    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    expect((await cookieDiB(app)).map((c) => c.name)).toContain('sessionid');
  } finally { await srv.chiudi(); }
});

test('r3 — aprire la home di un sito col modulo d\'accesso, senza entrare, non lo segna fra i siti dove sei entrato', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.homeB);
    await p.waitForSelector('#pw');
    await expect.poll(() => cookieDiB(app).then((l) => l.map((c) => c.name)), { timeout: 10_000 }).toContain('_session_id');
    await new Promise((r) => setTimeout(r, 1000));
    const logged = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites);
    expect(logged).not.toContain('b.localhost');
  } finally { await srv.chiudi(); }
});

test('esplora — elenco «Siti dove sei entrato» in chiaro e in scuro; togliere un sito riattiva il declassamento', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    mkdirSync(SHOTS, { recursive: true });
    await app.evaluate(async () => {
      const { applySettingsUpdate } = require(process.cwd() + '/src/main/services/handlers');
      await applySettingsUpdate({ security: { cookies: { loggedSites: ['b.localhost', 'instagram.com', 'un-nome-di-dominio-molto-molto-lungo-per-vedere-come-va-a-capo.example.co.uk'] } } });
    }).catch(async () => {
      await app.evaluate(async () => {
        const s = await globalThis.SN_STORAGE.getSettings();
        s.security.cookies.loggedSites = ['b.localhost', 'instagram.com'];
        await globalThis.SN_STORAGE.saveSettings?.(s);
      });
    });
    const sec = await openTab('filo://security/');
    await expect(sec.locator('#sec-cookies-accessi')).toBeVisible({ timeout: 10_000 });
    await sec.locator('#sec-cookies-accessi').scrollIntoViewIfNeeded();
    for (const tema of ['light', 'dark']) {
      await sec.emulateMedia({ colorScheme: tema });
      await sec.waitForTimeout(300);
      await sec.screenshot({ path: join(SHOTS, `v758-accessi-${tema}.png`), fullPage: false });
    }
    await sec.locator('#cookie-accessi-list li', { hasText: 'b.localhost' }).locator('button').click();
    await expect(sec.locator('#cookie-accessi-list li', { hasText: 'b.localhost' })).toHaveCount(0);
    await openTab(srv.articolo);
    await expect.poll(() => cookieDiB(app), { timeout: 10_000 }).toEqual([{ name: 'mid', session: true }]);
  } finally { await srv.chiudi(); }
});
