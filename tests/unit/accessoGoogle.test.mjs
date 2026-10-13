// #1086 — l'accesso con Google: il ritorno nel loopback lo decide solo lo state giusto, il consenso non si
// ripropone a ogni accesso, e sul secondo computer (account già legato altrove) l'accesso riesce davvero.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const auth = require('../../src/main/auth/google-auth.js');
const anon = require('../../src/main/auth/anon-auth.js');
const cfg = require('../../src/main/auth/config.js');
const { _internals } = auth;

const fetchVero = globalThis.fetch;
const anonVero = { hasIdentity: anon.hasIdentity, getIdToken: anon.getIdToken };
afterEach(() => {
  globalThis.fetch = fetchVero;
  Object.assign(anon, anonVero);
  auth.signOut();
});

function chiama(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let corpo = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { corpo += c; });
      r.on('end', () => res({ status: r.statusCode, corpo }));
    }).on('error', rej);
  });
}

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

// Firebase come risponde davvero: un collegamento a un account Google già legato a un'altra installazione
// torna 200 senza token se si chiede returnIdpCredential, 400 altrimenti.
function firebaseFinto({ collegamento = 'reale', accesso = 'ok' } = {}) {
  const chiamate = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith(cfg.tokenEndpoint)) return json({ id_token: 'google-id-token' });
    if (u.startsWith(cfg.signInWithIdpEndpoint)) {
      const body = JSON.parse(opts.body);
      chiamate.push(body);
      if (body.idToken) {
        if (collegamento === 'reale' && !body.returnIdpCredential) {
          return json({ error: { code: 400, message: 'FEDERATED_USER_ID_ALREADY_LINKED' } }, 400);
        }
        return json({ errorMessage: 'FEDERATED_USER_ID_ALREADY_LINKED', email: 'mario@example.com', federatedId: 'x' });
      }
      if (accesso === 'senza-token') return json({ needConfirmation: true, email: 'mario@example.com' });
      return json({ idToken: 'a.b.c', refreshToken: 'refresh-vero', expiresIn: '3600', email: 'mario@example.com', displayName: 'Mario' });
    }
    throw new Error('fetch inatteso: ' + u);
  };
  return chiamate;
}

function conIdentitaInstallazione() {
  anon.hasIdentity = () => true;
  anon.getIdToken = async () => 'anon-id-token';
}

async function accedi() {
  const f = await _internals.nuovoFlusso();
  f.esito.catch(() => {}); // come signIn, che lo aggancia subito: l'esito può arrivare prima di chi lo aspetta
  const state = new URL(f.url).searchParams.get('state');
  const ritorno = await chiama(`${f.loop.redirectUri}/?code=codice-google&state=${encodeURIComponent(state)}`);
  assert.equal(ritorno.status, 200);
  return f.esito;
}

test('il ritorno senza lo state giusto non chiude né fa fallire l\'accesso', async () => {
  const loop = await _internals.startLoopback('stato-vero');
  let esito = 'in attesa';
  loop.waitForCode().then((c) => { esito = c; }, (e) => { esito = e; });
  for (const q of ['?error=access_denied', '?error=access_denied&state=altro', '?code=intruso&state=stato-falso', '', 'favicon.ico']) {
    const r = await chiama(`${loop.redirectUri}/${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(esito, 'in attesa', `«${q}» non deve chiudere l'accesso`);
  }
  await chiama(`${loop.redirectUri}/?code=codice-vero&state=stato-vero`);
  assert.equal(await loop.waitForCode(), 'codice-vero');
});

test('lo state giusto con un errore di Google chiude l\'accesso col suo motivo', async () => {
  const loop = await _internals.startLoopback('stato-vero');
  const attesa = loop.waitForCode();
  const r = await chiama(`${loop.redirectUri}/?error=access_denied&state=stato-vero`);
  assert.equal(r.status, 200);
  await assert.rejects(attesa, (e) => e.code === 'annullato');
});

test('il consenso non si chiede a ogni accesso e non si chiede l\'accesso offline', async () => {
  const f = await _internals.nuovoFlusso();
  const p = new URL(f.url).searchParams;
  f.loop.abort(new Error('fine prova'));
  await assert.rejects(f.esito);
  assert.equal(p.get('prompt'), 'select_account');
  assert.equal(p.has('access_type'), false);
});

for (const collegamento of ['reale', 'sempre-200']) {
  test(`secondo computer (${collegamento}): il collegamento rifiutato ripiega sull'accesso normale, e si è dentro`, async () => {
    conIdentitaInstallazione();
    const chiamate = firebaseFinto({ collegamento });
    const profilo = await accedi();
    assert.equal(auth.isSignedIn(), true);
    assert.equal(profilo.email, 'mario@example.com');
    assert.equal(await auth.getIdToken(), 'a.b.c');
    assert.equal(chiamate.length, 2);
    assert.equal(chiamate[0].idToken, 'anon-id-token');
    assert.equal(chiamate[1].idToken, undefined);
  });
}

test('una risposta senza token non è un accesso: lo dice, e la sessione di prima resta', async () => {
  firebaseFinto();
  await accedi();
  assert.equal(auth.isSignedIn(), true);
  conIdentitaInstallazione();
  firebaseFinto({ accesso: 'senza-token' });
  await assert.rejects(accedi(), /senza sessione/);
  assert.equal(auth.isSignedIn(), true);
  assert.equal(await auth.getIdToken(), 'a.b.c');
});

test('senza nessuna sessione prima, un accesso senza token lascia fuori e non mostra un profilo', async () => {
  firebaseFinto({ accesso: 'senza-token' });
  await assert.rejects(accedi());
  assert.equal(auth.isSignedIn(), false);
  assert.equal(auth.getProfile(), null);
});
