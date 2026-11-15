// #2067: chi torna dopo la pulizia degli account anonimi mai tornati trova il suo account cancellato. Senza un
// portafoglio su disco Filo riparte da solo con un account nuovo; un account disattivato resta perso. Regola:
// src/main/auth/anon-auth.js. Servizio d'accesso finto su HTTP locale.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const stato = { iscrizioni: 0, rifiuto: '' };
let server;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
const jwt = (uid) => `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid }))}.firma`;
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') {
        stato.iscrizioni++;
        const uid = `anon-${stato.iscrizioni}`;
        return json(res, 200, { idToken: jwt(uid), refreshToken: `rt-${uid}`, expiresIn: '3600', localId: uid });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token') || '';
        if (stato.rifiuto && rt === 'rt-anon-1') return json(res, 400, { error: { code: 400, message: stato.rifiuto, status: 'INVALID_ARGUMENT' } });
        const uid = rt.replace(/^rt-/, '');
        return json(res, 200, { id_token: jwt(uid), refresh_token: rt, expires_in: '3600', user_id: uid });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { stato.iscrizioni = 0; stato.rifiuto = ''; });

// L'identità del main, come la chiedono crediti, inviti e contatori. `scade`: il token è scaduto, come dopo settimane.
const chiedi = (app, scade) => app.evaluate(async ({}, scade) => {
  const Module = process.getBuiltinModule('module');
  const path = process.getBuiltinModule('path');
  const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
  const anon = req('./auth/anon-auth');
  if (scade) anon._expireToken();
  try {
    await anon.getIdToken();
    return { ok: true, uid: await anon.getUid(), persa: anon.isLost() };
  } catch (e) {
    return { ok: false, codice: e && e.code, persa: anon.isLost() };
  }
}, scade);

test('un account anonimo cancellato, senza portafoglio, riparte da solo con un account nuovo', async ({ app }) => {
  const prima = await chiedi(app, false);
  expect(prima).toMatchObject({ ok: true, uid: 'anon-1' });

  stato.rifiuto = 'USER_NOT_FOUND';
  const dopo = await chiedi(app, true);
  expect(dopo, 'identità ferma su «persa» senza un portafoglio da proteggere').toEqual({ ok: true, uid: 'anon-2', persa: false });
  // Il nuovo resta: la richiesta dopo non ne crea un terzo.
  expect(await chiedi(app, true)).toEqual({ ok: true, uid: 'anon-2', persa: false });
  expect(stato.iscrizioni).toBe(2);
});

test('un account anonimo disattivato resta perso: non se ne crea un altro da solo', async ({ app }) => {
  expect(await chiedi(app, false)).toMatchObject({ ok: true, uid: 'anon-1' });
  stato.rifiuto = 'USER_DISABLED';
  expect(await chiedi(app, true)).toEqual({ ok: false, codice: 'identity_lost', persa: true });
  expect(stato.iscrizioni).toBe(1);
});
