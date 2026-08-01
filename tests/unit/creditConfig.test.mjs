// Unit test per gli IMPORTI CREDITI configurabili dall'owner (#366.2).
//
// Copre due strati, entrambi logica PURA (niente Electron, niente rete):
//   1. src/shared/creditConfig.js — normalizzazione del documento di config
//      globale (default = costanti CREDIT; campi mancanti/sporchi → default;
//      zero esplicito rispettato);
//   2. src/main/services/creditStore.js — il motore usa quegli importi al posto
//      delle costanti: saldo di benvenuto, ricarica giornaliera (col tetto di
//      giorni accumulabili) e premi di risoluzione per priorità.
//
// PRE-CONDIZIONE del test: senza il collegamento config→motore, gli assert
// "con config diversa produce i NUOVI importi" diventano rossi (il motore
// tornerebbe 1000/100/50-100-200-300 in ogni caso).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'creditConfig.js'));
require(join(ROOT, 'src', 'main', 'services', 'creditStore.js'));

const CC = globalThis.SN_CREDIT_CONFIG;
const C = globalThis.SN_CREDITS;
const { CREDIT } = globalThis.SN_CONST;

// Config "owner" completa, con importi TUTTI diversi da quelli storici.
const OWNER = {
  initial: 2500,
  dailyRefill: 250,
  maxRefillDays: 3,
  feedbackSend: 7,
  feedbackResolveByPriority: { 0: 11, 1: 22, 2: 33, 3: 44 },
  boardVote: 15,
  boardReopen: 20,
};

// Il motore ha uno stato globale (config attiva): ogni test che la imposta la
// azzera subito dopo, così l'ordine dei test non conta.
function withActive(cfg, fn) {
  C.setActiveConfig(cfg);
  try { fn(); } finally { C.setActiveConfig(null); }
}

// ── 1. Normalizzazione della config ─────────────────────────────────────────

test('i default sono ESATTAMENTE le costanti crediti attuali', () => {
  const d = CC.defaults();
  assert.equal(d.initial, CREDIT.INITIAL);
  assert.equal(d.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(d.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
  assert.equal(d.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(d.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(d.boardReopen, CREDIT.BOARD_REOPEN);
  for (const p of [0, 1, 2, 3]) {
    assert.equal(d.feedbackResolveByPriority[p], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[p]);
  }
});

test('documento assente o non valido → tutti i default', () => {
  for (const raw of [null, undefined, 42, 'ciao', []]) {
    assert.deepEqual(CC.normalize(raw), CC.defaults());
  }
});

test('documento completo → tutti gli importi nuovi', () => {
  const c = CC.normalize(OWNER);
  assert.equal(c.initial, 2500);
  assert.equal(c.dailyRefill, 250);
  assert.equal(c.maxRefillDays, 3);
  assert.equal(c.feedbackSend, 7);
  assert.equal(c.boardVote, 15);
  assert.equal(c.boardReopen, 20);
  assert.deepEqual(c.feedbackResolveByPriority, { 0: 11, 1: 22, 2: 33, 3: 44 });
});

test('documento parziale → i campi assenti restano ai default', () => {
  const c = CC.normalize({ dailyRefill: 250 });
  assert.equal(c.dailyRefill, 250);
  assert.equal(c.initial, CREDIT.INITIAL);
  assert.equal(c.boardReopen, CREDIT.BOARD_REOPEN);
  assert.deepEqual(c.feedbackResolveByPriority, CC.defaults().feedbackResolveByPriority);
});

test('tabella per priorità parziale → solo la fascia scritta cambia', () => {
  const c = CC.normalize({ feedbackResolveByPriority: { 3: 999 } });
  assert.equal(c.feedbackResolveByPriority[3], 999);
  assert.equal(c.feedbackResolveByPriority[0], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[0]);
  assert.equal(c.feedbackResolveByPriority[2], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[2]);
});

test('valori sballati (negativi, testo, vuoto, NaN) ricadono sul default', () => {
  const c = CC.normalize({
    initial: -5,
    dailyRefill: 'tanti',
    maxRefillDays: '',
    feedbackSend: NaN,
    boardVote: null,
    boardReopen: Infinity,
    feedbackResolveByPriority: { 0: -1, 1: 'x' },
  });
  assert.equal(c.initial, CREDIT.INITIAL);
  assert.equal(c.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(c.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
  assert.equal(c.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(c.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(c.boardReopen, CREDIT.BOARD_REOPEN);
  assert.equal(c.feedbackResolveByPriority[0], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[0]);
  assert.equal(c.feedbackResolveByPriority[1], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[1]);
});

test('lo ZERO esplicito è rispettato (si può azzerare un premio)', () => {
  const c = CC.normalize({ feedbackSend: 0, boardVote: 0, feedbackResolveByPriority: { 2: 0 } });
  assert.equal(c.feedbackSend, 0);
  assert.equal(c.boardVote, 0);
  assert.equal(c.feedbackResolveByPriority[2], 0);
  // …e non contagia gli altri campi.
  assert.equal(c.dailyRefill, CREDIT.DAILY_REFILL);
});

// ── 2. Il motore usa la config (con config esplicita) ───────────────────────

test('saldo di benvenuto: default storico senza config, nuovo importo con config', () => {
  assert.equal(C.freshState('2026-06-17').balance, 1000);
  assert.equal(C.freshState('2026-06-17', OWNER).balance, 2500);
});

test('ricarica giornaliera: default storico senza config, nuovo importo con config', () => {
  const base = () => ({ ...C.freshState('2026-06-16'), balance: 0 });

  const senza = C.applyRefill(base(), '2026-06-17');
  assert.equal(senza.added, 100);
  assert.equal(senza.state.balance, 100);

  const con = C.applyRefill(base(), '2026-06-17', false, OWNER);
  assert.equal(con.added, 250);
  assert.equal(con.state.balance, 250);
});

test('tetto dei giorni accumulabili: usa quello della config', () => {
  const base = () => ({ ...C.freshState('2026-06-01'), balance: 0 });

  // Storico: 40 giorni mancati, tetto 30 → 30 × 100.
  const senza = C.applyRefill(base(), '2026-07-11');
  assert.equal(senza.added, 30 * 100);

  // Config: tetto 3 → 3 × 250, non 40 × 250 né 30 × 250.
  const con = C.applyRefill(base(), '2026-07-11', false, OWNER);
  assert.equal(con.added, 3 * 250);
});

test('premi di risoluzione: default storici senza config, nuovi con config', () => {
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [50, 100, 200, 300]);
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, OWNER)), [11, 22, 33, 44]);
  // Priorità fuori scala/mancante → fascia 0, anche con config.
  assert.equal(C.rewardForPriority(99, OWNER), 44);   // clamp a 3
  assert.equal(C.rewardForPriority(undefined, OWNER), 11);
});

// ── 3. Il motore usa la config REGISTRATA (quella che arriva dall'owner) ────

test('config attiva: gli importi valgono per tutte le chiamate senza parametri', () => {
  // Senza config attiva: importi storici.
  assert.equal(C.config().dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(C.config().boardReopen, CREDIT.BOARD_REOPEN);

  withActive(OWNER, () => {
    assert.equal(C.config().initial, 2500);
    assert.equal(C.config().dailyRefill, 250);
    assert.equal(C.config().feedbackSend, 7);
    assert.equal(C.config().boardVote, 15);
    assert.equal(C.config().boardReopen, 20);

    // Il motore, chiamato SENZA config esplicita, deve già usare quegli importi.
    assert.equal(C.freshState('2026-06-17').balance, 2500);
    const r = C.applyRefill({ ...C.freshState('2026-06-16'), balance: 0 }, '2026-06-17');
    assert.equal(r.added, 250);
    assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [11, 22, 33, 44]);
  });

  // …e dopo averla tolta si torna esattamente agli importi storici.
  assert.equal(C.freshState('2026-06-17').balance, 1000);
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [50, 100, 200, 300]);
});

test('config attiva parziale/sporca: solo i campi validi cambiano, il resto resta storico', () => {
  withActive({ dailyRefill: 250, initial: -1 }, () => {
    assert.equal(C.config().dailyRefill, 250);
    assert.equal(C.config().initial, CREDIT.INITIAL);
    assert.equal(C.freshState('2026-06-17').balance, 1000);
  });
});

test('cambiare la ricarica NON ricalcola i giorni già accreditati', () => {
  // Un utente ricaricato fino a ieri con l'importo storico: oggi, col nuovo
  // importo, riceve UN solo giorno al valore NUOVO — il passato resta com'era.
  const stato = { ...C.freshState('2026-06-16'), balance: 5000 };
  withActive(OWNER, () => {
    const { state, added } = C.applyRefill(stato, '2026-06-17');
    assert.equal(added, 250);
    assert.equal(state.balance, 5250);
  });
});

// ── 4. Lo ZERO di UNA SOLA fascia (regressione: pagava un'altra fascia) ─────
// PRE-CONDIZIONE: con il vecchio `Number(table[p]) || Number(table[0]) || 0` una
// fascia azzerata cadeva sulla fascia 0 → questi assert sono ROSSI senza il fix.

test('premio azzerato su UNA fascia: paga 0, non l\'importo di un\'altra fascia', () => {
  const cfg = { feedbackResolveByPriority: { 0: 50, 1: 0, 2: 0, 3: 0 } };
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, cfg)), [50, 0, 0, 0]);
  withActive(cfg, () => {
    assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [50, 0, 0, 0]);
  });
});

test('premio azzerato solo sulla fascia 0: le altre restano ai loro importi', () => {
  const cfg = { feedbackResolveByPriority: { 0: 0 } };
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, cfg)), [0, 100, 200, 300]);
  // Priorità mancante/fuori scala continua a mappare sulla fascia giusta.
  assert.equal(C.rewardForPriority(undefined, cfg), 0);
  assert.equal(C.rewardForPriority(99, cfg), 300);
});

test('mix di fasce azzerate e valorizzate: ognuna paga il SUO importo', () => {
  const cfg = { feedbackResolveByPriority: { 0: 7, 1: 0, 2: 9, 3: 0 } };
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, cfg)), [7, 0, 9, 0]);
});

test('tutte le fasce a zero: nessun premio, e nessun ripiego sugli storici', () => {
  const cfg = { feedbackResolveByPriority: { 0: 0, 1: 0, 2: 0, 3: 0 } };
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, cfg)), [0, 0, 0, 0]);
});

test('fascia con valore assurdo: ripiega sullo storico DELLA STESSA fascia', () => {
  // 'x' non è un importo: la fascia 3 deve tornare 300 (il suo storico), NON 0
  // né l'importo della fascia 0.
  const cfg = { feedbackResolveByPriority: { 0: 0, 3: 'x' } };
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, cfg)), [0, 100, 200, 300]);
});

// ── 5. Tipi sbagliati: mai uno ZERO silenzioso ─────────────────────────────
// PRE-CONDIZIONE: con `Number(v)` alla cieca, `true`→1, `false`/`[]`/'   '→0 →
// questi assert sono ROSSI senza il fix.

test('si\'/no, elenchi e testi di soli spazi NON diventano importi', () => {
  const c = CC.normalize({
    boardReopen: false,          // prima: 0 → riapertura gratis per tutti
    boardVote: true,             // prima: 1
    dailyRefill: '   ',          // prima: 0 → ricarica azzerata per tutti
    initial: [],                 // prima: 0 → saldo di benvenuto azzerato
    feedbackSend: [7],           // prima: 7
    maxRefillDays: {},           // prima: NaN → già default, resta default
  });
  assert.equal(c.boardReopen, CREDIT.BOARD_REOPEN);
  assert.equal(c.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(c.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(c.initial, CREDIT.INITIAL);
  assert.equal(c.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(c.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
});

test('tipi sbagliati nella tabella per priorità → storico di quella fascia', () => {
  const c = CC.normalize({ feedbackResolveByPriority: { 0: false, 1: true, 2: '  ', 3: [] } });
  assert.deepEqual(c.feedbackResolveByPriority, { ...CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY });
});

test('le stringhe NUMERICHE restano valide (Firestore le consegna così)', () => {
  const c = CC.normalize({ dailyRefill: '250', boardReopen: ' 0 ', feedbackResolveByPriority: { 1: '0' } });
  assert.equal(c.dailyRefill, 250);
  assert.equal(c.boardReopen, 0);
  assert.equal(c.feedbackResolveByPriority[1], 0);
});

test('il saldo di benvenuto NON viene riapplicato a chi ce l\'ha già', () => {
  // Stato esistente (già inizializzato): ensure/applyRefill non devono
  // rimpiazzare il saldo col nuovo "initial" della config.
  const esistente = { ...C.freshState('2026-06-17'), balance: 42 };
  withActive(OWNER, () => {
    assert.equal(C.ensure(esistente).balance, 42);
    assert.equal(C.applyRefill(esistente, '2026-06-17').state.balance, 42);
  });
});

// ── 6. Porta d'ingresso della SCRITTURA (owner) ─────────────────────────────
// Salvare un importo di tipo sbagliato non deve "quasi funzionare": prima
// veniva convertito (un si'/no diventava 1 o 0, uno spazio diventava 0) e
// finiva su TUTTE le installazioni. PRE-CONDIZIONE: senza il fix la PATCH parte
// lo stesso e questi assert sono rossi.

const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));

// Stuba la rete: cattura le richieste e risponde sempre ok con doc vuoto.
async function withFakeFetch(fn) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
  };
  try { await fn(calls); } finally { global.fetch = realFetch; }
}

const patchOf = (calls) => calls.find(
  (c) => (c.opts.method || '').toUpperCase() === 'PATCH' && c.url.includes('config/credits'),
);

test('salvataggio: importi validi finiscono davvero sul documento globale', async () => {
  await withFakeFetch(async (calls) => {
    await Defaults.updateCreditConfig(
      { dailyRefill: 250, boardReopen: 0, feedbackResolveByPriority: { 1: 0 } },
      'fake-id-token',
    );
    const patch = patchOf(calls);
    assert.ok(patch, 'manca la scrittura degli importi crediti');
    const body = JSON.parse(patch.opts.body);
    assert.equal(Number(body.fields.dailyRefill.integerValue ?? body.fields.dailyRefill.doubleValue), 250);
    // Lo zero esplicito si può salvare (disattivare un premio è legittimo).
    assert.equal(Number(body.fields.boardReopen.integerValue ?? body.fields.boardReopen.doubleValue), 0);
    // Maschera per-leaf sulla tabella: cambiare una fascia non cancella le altre.
    assert.match(patch.url, /feedbackResolveByPriority\.1/);
  });
});

test('salvataggio: un si\'/no al posto di un importo viene RIFIUTATO, non convertito', async () => {
  await withFakeFetch(async (calls) => {
    await assert.rejects(
      () => Defaults.updateCreditConfig({ boardReopen: false, dailyRefill: 100 }, 'fake-id-token'),
      /boardReopen/,
    );
    assert.equal(patchOf(calls), undefined, 'non deve scrivere NULLA se un importo è di tipo sbagliato');
  });
});

test('salvataggio: testo, spazi, elenchi e negativi vengono RIFIUTATI', async () => {
  const casi = [
    { initial: 'tanti' },
    { initial: [] },
    { initial: -5 },
    { boardVote: true },
    { feedbackResolveByPriority: { 2: true } },
    { feedbackResolveByPriority: [1, 2] },
  ];
  for (const bad of casi) {
    await withFakeFetch(async (calls) => {
      await assert.rejects(() => Defaults.updateCreditConfig(bad, 'fake-id-token'));
      assert.equal(patchOf(calls), undefined);
    });
  }
});

test('salvataggio: casella lasciata vuota = "non toccare", non uno zero', async () => {
  await withFakeFetch(async (calls) => {
    await Defaults.updateCreditConfig({ dailyRefill: 250, boardVote: '', boardReopen: '  ' }, 'fake-id-token');
    const patch = patchOf(calls);
    assert.ok(patch);
    const body = JSON.parse(patch.opts.body);
    assert.deepEqual(Object.keys(body.fields), ['dailyRefill']);
    assert.doesNotMatch(patch.url, /boardVote|boardReopen/);
  });
});

test('salvataggio: senza credenziali da proprietario non parte nessuna scrittura', async () => {
  await withFakeFetch(async (calls) => {
    await assert.rejects(() => Defaults.updateCreditConfig({ dailyRefill: 250 }, ''));
    assert.equal(patchOf(calls), undefined);
  });
});
