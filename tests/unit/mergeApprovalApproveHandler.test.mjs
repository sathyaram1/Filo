// L'esito di «Approva e fondi» passa dal main (src/main/services/handlers/auth.js)
// prima di arrivare alla pagina di Gestione. Il server dice più di «esito e
// sha»: il riallineamento fatto da lui (`realigned`), la richiesta nuova aperta
// per la sola differenza (`newRequest`, `newBlocks`) e il motivo di un
// tentativo fallito (`realignReason`). Il main deve lasciarli passare TUTTI:
// una volta li buttava via, e la pagina diceva «la richiesta decade, rilancia»
// a un riallineamento riuscito (verifica locale del 2026-09-13, giro 1).
//
// Stesso harness di decksImportExportHandler.test.mjs: handler vero registrato
// con `on`/`ctx` finti, sessione da proprietario al posto del modulo di
// accesso, server = un HTTP locale che parla il protocollo onCall.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const SHA_A = 'a1b2c3d4'.repeat(5);
const SHA_B = 'b2c3d4e5'.repeat(5);
const SHA_M = 'c3d4e5f6'.repeat(5);

let server;
let risposta = null;
let handlers;
let MSG;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (data.op === 'approve') return res.end(JSON.stringify({ result: risposta }));
      res.end(JSON.stringify({ result: { ok: true, pending: [], failed: [], recent: [] } }));
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

function approva() {
  const h = handlers.get(MSG.MERGE_APPROVAL_APPROVE);
  assert.ok(h, 'il main non registra il gestore dell’approvazione');
  return h({ type: MSG.MERGE_APPROVAL_APPROVE, id: 'ab12cd34ef56ab12cd34ef56' }, { isShell: true }, 'filo://manage/manage.html');
}

test('stale riallineata: alla pagina arrivano riallineamento, richiesta nuova e blocchi nuovi', async () => {
  const blocchi = [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }];
  risposta = {
    ok: true, result: 'stale', headSha: SHA_B,
    realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M },
    newRequest: 'ff00ff00ff00ff00ff00ff00', newBlocks: blocchi,
  };
  const r = await approva();
  assert.equal(r.ok, true);
  assert.equal(r.result, 'stale');
  assert.equal(r.headSha, SHA_B);
  assert.deepEqual(r.realigned, { from: SHA_A, to: SHA_B, mainSha: SHA_M });
  assert.equal(r.newRequest, 'ff00ff00ff00ff00ff00ff00');
  assert.deepEqual(r.newBlocks, blocchi);
});

test('merged riallineata: alla pagina arriva che il server ha riallineato prima di fondere', async () => {
  risposta = { ok: true, result: 'merged', sha: SHA_M, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } };
  const r = await approva();
  assert.equal(r.result, 'merged');
  assert.equal(r.sha, SHA_M);
  assert.deepEqual(r.realigned, { from: SHA_A, to: SHA_B, mainSha: SHA_M });
});

test('merged senza riallineamento: nessun campo inventato', async () => {
  risposta = { ok: true, result: 'merged', sha: SHA_M };
  const r = await approva();
  assert.deepEqual(r, { ok: true, result: 'merged', sha: SHA_M, headSha: '' });
});

test('conflict con tentativo fallito: alla pagina arrivano il motivo del conflitto e quello del riallineamento', async () => {
  risposta = {
    ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale',
    realignReason: 'richiesta nuova per la punta riallineata non registrata: realign_request_failed',
  };
  const r = await approva();
  assert.equal(r.result, 'conflict');
  assert.equal(r.reason, 'conflitto di merge: serve risoluzione manuale');
  assert.match(r.realignReason, /realign_request_failed/);
});

test('un riallineamento malformato non arriva come oggetto strano', async () => {
  risposta = { ok: true, result: 'merged', sha: SHA_M, realigned: 'sì' };
  const r = await approva();
  assert.equal('realigned' in r, false);
});

test('la frase che legge l’owner, costruita con quello che il main passa davvero', async () => {
  require(join(ROOT, 'src', 'shared', 'mergeApprovals.js'));
  const UI = globalThis.SN_MERGE_APPROVALS;
  risposta = {
    ok: true, result: 'stale', headSha: SHA_B,
    realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, newRequest: 'ff00ff00ff00ff00ff00ff00', newBlocks: [],
  };
  const msg = UI.outcomeMessage(await approva(), { origin: 'routine' });
  assert.match(msg.text, /il server ha riallineato il ramo/);
  assert.match(msg.text, /richiesta nuova/);
  assert.doesNotMatch(msg.text, /decade/);
  assert.equal(msg.reload, true);
});
