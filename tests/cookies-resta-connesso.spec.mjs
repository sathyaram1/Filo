// #759 — «Resta connesso qui» con la privacy massima dei cookie: la proposta dopo un accesso riuscito, la voce
// del menu della scheda, l'azione della chat. Il sito di prova tiene l'accesso in un cookie col suo server:
// le asserzioni guardano se il sito riconosce l'utente, non solo l'elenco dei fidati.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'tests', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un sito con l'accesso vero: password giusta → cookie di sessione persistente e /home che saluta.
async function sitoConAccesso() {
  const sessioni = new Set();
  const modulo = (errore) => `<!doctype html><html><head><title>Accedi</title></head><body style="padding:30px">
    ${errore ? '<p id="errore">Password sbagliata</p>' : ''}
    <form method="post" action="/login"><input name="u" value="sara"> <input id="pw" type="password" name="p">
    <button id="entra">Entra</button></form></body></html>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sid = ((req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/) || [])[1];
    const dentro = !!sid && sessioni.has(sid);
    const html = (corpo) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(corpo); };
    if (req.method === 'POST' && u.pathname === '/login') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (new URLSearchParams(body).get('p') !== 'giusta') { html(modulo(true)); return; }
        const nuovo = Math.random().toString(36).slice(2);
        sessioni.add(nuovo);
        res.writeHead(302, { 'Set-Cookie': `sid=${nuovo}; Max-Age=86400; Path=/; HttpOnly`, Location: '/home' });
        res.end();
      });
      return;
    }
    // «Continua con Google» finto: la finestrella d'accesso e il ritorno che apre la sessione.
    if (u.pathname === '/pubblica') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'visita=1; Path=/; HttpOnly' });
      res.end(`<!doctype html><html><head><title>Benvenuto</title></head><body style="padding:30px">
        <button id="google" onclick="window.open('/oauth/authorize?client_id=x&redirect_uri=y', 'accesso', 'width=420,height=420')">Continua con Google</button>
        </body></html>`);
      return;
    }
    if (u.pathname === '/oauth/authorize') { html('<!doctype html><title>Scegli un account</title><p>Account</p>'); return; }
    if (u.pathname === '/oauth-ritorno') {
      const nuovo = Math.random().toString(36).slice(2);
      sessioni.add(nuovo);
      res.writeHead(302, { 'Set-Cookie': `sid=${nuovo}; Max-Age=86400; Path=/; HttpOnly`, Location: '/home' });
      res.end();
      return;
    }
    if (u.pathname === '/esci') {
      res.writeHead(302, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/', Location: '/login' });
      res.end();
      return;
    }
    if (u.pathname === '/home' && dentro) {
      html(`<!doctype html><html><head><title>Casa</title></head><body style="padding:30px"><h1 id="dentro">Ciao Sara</h1>
        <script>if (!localStorage.getItem('tema')) localStorage.setItem('tema', 'scuro-' + Date.now());</script></body></html>`);
      return;
    }
    html(modulo(false));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    a: `http://127.0.0.1:${port}`,
    b: `http://localhost:${port}`,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

async function privacy(app) {
  await app.evaluate(async () => {
    await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } });
  });
}

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  return pagina(app, url);
}

// La pagina della scheda su `prefisso`: dopo uno spostamento di jar la vista è nuova, quindi si ricerca.
async function pagina(app, prefisso, { timeout = 15_000 } = {}) {
  const scade = Date.now() + timeout;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } });
    if (p) {
      try {
        await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 4000 });
        return p;
      } catch (_) { /* vista sostituita mentre si caricava: si riprova */ }
    }
    await sleep(100);
  }
  throw new Error(`nessuna scheda su ${prefisso}`);
}

async function accedi(page, password = 'giusta') {
  await page.locator('#pw').fill(password);
  await page.locator('#entra').click();
}

async function dentro(app, prefisso) {
  await expect.poll(async () => {
    try { return await (await pagina(app, prefisso, { timeout: 3000 })).locator('#dentro').count(); } catch (_) { return -1; }
  }, { timeout: 15_000 }).toBe(1);
}

const fidati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.trustedSites);

const partizioneDi = (app, prefisso) => app.evaluate(({ BrowserWindow }, pre) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      if (String(t.url || '').startsWith(pre)) return t.partition || null;
    }
  }
  return undefined;
}, prefisso);

const cookieNelJar = (app, partizione) => app.evaluate(async ({ session }, p) =>
  (await session.fromPartition(p).cookies.get({})).map((c) => c.name), partizione);

// La vista che disegna gli avvisi sopra la pagina, per chi lancia Filo da sé.
async function vistaAvvisi(app) {
  const scade = Date.now() + 10_000;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avvisi.html'); } catch (_) { return false; } });
    if (p) return p;
    await sleep(100);
  }
  throw new Error('la vista degli avvisi non è nata');
}

async function proposta(vista, sito) {
  const carta = vista.locator('.shell-notif.show', { hasText: `Hai fatto l'accesso a ${sito}` });
  await expect(carta).toBeVisible({ timeout: 15_000 });
  return carta;
}

async function accetta(carta) {
  const sì = carta.locator('.shell-notif-action', { hasText: 'Resta connesso' });
  await expect(sì).toBeEnabled({ timeout: 4000 });
  await sì.click();
}

// ── la proposta ────────────────────────────────────────────────────────────

test('dopo l\'accesso Filo propone di restare connessi; accettata, il sito riconosce l\'utente chiudendo la scheda e riaprendo Filo', async () => {
  test.setTimeout(150_000);
  const sito = await sitoConAccesso();
  const userData = cartellaTemporanea('filo-connesso-');
  const lancia = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  let app = await lancia();
  try {
    let shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await privacy(app);

    // Il secondo sito non accetta: serve da controprova dopo il riavvio.
    await accedi(await apri(app, shell, `${sito.b}/login`));
    await dentro(app, `${sito.b}/home`);

    await accedi(await apri(app, shell, `${sito.a}/login`));
    await dentro(app, `${sito.a}/home`);
    const prima = await (await pagina(app, `${sito.a}/home`)).evaluate(() => localStorage.getItem('tema'));
    expect(prima).toMatch(/^scuro-/);
    const vista = await vistaAvvisi(app);
    await accetta(await proposta(vista, '127.0.0.1'));
    await expect(vista.locator('.shell-notif.show', { hasText: 'Resti connesso a 127.0.0.1' })).toBeVisible({ timeout: 10_000 });

    await expect.poll(() => fidati(app)).toEqual(['127.0.0.1']);
    // La scheda è già nel posto che resta, con l'accesso e la memoria della pagina di prima.
    await expect.poll(() => partizioneDi(app, `${sito.a}/`)).toBe('persist:filo-priv-127.0.0.1');
    await dentro(app, `${sito.a}/home`);
    expect(await (await pagina(app, `${sito.a}/home`)).evaluate(() => localStorage.getItem('tema'))).toBe(prima);
    expect(await cookieNelJar(app, 'persist:filo-priv-127.0.0.1')).toContain('sid');

    // Chiusa la scheda e riaperto il sito: ancora dentro.
    const { tabs } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    const scheda = tabs.find((t) => String(t.url).startsWith(sito.a));
    await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);
    await expect.poll(() => partizioneDi(app, `${sito.a}/`)).toBe(undefined);
    await apri(app, shell, `${sito.a}/home`);
    await dentro(app, `${sito.a}/home`);

    await chiudiApp(app);
    app = await lancia();
    shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await apri(app, shell, `${sito.a}/home`);
    await dentro(app, `${sito.a}/home`);
    expect(await (await pagina(app, `${sito.a}/home`)).evaluate(() => localStorage.getItem('tema'))).toBe(prima);
    // Controprova: il sito non fidato ha perso tutto con la chiusura.
    const altro = await apri(app, shell, `${sito.b}/home`);
    await expect(altro.locator('#pw')).toBeVisible();
  } finally {
    await chiudiApp(app);
    await sito.chiudi();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('la proposta non parte con la password sbagliata e, chiusa, non torna su quel sito', async ({ app, shell, avvisi }) => {
  test.setTimeout(120_000);
  const sito = await sitoConAccesso();
  try {
    await privacy(app);
    const page = await apri(app, shell, `${sito.a}/login`);
    await accedi(page, 'sbagliata');
    await expect(page.locator('#errore')).toBeVisible();
    await sleep(2500);
    expect(await shell.locator('.shell-notif', { hasText: 'Hai fatto l\'accesso' }).count()).toBe(0);

    await accedi(page, 'giusta');
    await dentro(app, `${sito.a}/home`);
    const vista = await avvisi();
    const carta = await proposta(vista, '127.0.0.1');
    mkdirSync(SHOTS, { recursive: true });
    for (const tema of ['light', 'dark']) {
      await shell.emulateMedia({ colorScheme: tema });
      await sleep(300);
      await vista.screenshot({ path: join(SHOTS, `resta-connesso-proposta-${tema}.png`) });
    }
    await carta.locator('.shell-notif-close').click();
    await expect(shell.locator('.shell-notif', { hasText: 'Hai fatto l\'accesso' })).toHaveCount(0, { timeout: 4000 });

    // Esce e rientra: niente proposta per lo stesso sito. Un altro sito la riceve, quindi Filo stava guardando.
    const home = await pagina(app, `${sito.a}/home`);
    await home.evaluate(() => { location.href = '/esci'; });
    await accedi(await pagina(app, `${sito.a}/login`), 'giusta');
    await dentro(app, `${sito.a}/home`);
    await accedi(await apri(app, shell, `${sito.b}/login`), 'giusta');
    await dentro(app, `${sito.b}/home`);
    await proposta(vista, 'localhost');
    expect(await shell.locator('.shell-notif', { hasText: 'accesso a 127.0.0.1' }).count()).toBe(0);
    expect(await fidati(app)).toEqual([]);
  } finally {
    await sito.chiudi();
  }
});

test('«Continua con Google»: la proposta arriva quando il sito reagisce all\'accesso, non se la finestrella si chiude e basta', async ({ app, shell, avvisi }) => {
  test.setTimeout(120_000);
  const sito = await sitoConAccesso();
  try {
    await privacy(app);
    const page = await apri(app, shell, `${sito.a}/pubblica`);
    const finestrella = async () => {
      await page.locator('#google').click();
      let w = null;
      await expect.poll(() => {
        w = app.windows().find((x) => { try { return x.url().includes('/oauth/authorize'); } catch (_) { return false; } });
        return !!w;
      }, { timeout: 10_000 }).toBe(true);
      return w;
    };
    // Chiusa senza accedere: la pagina resta com'era, e niente proposta.
    const prima = await finestrella();
    await prima.evaluate(() => window.close());
    await sleep(5000);
    expect(await shell.locator('.shell-notif', { hasText: 'Hai fatto l\'accesso' }).count()).toBe(0);

    // Accesso vero: la finestrella si chiude e il sito apre la sessione.
    const seconda = await finestrella();
    await seconda.evaluate(() => window.close());
    await page.evaluate(() => { location.href = '/oauth-ritorno'; });
    await dentro(app, `${sito.a}/home`);
    await proposta(await avvisi(), '127.0.0.1');

    // Nella scheda stessa: sito → fornitore d'identità → di nuovo il sito. Un fornitore vero non si raggiunge da
    // qui (la sua porta è la 443), quindi i due passaggi di indirizzo si danno al gestore delle schede.
    const altra = await apri(app, shell, `${sito.b}/pubblica`);
    const passa = (prima, dopo) => app.evaluate(({ BrowserWindow }, { pre, prima, dopo }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs;
        const t = tm && tm.tabs.find((x) => String(x.url || '').startsWith(pre));
        if (t) { tm._accessoDaNavigazione(t, prima, dopo || t.url); return true; }
      }
      return false;
    }, { pre: sito.b, prima, dopo });
    expect(await passa(`${sito.b}/pubblica`, 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true);
    await altra.evaluate(() => { location.href = '/oauth-ritorno'; });
    await dentro(app, `${sito.b}/home`);
    expect(await passa('https://accounts.google.com/signin/oauth/consent', null)).toBe(true);
    await proposta(await avvisi(), 'localhost');
  } finally {
    await sito.chiudi();
  }
});

test('in Automatico niente proposta e niente voce nel menu della scheda', async ({ app, shell }) => {
  const sito = await sitoConAccesso();
  try {
    await accedi(await apri(app, shell, `${sito.a}/login`));
    await dentro(app, `${sito.a}/home`);
    await sleep(2500);
    expect(await shell.locator('.shell-notif', { hasText: 'Hai fatto l\'accesso' }).count()).toBe(0);
    const { tabs } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    expect(tabs.find((t) => String(t.url).startsWith(sito.a)).connesso).toBe(null);
  } finally {
    await sito.chiudi();
  }
});

// ── il menu della scheda ───────────────────────────────────────────────────

async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

async function tryClick(app, label) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate((l) => {
        const btn = [...document.querySelectorAll('button.item')].find((b) => b.textContent.trim() === l);
        if (!btn) return false;
        btn.click();
        return true;
      }, label);
      if (r) return true;
    } catch (_) {}
  }
  return false;
}

async function scegliNelMenu(app, shell, label, finito) {
  await expect.poll(async () => {
    if (await finito()) return true;
    await rightClickTab(shell);
    for (let i = 0; i < 15; i++) { if (await tryClick(app, label)) break; await sleep(40); }
    await sleep(300);
    return finito();
  }, { timeout: 25_000, intervals: [200, 400, 800, 1200] }).toBe(true);
}

test('tasto destro sulla scheda: «Resta connesso qui» porta l\'accesso nel posto che resta, «Non restare connesso» lo lascia fino alla chiusura e svuota il disco', async ({ app, shell, avvisi }) => {
  test.setTimeout(120_000);
  const sito = await sitoConAccesso();
  try {
    await privacy(app);
    await accedi(await apri(app, shell, `${sito.a}/login`));
    await dentro(app, `${sito.a}/home`);
    // La proposta c'è, ma l'utente passa dal menu.
    const vista = await avvisi();
    await proposta(vista, '127.0.0.1');

    await rightClickTab(shell);
    await expect.poll(async () => {
      for (const w of app.windows()) {
        try {
          if (await w.evaluate(() => !!document.body && document.body.innerText.includes('Resta connesso qui'))) {
            mkdirSync(SHOTS, { recursive: true });
            await w.screenshot({ path: join(SHOTS, 'resta-connesso-menu-scheda.png') });
            return true;
          }
        } catch (_) {}
      }
      return false;
    }, { timeout: 10_000 }).toBe(true);
    await shell.keyboard.press('Escape').catch(() => {});
    await scegliNelMenu(app, shell, 'Resta connesso qui', async () => (await fidati(app)).includes('127.0.0.1'));
    await expect.poll(() => partizioneDi(app, `${sito.a}/`)).toBe('persist:filo-priv-127.0.0.1');
    await dentro(app, `${sito.a}/home`);
    expect(await cookieNelJar(app, 'persist:filo-priv-127.0.0.1')).toContain('sid');
    await expect(vista.locator('.shell-notif.show', { hasText: 'Resti connesso a 127.0.0.1' })).toBeVisible({ timeout: 10_000 });

    await scegliNelMenu(app, shell, 'Non restare connesso', async () => (await fidati(app)).length === 0);
    await expect.poll(() => partizioneDi(app, `${sito.a}/`)).toBe('filo-priv-127.0.0.1');
    // Fino alla chiusura l'utente resta dentro; sul disco non resta niente.
    await dentro(app, `${sito.a}/home`);
    await expect.poll(() => cookieNelJar(app, 'persist:filo-priv-127.0.0.1')).toEqual([]);
    await expect(vista.locator('.shell-notif.show', { hasText: 'l\'accesso vale fino alla chiusura di Filo' })).toBeVisible({ timeout: 10_000 });
    const { tabs } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    expect(tabs.find((t) => String(t.url).startsWith(sito.a)).connesso).toEqual({ sito: '127.0.0.1', fidato: false });
  } finally {
    await sito.chiudi();
  }
});

// ── la chat ─────────────────────────────────────────────────────────────────

const execAction = (app, action) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), action);

test('in chat «resta connesso su» aggiunge il sito con la conferma, e «togli dai siti connessi» lo toglie', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const sito = await sitoConAccesso();
  // In chat un sito si nomina col suo dominio: la fixture porta sito-pubblico.test sul server di prova.
  const base = `http://sito-pubblico.test:${sito.port}`;
  const nome = 'sito-pubblico.test';
  try {
    await privacy(app);
    await accedi(await apri(app, shell, `${base}/login`));
    await dentro(app, `${base}/home`);
    const home = await openTab('filo://newtab/');

    const aggiungi = { type: 'IMPOSTA_PREFERENZA', chiave: 'resta connesso su', valore: `aggiungi ${nome}` };
    const r = await execAction(app, aggiungi);
    expect(r.executed).toBe(false);
    expect(r.needsConfirm).toBe(2);
    expect(await fidati(app)).toEqual([]);
    const c = await home.evaluate((a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), aggiungi);
    expect(c.executed).toBe(true);
    await expect.poll(() => fidati(app)).toEqual([nome]);
    await expect.poll(() => partizioneDi(app, `${base}/`)).toBe(`persist:filo-priv-${nome}`);
    await dentro(app, `${base}/home`);
    expect(await cookieNelJar(app, `persist:filo-priv-${nome}`)).toContain('sid');

    const togli = { type: 'IMPOSTA_PREFERENZA', chiave: 'siti connessi', valore: `togli ${nome}` };
    expect((await execAction(app, togli)).needsConfirm).toBe(2);
    const c2 = await home.evaluate((a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), togli);
    expect(c2.executed).toBe(true);
    await expect.poll(() => fidati(app)).toEqual([]);
    await expect.poll(() => cookieNelJar(app, `persist:filo-priv-${nome}`)).toEqual([]);
    await expect.poll(() => partizioneDi(app, `${base}/`)).toBe(`filo-priv-${nome}`);
    await dentro(app, `${base}/home`);
  } finally {
    await sito.chiudi();
  }
});
