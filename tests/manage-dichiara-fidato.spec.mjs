// «DICHIARA FIDATO COM'È» DALLA PAGINA AL SERVER (#2258): il tratto che manage-lavori-server.spec.mjs non vede.
//
// COSA DEVE ESSERE VERO
//   1. La prova arriva al server come { op:'dichiara', feedbackId, prova:true } e torna alla pagina con rami e `visto`.
//   2. La conferma porta al server esattamente il `visto` che la pagina ha ricevuto, e un sì torna come { ok:true }.
//   3. I no del server tornano in parole: il suo motivo, la funzione non pubblicata, l'operazione sconosciuta.
//   4. Un `visto` storto dalla pagina non parte nemmeno.
// La funzione del server è un HTTP locale, come in redteam-pausa.spec.mjs.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const PUNTA_APP = 'a'.repeat(40);
const PUNTA_SRV = 'b'.repeat(40);
const QUANDO = Date.parse('2026-11-06T13:32:00Z');

let server;
let base = '';
const chiamate = [];
// Come risponde la funzione alla prossima conferma.
let risposta = 'ok';

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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: 'rt-owner', expires_in: '3600', user_id: 'owner-1' });
      if (url === '/ownerFiducia') {
        const d = body.data || {};
        chiamate.push(d);
        if (d.prova) {
          return json(res, 200, { result: { ok: true, prova: true, stato: 1, scritti: [{ at: QUANDO, ruolo: 'fixer' }, { at: 0, ruolo: 'x' }], visto: { stato: 1, app: PUNTA_APP, server: PUNTA_SRV }, rami: [
            { repo: 'app', punta: PUNTA_APP, motivo: 'una voce di biglietti non fidati' },
            { repo: 'server', punta: PUNTA_SRV, motivo: 'un buco nel registro' },
          ] } });
        }
        if (risposta === 'cambiato') return json(res, 200, { result: { ok: false, reason: 'cambiato', detail: 'il lavoro è cambiato da quando l’hai guardato: riguardalo prima di dichiararlo fidato' } });
        if (risposta === 'vecchio') return json(res, 200, { result: { ok: false, reason: 'op_sconosciuta', detail: 'op ammesse: segna, togli, migra, sana' } });
        if (risposta === 'assente') return json(res, 404, { error: { message: 'not found', status: 'NOT_FOUND' } });
        return json(res, 200, { result: { ok: true, rami: [{ repo: 'app', punta: PUNTA_APP, motivo: 'x' }], stato: 1 } });
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

async function entraOwner(app) {
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/config').secureTokenEndpoint = o.tokenEndpoint;
    req('./auth/token-store').save({ refreshToken: 'rt-owner', email: o.owner, name: 'Prova', picture: '' });
    const ga = req('./auth/google-auth');
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, owner: OWNER_EMAIL });
}

const manda = (page, msg) => page.evaluate((m) => window.filo.message(m), msg);

test('#2258: la prova e la conferma passano dal main al server con quello che l’owner ha visto; i no tornano in parole', async ({ app, openTab }) => {
  expect(await entraOwner(app)).toBe(true);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo);

  const prova = await manda(page, { type: 'fiducia_dichiara', feedbackId: 'srv-8', prova: true });
  expect(prova).toEqual({ ok: true, stato: 1, visto: { stato: 1, app: PUNTA_APP, server: PUNTA_SRV }, rami: [
    { repo: 'app', punta: PUNTA_APP, motivo: 'una voce di biglietti non fidati' },
    { repo: 'server', punta: PUNTA_SRV, motivo: 'un buco nel registro' },
  ] });
  expect(chiamate.at(-1)).toEqual({ op: 'dichiara', feedbackId: 'srv-8', prova: true });

  risposta = 'ok';
  const si = await manda(page, { type: 'fiducia_dichiara', feedbackId: 'srv-8', visto: prova.visto });
  expect(si.ok).toBe(true);
  expect(chiamate.at(-1)).toEqual({ op: 'dichiara', feedbackId: 'srv-8', visto: { stato: 1, app: PUNTA_APP, server: PUNTA_SRV } });

  risposta = 'cambiato';
  expect(await manda(page, { type: 'fiducia_dichiara', feedbackId: 'srv-8', visto: prova.visto }))
    .toEqual({ ok: false, error: 'il lavoro è cambiato da quando l’hai guardato: riguardalo prima di dichiararlo fidato' });
  risposta = 'vecchio';
  expect((await manda(page, { type: 'fiducia_dichiara', feedbackId: 'srv-8', visto: prova.visto })).error).toMatch(/non sa ancora farlo/);
  risposta = 'assente';
  expect((await manda(page, { type: 'fiducia_dichiara', feedbackId: 'srv-8', visto: prova.visto })).error).toMatch(/non è ancora pubblicata/);

  const prima = chiamate.length;
  const storto = await manda(page, { type: 'fiducia_dichiara', feedbackId: 'srv-8', visto: { stato: 1, app: 'non-uno-sha' } });
  expect(storto.ok).toBe(false);
  expect(storto.error).toMatch(/Manca quello che hai guardato/);
  expect(chiamate.length).toBe(prima);
});
