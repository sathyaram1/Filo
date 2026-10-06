// #760 — un contenuto incorporato rotto perché Filo ne rifiuta i cookie: Filo se ne accorge e propone sopra il
// riquadro di riattivarli. Servizio noto → regola, senza modello; sconosciuto e rotto → il modello guarda l'immagine
// del solo riquadro; sconosciuto che funziona → nessuna chiamata.
//
// Domini finti sul server locale: a.localhost ospita, b.localhost fa il servizio noto (registrato come tale solo
// nel test), cosmo.localhost e d.localhost sono servizi che Filo non conosce. *.localhost è un'origine fidata per
// Chromium, quindi i cookie di terze parti (SameSite=None; Secure) passano come su un sito vero in https.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const LARGO = 420;
const ALTO = 300;

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    const u = new URL(req.url, 'http://x');
    const cookie = String(req.headers.cookie || '');
    const html = (corpo, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px sans-serif">${corpo}`);
    };
    const conCookie = { 'Set-Cookie': ['vista=1; Max-Age=86400; Path=/; SameSite=None; Secure'] };
    if (u.pathname === '/art') {
      const h = u.searchParams.get('h');
      const p = u.searchParams.get('p');
      html(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" width="${LARGO}" height="${ALTO}" style="border:0" src="http://${h}.localhost:${porta}/${p}"></iframe><p>fine</p>`);
      return;
    }
    if (u.pathname === '/post') {
      // Il servizio noto: senza il suo cookie mostra il segnaposto, con il cookie il post. Il cookie lo rinfresca
      // a ogni caricamento, come fanno i servizi veri.
      if (/vista=1/.test(cookie)) html('<p id="ok">Il post: tramonto sul mare</p>', conCookie);
      else html('<p>Accedi per vedere il post</p>', conCookie);
      return;
    }
    if (u.pathname === '/vuoto') {
      if (/vista=1/.test(cookie)) html('<p id="ok">La mappa del quartiere</p>', conCookie);
      else html('<div style="padding:40px"><button>Accedi</button></div>', conCookie);
      return;
    }
    // Senza cookie il riquadro viene rimandato all'accesso, su un altro sottodominio dello stesso servizio.
    if (u.pathname === '/redir') {
      if (/vista=1/.test(cookie)) { html('<p id="ok">Il contenuto dopo l\'accesso</p>', conCookie); return; }
      const host = String(req.headers.host || '').split(':')[0];
      res.writeHead(302, { Location: `http://accounts.${host}:${porta}/login` });
      res.end();
      return;
    }
    if (u.pathname === '/login') {
      // Il cookie vale per tutto il servizio, come quelli di un accesso vero.
      const host = String(req.headers.host || '').split(':')[0];
      const delServizio = { 'Set-Cookie': [`vista=1; Max-Age=86400; Path=/; Domain=${host.replace(/^accounts\./, '')}; SameSite=None; Secure`] };
      if (/^accounts\.b\./.test(host)) html('<p>Accedi per vedere il post</p>', delServizio);
      else html('<div style="padding:40px"><button>Accedi</button></div>', delServizio);
      return;
    }
    if (u.pathname === '/funziona') {
      const testo = Array.from({ length: 140 }, (_, i) => `parola${i}`).join(' ');
      html(`<canvas width="200" height="120" style="background:#c45a3b"></canvas><p>${testo}</p>`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    art: (h, p) => `http://a.localhost:${porta}/art?h=${h}&p=${p}`,
    async chiudi() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// b.localhost fa la parte di un servizio noto col suo segnaposto; il modello è finto e ogni chiamata si conta.
// I siti di casa non vanno mai al modello (#591): qui tutto è su localhost, quindi il controllo si spegne.
async function prepara(app, { risposta = '{"rotto": true, "servizio": "Cosmo"}' } = {}) {
  await app.evaluate(async ({ nativeImage }, risp) => {
    const C = globalThis.SN_CONST;
    globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EMBED_COOKIE_CHECK]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    globalThis.__chiamateRiquadri = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const img = Array.isArray(u.content) ? u.content.find((p) => p.type === 'image_url') : null;
      let misura = null;
      if (img) misura = nativeImage.createFromDataURL(img.image_url.url).getSize();
      globalThis.__chiamateRiquadri.push({ immagine: !!img, misura });
      return { text: risp, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, risposta);
}

const chiamate = (app) => app.evaluate(() => globalThis.__chiamateRiquadri || []);

function proposte(app, frammento) {
  return app.evaluate(async ({ BrowserWindow }, f) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
        const wc = t.view && t.view.webContents;
        if (!wc || wc.isDestroyed() || !wc.getURL().includes(f)) continue;
        return wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_RIQUADRO_COOKIE?._test?.proposte() ?? []' }]);
      }
    }
    return [];
  }, frammento);
}

async function aspettaProposta(app, frammento) {
  let lista = [];
  await expect.poll(async () => { lista = await proposte(app, frammento); return lista.length; }, { timeout: 25_000 }).toBe(1);
  return lista[0];
}

const cookieVista = (app) => app.evaluate(async ({ session }) => {
  const lista = await session.defaultSession.cookies.get({ name: 'vista' });
  return lista.map((c) => ({ dominio: c.domain, session: !!c.session }));
});

const impostazioni = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.embedSites);

test('servizio noto col segnaposto: la proposta compare senza il modello, «Sì» ricarica il riquadro che funziona', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('b', 'post'));
    const p = await aspettaProposta(app, 'a.localhost');
    expect(p.testo).toBe('Attivo i cookie di Fotogrammi per questo contenuto?');
    expect(p.visibile).toBe(true);
    await page.screenshot({ path: 'tests/.shots/riquadro-rotto-proposta.png' });
    await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
    await page.screenshot({ path: 'tests/.shots/riquadro-rotto-proposta-scuro.png' });
    // Sta sopra il riquadro, nella sua metà alta, non altrove nella pagina.
    expect(p.si.y).toBeGreaterThan(p.riquadro.y - ALTO / 2);
    expect(p.si.y).toBeLessThan(p.riquadro.y);
    expect(await chiamate(app)).toEqual([]);

    await page.mouse.click(p.si.x, p.si.y);
    await expect(page.frameLocator('#ri').locator('#ok')).toHaveText('Il post: tramonto sul mare', { timeout: 10_000 });
    expect(await impostazioni(app)).toEqual(['b.localhost']);
    // Il servizio adesso tiene i suoi cookie come un sito dove sei entrato: non durano più solo la visita.
    await expect.poll(() => cookieVista(app), { timeout: 8_000 }).toEqual([{ dominio: 'b.localhost', session: false }]);
    expect(await chiamate(app)).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});

test('riquadro sconosciuto rotto: una chiamata al modello con l\'immagine del solo riquadro, poi la proposta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('cosmo', 'vuoto'));
    const p = await aspettaProposta(app, 'a.localhost');
    expect(p.testo).toBe('Attivo i cookie di Cosmo per questo contenuto?');
    const c = await chiamate(app);
    expect(c.length).toBe(1);
    expect(c[0].immagine).toBe(true);
    // L'immagine è grande quanto il riquadro, non quanto la pagina.
    expect(Math.abs(c[0].misura.width - LARGO)).toBeLessThanOrEqual(2);
    expect(Math.abs(c[0].misura.height - ALTO)).toBeLessThanOrEqual(2);

    await page.mouse.click(p.si.x, p.si.y);
    await expect(page.frameLocator('#ri').locator('#ok')).toHaveText('La mappa del quartiere', { timeout: 10_000 });
    expect(await impostazioni(app)).toEqual(['cosmo.localhost']);
    // Ricaricato e funzionante: non lo si riguarda.
    await page.waitForTimeout(3000);
    expect((await chiamate(app)).length).toBe(1);
  } finally {
    await srv.chiudi();
  }
});

test('riquadro sconosciuto che funziona: nessuna chiamata al modello e nessuna proposta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('d', 'funziona'));
    await expect(page.frameLocator('#ri').locator('canvas')).toBeVisible();
    await page.waitForTimeout(12_000);
    expect(await chiamate(app)).toEqual([]);
    expect(await proposte(app, 'a.localhost')).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});

test('«No» chiude la proposta e non la ripropone; il tasto destro sul riquadro riattiva e toglie, come Sicurezza', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('b', 'post'));
    const p = await aspettaProposta(app, 'a.localhost');
    await page.mouse.click(p.no.x, p.no.y);
    await expect.poll(() => proposte(app, 'a.localhost').then((l) => l.length), { timeout: 5_000 }).toBe(0);
    await page.reload();
    await page.waitForTimeout(9000);
    expect(await proposte(app, 'a.localhost')).toEqual([]);
    expect(await impostazioni(app)).toEqual([]);

    // Dal tasto destro dentro il riquadro si riattiva lo stesso.
    const ri = page.frameLocator('#ri');
    await ri.locator('html').click({ button: 'right', position: { x: 60, y: 60 } });
    await ri.locator('.sn-menu').getByText('Attiva i cookie di Fotogrammi qui', { exact: true }).click();
    await expect(ri.locator('#ok')).toHaveText('Il post: tramonto sul mare', { timeout: 10_000 });
    expect(await impostazioni(app)).toEqual(['b.localhost']);

    // In Sicurezza c'è, e si toglie da lì.
    const sec = await openTab('filo://security/');
    await expect(sec.locator('#sec-cookies-riquadri')).toBeVisible({ timeout: 8_000 });
    await expect(sec.locator('#cookie-riquadri-list li')).toHaveCount(1);
    await expect(sec.locator('#cookie-riquadri-list li')).toContainText('b.localhost');
    await sec.locator('#cookie-riquadri-list button').click();
    await expect.poll(() => impostazioni(app), { timeout: 5_000 }).toEqual([]);
    await expect(sec.locator('#sec-cookies-riquadri')).toBeHidden();

    // Riattivato di nuovo dal tasto destro, si toglie anche da lì.
    await ri.locator('html').click({ button: 'right', position: { x: 60, y: 60 } });
    await ri.locator('.sn-menu').getByText('Attiva i cookie di Fotogrammi qui', { exact: true }).click();
    await expect.poll(() => impostazioni(app), { timeout: 5_000 }).toEqual(['b.localhost']);
    await expect.poll(() => sec.locator('#cookie-riquadri-list li').count(), { timeout: 5_000 }).toBe(1);
    await expect(ri.locator('#ok')).toBeVisible({ timeout: 10_000 });
    await ri.locator('html').click({ button: 'right', position: { x: 60, y: 60 } });
    await ri.locator('.sn-menu').getByText('Togli i cookie riattivati di Fotogrammi', { exact: true }).click();
    await expect.poll(() => impostazioni(app), { timeout: 5_000 }).toEqual([]);
    await expect(sec.locator('#sec-cookies-riquadri')).toBeHidden();
  } finally {
    await srv.chiudi();
  }
});

test('in Privacy: «Sì» fa sopravvivere i cookie del servizio nello spazio del sito che lo ospita, oltre l\'uscita', async ({ app, openTab, shell }) => {
  const srv = await serve();
  try {
    await prepara(app);
    await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { security: { cookies: { mode: 'privacy' } } } }));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
    await app.evaluate(() => globalThis.__filoCookies.impostaMargineUscita(800));

    const page = await openTab(srv.art('b', 'post'));
    const p = await aspettaProposta(app, 'a.localhost');
    await page.mouse.click(p.si.x, p.si.y);
    await expect(page.frameLocator('#ri').locator('#ok')).toBeVisible({ timeout: 10_000 });

    // Uscito dal sito (scheda chiusa, margine passato) lo spazio si butta: il riquadro di Fotogrammi resta servito.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of [...((w._filoTabs && w._filoTabs.tabs) || [])]) {
          if (String(t.url || '').includes('a.localhost')) w._filoTabs.closeTab(t.id);
        }
      }
    });
    await new Promise((r) => setTimeout(r, 3000));
    const di = await openTab(srv.art('b', 'post') + '&di=nuovo');
    await expect(di.frameLocator('#ri').locator('#ok')).toHaveText('Il post: tramonto sul mare', { timeout: 10_000 });
    // E il servizio non ha ricevuto niente nello spazio suo: i cookie stanno solo in quello del sito che lo ospita.
    expect(await cookieVista(app)).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});

test('rimandato all\'accesso su un altro sottodominio: la proposta compare sopra il riquadro e «Sì» lo riporta al contenuto', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('b', 'redir'));
    await expect(page.frameLocator('#ri').getByText('Accedi per vedere il post')).toBeVisible();
    const p = await aspettaProposta(app, 'a.localhost');
    expect(p.visibile).toBe(true);
    expect(p.si.y).toBeGreaterThan(p.riquadro.y - ALTO / 2);
    expect(p.si.y).toBeLessThan(p.riquadro.y);
    await page.mouse.click(p.si.x, p.si.y);
    await expect(page.frameLocator('#ri').locator('#ok')).toHaveText('Il contenuto dopo l\'accesso', { timeout: 10_000 });
    expect(await chiamate(app)).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});

test('sconosciuto rimandato all\'accesso: il modello guarda il solo riquadro, e il tasto destro lo riporta al contenuto', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('cosmo', 'redir'));
    const p = await aspettaProposta(app, 'a.localhost');
    expect(p.testo).toBe('Attivo i cookie di Cosmo per questo contenuto?');
    const c = await chiamate(app);
    expect(c.length).toBe(1);
    expect(Math.abs(c[0].misura.width - LARGO)).toBeLessThanOrEqual(2);
    expect(Math.abs(c[0].misura.height - ALTO)).toBeLessThanOrEqual(2);
    await page.mouse.click(p.no.x, p.no.y);
    await expect.poll(() => proposte(app, 'a.localhost').then((l) => l.length), { timeout: 5_000 }).toBe(0);

    const ri = page.frameLocator('#ri');
    await ri.locator('html').click({ button: 'right', position: { x: 60, y: 60 } });
    await ri.locator('.sn-menu').getByText('Attiva i cookie di cosmo.localhost qui', { exact: true }).click();
    await expect(ri.locator('#ok')).toHaveText('Il contenuto dopo l\'accesso', { timeout: 10_000 });
    expect(await impostazioni(app)).toEqual(['cosmo.localhost']);
  } finally {
    await srv.chiudi();
  }
});
