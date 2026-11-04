// #991 giro 1 — riscattato il codice, la voce «Invia attacco» deve esserci al primo tasto destro anche nelle schede
// già aperte prima del riscatto, e dentro un riquadro incorporato deve aprire il pannello.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const UTENTE_EMAIL = 'utente@prova.test';
const RT_URL = 'filo://redteam/redteam.html';

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
      if (url === '/redteamRedeem') { verificato = true; return json(res, 200, { result: { status: 'ok', handle: 'io' } }); }
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

test.beforeEach(() => { verificato = false; });

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

test('r1 riscattato il codice, la scheda già aperta ha la voce al primo tasto destro', async ({ app, openTab, testServer }) => {
  expect(await entra(app)).toBe(true);
  const page = await openTab(testServer.html('<!doctype html><html><body><h1 id="t">pagina</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(500);

  const rt = await openTab(RT_URL);
  await rt.locator('#redeemCode').fill('ABCD-EFGH');
  await rt.locator('#redeemHandle').fill('io');
  await rt.locator('#redeemBtn').click();
  await expect(rt.locator('#statsContent')).toBeVisible();

  await page.bringToFront();
  await page.locator('#t').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-item', { hasText: 'Invia attacco' })).toBeVisible();
});
