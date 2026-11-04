// #1086 — l'accesso con Google: il ritorno nel loopback lo decide solo lo state giusto, il consenso non si
// ripropone a ogni accesso, e sul secondo computer (account già legato altrove) l'accesso riesce davvero.
// #1351 — la pagina del ritorno dice l'esito vero, e le richieste a raffica non riaprono il browser né allungano il tetto.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
// Electron finto per signIn: nessuna finestra normale (l'accesso va nel browser) e un browser che registra le aperture.
const aperture = [];
const percorsoElectron = require.resolve('electron');
require.cache[percorsoElectron] = {
  id: percorsoElectron, filename: percorsoElectron, loaded: true,
  exports: {
    shell: { openExternal: async (u) => { aperture.push(String(u)); } },
    net: { isOnline: () => true },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  },
};
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
  // La pagina del ritorno risponde a esito noto: qui lo dà il test.
  const pagina = chiama(`${loop.redirectUri}/?code=codice-vero&state=stato-vero`);
  assert.equal(await loop.waitForCode(), 'codice-vero');
  loop.concludi();
  assert.equal((await pagina).status, 200);
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

// #678.6 — la pagina del ritorno dice «completato» solo a scambio riuscito; altrimenti dice il perché.
async function ritornoDi(firebase) {
  firebase();
  const f = await _internals.nuovoFlusso();
  f.esito.catch(() => {});
  const state = new URL(f.url).searchParams.get('state');
  const pagina = await chiama(`${f.loop.redirectUri}/?code=codice-google&state=${encodeURIComponent(state)}`);
  return { pagina, esito: await f.esito.then(() => 'ok', (e) => e) };
}

test('scambio riuscito: la pagina del browser dice completato, e manda all\'app', async () => {
  const { pagina, esito } = await ritornoDi(() => firebaseFinto());
  assert.equal(esito, 'ok');
  assert.match(pagina.corpo, /Accesso a Filo completato/);
  assert.match(pagina.corpo, /tornare all&#39;app/);
});

test('scambio rifiutato dal servizio: la pagina del browser non dice completato, dice il perché', async () => {
  const { pagina, esito } = await ritornoDi(() => {
    globalThis.fetch = async () => new Response('servizio giù', { status: 503 });
  });
  assert.notEqual(esito, 'ok');
  assert.doesNotMatch(pagina.corpo, /completato/);
  assert.match(pagina.corpo, /Il servizio di accesso non ha risposto/);
});

test('l\'annullo su Google: la pagina lo dice con la frase dell\'app', async () => {
  const loop = await _internals.startLoopback('stato-vero');
  const attesa = loop.waitForCode().catch((e) => e);
  const r = await chiama(`${loop.redirectUri}/?error=access_denied&state=stato-vero`);
  assert.match(r.corpo, /Accesso annullato/);
  assert.equal((await attesa).code, 'annullato');
});

// #1086.2 — lo strumento dell'owner da terminale usa lo stesso ritorno: la pagina manda al terminale.
test('strumento da terminale: la pagina dice di tornare al terminale', async () => {
  const loop = await _internals.startLoopback('stato-vero', { dove: 'terminale' });
  const codice = loop.waitForCode();
  const pagina = chiama(`${loop.redirectUri}/?code=c&state=stato-vero`);
  assert.equal(await codice, 'c');
  loop.concludi();
  const r = await pagina;
  assert.match(r.corpo, /tornare al terminale/);
  assert.doesNotMatch(r.corpo, /app/);
  const fs = await import('node:fs');
  const script = fs.readFileSync(new URL('../../scripts/admin-login.mjs', import.meta.url), 'utf8');
  assert.match(script, /startLoopback\(state, \{ dove: 'terminale' \}\)/);
  assert.match(script, /loop\.concludi\(\)/);
});

// #1086.2 — un altro programma che chiede un indirizzo che non si legge riceve un rifiuto, e l'accesso resta in ascolto.
test('un indirizzo malformato al ritorno riceve 400, senza errori sfuggiti', async () => {
  const net = await import('node:net');
  const sfuggiti = [];
  const spia = (e) => sfuggiti.push(e);
  process.on('uncaughtException', spia);
  try {
    const loop = await _internals.startLoopback('stato-vero');
    const porta = new URL(loop.redirectUri).port;
    const risposta = await new Promise((res, rej) => {
      const s = net.connect(Number(porta), '127.0.0.1', () => s.write('GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'));
      let dati = '';
      s.setEncoding('utf8');
      s.on('data', (c) => { dati += c; });
      s.on('end', () => res(dati));
      s.on('error', rej);
    });
    assert.match(risposta, /^HTTP\/1\.1 400/);
    const pagina = chiama(`${loop.redirectUri}/?code=codice-vero&state=stato-vero`);
    assert.equal(await loop.waitForCode(), 'codice-vero');
    loop.concludi();
    assert.equal((await pagina).status, 200);
  } finally {
    process.off('uncaughtException', spia);
  }
  assert.deepEqual(sfuggiti, []);
});

// #1132 — l'accesso che aspetta il browser: richieste ravvicinate, da qualunque mittente, aprono il browser una volta
// ogni 10 secondi, e riaprirlo non allunga il tetto di dieci minuti.
const giro = () => new Promise((r) => setImmediate(r));
async function finoA(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await giro();
  assert.ok(cond(), 'condizione mai arrivata');
}
function orologioFinto(t) {
  aperture.length = 0;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-04T10:00:00Z') });
  // Un accesso rimasto aperto da una prova rossa terrebbe vivo il server loopback: lo chiude il suo tetto.
  t.after(() => t.mock.timers.tick(60 * 60 * 1000));
}

test('dieci richieste ravvicinate aprono il browser una volta sola', async (t) => {
  orologioFinto(t);
  const esiti = [];
  for (let i = 0; i < 10; i++) esiti.push(auth.signIn().catch((e) => e));
  await finoA(() => aperture.length >= 1);
  for (let i = 0; i < 20; i++) await giro();
  assert.equal(aperture.length, 1);
  // Passati 10 secondi una nuova richiesta lo riapre, sulla stessa pagina.
  t.mock.timers.tick(10_000);
  esiti.push(auth.signIn().catch((e) => e));
  await finoA(() => aperture.length === 2);
  assert.equal(aperture[1], aperture[0]);
  t.mock.timers.tick(10 * 60 * 1000);
  for (const e of await Promise.all(esiti)) assert.equal(e && e.code, 'scaduto');
});

test('riaprire il browser non allunga il tetto dei dieci minuti', async (t) => {
  orologioFinto(t);
  const primo = auth.signIn().catch((e) => e);
  await finoA(() => aperture.length === 1);
  // Una riapertura a 9 minuti e mezzo: il tetto resta quello della prima richiesta.
  t.mock.timers.tick(9.5 * 60 * 1000);
  const riaperto = auth.signIn().catch((e) => e);
  await finoA(() => aperture.length === 2);
  t.mock.timers.tick(30 * 1000);
  const [a, b] = await Promise.all([primo, riaperto]);
  assert.equal(a && a.code, 'scaduto');
  assert.equal(b && b.code, 'scaduto');
  // Chiuso quell'accesso, la richiesta dopo ne apre uno nuovo, su un'altra pagina.
  const nuovo = auth.signIn().catch((e) => e);
  await finoA(() => aperture.length === 3);
  assert.notEqual(aperture[2], aperture[0]);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal((await nuovo).code, 'scaduto');
});
