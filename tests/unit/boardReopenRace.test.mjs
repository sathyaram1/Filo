// Unit test degli handler della bacheca (src/main/services/handlers/board.js): «Ancora rotto?» e il voto.
//
// #1076 — un utente qualunque non scrive più `reopenRequests`: la riapertura la fa il server (callable
// `bachecaRiapri`), che scala i crediti del portafoglio, crea il feedback collegato e segna la scheda in una
// transazione. Qui si prova cosa fa il main: senza portafoglio non parte niente; col portafoglio chiama il server con
// l'identità dell'installazione e dice con la frase giusta i suoi rifiuti. Il voto usa la stessa identità.
//
// L'owner riapre ancora da sé, con la sua credenziale e senza spesa: per lui restano le prove di #269 e #602 (il
// segnale scritto per primo, e tolto se la creazione non va, senza mai un figlio doppione).
//
// Harness: `on`/`ctx` finti, SN_FEEDBACK / SN_MANAGE_REVIEW / SN_WALLET_MAIN finti, google-auth e anon-auth
// patchati (board.js tiene gli stessi oggetti). Niente rete, niente Electron.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'messages.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'wallet.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'chatErrors.js'));

const { MSG } = globalThis.SN_MSG;

const UID_GOOGLE = 'google-abc';
const UID_INSTALLAZIONE = 'installazione-xyz';
const ORIGINAL_ID = 'fb-original';

const auth = require(join(__dirname, '..', '..', 'src', 'main', 'auth', 'google-auth.js'));
let owner = false;
auth.isSignedIn = () => true;
auth.isAdmin = () => owner;
auth.getUid = async () => UID_GOOGLE;
auth.getIdToken = async () => 'token-google';
const identita = require(join(__dirname, '..', '..', 'src', 'main', 'auth', 'anon-auth.js'));
identita.getIdToken = async () => 'token-installazione';
identita.getUid = async () => UID_INSTALLAZIONE;

let server;
let failGuard;
let failSubmit;
let portafoglio;
let chiamate;
let rispostaServer;
let voti;
let premi;

beforeEach(() => {
  server = { reopenRequests: {}, feedbacks: [] };
  failGuard = false;
  failSubmit = false;
  owner = false;
  portafoglio = true;
  chiamate = [];
  rispostaServer = async () => ({ ok: true, feedbackId: 'fb-figlio', num: '#201', cost: 5, balance: 4995 });
  voti = [];
  premi = [];
});

globalThis.SN_CREDITS = {
  awardVoteOnce: async (id, amount) => { premi.push({ id, amount }); return { awarded: true, credits: amount, balance: amount }; },
  spendIfAffordable: async () => { throw new Error('il conteggio locale non paga più le riaperture'); },
};

globalThis.SN_WALLET_MAIN = {
  haPortafoglio: () => portafoglio,
  chiama: async (name, data) => { chiamate.push({ name, data }); return rispostaServer(name, data); },
};

let seq = 0;
globalThis.SN_FEEDBACK = {
  castReopenRequest: async (id, uid) => {
    if (failGuard) throw new Error('firestore castReopenRequest fallito (503): network hiccup');
    server.reopenRequests[uid] = { at: new Date().toISOString() };
    return server.reopenRequests[uid];
  },
  // Come il server vero (#370): un id d'invio già visto non crea un secondo documento.
  submit: async (fb) => {
    if (failSubmit === 'dopo-aver-scritto') {
      server.feedbacks.push({ id: `fb-child-${++seq}`, ...fb });
      throw new Error('firestore submit fallito (503): risposta persa');
    }
    if (failSubmit) throw new Error('firestore submit fallito (503): network hiccup');
    const gia = fb.submissionId && server.feedbacks.find((f) => f.submissionId === fb.submissionId);
    if (gia) return { id: gia.id, deduped: true };
    const id = `fb-child-${++seq}`;
    server.feedbacks.push({ id, ...fb });
    return { id };
  },
  clearReopenRequest: async (id, uid) => { delete server.reopenRequests[uid]; return true; },
  getPublic: async () => ({ _id: ORIGINAL_ID, seq: 42, status: 'done', name: 'Condividi', reopenRequests: { ...server.reopenRequests } }),
  castVote: async (id, entry, opts) => { voti.push({ id, entry, opts }); return entry; },
  clearVote: async (id, uid, opts) => { voti.push({ id, uid, opts, via: true }); return true; },
  rest: { FIRESTORE_BASE: 'https://example.invalid/v1', API_KEY: 'k', VIEW_COLLECTION: 'feedback-public' },
  fsDocToObject: (doc) => doc,
};

globalThis.fetch = async () => ({ ok: true, json: async () => ({ votes: {} }) });

globalThis.SN_MANAGE_REVIEW = {
  hasReopenRequest: (fb) => Object.keys((fb && fb.reopenRequests) || {}).length > 0,
  canReopen: (fb) => Object.keys((fb && fb.reopenRequests) || {}).length === 0,
};

const registerBoard = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'handlers', 'board.js'));
const handlers = new Map();
registerBoard((type, fn) => handlers.set(type, fn), { MSG, broadcastToFiloPages: () => {} });
const BACHECA = 'filo://board/board.html';
const reopen = (msg, origin = BACHECA) => handlers.get(MSG.BOARD_REOPEN)(msg, null, origin);
const vota = (msg, origin = BACHECA) => handlers.get(MSG.BOARD_CAST_VOTE)(msg, null, origin);
const identitaBacheca = () => handlers.get(MSG.BOARD_IDENTITA)({}, null, BACHECA);

const msgFor = () => ({ type: MSG.BOARD_REOPEN, id: ORIGINAL_ID, text: 'Ancora rotto, ho riprovato e si spacca uguale.' });

// ── Un utente: la riapertura la fa il server ───────────────────────────────

test('col portafoglio la riapertura passa dal server, che dice spesa e saldo; il client non scrive il segnale', async () => {
  const r = await reopen(msgFor());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(chiamate, [{ name: 'bachecaRiapri', data: { id: ORIGINAL_ID, text: msgFor().text } }]);
  assert.equal(r.feedbackId, 'fb-figlio');
  assert.equal(r.cost, 5);
  assert.equal(r.balance, 4995);
  assert.deepEqual(server.reopenRequests, {}, 'reopenRequests non lo scrive il client');
  assert.equal(server.feedbacks.length, 0, 'il feedback collegato lo crea il server');
});

test('senza portafoglio niente parte: la frase dice cosa serve', async () => {
  portafoglio = false;
  const r = await reopen(msgFor());
  assert.equal(r.ok, false);
  assert.equal(r.code, 'portafoglio');
  assert.match(r.error, /crediti di Filo/);
  assert.equal(chiamate.length, 0);
  // Anche a testo vuoto la risposta è quella: è la prima cosa che manca.
  assert.equal((await reopen({ ...msgFor(), text: '' })).code, 'portafoglio');
});

test('i rifiuti del server diventano la frase giusta, coi numeri', async () => {
  const casi = [
    [{ ok: false, reason: 'insufficient', cost: 5, balance: 3.5 }, (r) => assert.match(r.error, /Servono 5 crediti.*saldo: 3,5/)],
    [{ ok: false, reason: 'already_reopened' }, (r) => assert.equal(r.code, 'gone')],
    [{ ok: false, reason: 'not_on_board' }, (r) => assert.equal(r.code, 'gone')],
    [{ ok: false, reason: 'no_wallet' }, (r) => assert.equal(r.code, 'portafoglio')],
    [{ ok: false, reason: 'disabled' }, (r) => assert.equal(r.code, 'portafoglio')],
    [{ ok: false, reason: 'text_too_long', max: 10000 }, (r) => assert.match(r.error, /10000/)],
    [{ ok: false, reason: 'rate_limited' }, (r) => assert.match(r.error, /riprova fra un minuto/)],
    [{ ok: false, reason: 'server_error' }, (r) => assert.match(r.error, /non è partita/)],
  ];
  for (const [risposta, controlla] of casi) {
    rispostaServer = async () => risposta;
    const r = await reopen(msgFor());
    assert.equal(r.ok, false, JSON.stringify(risposta));
    controlla(r);
  }
});

test('server irraggiungibile: si dice che manca la rete, e il gesto si può rifare', async () => {
  rispostaServer = async () => { throw new TypeError('fetch failed'); };
  const r = await reopen(msgFor());
  assert.equal(r.ok, false);
  assert.equal(r.code, 'offline');
});

test('un fix già segnalato non arriva nemmeno al server', async () => {
  server.reopenRequests = { altro: { at: 'x' } };
  const r = await reopen(msgFor());
  assert.equal(r.code, 'gone');
  assert.equal(chiamate.length, 0);
});

test('da un sito visitato la riapertura non chiama il server e non scrive niente', async () => {
  const r = await reopen(msgFor(), 'https://evil.example/pagina');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forbidden', 'rifiutato per provenienza, non per la sessione');
  assert.equal(chiamate.length, 0);
  assert.equal(server.feedbacks.length, 0);
  assert.deepEqual(server.reopenRequests, {});
});

// ── Il voto: l'identità del portafoglio ────────────────────────────────────

test('il voto parte con l\'identità dell\'installazione e il suo uid, senza premio locale col portafoglio', async () => {
  const r = await vota({ type: MSG.BOARD_CAST_VOTE, id: ORIGINAL_ID, vote: 'works' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.uid, UID_INSTALLAZIONE);
  assert.equal(voti[0].entry.uid, UID_INSTALLAZIONE);
  assert.equal(voti[0].opts.idToken, 'token-installazione');
  assert.equal(r.awarded, false);
  assert.equal(premi.length, 0);
  assert.deepEqual(await identitaBacheca(), { ok: true, uid: UID_INSTALLAZIONE, portafoglio: true });
});

test('senza portafoglio il voto non si scrive e la frase dice cosa serve', async () => {
  portafoglio = false;
  const r = await vota({ type: MSG.BOARD_CAST_VOTE, id: ORIGINAL_ID, vote: 'broken' });
  assert.equal(r.code, 'portafoglio');
  assert.equal(voti.length, 0);
  const b = await identitaBacheca();
  assert.equal(b.portafoglio, false);
  assert.match(b.motivo, /crediti di Filo/);
});

test('un voto respinto dalle regole su una scheda ancora in bacheca: il portafoglio non risulta attivo', async () => {
  globalThis.SN_FEEDBACK.castVote = async () => { const e = new Error('firestore castVote fallito (403): PERMISSION_DENIED'); throw e; };
  globalThis.SN_MANAGE_REVIEW.listBoardTab = (cards) => cards;
  try {
    const r = await vota({ type: MSG.BOARD_CAST_VOTE, id: ORIGINAL_ID, vote: 'works' });
    assert.equal(r.code, 'portafoglio');
    assert.match(r.error, /non risulta attivo/);
  } finally {
    globalThis.SN_FEEDBACK.castVote = async (id, entry, opts) => { voti.push({ id, entry, opts }); return entry; };
    delete globalThis.SN_MANAGE_REVIEW.listBoardTab;
  }
});

test('l\'owner vota con la sua credenziale', async () => {
  owner = true;
  const r = await vota({ type: MSG.BOARD_CAST_VOTE, id: ORIGINAL_ID, vote: 'works' });
  assert.equal(r.ok, true);
  assert.equal(voti[0].opts.idToken, 'token-google');
  assert.equal(r.uid, UID_GOOGLE);
});

// ── L'owner: riapre da sé, senza spesa (#269, #602) ────────────────────────

test('owner: segnale e UN feedback figlio, niente server e niente crediti', async () => {
  owner = true;
  const r = await reopen(msgFor());
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.equal(chiamate.length, 0);
  assert.equal(server.feedbacks.length, 1);
  assert.ok(server.reopenRequests[UID_GOOGLE]);
});

test('owner, rete instabile sul segnale: MAI un figlio orfano, MAI doppioni', async () => {
  owner = true;
  failGuard = true;
  for (let i = 0; i < 3; i++) assert.equal((await reopen(msgFor())).ok, false);
  assert.equal(server.feedbacks.length, 0);
});

test('owner, creazione fallita: il segnale torna indietro e si può riprovare, il figlio resta UNO', async () => {
  owner = true;
  failSubmit = true;
  assert.equal((await reopen(msgFor())).ok, false);
  assert.deepEqual(server.reopenRequests, {});
  failSubmit = false;
  assert.equal((await reopen(msgFor())).ok, true);
  assert.equal(server.feedbacks.length, 1);
  assert.equal((await reopen(msgFor())).ok, false, 'un terzo tentativo è respinto dal segnale');
  assert.equal(server.feedbacks.length, 1);
});

test('owner, la creazione era riuscita ma la risposta si è persa: il ritentativo non crea un doppione', async () => {
  owner = true;
  failSubmit = 'dopo-aver-scritto';
  assert.equal((await reopen(msgFor())).ok, false);
  assert.equal(server.feedbacks.length, 1);
  failSubmit = false;
  assert.equal((await reopen(msgFor())).ok, true);
  assert.equal(server.feedbacks.length, 1);
});
