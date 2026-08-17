// Unit test del biglietto ritrovabile (scripts/lib/routine-ticket.mjs) e della
// distinzione rifiuto/guasto del canale (scripts/routine-channel.mjs).
//
// PERCHÉ QUESTA DISTINZIONE HA UN TEST TUTTO SUO
//   Il ripiego sulla coda su git è legittimo SOLO quando il server non
//   risponde. Se ci si ripiegasse anche dopo un rifiuto, la decisione verrebbe
//   scritta lo stesso da un automatismo che i controlli non li fa — cioè
//   esattamente il buco che la spec viene a chiudere. È una riga di codice, ed
//   è il cardine di tutto il pezzo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const { classifyReply, work } = await import('../../scripts/routine-channel.mjs');
const { readTicket, writeTicket, clearTicket, isFresh, ticketFile, MAX_AGE_MS } =
  await import('../../scripts/lib/routine-ticket.mjs');

function tempRoot() {
  const d = mkdtempSync(resolve(tmpdir(), 'filo-ticket-'));
  mkdirSync(resolve(d, '.claude'), { recursive: true });
  return d;
}

// ── La busta del lavoro ─────────────────────────────────────────────────────
//
// REGRESSIONE VERA (trovata dalla verifica di #477.3): chi ritira il lavoro
// teneva solo il payload e buttava via ruolo, indirizzo, numero e ramo. Chi
// guida il giro li legge tutti: senza ruolo consegnava al lavoratore una busta
// VUOTA e usciva dicendo che era andato tutto bene — un guasto totale
// travestito da giro riuscito. Nessun test lo vedeva, perché nessuno
// esercitava la catena vera biglietto → lavoro.

const rispostaFinta = (status, body) => async () => ({
  status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body),
});

test('chi ritira il lavoro riceve la busta INTERA, non solo il contenuto', async () => {
  const fetchImpl = rispostaFinta(200, {
    ok: true, role: 'fixer', id: 'fid-1', num: '#500.2', branch: 'worker/500.2',
    payload: { role: 'fixer', feedback: { text: 'il sintomo' }, critique: 'non compare', loopCount: 2 },
  });
  const w = await work('biglietto', { fetchImpl, sleep: async () => {}, attempts: 1 });
  assert.equal(w.ok, true);
  assert.equal(w.role, 'fixer', 'senza il ruolo il giro non sa nemmeno che lavoro sta facendo');
  assert.equal(w.id, 'fid-1');
  assert.equal(w.num, '#500.2');
  assert.equal(w.branch, 'worker/500.2', 'senza il ramo non ci si posiziona, e si lavora sull albero sbagliato');
  assert.equal(w.payload.critique, 'non compare');
});

test('una risposta "riuscita" ma senza ruolo è un guasto, non un lavoro', async () => {
  // È la forma esatta in cui il difetto si presentava: ok:true, payload magari
  // pieno, ma niente ruolo. Consegnarla vuol dire mandare un lavoratore allo
  // sbaraglio; va trattata come il server che non risponde.
  const fetchImpl = rispostaFinta(200, { ok: true, payload: { feedback: { text: 'x' } } });
  const w = await work('biglietto', { fetchImpl, sleep: async () => {}, attempts: 1 });
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'busta_incompleta');
});

test('i ruoli senza feedback portano comunque la loro busta', async () => {
  // Il controllo di sicurezza riceve solo il ramo: il payload è quasi vuoto, ma
  // ruolo e ramo devono arrivare lo stesso.
  const fetchImpl = rispostaFinta(200, {
    ok: true, role: 'secaudit', id: 'fid-2', num: '#366.2', branch: 'worker/366.2-v3',
    payload: { role: 'secaudit', branch: 'worker/366.2-v3' },
  });
  const w = await work('biglietto', { fetchImpl, sleep: async () => {}, attempts: 1 });
  assert.equal(w.ok, true);
  assert.equal(w.role, 'secaudit');
  assert.equal(w.branch, 'worker/366.2-v3');
  assert.equal(w.payload.feedback, undefined, 'e del feedback continua a non vedere niente');
});

test('un rifiuto NON è un guasto: sono due esiti diversi', () => {
  assert.equal(classifyReply(200, { ok: true }), 'ok');
  // Il server ha guardato e ha detto no.
  assert.equal(classifyReply(401, { ok: false, reason: 'role_forbids' }), 'refused');
  assert.equal(classifyReply(401, { ok: false, reason: 'illegal_transition' }), 'refused');
  assert.equal(classifyReply(429, { ok: false, reason: 'rate_limited' }), 'refused');
  // Il server non c'è.
  assert.equal(classifyReply(503, { ok: false, reason: 'server_error' }), 'fault');
  assert.equal(classifyReply(500, {}), 'fault');
  assert.equal(classifyReply(0, { ok: false, reason: 'network' }), 'fault');
});

test('una risposta 200 senza ok non viene presa per buona', () => {
  assert.notEqual(classifyReply(200, {}), 'ok');
  assert.notEqual(classifyReply(200, { ok: false }), 'ok');
});

test('il biglietto scritto si rilegge', () => {
  const root = tempRoot();
  try {
    writeTicket(root, 'abc123');
    assert.equal(readTicket(root), 'abc123');
    assert.ok(existsSync(ticketFile(root)));
    clearTicket(root);
    assert.equal(readTicket(root), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('un biglietto vecchio non viene riusato: il semaforo è certamente morto', () => {
  const vecchio = { ticket: 'x', since: new Date(Date.now() - MAX_AGE_MS - 60_000).toISOString() };
  assert.equal(isFresh(vecchio), false);
  const fresco = { ticket: 'x', since: new Date().toISOString() };
  assert.equal(isFresh(fresco), true);
});

test('un marcatore malformato non passa per buono', () => {
  assert.equal(isFresh(null), false);
  assert.equal(isFresh({}), false);
  assert.equal(isFresh({ ticket: '', since: new Date().toISOString() }), false);
  assert.equal(isFresh({ ticket: 'x' }), false);
  assert.equal(isFresh({ ticket: 'x', since: 'non-una-data' }), false);
});

test('un file illeggibile non fa saltare niente: si lavora senza biglietto', () => {
  const root = tempRoot();
  try {
    writeFileSync(ticketFile(root), '{ questo non è json', 'utf8');
    assert.equal(readTicket(root), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scrivere un biglietto vuoto non crea un marcatore fasullo', () => {
  const root = tempRoot();
  try {
    assert.equal(writeTicket(root, ''), null);
    assert.equal(writeTicket(root, '   '), null);
    assert.equal(readTicket(root), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
