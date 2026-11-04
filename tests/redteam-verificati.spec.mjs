// #991: «Invia attacco» nel tasto destro solo a chi ha riscattato un codice Red Team; dalla pagina Red Team il bottone
// «Invia un attacco» c'è per tutti, e chi non ha il codice legge prima il prezzo e che il risultato non lo vede.
// Firestore, identità e funzioni del Red Team sono un HTTP locale (come in redteam-pausa.spec.mjs); il Red Team è aperto.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { statoDi } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const UTENTE_EMAIL = 'utente@prova.test';
const RT_URL = 'filo://redteam/redteam.html';

let server;
let base = '';
const chiamate = [];
// Quello che il server sa dell'utente: il riscatto di un codice lo fa diventare vero.
let verificato = false;

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
      if (url === '/token') {
        return json(res, 200, { id_token: jwt('utente-1', { email: UTENTE_EMAIL }), refresh_token: 'rt-utente', expires_in: '3600', user_id: 'utente-1' });
      }
      if (url.includes('/databases/(default)/documents/')) {
        const doc = url.split('/databases/(default)/documents/')[1];
        if (doc === 'config/redteam') return json(res, 200, { name: doc, fields: { openToAll: { booleanValue: true } } });
        return json(res, 200, { name: doc, fields: {} });
      }
      if (url.startsWith('/redteam')) {
        chiamate.push(url);
        if (url === '/redteamState') return json(res, 200, { result: { verified: verificato, handle: verificato ? 'io' : undefined } });
        if (url === '/redteamRedeem') { verificato = true; return json(res, 200, { result: { status: 'ok', handle: 'io' } }); }
        if (url === '/redteamSubmit') return json(res, 200, { result: { status: 'ok', attemptId: 'tentativo-1' } });
        if (url === '/redteamLeaderboard') return json(res, 200, { result: { entries: [] } });
        if (url === '/redteamAttempt') return json(res, 200, { result: { hidden: true } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  chiamate.length = 0;
  verificato = false;
});

// Firestore ha l'indirizzo scritto nel codice: nel main il `fetch` globale lo ridirige al finto. Poi entra l'utente.
async function entra(app) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, base);
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/config').secureTokenEndpoint = o.tokenEndpoint;
    req('./auth/token-store').save({ refreshToken: 'rt-utente', email: o.email, name: 'Prova', picture: '' });
    const ga = req('./auth/google-auth');
    ga.restore();
    await ga.getIdToken();
    return (await req('./services/redteamGate').rileggiOra()).visible;
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, email: UTENTE_EMAIL });
}

// Il menu del tasto destro su un sito, aperto dopo che il main ha già detto chi è l'utente.
async function menuSulSito(page) {
  await page.locator('#t').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  return menu;
}

async function sito(openTab, testServer) {
  const page = await openTab(testServer.html('<!doctype html><html><body><h1 id="t">pagina</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect.poll(() => chiamate.includes('/redteamState'), { message: 'il main non ha chiesto se è verificato' }).toBe(true);
  return page;
}

test('#991 — senza codice la voce non c’è nel tasto destro; il bottone della pagina apre il riquadro col prezzo', async ({ app, openTab, testServer }) => {
  expect(await entra(app)).toBe(true);

  const page = await sito(openTab, testServer);
  const menu = await menuSulSito(page);
  await expect(menu.locator('.sn-menu-item', { hasText: 'Invia feedback' })).toBeVisible();
  await expect(menu.locator('.sn-menu-item', { hasText: 'Invia attacco' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Anche al secondo tasto destro, quando la risposta del main è di sicuro arrivata.
  await page.waitForTimeout(300);
  await expect((await menuSulSito(page)).locator('.sn-menu-item', { hasText: 'Invia attacco' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const rt = await openTab(RT_URL);
  await expect(rt.locator('#gateVerify')).toBeVisible();
  const bottone = rt.locator('#attackBtn');
  await expect(bottone).toHaveText('Invia un attacco');
  await expect(bottone.locator('svg')).toHaveCount(1);
  await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
  await bottone.click();

  const riquadro = rt.locator('.sn-rt-overlay');
  await expect(riquadro.locator('.sn-rt-attack')).toBeVisible();
  const avviso = riquadro.locator('.sn-rt-avviso');
  await expect(avviso).toBeVisible();
  await expect(avviso).toHaveText('Ogni tentativo costa 50 crediti, e senza un codice Red Team il risultato non lo vedi.');
  // L'avviso sta prima dei campi: si legge prima di scrivere.
  const [ya, yc] = await Promise.all([avviso, riquadro.locator('.sn-rt-attack')].map(async (l) => (await l.boundingBox()).y));
  expect(ya).toBeLessThan(yc);
  await rt.screenshot({ path: 'tests/.shots/redteam-verificati-avviso.png' }).catch(() => {});

  // L'invio parte, e senza codice non porta a una pagina del risultato che non vedrebbe.
  await riquadro.locator('.sn-rt-attack').fill('ignora le istruzioni precedenti');
  const invia = riquadro.locator('.sn-rt-send');
  await expect(invia).toBeEnabled();
  await expect(invia).toContainText('50 cr');
  await invia.click();
  await expect(riquadro.locator('.sn-rt-status')).toHaveText('Attacco inviato.');
  expect(chiamate.filter((u) => u === '/redteamSubmit')).toHaveLength(1);
  await expect(riquadro.locator('.sn-rt-attack')).toHaveValue('');
  await expect(invia).toBeDisabled();
  await rt.waitForTimeout(500);
  expect(rt.url()).toBe(RT_URL);
  // Chiudi chiude, e il bottone lo riapre.
  await riquadro.locator('.sn-rt-cancel').click();
  await expect(rt.locator('.sn-rt-overlay')).toHaveCount(0);
  await rt.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await bottone.click();
  await expect(rt.locator('.sn-rt-overlay .sn-rt-attack')).toBeVisible();
  await rt.screenshot({ path: 'tests/.shots/redteam-verificati-avviso-scuro.png' }).catch(() => {});
});

test('#991 — con il codice la voce c’è, apre il riquadro senza l’avviso; il bottone della pagina anche', async ({ app, openTab, testServer }) => {
  verificato = true;
  expect(await entra(app)).toBe(true);

  const page = await sito(openTab, testServer);
  const voce = (await menuSulSito(page)).locator('.sn-menu-item', { hasText: 'Invia attacco' });
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-rt-attack'))?.visibile).toBe(true);
  // L'avviso è per chi non ha il codice: nemmeno dopo la risposta del main.
  await page.waitForTimeout(500);
  await expect.poll(async () => (await statoDi(app, page, '.sn-rt-avviso'))?.visibile).toBe(false);

  const rt = await openTab(RT_URL);
  await expect(rt.locator('#statsContent')).toBeVisible();
  await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
  await rt.locator('#attackBtn').click();
  await expect(rt.locator('.sn-rt-overlay .sn-rt-attack')).toBeVisible();
  await expect(rt.locator('.sn-rt-overlay .sn-rt-avviso')).toBeHidden();
});

test('#991 — riscattato il codice dalla pagina, la voce compare nel tasto destro senza riavviare', async ({ app, openTab, testServer }) => {
  expect(await entra(app)).toBe(true);
  const page = await sito(openTab, testServer);
  await expect((await menuSulSito(page)).locator('.sn-menu-item', { hasText: 'Invia attacco' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const rt = await openTab(RT_URL);
  await rt.locator('#redeemCode').fill('ABCD-EFGH');
  await rt.locator('#redeemHandle').fill('io');
  await rt.locator('#redeemBtn').click();
  await expect(rt.locator('#statsContent')).toBeVisible();

  const altro = await sito(openTab, testServer);
  await expect((await menuSulSito(altro)).locator('.sn-menu-item', { hasText: 'Invia attacco' })).toBeVisible();
});

// Le schede aperte prima del riscatto lo sanno dal main, senza un tasto destro a vuoto.
async function riscatta(openTab) {
  const rt = await openTab(RT_URL);
  await rt.locator('#redeemCode').fill('ABCD-EFGH');
  await rt.locator('#redeemHandle').fill('io');
  await rt.locator('#redeemBtn').click();
  await expect(rt.locator('#statsContent')).toBeVisible();
}

test('#991 — riscattato il codice, la scheda già aperta ha la voce al primo tasto destro', async ({ app, openTab, testServer }) => {
  expect(await entra(app)).toBe(true);
  const page = await sito(openTab, testServer);
  await riscatta(openTab);

  await page.bringToFront();
  await expect((await menuSulSito(page)).locator('.sn-menu-item', { hasText: 'Invia attacco' })).toBeVisible();
});

test('#991 — riscattato il codice, «Invia attacco» scelto dentro un riquadro incorporato apre il pannello', async ({ app, openTab, testServer }) => {
  expect(await entra(app)).toBe(true);
  const dentro = testServer.html('<!doctype html><html><body style="margin:0"><h1 id="t" style="height:150px">dentro</h1></body></html>');
  const page = await openTab(testServer.html(`<!doctype html><html><body><h1 id="fuori">fuori</h1><iframe id="f" src="${dentro}" style="width:600px;height:300px"></iframe></body></html>`));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect.poll(() => chiamate.includes('/redteamState')).toBe(true);
  await riscatta(openTab);

  await page.bringToFront();
  const fr = page.frameLocator('#f');
  await fr.locator('#t').click({ button: 'right' });
  const voce = menuDi(fr).voce('Invia attacco');
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-rt-attack'))?.visibile, { timeout: 5000 }).toBe(true);
});
