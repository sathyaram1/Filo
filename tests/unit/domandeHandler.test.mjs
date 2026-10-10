// Le porte della pagina verso ownerDomande (#1149) passano dal main (handlers/auth.js): la richiesta arriva al
// server con i soli campi ammessi, e una callable non ancora pubblicata si dice all'owner, non come «riprova».
// Harness di mergeApprovalApproveHandler.test.mjs: handler vero, sessione da proprietario finta, server HTTP locale.

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

test('elenco: al server va op elenco col delta, alla pagina domande, riferimenti e adesso', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, domande: [{ id: 'D-1' }], riferimenti: { f1: { num: '#8' } }, adesso: 1234 } } });
  const r = await chiama({ type: MSG.DOMANDE_ELENCO, dopo: 1000, extra: 'ignorato' });
  assert.deepEqual(r, { ok: true, domande: [{ id: 'D-1' }], riferimenti: { f1: { num: '#8' } }, adesso: 1234, altre: false });
  assert.equal(ricevute[0].path, '/ownerDomande');
  assert.deepEqual(ricevute[0].data, { op: 'elenco', dopo: 1000 });
});

test('rispondi: passano solo id, scelta intera e testo; senza nessuno dei due il server non si chiama', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, domanda: { id: 'D-3', stato: 'chiusa' }, esito: { ok: true } } } });
  const r = await chiama({ type: MSG.DOMANDA_RISPONDI, id: 'D-3', scelta: 1, testo: 'va bene', autore: 'owner', fiducia: 'fidato' });
  assert.equal(r.ok, true);
  assert.deepEqual(ricevute[0].data, { op: 'rispondi', id: 'D-3', scelta: 1, testo: 'va bene' }, 'chi ha scritto lo decide il server');
  const vuota = await chiama({ type: MSG.DOMANDA_RISPONDI, id: 'D-3', scelta: '1' });
  assert.equal(vuota.ok, false);
  assert.equal(ricevute.length, 0);
});

test('callable non ancora pubblicata: la pagina lo legge in chiaro', async () => {
  rispondi = () => ({ status: 404, html: '<html>Page not found</html>' });
  const r = await chiama({ type: MSG.DOMANDE_ELENCO });
  assert.equal(r.ok, false);
  assert.match(r.error, /non sono ancora pubblicate/);
});

test('un rifiuto del server arriva con la sua frase; consiglio porta gli esiti', async () => {
  rispondi = () => ({ status: 404, body: { error: { status: 'NOT_FOUND', message: 'La domanda D-9 non esiste.' } } });
  const r = await chiama({ type: MSG.DOMANDA_MOSTRA, id: 'D-9' });
  assert.deepEqual(r, { ok: false, error: 'La domanda D-9 non esiste.' });
  rispondi = () => ({ status: 200, body: { result: { ok: true, esiti: [{ id: 'D-1', ok: true, etichetta: 'Archivia #8' }, { id: 'D-2', ok: false, errore: 'una_per_una' }] } } });
  const c = await chiama({ type: MSG.DOMANDE_CONSIGLIO, ids: ['D-1', ' D-2 ', ''] });
  assert.equal(c.ok, true);
  assert.equal(c.esiti.length, 2);
  assert.deepEqual(ricevute[0].data, { op: 'consiglio', ids: ['D-1', 'D-2'] });
});
