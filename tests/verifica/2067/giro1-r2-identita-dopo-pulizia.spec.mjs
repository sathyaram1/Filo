// Verifica #2067 giro 1: chi aveva provato Filo una volta e torna dopo la pulizia degli anonimi trova il suo account
// cancellato. Senza un portafoglio su disco non c'è niente da staccare: Filo deve ripartire con un'identità nuova.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const stato = { iscrizioni: 0, cancellato: false };
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
        if (stato.cancellato && rt === 'rt-anon-1') return json(res, 400, { error: { code: 400, message: 'USER_NOT_FOUND', status: 'INVALID_ARGUMENT' } });
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

test('r2 un account anonimo cancellato dalla pulizia, senza portafoglio, riparte da solo con un account nuovo', async ({ app }) => {
  test.setTimeout(60_000);
  const chiedi = (scade) => app.evaluate(async ({}, scade) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const anon = req('./auth/anon-auth');
    if (scade) anon._expireToken();
    try { await anon.getIdToken(); return { ok: true, uid: anon.getUid(), persa: anon.isLost() }; } catch (e) {
      return { ok: false, codice: e && e.code, persa: anon.isLost() };
    }
  }, scade);

  const prima = await chiedi(false);
  expect(prima.ok, JSON.stringify(prima)).toBe(true);

  // La pulizia lo cancella; l'installazione torna dopo settimane e il token è scaduto.
  stato.cancellato = true;
  const dopo = await chiedi(true);
  expect(dopo, 'identità ferma su «persa» senza un portafoglio da proteggere').toMatchObject({ ok: true, persa: false });
  expect(dopo.uid).not.toBe(prima.uid);
});
