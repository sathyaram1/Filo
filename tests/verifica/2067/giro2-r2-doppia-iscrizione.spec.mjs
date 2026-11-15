// Verifica #2067 giro 2, rilievo 2: un account anonimo cancellato riparte con UN account nuovo anche se un'altra parte
// di Filo chiede l'identità mentre il nuovo si sta creando. Servizio d'accesso finto su HTTP locale, iscrizione lenta.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const stato = { iscrizioni: 0, rifiuto: '', lenta: false };
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
        const rispondi = () => json(res, 200, { idToken: jwt(uid), refreshToken: `rt-${uid}`, expiresIn: '3600', localId: uid });
        return stato.lenta ? setTimeout(rispondi, 1500) : rispondi();
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

test('r2 un account cancellato riparte con un solo account nuovo, anche con due richieste a cavallo', async ({ app }) => {
  const prima = await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const anon = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'))('./auth/anon-auth');
    await anon.getIdToken();
    return anon.getUid();
  });
  expect(prima).toBe('anon-1');

  stato.rifiuto = 'USER_NOT_FOUND';
  stato.lenta = true;
  const uids = await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const anon = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'))('./auth/anon-auth');
    anon._expireToken();
    const uidDi = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString('utf8')).user_id;
    const prima = anon.getIdToken();
    // Il rinnovo rifiutato torna subito; l'iscrizione nuova impiega un secondo e mezzo: a metà chiede qualcun altro.
    await new Promise((r) => setTimeout(r, 600));
    const seconda = anon.getIdToken();
    return (await Promise.all([prima, seconda])).map(uidDi);
  });
  expect(stato.iscrizioni, 'una seconda iscrizione partita mentre la prima era in volo').toBe(2);
  expect(uids).toEqual(['anon-2', 'anon-2']);
});
