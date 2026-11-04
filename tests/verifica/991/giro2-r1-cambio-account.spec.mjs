// #991 giro 2 — la voce «Invia attacco» segue chi è entrato: uscito dall'account, la scheda già aperta non la mostra
// più; entrato con un account che ha il codice, la scheda già aperta la mostra al primo tasto destro.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const UTENTE_EMAIL = 'utente@prova.test';

let server;
let base = '';
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
    req.on('data', () => {});
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
      if (url === '/redteamState') return json(res, 200, { result: { verified: verificato, handle: verificato ? 'io' : undefined } });
      if (url === '/redteamLeaderboard') return json(res, 200, { result: { entries: [] } });
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

test.beforeEach(() => { verificato = true; });

async function redirigi(app) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, base);
}

// Come fa la pagina Account: entra, e il main avvisa le superfici di Filo.
async function entra(app) {
  await redirigi(app);
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

async function sito(openTab, testServer) {
  const page = await openTab(testServer.html('<!doctype html><html><body><h1 id="t">pagina</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(800);
  return page;
}

async function voceNelMenu(page) {
  await page.locator('#t').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  return menu.locator('.sn-menu-item', { hasText: 'Invia attacco' });
}

test('r1 uscito dall’account, la scheda già aperta non ha più la voce al primo tasto destro', async ({ app, openTab, testServer }) => {
  expect(await entra(app)).toBe(true);
  const page = await sito(openTab, testServer);
  await expect(await voceNelMenu(page)).toBeVisible();
  await page.keyboard.press('Escape');

  // L'uscita dalla pagina Account.
  const rt = await openTab('filo://redteam/redteam.html');
  await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
  const r = await rt.evaluate(async () => chrome.runtime.sendMessage({ type: 'auth_signout' }));
  expect(r?.ok).toBe(true);
  expect(await app.evaluate(() => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    return req('./auth/google-auth').isSignedIn();
  })).toBe(false);
  await page.waitForTimeout(1500);

  await page.bringToFront();
  await expect(await voceNelMenu(page)).toHaveCount(0);
});

test('r1 entrato con un account che ha il codice, la scheda già aperta ha la voce al primo tasto destro', async ({ app, openTab, testServer }) => {
  await redirigi(app);
  const page = await sito(openTab, testServer);
  await expect(await voceNelMenu(page)).toHaveCount(0);
  await page.keyboard.press('Escape');

  expect(await entra(app)).toBe(true);
  await page.waitForTimeout(1500);

  await page.bringToFront();
  await expect(await voceNelMenu(page)).toBeVisible();
});
