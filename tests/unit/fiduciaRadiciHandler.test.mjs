// #1918: «Segna fidato» e le radici passano dal main (handlers/auth.js) verso ownerFiducia: timbro su una radice o su un
// feedback, radici di un feedback o di una domanda, e un server non ancora aggiornato detto in chiaro. Harness di
// domandeHandler.test.mjs: handler vero, sessione da proprietario finta, server HTTP locale.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let server;
let rispondi = () => ({ status: 200, body: { result: { ok: true } } });
let ricevute = [];
let handlers;
let MSG;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      ricevute.push({ path: req.url, data });
      const r = rispondi(data);
      res.writeHead(r.status, { 'Content-Type': r.html ? 'text/html' : 'application/json' });
      res.end(r.html || JSON.stringify(r.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;

  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true, isAdmin: () => true, getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

function chiama(msg) {
  const h = handlers.get(msg.type);
  assert.ok(h, `il main non registra ${msg.type}`);
  ricevute = [];
  return h(msg, { isShell: true }, 'filo://manage/manage.html');
}

test('il timbro su una radice manda la radice, e torna quante cose hanno cambiato fiducia', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, radice: 'legacy', timbrata: true, cambiati: { feedback: 3 } } } });
  const r = await chiama({ type: MSG.FIDUCIA_SEGNA, radice: ' legacy ', feedbackId: 'ignorato' });
  assert.deepEqual(ricevute[0].data, { op: 'segna', radice: 'legacy' });
  assert.equal(ricevute[0].path, '/ownerFiducia');
  assert.deepEqual(r, { ok: true, radice: 'legacy', timbrata: true, cambiati: { feedback: 3 } });
  await chiama({ type: MSG.FIDUCIA_SEGNA, radice: 'feedback:1916', fidato: false });
  assert.deepEqual(ricevute[0].data, { op: 'togli', radice: 'feedback:1916' });
});

test('il timbro su un feedback: la fiducia che dice il server, anche quando resta non fidato', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, fiducia: 'non_fidato', restano: ['ignota'] } } });
  const r = await chiama({ type: MSG.FIDUCIA_SEGNA, feedbackId: 'u-1916' });
  assert.deepEqual(ricevute[0].data, { op: 'segna', feedbackId: 'u-1916' });
  assert.deepEqual(r, { ok: true, fiducia: 'non_fidato' });
  assert.match((await chiama({ type: MSG.FIDUCIA_SEGNA })).error, /Manca il feedback/);
});

test('un server che non sa timbrare una radice lo dice in chiaro', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: false, reason: 'feedback_non_valido', detail: 'indirizzo del feedback non valido' } } });
  const r = await chiama({ type: MSG.FIDUCIA_SEGNA, radice: 'legacy' });
  assert.match(r.error, /non sa ancora timbrare una radice/);
});

test('le radici per il cartellino: di un feedback o di una domanda, con la sola chiave giusta', async () => {
  const radici = [{ radice: 'legacy', tipo: 'legacy', timbrata: false }];
  rispondi = () => ({ status: 200, body: { result: { ok: true, fiducia: 'non_fidato', radici } } });
  assert.deepEqual(await chiama({ type: MSG.FIDUCIA_RADICI, feedbackId: 'u-1' }), { ok: true, fiducia: 'non_fidato', radici });
  assert.deepEqual(ricevute[0].data, { op: 'radici', feedbackId: 'u-1' });
  await chiama({ type: MSG.FIDUCIA_RADICI, domandaId: 'D-90' });
  assert.deepEqual(ricevute[0].data, { op: 'radici', domandaId: 'D-90' });
  assert.match((await chiama({ type: MSG.FIDUCIA_RADICI })).error, /Manca il feedback o la domanda/);
});

test('un server che non sa dire le radici lo dice in chiaro', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: false, reason: 'op_sconosciuta', detail: 'op ammesse' } } });
  assert.match((await chiama({ type: MSG.FIDUCIA_RADICI, feedbackId: 'u-1' })).error, /non sa ancora dire le radici/);
});
