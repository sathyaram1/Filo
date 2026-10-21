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
    if (req.url.startsWith('/home-pref')) {
      // La home di B aperta come sito principale mette un suo cookie al primo caricamento.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['pref=scuro; Max-Age=86400; Path=/'] });
      res.end('<title>HOME B</title><p>home di B</p>');
      return;
    }
    if (req.url.startsWith('/riquadro-partizionato')) {
      // Un cookie partizionato (legato al sito che ospita il riquadro), dall'intestazione e da uno script.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['chips=1; Max-Age=3600; Path=/; SameSite=None; Secure; Partitioned', 'mid=1; Max-Age=3600; Path=/; SameSite=None; Secure'],
      });
      res.end('<p>riquadro</p><script>document.cookie = "jschips=1; max-age=3600; path=/; SameSite=None; Secure; Partitioned";</script>');
      return;
    }
    if (req.url.startsWith('/riquadro-rinfresca')) {
      // Il riquadro di un sito dove l'utente era già entrato rinfresca il suo cookie d'accesso.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['sessionid=abc; Max-Age=86400; Path=/; SameSite=None; Secure'],
      });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/visita')) {
      // Cookie da visitatore che il sito mette dopo il caricamento della pagina, senza nessun accesso.
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': ['_session_id=v1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end('ok');
      return;
    }
    if (req.url.startsWith('/statistiche')) {
      // Le statistiche che una home manda in POST appena caricata, con una chiamata che porta un `token`.
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url.startsWith('/home-post')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>HOME</title><form><input type="password" id="pw"></form><script>'
        + 'setTimeout(() => { fetch("/statistiche", { method: "POST", body: "x" }); fetch("/statistiche?token=abc"); }, 600);'
        + 'setTimeout(() => fetch("/visita"), 1500);</script>');
      return;
    }
    if (req.url.startsWith('/entra-modulo')) {
      res.writeHead(302, { Location: '/dentro', 'Set-Cookie': ['sessionid=m1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end();
      return;
    }
    if (req.url.startsWith('/dentro')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>DENTRO</title><p>dentro</p>');
      return;
    }
    if (req.url.startsWith('/modulo')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>ACCESSO</title><form method="post" action="/entra-modulo"><input name="u" id="u">'
        + '<input type="password" name="p" id="pw"><button id="vai">Entra</button></form>');
      return;
    }
    if (req.url.startsWith('/riquadro-doppio')) {
      // Il riquadro aggiorna il suo cookie due volte di fila: deve restare il valore più nuovo.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>riquadro</p><script>document.cookie = "stato=1; max-age=3600; path=/; SameSite=None; Secure";'
        + 'document.cookie = "stato=2; max-age=3600; path=/; SameSite=None; Secure";</script>');
      return;
    }
    if (req.url.startsWith('/home-con-login')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>HOME</title><form><input type="password" id="pw"></form><script>setTimeout(() => fetch("/visita"), 1500)</script>');
      return;
    }
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
    const riquadro = req.url.startsWith('/art-rinfresca') ? 'riquadro-rinfresca'
      : req.url.startsWith('/art-doppio') ? 'riquadro-doppio'
        : req.url.startsWith('/art-partizionato') ? 'riquadro-partizionato' : 'riquadro';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><a id="vai" href="http://b.localhost:${porta}/home-pref">vai a B</a>`
      + `<a id="nuova" target="_blank" href="http://b.localhost:${porta}/home-pref?n=1">B in una scheda nuova</a>`
      + `<iframe id="ri" width="200" height="120" src="http://b.localhost:${porta}/${riquadro}"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    porta,
    articolo: `http://a.localhost:${porta}/`,
    login: `http://b.localhost:${porta}/login`,
    articoloRinfresca: `http://a.localhost:${porta}/art-rinfresca`,
    homeB: `http://b.localhost:${porta}/home-con-login`,
    homePost: `http://b.localhost:${porta}/home-post`,
    modulo: `http://b.localhost:${porta}/modulo`,
    articoloDoppio: `http://a.localhost:${porta}/art-doppio`,
    articoloPartizionato: `http://a.localhost:${porta}/art-partizionato`,
    homePref: `http://b.localhost:${porta}/home-pref`,
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
    // Quello messo dall'intestazione e quello messo da uno script del riquadro: nessuno dei due ha più una scadenza.
    // Il declassamento arriva un attimo dopo il cookie: si aspetta lui, non il primo avviso.
    await expect.poll(() => cookieDiB(app).then((l) => l.filter((c) => c.session).map((c) => c.name).sort()), { timeout: 10_000 })
      .toEqual(['js', 'mid']);
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
    await login.fill('#pw', 'segreta');
    await new Promise((r) => setTimeout(r, 300));
    await login.evaluate(() => fetch('/accedi', { method: 'POST', credentials: 'same-origin' }));

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

test('chi era già entrato prima (cookie d\'accesso già sul disco): il riquadro che lo rinfresca non lo fa uscire', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    // Un accesso che Filo non ha visto nascere: il cookie persistente c'è, il sito non è nell'elenco.
    await app.evaluate(async ({ session }) => {
      await session.defaultSession.cookies.set({ url: 'http://b.localhost/', name: 'sessionid', value: 'abc', path: '/', expirationDate: Date.now() / 1000 + 86400 * 30 });
    });
    await openTab(srv.articoloRinfresca);
    await expect.poll(() => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost', name: 'sessionid' }))
      .map((c) => c.value + (c.secure ? ':s' : ''))), { timeout: 10_000 }).toEqual(['abc:s']);
    await new Promise((r) => setTimeout(r, 800));
    expect((await cookieDiB(app)).find((c) => c.name === 'sessionid')).toEqual({ name: 'sessionid', session: false });
    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    expect((await cookieDiB(app)).map((c) => c.name)).toContain('sessionid');
  } finally {
    await srv.chiudi();
  }
});

test('la home col modulo d\'accesso vista senza entrare non segna il sito fra quelli con accesso', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.homeB);
    await p.waitForSelector('#pw');
    await expect.poll(() => cookieDiB(app).then((l) => l.map((c) => c.name)), { timeout: 10_000 }).toContain('_session_id');
    await new Promise((r) => setTimeout(r, 1000));
    const logged = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites);
    expect(logged).not.toContain('b.localhost');
  } finally {
    await srv.chiudi();
  }
});

test('la home col modulo d\'accesso che manda statistiche in POST, senza che tu scriva la password, non segna il sito', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.homePost);
    await p.waitForSelector('#pw');
    await expect.poll(() => cookieDiB(app).then((l) => l.map((c) => c.name)), { timeout: 10_000 }).toContain('_session_id');
    await new Promise((r) => setTimeout(r, 1000));
    const logged = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites || []);
    expect(logged).not.toContain('b.localhost');
  } finally {
    await srv.chiudi();
  }
});

test('un accesso col modulo compilato e inviato segna il sito fra quelli dove sei entrato', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.modulo);
    await p.waitForSelector('#pw');
    await p.fill('#u', 'io');
    await p.fill('#pw', 'segreta');
    await p.click('#vai');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites || []),
      { timeout: 10_000 }).toContain('b.localhost');
  } finally {
    await srv.chiudi();
  }
});

test('il riquadro che aggiorna due volte di fila il suo cookie tiene il valore più nuovo, di sessione', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const page = await openTab(srv.articoloDoppio);
    const valore = () => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost', name: 'stato' }))
      .map((c) => `${c.value}:${c.session ? 'sessione' : 'scadenza'}`));
    await expect.poll(valore, { timeout: 10_000 }).toEqual(['2:sessione']);
    await new Promise((r) => setTimeout(r, 800));
    expect(await valore()).toEqual(['2:sessione']);
    const riquadro = page.frames().find((f) => f.url().includes('b.localhost'));
    expect(await riquadro.evaluate(() => document.cookie)).toContain('stato=2');
  } finally {
    await srv.chiudi();
  }
});

const pref = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost', name: 'pref' }))
  .map((c) => (c.session ? 'sessione' : 'scadenza')));
const midDiSessione = (app) => cookieDiB(app).then((l) => l.filter((c) => c.name === 'mid').map((c) => c.session));

// Il sito visto prima incorporato e poi aperto come sito principale nella stessa scheda: i cookie della sua risposta
// arrivano prima che la scheda cambi indirizzo, e restano suoi.
test('dal link dell\'articolo al sito del riquadro, nella stessa scheda: il cookie della sua home resta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const page = await openTab(srv.articolo);
    await expect.poll(() => midDiSessione(app), { timeout: 10_000 }).toEqual([true]);
    await page.click('#vai');
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    const durante = await pref(app);
    await chiudiSchede(app, 'b.localhost');
    await pulisci(app);
    expect({ durante, dopo: await pref(app) }).toEqual({ durante: ['scadenza'], dopo: ['scadenza'] });
  } finally {
    await srv.chiudi();
  }
});

test('il sito del riquadro scritto nella barra di una scheda già aperta: il cookie della sua home resta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await openTab(srv.articolo);
    await expect.poll(() => midDiSessione(app), { timeout: 10_000 }).toEqual([true]);
    await chiudiSchede(app, 'a.localhost');
    await openTab('filo://security/');
    await app.evaluate(({ BrowserWindow }, u) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs;
        if (!tm) continue;
        const t = tm.tabs.find((x) => String(x.url || '').startsWith('filo://security'));
        if (t) tm.navigate(t.id, u);
      }
    }, srv.homePref);
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    const durante = await pref(app);
    await chiudiSchede(app, 'b.localhost');
    await pulisci(app);
    expect({ durante, dopo: await pref(app) }).toEqual({ durante: ['scadenza'], dopo: ['scadenza'] });
  } finally {
    await srv.chiudi();
  }
});

test('dal link dell\'articolo che apre il sito del riquadro in una scheda nuova: il cookie della sua home resta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const page = await openTab(srv.articolo);
    await expect.poll(() => midDiSessione(app), { timeout: 10_000 }).toEqual([true]);
    await page.click('#nuova');
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await pref(app)).toEqual(['scadenza']);
  } finally {
    await srv.chiudi();
  }
});

// Electron non sa riscrivere un cookie partizionato senza scadenza: resta per la visita e se ne va con lei.
test('il cookie partizionato di un riquadro se ne va con la visita, come gli altri', async ({ app, openTab }) => {
  const srv = await serve();
  const tuttiDiB = () => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
    .map((c) => c.name).sort());
  try {
    await app.evaluate(async ({ session }) => {
      // Un cookie normale di B con lo stesso nome, suo da prima: la pulizia del partizionato non lo porta via.
      await session.defaultSession.cookies.set({ url: 'https://b.localhost/', name: 'chips', value: 'mio', path: '/', secure: true,
        sameSite: 'no_restriction', expirationDate: Date.now() / 1000 + 86400 * 30 });
    });
    await openTab(srv.articoloPartizionato);
    await expect.poll(tuttiDiB, { timeout: 10_000 }).toEqual(['chips', 'chips', 'jschips', 'mid']);
    await new Promise((r) => setTimeout(r, 800));
    // Quello dell'intestazione nasce già di sessione; quello dello script resta com'è fino alla fine della visita.
    const durante = await app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
      .map((c) => `${c.name}=${c.value}:${c.session ? 'sessione' : 'scadenza'}`).sort());
    expect(durante).toEqual(['chips=1:sessione', 'chips=mio:scadenza', 'jschips=1:scadenza', 'mid=1:sessione']);
    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    const resta = await app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
      .map((c) => `${c.name}=${c.value}:${c.session ? 'sessione' : 'scadenza'}`));
    expect(resta).toEqual(['chips=mio:scadenza']);
  } finally {
    await srv.chiudi();
  }
});

test('all\'uscita da Filo il cookie partizionato di un riquadro ancora aperto non resta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await openTab(srv.articoloPartizionato);
    await expect.poll(() => cookieDiB(app).then((l) => l.map((c) => c.name).sort()), { timeout: 10_000 }).toEqual(['chips', 'jschips', 'mid']);
    await new Promise((r) => setTimeout(r, 800));
    await app.evaluate(async () => { await globalThis.__filoCookieIncorporati.allUscita(); });
    expect((await cookieDiB(app)).filter((c) => !c.session).map((c) => c.name)).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});
