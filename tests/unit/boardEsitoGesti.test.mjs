// #678.1 — un voto o una riapertura che non passano lo DICONO, con la frase
// giusta per la causa: rete assente, sessione chiusa, fix tornato in
// lavorazione. Prima la pagina riceveva il messaggio grezzo (o niente) e il
// conteggio tornava indietro senza spiegazioni. Stesso harness di
// boardReopenRace.test.mjs: handler registrato con `on`/`ctx` finti.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');

require(join(SHARED, 'constants.js'));
require(join(SHARED, 'messages.js'));
require(join(SHARED, 'chatErrors.js'));

const { MSG } = globalThis.SN_MSG;

const auth = require(join(__dirname, '..', '..', 'src', 'main', 'auth', 'google-auth.js'));
let signedIn;
let tokenGuasto; // null | Error lanciato dal rinnovo del token
auth.isSignedIn = () => signedIn;
auth.getIdToken = async () => { if (tokenGuasto) throw tokenGuasto; return signedIn ? 'tok' : null; };
auth.getUid = async () => (signedIn ? 'uid-1' : null);

let scheda;       // la scheda pubblica come la vede il server (null = tolta)
let schedaGuasto; // Error lanciato dalla lettura della scheda
let votoGuasto;   // Error lanciato dalla scrittura del voto
let spese;

beforeEach(() => {
  signedIn = true;
  tokenGuasto = null;
  scheda = { _id: 'fb-1', seq: 7, status: 'done', votes: {} };
  schedaGuasto = null;
  votoGuasto = null;
  spese = 0;
});

globalThis.SN_CREDITS = {
  spendIfAffordable: async () => { spese += 1; return { ok: true, balance: 80 }; },
  award: async () => ({ balance: 100 }),
  awardVoteOnce: async () => ({ awarded: false, credits: 0, balance: 100 }),
};
globalThis.SN_FEEDBACK = {
  castVote: async () => { if (votoGuasto) throw votoGuasto; return {}; },
  clearVote: async () => { if (votoGuasto) throw votoGuasto; return true; },
  castReopenRequest: async () => ({}),
  clearReopenRequest: async () => true,
  submit: async () => ({ id: 'fb-figlio' }),
  getPublic: async () => { if (schedaGuasto) throw schedaGuasto; return scheda; },
  rest: { FIRESTORE_BASE: 'https://example.invalid/v1', API_KEY: 'k', VIEW_COLLECTION: 'feedback-public' },
  fsDocToObject: (d) => d,
};
globalThis.SN_MANAGE_REVIEW = {
  hasReopenRequest: (fb) => !!(fb && fb.reopenRequests && Object.keys(fb.reopenRequests).length),
  canReopen: (fb) => !!fb && !(fb.reopenRequests && Object.keys(fb.reopenRequests).length),
  listBoardTab: (list) => list.filter((f) => f && f.status === 'done'
    && !(f.reopenRequests && Object.keys(f.reopenRequests).length)),
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({ votes: {} }) });

const handlers = new Map();
require(join(__dirname, '..', '..', 'src', 'main', 'services', 'handlers', 'board.js'))(
  (type, fn) => handlers.set(type, fn), { MSG });
const BACHECA = 'filo://board/board.html';
const vota = () => handlers.get(MSG.BOARD_CAST_VOTE)({ id: 'fb-1', vote: 'works' }, null, BACHECA);
const ritira = () => handlers.get(MSG.BOARD_CLEAR_VOTE)({ id: 'fb-1' }, null, BACHECA);
const riapri = () => handlers.get(MSG.BOARD_REOPEN)({ id: 'fb-1', text: 'Ancora rotto.' }, null, BACHECA);

const retePersa = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });

test('voto senza rete: frase sulla connessione, mai il messaggio grezzo', async () => {
  votoGuasto = retePersa();
  const r = await vota();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'offline');
  assert.match(r.error, /connessione/);
  assert.doesNotMatch(r.error, /fetch failed/);
});

test('rinnovo del token senza rete: è la rete, non una sessione scaduta', async () => {
  tokenGuasto = retePersa();
  for (const r of [await vota(), await ritira(), await riapri()]) {
    assert.equal(r.code, 'offline');
    assert.doesNotMatch(r.error, /sessione/i);
  }
});

test('rinnovo rifiutato (sessione chiusa dal server): sessione scaduta', async () => {
  tokenGuasto = new Error('refresh sessione fallito (400)');
  signedIn = false; // google-auth chiude la sessione quando il rinnovo è rifiutato
  const r = await handlers.get(MSG.BOARD_CAST_VOTE)({ id: 'fb-1', vote: 'works' }, null, BACHECA);
  assert.equal(r.code, 'auth');
});

test('token rifiutato dal database (401): sessione scaduta', async () => {
  votoGuasto = new Error('firestore castVote fallito (401): UNAUTHENTICATED');
  const r = await vota();
  assert.equal(r.code, 'auth');
  assert.match(r.error, /accesso/);
});

test('voto su un fix tornato in lavorazione: lo dice, per il voto e per il ritiro', async () => {
  votoGuasto = new Error('firestore castVote fallito (403): PERMISSION_DENIED');
  scheda = null;
  for (const r of [await vota(), await ritira()]) {
    assert.equal(r.code, 'gone');
    assert.match(r.error, /tornato in lavorazione/);
  }
});

test('un 403 su una scheda ancora in bacheca non viene spacciato per «tornato in lavorazione»', async () => {
  votoGuasto = new Error('firestore castVote fallito (403): PERMISSION_DENIED');
  const r = await vota();
  assert.equal(r.ok, false);
  assert.notEqual(r.code, 'gone');
  assert.match(r.error, /voto non è stato registrato/i);
  assert.doesNotMatch(r.error, /firestore/);
});

test('riapertura senza rete sulla verifica: frase sulla connessione, niente crediti spesi', async () => {
  schedaGuasto = retePersa();
  const r = await riapri();
  assert.equal(r.code, 'offline');
  assert.doesNotMatch(r.error, /non trovato/i);
  assert.equal(spese, 0);
});

test('riapertura di un fix che non è più in bacheca: tornato in lavorazione, niente crediti spesi', async () => {
  scheda = null;
  const r1 = await riapri();
  assert.equal(r1.code, 'gone');
  scheda = { _id: 'fb-1', status: 'done', reopenRequests: { altro: { at: 'x' } } };
  const r2 = await riapri();
  assert.equal(r2.code, 'gone');
  assert.match(r2.error, /già segnalato/);
  assert.equal(spese, 0);
});

test('riapertura riuscita: torna il saldo, che la pagina mostra nella conferma', async () => {
  const r = await riapri();
  assert.equal(r.ok, true);
  assert.equal(r.balance, 80);
});
