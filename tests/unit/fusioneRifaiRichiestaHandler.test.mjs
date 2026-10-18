// #1040: «Rifai la richiesta» su una pratica ferma al cancello senza niente da approvare. Il main chiede al server
// la fusione del ramo della pratica (ownerMerge con feedbackId) e traduce l'esito per la pagina; la decisione resta
// del server. Stesso harness di mergeApprovalApproveHandler.test.mjs: handler vero, server onCall finto.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let server;
let fusione = null;
let salto = null;
let elenco = { ok: true, pending: [], failed: [], recent: [] };
let chiamate = [];
let handlers;
let MSG;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      chiamate.push({ url: req.url, data });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.endsWith('/ownerMerge')) return res.end(JSON.stringify({ result: fusione }));
      if (req.url.endsWith('/ownerSkipSecaudit')) return res.end(JSON.stringify({ result: salto }));
      res.end(JSON.stringify({ result: elenco }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;

  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true,
      isAdmin: () => true,
      getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }),
      getUid: async () => 'uid-owner',
      getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), {
    MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {},
  });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  chiamate = [];
  elenco = { ok: true, pending: [], failed: [], recent: [] };
});

function rifai(msg = {}) {
  const h = handlers.get(MSG.FUSIONE_RICHIESTA_RIFAI);
  assert.ok(h, 'il main non registra il gestore');
  return h({ type: MSG.FUSIONE_RICHIESTA_RIFAI, feedbackId: 'p1', branch: 'worker/p1', ...msg }, { isShell: true }, 'filo://manage/manage.html');
}

test('chiede al server la fusione del ramo DELLA pratica, col suo id e senza una punta raccontata', async () => {
  fusione = { ok: true, result: 'blocked', reason: 'hooks', requestId: 'req-1', pratica: true };
  elenco = { ok: true, pending: [{ id: 'req-1', feedbackId: 'p1' }], failed: [], recent: [] };
  const r = await rifai();
  assert.deepEqual(r, { ok: true, esito: 'richiesta', requestId: 'req-1' });
  const chiesta = chiamate.find((c) => c.url.endsWith('/ownerMerge'));
  assert.deepEqual(chiesta.data, { branch: 'worker/p1', feedbackId: 'p1' }, 'la punta la legge il server da GitHub');
});

test('stessa richiesta già scartata o decisa: lo dice, non «rifatta»', async () => {
  fusione = { ok: true, result: 'blocked', reason: 'hooks', requestId: 'req-1', pratica: true };
  elenco = { ok: true, pending: [], failed: [], recent: [{ id: 'req-1', discarded: true }] };
  assert.equal((await rifai()).esito, 'gia_decisa');
});

test('una richiesta in conflitto (approvata, non avvenuta) conta come ferma', async () => {
  fusione = { ok: true, result: 'blocked', reason: 'hooks', requestId: 'req-1', pratica: true };
  elenco = { ok: true, pending: [], failed: [{ id: 'req-1', used: true, outcome: 'conflict' }], recent: [] };
  assert.equal((await rifai()).esito, 'richiesta');
});

test('server che non lega la richiesta alla pratica: non_legata, non un successo', async () => {
  fusione = { ok: true, result: 'blocked', reason: 'hooks', requestId: 'req-1' };
  assert.deepEqual(await rifai(), { ok: true, esito: 'non_legata', requestId: 'req-1' });
});

test('blocco senza richiesta, conflitto, fusione, guasto: ognuno col suo esito', async () => {
  fusione = { ok: true, result: 'blocked', reason: 'hooks', requestId: '' };
  const senza = await rifai();
  assert.equal(senza.ok, false);
  assert.match(senza.error, /non si è registrata/);

  fusione = { ok: true, result: 'conflict', reason: 'x' };
  assert.deepEqual(await rifai(), { ok: true, esito: 'conflitto' });

  fusione = { ok: true, result: 'merged', sha: 'c'.repeat(40), pratica: true, chiusa: true };
  assert.deepEqual(await rifai(), { ok: true, esito: 'fuso', sha: 'c'.repeat(40), chiusa: true });

  fusione = { ok: false, reason: 'github_unreachable', detail: '' };
  const giu = await rifai();
  assert.equal(giu.ok, false);
  assert.match(giu.error, /GitHub non risponde/);

  fusione = { ok: true, result: 'stale', headSha: 'b'.repeat(40) };
  assert.match((await rifai()).error, /«stale»/);
});

// Verifica #1040 giro 1, rilievo 1: commit arrivati dopo i controlli non li ha letti nessuno, e il server non li fonde
// né li chiede. Per la pagina è un esito suo, che propone di rimettere in coda: non un errore da riprovare.
test('ramo mosso dopo i controlli della pratica: esito «cambiato», non un errore', async () => {
  fusione = { ok: true, result: 'stale', headSha: 'b'.repeat(40), pratica: true };
  assert.deepEqual(await rifai(), { ok: true, esito: 'cambiato' });
});

test('senza pratica o senza un ramo fondibile non chiede niente al server', async () => {
  for (const msg of [{ feedbackId: '' }, { branch: '' }, { branch: 'main' }, { branch: 'a..b' }, { branch: '--force' }, { branch: 'x'.repeat(201) }]) {
    const r = await rifai(msg);
    assert.equal(r.ok, false, JSON.stringify(msg));
  }
  assert.equal(chiamate.length, 0);
});

// «Salta il controllo» con la richiesta non registrata: il server lascia la pratica dov'è e risponde guasto con la
// frase per l'owner. Alla pagina arriva la frase, non il codice del motivo.
test('salta il controllo, richiesta non registrata: alla pagina la frase del server, non «approval_not_recorded»', async () => {
  salto = { ok: false, esito: 'guasto', reason: 'approval_not_recorded', error: 'Il cancello di fusione ha fermato il ramo, ma la richiesta per il tuo via libera non si è registrata. Il salto è registrato: ripremi.' };
  const h = handlers.get(MSG.LIVELLO4_SALTA);
  const r = await h({ type: MSG.LIVELLO4_SALTA, feedbackId: 'p1' }, { isShell: true }, 'filo://manage/manage.html');
  assert.equal(r.ok, false);
  assert.match(r.error, /non si è registrata.*ripremi/);
});
