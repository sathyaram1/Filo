// #1785: le letture di schede e testi che il server registra arrivano all'owner in Gestione passando dal main, non solo
// quando la pagina riceve le righe già pronte (quello lo prova routine-channel-log.spec.mjs). Server, identità e
// Firestore sono un HTTP locale, come in redteam-pausa.spec.mjs.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda, GESTIONE } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
let server;
let base = '';
const chiamate = [];

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
const jwt = (uid, extra = {}) => `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Le righe come le scrive il registro del server: una lettura di testi, una di tutti gli aperti, una scheda scritta.
const LETTURE = [
  { id: 'a', at: '2026-10-29T12:03:00.000Z', slug: 'chiave-riservati', role: 'manutentore', op: 'scheda', testi: false, schede: true, aperti: false, numeri: ['812'], quanti: 1, conDati: 1 },
  { id: 'b', at: '2026-10-29T12:02:00.000Z', slug: 'chiave-riservati', role: 'manutentore', op: 'leggi', testi: false, schede: true, aperti: true, numeri: ['812', '815'], quanti: 2, conDati: 2 },
  { id: 'c', at: '2026-10-29T12:01:00.000Z', slug: 'gestione-lavoro', role: 'compito', op: 'leggi', testi: true, schede: false, aperti: false, numeri: ['815'], quanti: 1, conDati: 1 },
];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: 'rt-owner', expires_in: '3600', user_id: 'owner-1' });
      if (url === '/routineLog') {
        chiamate.push(req.headers.authorization || '');
        return json(res, 200, { result: { rejections: [], comparisons: [], postiLasciati: [], letture: LETTURE } });
      }
      if (url.includes('/databases/(default)/documents/')) return json(res, 200, { name: url, fields: {} });
      return json(res, 404, { error: { status: 'NOT_FOUND' } });
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

async function entraOwner(app) {
  return app.evaluate(async ({}, o) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, o.base), init);
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/config').secureTokenEndpoint = o.tokenEndpoint;
    req('./auth/token-store').save({ refreshToken: 'rt-owner', email: o.owner, name: 'Prova', picture: '' });
    const ga = req('./auth/google-auth');
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { base, tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, owner: OWNER_EMAIL });
}

test('le letture registrate dal server arrivano nel registro del canale di Gestione, con chi ha letto e cosa', async ({ app, openTab }) => {
  expect(await entraOwner(app)).toBe(true);
  const page = await openTab(GESTIONE);
  await apriScheda(page, 'log');
  const list = page.locator('#mgChannelList');
  await expect(list.locator('.mg-log-row')).toHaveCount(3, { timeout: 15000 });
  await expect(list).toContainText('scheda scritta: #812 · chiave-riservati');
  await expect(list).toContainText('schede lette: tutti gli aperti (2)');
  await expect(list).toContainText('testi letti: #815 · gestione-lavoro');
  expect(chiamate.length).toBeGreaterThan(0);
  expect(chiamate[0]).toMatch(/^Bearer /);
});
