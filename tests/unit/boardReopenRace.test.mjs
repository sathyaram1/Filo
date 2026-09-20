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
};

let seq = 0;
globalThis.SN_FEEDBACK = {
  // Scrittura A: marca il guard sull'originale.
  castReopenRequest: async (id, uid) => {
    if (failGuard) throw new Error('firestore castReopenRequest fallito (503): network hiccup');
    server.reopenRequests[uid] = { at: new Date().toISOString() };
    return server.reopenRequests[uid];
  },
  // Scrittura B: crea il feedback figlio collegato. Come il server vero
  // (#370), un id d'invio gia' visto NON crea un secondo documento: torna
  // quello di prima.
  submit: async (fb) => {
    if (failSubmit === 'dopo-aver-scritto') {
      // Il caso cattivo: il documento nasce, la risposta si perde per strada.
      server.feedbacks.push({ id: `fb-child-${++seq}`, ...fb });
      throw new Error('firestore submit fallito (503): risposta persa');
    }
    if (failSubmit) throw new Error('firestore submit fallito (503): network hiccup');
    const gia = fb.submissionId
      && server.feedbacks.find((f) => f.submissionId === fb.submissionId);
    if (gia) return { id: gia.id, deduped: true };
    const id = `fb-child-${++seq}`;
    server.feedbacks.push({ id, ...fb });
    return { id };
  },
  // Toglie la propria richiesta di riapertura: l'handler la usa per rimettere
  // la porta com'era quando la creazione non e' andata in porto.
  clearReopenRequest: async (id, uid) => { delete server.reopenRequests[uid]; return true; },
  // #583: l'idoneità si legge dalla SCHEDA PUBBLICA del fix — il documento
  // feedback, da quando la collezione non è più pubblica, questa macchina non
  // lo può nemmeno aprire. Copia viva del guard: se una scrittura precedente
  // l'ha marcato, il gate d'idoneità (canReopen) deve vederlo.
  getPublic: async () => ({
    _id: ORIGINAL_ID,
    seq: 42,
    status: 'done',
    reopenRequests: { ...server.reopenRequests },
  }),
  // Plumbing letto da fetchVotes dentro board.js.
  rest: { FIRESTORE_BASE: 'https://example.invalid/v1', API_KEY: 'k', VIEW_COLLECTION: 'feedback-public' },
  fsDocToObject: (doc) => doc,
};

// fetchVotes fa `fetch(...)` e mappa via fsDocToObject.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ votes: {} }),
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
// #583: l'handler guarda anche DA DOVE arriva la richiesta. La bacheca è una
// pagina di Filo, e questi test sono la bacheca.
const BACHECA = 'filo://board/board.html';
const reopen = (msg, origin = BACHECA) => handlers.get(MSG.BOARD_REOPEN)(msg, null, origin);

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

// #602, giro 2 — LA SPIEGAZIONE DI CHI RIAPRE NON SI PERDE.
//
// Il guard si scrive per primo (sopra, #269) e questo resta giusto: senza, una
// rete che cade fra le due scritture lasciava figli orfani e duplicati gratis.
// Ma quando e' la CREAZIONE a fallire, di duplicati non ce n'e' nessuno da
// temere: c'e' solo chi ha appena scritto cosa non funziona ancora e si sente
// rispondere che il fix e' «gia' stato segnalato». I crediti tornavano, la
// spiegazione no, e non c'era modo di rimandarla.
//
// Adesso il guard torna indietro insieme ai crediti, e l'id d'invio stabile
// tiene chiusa la porta ai duplicati anche se il primo tentativo era in realta'
// arrivato. Senza il fix il primo di questi due test e' rosso.
test('creazione fallita: il segnale torna indietro e si puo\' riprovare — il figlio resta UNO', async () => {
  failSubmit = true;

  const r1 = await reopen(msgFor());
  assert.equal(r1.ok, false, 'la creazione del feedback fallisce');
  assert.equal(server.feedbacks.length, 0, 'nessun feedback figlio creato');
  assert.equal(refunds.length, 1, 'crediti rimborsati dopo il fallimento');
  assert.deepEqual(server.reopenRequests, {},
    'e il segnale torna indietro: chi ha scritto puo\' rimandare la sua spiegazione');

  // Ritentativo con la rete tornata: adesso passa, e nasce UN figlio solo.
  failSubmit = false;
  const r2 = await reopen(msgFor());
  assert.equal(r2.ok, true, 'il ritentativo va a buon fine');
  assert.equal(server.feedbacks.length, 1, 'un solo feedback figlio');
  assert.ok(server.reopenRequests[UID], 'e ora il guard e\' marcato');

  // Da qui in poi il guard fa il suo mestiere: niente secondo figlio.
  const r3 = await reopen(msgFor());
  assert.equal(r3.ok, false, 'un terzo tentativo e\' respinto dal guard');
  assert.equal(server.feedbacks.length, 1, 'ancora un solo feedback figlio');
});

test('la creazione era riuscita ma la risposta si e\' persa: il ritentativo non crea un doppione', async () => {
  // Il caso che il guard-per-primo proteggeva: il documento e' nato, il
  // chiamante ha visto un errore. Il segnale torna indietro, quindi si puo'
  // riprovare — e il ritentativo NON deve creare un secondo figlio.
  failSubmit = 'dopo-aver-scritto';

  const r1 = await reopen(msgFor());
  assert.equal(r1.ok, false, 'chi ha riaperto vede un errore');
  assert.equal(server.feedbacks.length, 1, 'ma il documento era nato');
  assert.deepEqual(server.reopenRequests, {}, 'il segnale e\' tornato indietro');

  failSubmit = false;
  const r2 = await reopen(msgFor());
  assert.equal(r2.ok, true);
  assert.equal(server.feedbacks.length, 1,
    'il ritentativo riconosce l\'invio gia\' fatto: nessun doppione');
  assert.ok(server.reopenRequests[UID], 'e il guard resta marcato');
});

// #583 — la stessa riapertura chiesta da una pagina di un SITO VISITATO.
// Senza il confine d'origine bastava una sessione aperta: il sito spendeva i
// crediti di chi sta usando Filo e gli apriva a suo nome una segnalazione col
// testo che voleva. Il rifiuto arriva prima di toccare qualunque cosa, e porta
// il motivo in una parola.
test('da un sito visitato la riapertura non scala crediti e non scrive niente', async () => {
  const r = await reopen(msgFor(), 'https://evil.example/pagina');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forbidden', 'rifiutato per provenienza, non per la sessione');
  assert.equal(spends.length, 0, 'nessun credito scalato');
  assert.equal(server.feedbacks.length, 0, 'nessuna segnalazione aperta a nome dell\'utente');
  assert.deepEqual(server.reopenRequests, {}, 'nessun segnale scritto sul fix');
});
