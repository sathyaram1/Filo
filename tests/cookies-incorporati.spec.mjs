// #758 — i cookie dei contenuti incorporati di terzi (modalità Automatico): il riquadro di un sito dove non sei
// entrato tiene i suoi cookie solo per la visita; quello di un sito dove sei entrato li tiene.
//
// Due domini finti sul server locale: a.localhost (la pagina) incorpora un riquadro di b.localhost, che mette un
// cookie con scadenza. *.localhost è un'origine fidata per Chromium, quindi il cookie di terze parti
// (SameSite=None; Secure) viene accettato come lo sarebbe su un sito vero in https.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const MARGINE_TEST = 1200;

// Server con due nomi: la pagina sta su a.localhost, il riquadro su b.localhost.
async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/riquadro')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['mid=1; Max-Age=3600; Path=/; SameSite=None; Secure'],
      });
      res.end('<title>RIQUADRO</title><script>document.cookie = "js=1; max-age=3600; path=/; SameSite=None; Secure";</script><p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/accedi')) {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': ['sessionid=abc123; Path=/'] });
      res.end('ok');
      return;
    }
    if (req.url.startsWith('/login')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>ACCESSO</title><form><input type="password" id="pw" /><button type="button">Entra</button></form>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" width="200" height="120" src="http://b.localhost:${porta}/riquadro"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    porta,
    articolo: `http://a.localhost:${porta}/`,
    login: `http://b.localhost:${porta}/login`,
    async chiudi() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

function cookieDiB(app) {
  return app.evaluate(async ({ session }) => {
    const lista = await session.defaultSession.cookies.get({ domain: 'b.localhost' });
    return lista.map((c) => ({ name: c.name, session: !!c.session }));
  });
}

function chiudiSchede(app, pezzo) {
  return app.evaluate(({ BrowserWindow }, frammento) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      for (const t of [...(tm.tabs || [])]) {
        if (String(t.url || '').includes(frammento)) { try { tm.closeTab(t.id); } catch (_) {} }
      }
    }
  }, pezzo);
}

// Il margine vero è di qualche minuto: nel test si accorcia, e i giri di pulizia si chiedono a mano invece di
// aspettare il suo orologio.
async function pulisci(app) {
  await app.evaluate(async (_e, ms) => {
    const S = globalThis.__filoCookieIncorporati;
    S.margineTest(ms);
    for (let i = 0; i < 40; i++) {
      await S.giroDiPulizia();
      await new Promise((r) => setTimeout(r, 150));
    }
  }, MARGINE_TEST);
}

async function setMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

test('il riquadro di un sito dove non sei entrato: i cookie durano la visita e poi se ne vanno', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const page = await openTab(srv.articolo);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect.poll(() => cookieDiB(app).then((l) => l.length), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    // Quello messo dall'intestazione e quello messo da uno script del riquadro: nessuno dei due ha più una scadenza.
    const durante = await cookieDiB(app);
    expect(durante.find((c) => c.name === 'mid')).toEqual({ name: 'mid', session: true });
    expect(durante.find((c) => c.name === 'js')).toEqual({ name: 'js', session: true });
    // Il riquadro continua a funzionare: la pagina legge il suo cookie.
    const dentro = await page.frameLocator('#ri').locator('p').textContent();
    expect(dentro).toBe('riquadro');

    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    expect(await cookieDiB(app)).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});

test('dopo un accesso al sito, il suo riquadro in un\'altra pagina tiene i cookie', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    // Accesso vero: pagina con il campo password, e il cookie di sessione che arriva quando si entra.
    const login = await openTab(srv.login);
    await login.waitForSelector('#pw', { timeout: 8_000 });
    await login.evaluate(() => fetch('/accedi', { credentials: 'same-origin' }));

    // Il sito compare fra quelli dove sei entrato, in Sicurezza, e da lì si può togliere.
    const sec = await openTab('filo://security/');
    await expect.poll(async () => sec.locator('#sec-cookies-accessi').isVisible(), { timeout: 10_000 }).toBe(true);
    await expect(sec.locator('#cookie-accessi-list li')).toContainText(['b.localhost']);
    expect(await sec.locator('#cookie-accessi-list button').first().textContent()).toBeTruthy();

    // La scheda del sito si chiude: quello che protegge i cookie adesso è l'accesso, non la scheda aperta.
    await chiudiSchede(app, 'b.localhost');
    const page = await openTab(srv.articolo);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect.poll(() => cookieDiB(app).then((l) => l.filter((c) => c.name === 'mid').length), { timeout: 10_000 }).toBe(1);
    expect((await cookieDiB(app)).find((c) => c.name === 'mid')).toEqual({ name: 'mid', session: false });

    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    // Il cookie del sito dove sei entrato resta anche dopo che la pagina che lo ospitava è chiusa.
    expect((await cookieDiB(app)).map((c) => c.name)).toContain('mid');
  } finally {
    await srv.chiudi();
  }
});

test('in Manuale i cookie del riquadro restano come li ha messi il sito (controprova)', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await setMode(openTab, 'manual');
    const page = await openTab(srv.articolo);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect.poll(() => cookieDiB(app).then((l) => l.length), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const durante = await cookieDiB(app);
    expect(durante.find((c) => c.name === 'mid')).toEqual({ name: 'mid', session: false });
    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    expect((await cookieDiB(app)).map((c) => c.name)).toContain('mid');
  } finally {
    await srv.chiudi();
  }
});
