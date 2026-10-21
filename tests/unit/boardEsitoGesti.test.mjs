// #678.1 — un voto o una riapertura che non passano lo DICONO, con la frase
// giusta per la causa: rete assente, sessione chiusa, fix tornato in
// lavorazione. Prima la pagina riceveva il messaggio grezzo (o niente) e il
// conteggio tornava indietro senza spiegazioni. Stesso harness di
// boardReopenRace.test.mjs: handler registrato con `on`/`ctx` finti. Dal #1076
// vota e riapre chi ha un portafoglio, con l'identità dell'installazione, e la
// riapertura la fa il server.

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
let owner;
auth.isAdmin = () => owner;
const identita = require(join(__dirname, '..', '..', 'src', 'main', 'auth', 'anon-auth.js'));
identita.getIdToken = async () => { if (tokenGuasto) throw tokenGuasto; return 'tok-installazione'; };
identita.getUid = async () => 'uid-installazione';

let scheda;       // la scheda pubblica come la vede il server (null = tolta)
let schedaGuasto; // Error lanciato dalla lettura della scheda
let votoGuasto;   // Error lanciato dalla scrittura del voto
let spese; // chiamate al server per riaprire

beforeEach(() => {
  signedIn = true;
  owner = false;
  tokenGuasto = null;
  scheda = { _id: 'fb-1', seq: 7, status: 'done', votes: {} };
  schedaGuasto = null;
  votoGuasto = null;
  spese = 0;
});

globalThis.SN_CREDITS = {
  awardVoteOnce: async () => ({ awarded: false, credits: 0, balance: 100 }),
};
globalThis.SN_WALLET_MAIN = {
  haPortafoglio: () => true,
  // Come la callable vera: il token dell'installazione si chiede lì dentro.
  chiama: async () => { if (tokenGuasto) throw tokenGuasto; spese += 1; return { ok: true, feedbackId: 'fb-figlio', num: '#8', cost: 5, balance: 80 }; },
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

test('token rifiutato dal database (401): per l\'owner è la sessione, per l\'installazione no', async () => {
  votoGuasto = new Error('firestore castVote fallito (401): UNAUTHENTICATED');
  owner = true;
  const r = await vota();
  assert.equal(r.code, 'auth');
  assert.match(r.error, /accesso/);
  // Rifare l'accesso Google non cambia il token dell'installazione: niente invito a rifarlo.
  owner = false;
  const r2 = await vota();
  assert.notEqual(r2.code, 'auth');
  assert.match(r2.error, /voto non è stato registrato/i);
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
  // Le regole rifiutano chi vota: col portafoglio che il server non riconosce, lo si dice (#1076).
  const r = await vota();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'portafoglio');
  assert.match(r.error, /non risulta attivo/);
  assert.doesNotMatch(r.error, /firestore/);
  owner = true;
  const r2 = await vota();
  assert.notEqual(r2.code, 'gone');
  assert.match(r2.error, /voto non è stato registrato/i);
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

test('riapertura riuscita: torna la spesa e il saldo, che la pagina mostra nella conferma', async () => {
  const r = await riapri();
  assert.equal(r.ok, true);
  assert.equal(r.cost, 5);
  assert.equal(r.balance, 80);
});

test('voto scritto ma rilettura caduta: niente conteggi vuoti che azzerino la scheda', async () => {
  const vero = globalThis.fetch;
  try {
    for (const guasto of [async () => { throw retePersa(); }, async () => ({ ok: false, status: 503 })]) {
      globalThis.fetch = guasto;
      for (const r of [await vota(), await ritira()]) {
        assert.equal(r.ok, true);
        assert.equal(r.votes, null);
      }
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    assert.deepEqual((await vota()).votes, {});
  } finally {
    globalThis.fetch = vero;
  }
});
