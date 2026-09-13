// Giro 1 (verifica locale, ramo claude/esiti-riallineamento).
//
// La domanda: quando l'owner preme «Approva e fondi» in Gestione, l'esito
// che LEGGE passa dal processo main di Filo, che chiede al server e poi
// risponde alla pagina. Le frasi nuove (riallineata dal server, richiesta
// nuova con la sola differenza, tentativo di riallineamento fallito col
// motivo) esistono solo se il main fa arrivare alla pagina `realigned`,
// `newRequest` e `realignReason` così come il server li manda.
//
// Qui si ripercorre il cammino VERO main → server: il server è un HTTP locale
// che risponde come il vero (protocollo onCall: { result: {…} }), la sessione
// da proprietario è una finzione registrata al posto del modulo di accesso, e
// l'handler è quello vero, registrato con `on`/`ctx` finti. Niente Electron.
//
// Lo spec della feature (tests/merge-approvals.spec.mjs) sostituisce il canale
// DALLA PAGINA e non passa mai di qui: è il punto cieco che questa prova copre.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const SHA_A = 'a1b2c3d4'.repeat(5);
const SHA_B = 'b2c3d4e5'.repeat(5);
const SHA_M = 'c3d4e5f6'.repeat(5);

let server;
let risposta = null;      // cosa risponde il finto server alla prossima approvazione
let handlers;             // i gestori registrati dall'handler vero
let MSG;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (data.op === 'approve') return res.end(JSON.stringify({ result: risposta }));
      if (data.op === 'list') return res.end(JSON.stringify({ result: { ok: true, pending: [], failed: [], recent: [] } }));
      res.end(JSON.stringify({ result: { ok: true, result: 'discarded' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;

  // La sessione da proprietario, al posto del modulo di accesso vero.
  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  const fintoAuth = {
    isSignedIn: () => true,
    isAdmin: () => true,
    getIdToken: async () => 'token-di-prova',
    getProfile: () => ({ email: 'owner@esempio' }),
    getUid: async () => 'uid-owner',
    getAccessToken: async () => '',
    onChange: () => () => {},
  };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fintoAuth };

  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;

  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), {
    MSG,
    broadcastToTabs() {},
    broadcastToFiloPages() {},
    broadcastLiveUpdate() {},
  });
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

async function approva() {
  const h = handlers.get(MSG.MERGE_APPROVAL_APPROVE);
  expect(h, 'il main non registra il gestore dell’approvazione').toBeTruthy();
  return h({ type: MSG.MERGE_APPROVAL_APPROVE, id: 'ab12cd34ef56ab12cd34ef56' }, { isShell: true }, 'filo://manage/manage.html');
}

test('stale riallineata: alla pagina arrivano il riallineamento e la richiesta nuova, non solo «stale»', async () => {
  risposta = {
    ok: true, result: 'stale', headSha: SHA_B,
    realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M },
    newRequest: 'ff00ff00ff00ff00ff00ff00',
    newBlocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
  };
  const r = await approva();
  expect(r.ok).toBe(true);
  expect(r.result).toBe('stale');
  // Senza questi due campi la pagina dice «la richiesta decade, rilancia»:
  // il contrario di quello che è successo.
  expect(r.realigned).toEqual({ from: SHA_A, to: SHA_B, mainSha: SHA_M });
  expect(r.newRequest).toBe('ff00ff00ff00ff00ff00ff00');
});

test('merged riallineata: alla pagina arriva che il server ha riallineato prima di fondere', async () => {
  risposta = { ok: true, result: 'merged', sha: SHA_M, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } };
  const r = await approva();
  expect(r.ok).toBe(true);
  expect(r.result).toBe('merged');
  expect(r.sha).toBe(SHA_M);
  expect(r.realigned).toEqual({ from: SHA_A, to: SHA_B, mainSha: SHA_M });
});

test('conflict con tentativo fallito: alla pagina arriva il motivo del riallineamento non riuscito', async () => {
  risposta = {
    ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale',
    realignReason: 'richiesta nuova per la punta riallineata non registrata: realign_request_failed',
  };
  const r = await approva();
  expect(r.ok).toBe(true);
  expect(r.result).toBe('conflict');
  expect(r.realignReason).toContain('realign_request_failed');
});

test('l’esito letto dall’owner, costruito con quello che il main passa davvero', async () => {
  require(join(ROOT, 'src', 'shared', 'mergeApprovals.js'));
  const UI = globalThis.SN_MERGE_APPROVALS;
  risposta = {
    ok: true, result: 'stale', headSha: SHA_B,
    realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, newRequest: 'ff00ff00ff00ff00ff00ff00', newBlocks: [],
  };
  const msg = UI.outcomeMessage(await approva(), { origin: 'routine' });
  expect(msg.text).toMatch(/riallineato/);
  expect(msg.text).toMatch(/richiesta nuova/);
  expect(msg.text).not.toMatch(/decade/);
});
