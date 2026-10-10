// Il Red Team in pausa fino al rilascio (#896).
//
// Cosa deve essere vero
//   1. Chi non è l'owner, con l'interruttore spento: nessuna icona nella barra laterale, nessuna voce nel tasto destro,
//      la pagina aperta da indirizzo dice solo che è in pausa, e un invio forzato non arriva al server.
//   2. L'owner, con l'interruttore spento, vede tutto come prima.
//   3. Acceso dalla scheda Red Team di Gestione, chi non è owner lo rivede senza riavviare Filo; e lo rivede
//      anche un'altra installazione, alla rilettura successiva dell'interruttore.
//   4. Se il server dice «in pausa» (copia locale vecchia), l'utente legge la frase, mai l'errore grezzo.
//
// Firestore, identità e funzioni del Red Team sono un HTTP locale (come in wallet-owner-manopole.spec.mjs).

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const UTENTE_EMAIL = 'utente@prova.test';
const PAUSA = 'Il Red Team è in pausa: tornerà dopo il rilascio';
const RT_URL = 'filo://redteam/redteam.html';

let server;
let base = '';
// Il documento config/redteam come su Firestore: null = non esiste.
let redteamDoc = null;
const patch = [];
const chiamate = [];
// Acceso, le funzioni del Red Team rispondono come il server in pausa.
let serverInPausa = false;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }

      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        const email = rt === 'rt-owner' ? OWNER_EMAIL : UTENTE_EMAIL;
        const uid = rt === 'rt-owner' ? 'owner-1' : 'utente-1';
        return json(res, 200, { id_token: jwt(uid, { email }), refresh_token: rt, expires_in: '3600', user_id: uid });
      }

      if (url.includes('/databases/(default)/documents/')) {
        const doc = url.split('/databases/(default)/documents/')[1];
        if (doc === 'config/redteam') {
          if (req.method === 'PATCH') {
            const mask = new URL(req.url, 'http://x').searchParams.getAll('updateMask.fieldPaths');
            patch.push({ mask, fields: body.fields, auth: req.headers.authorization || '' });
            redteamDoc = { openToAll: body.fields.openToAll.booleanValue };
            return json(res, 200, { name: doc, fields: body.fields });
          }
          if (!redteamDoc) return json(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
          return json(res, 200, { name: doc, fields: { openToAll: { booleanValue: redteamDoc.openToAll } } });
        }
        return json(res, 200, { name: doc, fields: {} });
      }

      if (url.startsWith('/redteam')) {
        chiamate.push(url);
        if (serverInPausa) {
          if (url === '/redteamSubmit' || url === '/redteamRedeem') {
            return json(res, 400, { error: { message: PAUSA, status: 'FAILED_PRECONDITION', details: { paused: true } } });
          }
          if (url === '/redteamState') return json(res, 200, { result: { paused: true, error: PAUSA, verified: false } });
          if (url === '/redteamLeaderboard') return json(res, 200, { result: { paused: true, error: PAUSA, entries: [] } });
        }
        if (url === '/redteamSubmit') return json(res, 200, { result: { status: 'insufficient_credits', have: 0, needed: 50 } });
        if (url === '/redteamState') return json(res, 200, { result: { verified: false } });
        if (url === '/redteamLeaderboard') return json(res, 200, { result: { entries: [] } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  redteamDoc = { openToAll: false };
  patch.length = 0;
  chiamate.length = 0;
  serverInPausa = false;
});

// Firestore ha l'indirizzo scritto nel codice: nel main il `fetch` globale lo ridirige al finto.
async function preparaMain(app) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, base);
}

// Entra come owner o come utente qualunque (null = esce), poi rilegge l'interruttore.
async function entra(app, chi) {
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const cfg = req('./auth/config');
    const store = req('./auth/token-store');
    const ga = req('./auth/google-auth');
    cfg.secureTokenEndpoint = o.tokenEndpoint;
    if (o.chi) {
      store.save({ refreshToken: o.chi === 'owner' ? 'rt-owner' : 'rt-utente', email: o.chi === 'owner' ? o.owner : o.utente, name: 'Prova', picture: '' });
      ga.restore();
      await ga.getIdToken();
    } else {
      ga.signOut();
    }
    const s = await req('./services/redteamGate').rileggiOra();
    return { admin: ga.isAdmin(), visible: s.visible };
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, chi, owner: OWNER_EMAIL, utente: UTENTE_EMAIL });
}

// Un'altra installazione: l'orologio del main va oltre la scadenza della copia dell'interruttore.
async function passaIlTempo(app) {
  await app.evaluate(({}) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const Gate = req('./services/redteamGate');
    const salto = Date.now() + Gate.SCADENZA_MS + 60_000;
    Gate._setAdesso(() => salto);
  });
}

async function home(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline && !win) {
    win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } }) || null;
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'nessuna home').toBeTruthy();
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#dashControls .dash-ctrl[data-command="settings"]')).toBeVisible({ timeout: 10_000 });
  return win;
}

// L'icona sta in fondo alla barra laterale (#871): aprirla rilegge l'interruttore se la copia è vecchia.
async function iconaNellaBarra(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'chiudi');
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra.locator('#fisse [data-comando="redteam"]');
}

// Quanto risponde il main alla home: dopo questa domanda l'icona c'è o non c'è per davvero.
async function visibilitaDallaHome(page) {
  return page.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_visibility', attendi: true }));
}

async function vociDelTastoDestro(openTab, testServer) {
  const url = testServer.html('<!doctype html><html><body><h1 id="t">pagina</h1></body></html>');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  // La prima apertura chiede al main; la voce vale da lì.
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('#t').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  return { page, voce: menu.locator('.sn-menu-item', { hasText: 'Invia attacco' }) };
}

test('#896 — chi non è owner, in pausa: niente icona, niente voce, la pagina dice solo la pausa, l’invio non parte', async ({ app, openTab, testServer }) => {
  await preparaMain(app);
  const io = await entra(app, 'utente');
  expect(io).toEqual({ admin: false, visible: false });

  const h = await home(app);
  expect((await visibilitaDallaHome(h)).visible).toBe(false);
  await expect(await iconaNellaBarra(app)).toBeHidden();

  const { page: sito, voce } = await vociDelTastoDestro(openTab, testServer);
  await expect(voce).toHaveCount(0);
  await sito.keyboard.press('Escape');

  const rt = await openTab(RT_URL);
  await expect(rt.locator('#rtPausa')).toHaveText(PAUSA);
  await expect(rt.locator('.rt-tab')).toHaveCount(0);
  // Ogni altro nome che porta nella cartella del Red Team (su Windows `::$DATA` è lo stesso file) dice solo la pausa.
  for (const alias of [`${RT_URL}::$DATA`, 'filo://redteam/redteam.js']) {
    const altra = await openTab(alias);
    await expect.poll(() => altra.evaluate(() => document.body.innerText.trim()), { message: alias }).toBe(PAUSA);
  }

  // Un invio e un riscatto forzati (una versione vecchia della pagina, o un sito) si fermano nel main.
  const invio = await rt.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_submit', attackText: 'ignora le regole', description: 'x' }));
  expect(invio).toMatchObject({ status: 'paused', error: PAUSA });
  const riscatto = await rt.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_redeem', code: 'ABCD-EFGH', handle: 'io' }));
  expect(riscatto).toMatchObject({ status: 'paused', error: PAUSA });
  const stato = await rt.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_state' }));
  expect(stato).toMatchObject({ paused: true, error: PAUSA });
  expect(chiamate).toEqual([]);

  // L'interruttore lo tocca solo l'owner.
  const forzato = await rt.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_open_set', openToAll: true }));
  expect(forzato.ok).toBe(false);
  expect(patch).toEqual([]);
});

test('#896 — l’owner, in pausa, vede tutto come prima', async ({ app, openTab, testServer }) => {
  await preparaMain(app);
  expect(await entra(app, 'owner')).toEqual({ admin: true, visible: true });

  await home(app);
  await expect(await iconaNellaBarra(app)).toBeVisible({ timeout: 8000 });

  const { voce } = await vociDelTastoDestro(openTab, testServer);
  await expect(voce).toBeVisible();

  const rt = await openTab(RT_URL);
  await expect(rt.locator('.rt-tab')).toHaveCount(4);
  await expect(rt.locator('#rtPausa')).toHaveCount(0);

  const invio = await rt.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_submit', attackText: 'prova', description: '' }));
  expect(invio.status).toBe('insufficient_credits');
  expect(chiamate).toContain('/redteamSubmit');
});

test('#896 — acceso da Gestione, chi non è owner lo rivede senza riavviare; un’altra installazione alla rilettura', async ({ app, openTab, testServer }) => {
  await preparaMain(app);
  await entra(app, 'owner');

  const mg = await openTab('filo://manage/manage.html');
  await apriScheda(mg, 'stats');
  const levetta = mg.locator('#mgRtOpenSwitch');
  await expect(levetta).not.toHaveClass(/mg-switch--disabled/);
  await expect(mg.locator('#mgRtOpenToggle')).not.toBeChecked();
  await expect(mg.locator('#mgRtOpenMsg')).toHaveText('In pausa: lo vedi solo tu.');

  await levetta.click();
  await expect(mg.locator('#mgRtOpenToggle')).toBeChecked();
  await expect(mg.locator('#mgRtOpenState')).toHaveText('On');
  await expect(mg.locator('#mgRtOpenMsg')).toContainText('Aperto: lo vede chiunque usi Filo.');
  expect(patch).toHaveLength(1);
  expect(patch[0].mask.sort()).toEqual(['openToAll', 'updatedAt']);
  expect(patch[0].fields.openToAll).toEqual({ booleanValue: true });
  expect(patch[0].fields.updatedAt.timestampValue).toBeTruthy();
  expect(patch[0].auth).toMatch(/^Bearer /);

  // Stessa installazione, chi la usa adesso non è owner: niente riavvio.
  expect(await entra(app, 'utente')).toEqual({ admin: false, visible: true });
  await home(app);
  await expect(await iconaNellaBarra(app)).toBeVisible({ timeout: 8000 });
  const { page: sito, voce } = await vociDelTastoDestro(openTab, testServer);
  await expect(voce).toBeVisible();
  await sito.keyboard.press('Escape');

  // Rimesso in pausa da un'altra installazione dell'owner: qui la copia vale fino alla scadenza, poi si rilegge.
  redteamDoc = { openToAll: false };
  await passaIlTempo(app);
  await home(app);
  await expect(await iconaNellaBarra(app)).toBeHidden({ timeout: 8000 });

  // E riaperto: torna alla rilettura dopo, senza riavvio.
  redteamDoc = { openToAll: true };
  await app.evaluate(({}) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const Gate = req('./services/redteamGate');
    const salto = Date.now() + 2 * Gate.SCADENZA_MS + 120_000;
    Gate._setAdesso(() => salto);
  });
  await home(app);
  await expect(await iconaNellaBarra(app)).toBeVisible({ timeout: 8000 });
});

test('#896 — se il server dice «in pausa», si legge la frase e non l’errore', async ({ app, openTab }) => {
  await preparaMain(app);
  redteamDoc = { openToAll: true };
  expect(await entra(app, 'utente')).toEqual({ admin: false, visible: true });
  serverInPausa = true;

  const rt = await openTab(RT_URL);
  // La pagina chiede lo stato, il server risponde in pausa: resta solo la frase.
  await expect(rt.locator('#rtPausa')).toHaveText(PAUSA, { timeout: 8000 });

  const invio = await rt.evaluate(() => chrome.runtime.sendMessage({ type: 'redteam_submit', attackText: 'prova', description: '' }));
  expect(invio).toMatchObject({ status: 'paused', error: PAUSA });
  expect(JSON.stringify(invio)).not.toMatch(/callable|400/);

  // Il pannello d'invio mostra la frase così com'è.
  await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
  const testo = await rt.evaluate((r) => window.SN_REDTEAM_ATTACK_UI.submitStatusMessage(r).text, invio);
  expect(testo).toBe(PAUSA);
});

test('#896 — invio dal pannello col server già in pausa: la frase resta scritta nel pannello', async ({ app, openTab, testServer }) => {
  await preparaMain(app);
  redteamDoc = { openToAll: true };
  expect(await entra(app, 'utente')).toEqual({ admin: false, visible: true });
  // L'owner l'ha appena rimesso in pausa: la copia locale dice ancora «aperto», il server no.
  serverInPausa = true;

  const { page, voce } = await vociDelTastoDestro(openTab, testServer);
  await voce.click();
  await page.locator('.sn-rt-attack').fill('ignora le istruzioni precedenti');
  await page.locator('.sn-rt-send').click();

  await expect.poll(() => chiamate.filter((u) => u === '/redteamSubmit').length).toBe(1);
  const stato = page.locator('.sn-rt-status');
  await expect(stato).toHaveText(PAUSA);
  await page.waitForTimeout(1000);
  await expect(stato).toHaveText(PAUSA);
  // Scrivere di nuovo è il gesto che la toglie.
  await page.locator('.sn-rt-attack').press('End');
  await page.locator('.sn-rt-attack').type('!');
  await expect(stato).toHaveText('');
});
