// Unit test dell'handler BOARD_REOPEN (src/main/services/handlers/board.js) di
// fronte a una RETE INSTABILE fra le due scritture Firestore della riapertura a
// pagamento (feedback #269).
//
// Stesso harness di decksImportExportHandler.test.mjs: si registra l'handler con
// `on`/`ctx` finti, si stubbano SN_CREDITS / SN_FEEDBACK / SN_MANAGE_REVIEW e la
// sessione Google (google-auth) — niente rete, niente Electron.
//
// L'handler fa DUE scritture REST separate e non atomiche: (A) marca il guard
// anti-doppia-riapertura sull'originale (reopenRequests.<uid>) e (B) crea il
// feedback figlio collegato. Il bug: se (B) veniva PRIMA di (A) e la rete cadeva
// fra le due, restava un feedback figlio orfano col guard MAI marcato → l'utente
// poteva ripetere all'infinito creando duplicati gratis (crediti sempre
// rimborsati), bypassando l'anti-spam. Il fix marca il guard PER PRIMO.
//
// Asserzioni di COMPORTAMENTO (non "non crasha"): con la scrittura del guard che
// fallisce ripetutamente NON deve mai nascere un feedback figlio; e una volta
// che il guard è marcato, ogni ritentativo è bloccato → mai piu di un figlio.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'messages.js'));

const { MSG } = globalThis.SN_MSG;
const { SN_CONST } = globalThis;

// Sessione Google finta: patchiamo il singleton google-auth (board.js tiene un
// riferimento allo STESSO oggetto, quindi mutarne i metodi basta).
const auth = require(join(__dirname, '..', '..', 'src', 'main', 'auth', 'google-auth.js'));
auth.isSignedIn = () => true;
auth.getUid = async () => UID;
auth.getIdToken = async () => 'fake-id-token';
const UID = 'user-abc';
const ORIGINAL_ID = 'fb-original';

// "Server" Firestore in-memory: lo stato che le due scritture toccano e che
// fetchFeedback (via global fetch) rilegge per il gate d'idoneità.
let server;
let failGuard;  // castReopenRequest (scrittura A) fallisce come rete instabile
let failSubmit; // submit (scrittura B) fallisce come rete instabile
let refunds;    // crediti rimborsati (compensazione best-effort)
let spends;     // quante volte l'handler ha davvero scalato crediti

beforeEach(() => {
  server = { reopenRequests: {}, feedbacks: [] };
  failGuard = false;
  failSubmit = false;
  refunds = [];
  spends = [];
});

globalThis.SN_CREDITS = {
  spendIfAffordable: async (amount, meta) => {
    spends.push({ amount, meta });
    return { ok: true, balance: 100 - amount };
  },
  award: async (entry) => { refunds.push(entry); return { balance: 100 }; },
  // #366.2: l'handler legge il costo di riapertura dalla config crediti
  // (owner-configurabile, fallback CREDIT.BOARD_REOPEN). Lo stub rispecchia il
  // default storico.
  config: () => ({ boardReopen: SN_CONST.CREDIT.BOARD_REOPEN, boardVote: SN_CONST.CREDIT.BOARD_VOTE }),
};

let seq = 0;
globalThis.SN_FEEDBACK = {
  // Scrittura A: marca il guard sull'originale.
  castReopenRequest: async (id, uid) => {
    if (failGuard) throw new Error('firestore castReopenRequest fallito (503): network hiccup');
    server.reopenRequests[uid] = { at: new Date().toISOString() };
    return server.reopenRequests[uid];
  },
  // Scrittura B: crea il feedback figlio collegato.
  submit: async (fb) => {
    if (failSubmit) throw new Error('firestore submit fallito (503): network hiccup');
    const id = `fb-child-${++seq}`;
    server.feedbacks.push({ id, ...fb });
    return { id };
  },
  // Plumbing letto da fetchFeedback dentro board.js.
  rest: { FIRESTORE_BASE: 'https://example.invalid/v1', API_KEY: 'k' },
  fsDocToObject: (doc) => doc,
};

// fetchFeedback fa `fetch(...)` e mappa via fsDocToObject: torniamo un doc che
// riflette lo stato corrente del "server" (guard incluso), come farebbe la GET.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    seq: 42,
    url: '',
    title: '',
    // Copia viva del guard: se una scrittura precedente l'ha marcato, il gate
    // d'idoneità (canReopen) deve vederlo.
    reopenRequests: { ...server.reopenRequests },
    status: 'done',
  }),
});

// SN_MANAGE_REVIEW: qui interessa SOLO il guard anti-doppia-riapertura, non le
// regole di visibilità della board (coperte da manageReview.test.mjs). canReopen
// consulta lo stesso reopenRequests che la scrittura A marca.
globalThis.SN_MANAGE_REVIEW = {
  hasReopenRequest: (fb) => {
    const r = fb && fb.reopenRequests;
    return !!(r && typeof r === 'object' && Object.keys(r).length > 0);
  },
  canReopen: (fb) => {
    const r = fb && fb.reopenRequests;
    return !(r && typeof r === 'object' && Object.keys(r).length > 0);
  },
};

// Registra l'handler.
const registerBoard = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'handlers', 'board.js'));
const handlers = new Map();
registerBoard((type, fn) => handlers.set(type, fn), { MSG });
const reopen = (msg) => handlers.get(MSG.BOARD_REOPEN)(msg);

const msgFor = () => ({ type: MSG.BOARD_REOPEN, id: ORIGINAL_ID, text: 'Ancora rotto, ho riprovato e si spacca uguale.' });

test('happy path: guard marcato e UN feedback figlio creato, crediti scalati una volta', async () => {
  const r = await reopen(msgFor());
  assert.equal(r.ok, true);
  assert.equal(server.feedbacks.length, 1, 'esattamente un feedback figlio');
  assert.ok(server.reopenRequests[UID], 'il guard è marcato sull\'originale');
  assert.equal(spends.length, 1, 'crediti scalati una sola volta');
  assert.equal(refunds.length, 0, 'nessun rimborso nel percorso riuscito');
});

test('rete instabile sul guard, ripetuta: MAI un feedback figlio orfano, MAI duplicati', async () => {
  // Riproduce #269: la scrittura del guard cade "nello stesso punto" ad ogni
  // tentativo. Prima del fix (feedback creato PRIMA del guard) ogni tentativo
  // creava un nuovo figlio duplicato col guard mai marcato. Col guard PRIMA,
  // il fallimento avviene prima di creare qualsiasi feedback.
  failGuard = true;

  const r1 = await reopen(msgFor());
  assert.equal(r1.ok, false, 'primo tentativo fallisce (rete)');

  const r2 = await reopen(msgFor());
  assert.equal(r2.ok, false, 'secondo tentativo fallisce (rete)');

  const r3 = await reopen(msgFor());
  assert.equal(r3.ok, false, 'terzo tentativo fallisce (rete)');

  // Il cuore del bug: nessun feedback figlio deve esistere. Prima del fix qui
  // ce ne sarebbero TRE.
  assert.equal(server.feedbacks.length, 0, 'nessun feedback figlio duplicato creato');
  // Crediti scalati ad ogni tentativo ma sempre rimborsati: saldo netto zero.
  assert.equal(refunds.length, spends.length, 'ogni addebito è stato rimborsato');
  assert.ok(refunds.length >= 1, 'la compensazione crediti è scattata');
});

test('guard riuscito ma creazione feedback fallita: il ritentativo è bloccato (niente secondo figlio)', async () => {
  // Il guard (scrittura A) riesce, la creazione del feedback (scrittura B)
  // fallisce. Il guard resta marcato: un ritentativo deve essere respinto da
  // canReopen, così non si accumulano duplicati.
  failSubmit = true;

  const r1 = await reopen(msgFor());
  assert.equal(r1.ok, false, 'la creazione del feedback fallisce');
  assert.ok(server.reopenRequests[UID], 'ma il guard è comunque marcato');
  assert.equal(server.feedbacks.length, 0, 'nessun feedback figlio creato');
  assert.equal(refunds.length, 1, 'crediti rimborsati dopo il fallimento');

  // Ritentativo: ora il guard blocca. Anche se la rete tornasse buona, non deve
  // nascere un secondo feedback né essere riscalato credito.
  failSubmit = false;
  const spendsBefore = spends.length;
  const r2 = await reopen(msgFor());
  assert.equal(r2.ok, false, 'il ritentativo è respinto dal guard');
  assert.match(r2.error, /gi[àa].*segnalato|segnalato.*rotto/i, 'messaggio "già segnalato"');
  assert.equal(server.feedbacks.length, 0, 'ancora nessun feedback figlio');
  assert.equal(spends.length, spendsBefore, 'nessun credito scalato al ritentativo bloccato');
});
