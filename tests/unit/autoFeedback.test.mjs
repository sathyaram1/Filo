// Unit test per src/shared/autoFeedback.js — logica pura F4.
// Testa: analyzeReply (rilevamento segnali), compose (composizione sanitizzata),
// calcAutoFeedbackBonus (bonus giornaliero idempotente), applyAutoFeedbackBonus.
//
// Tutti headless: nessun Electron, nessun I/O, nessuna rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// autoFeedback dipende solo da globalThis (nessuna dipendenza su altri moduli).
require(join(__dirname, '..', '..', 'src', 'shared', 'autoFeedback.js'));

const AF = globalThis.SN_AUTO_FEEDBACK;

// Capacità fittizie per i test.
const FAKE_CAPS = [
  { id: 'salva-pagina', title: 'Salva pagina', category: 'save', desc: '', invoke: '' },
  { id: 'traduzione', title: 'Traduzione', category: 'reading', desc: '', invoke: '' },
  { id: 'lettore-rss', title: 'Lettore RSS', category: 'reading', desc: '', invoke: '' },
];

// ── Registrazione ──────────────────────────────────────────────────────────────

test('SN_AUTO_FEEDBACK si registra su globalThis', () => {
  assert.ok(AF, 'SN_AUTO_FEEDBACK non trovato su globalThis');
  for (const fn of ['analyzeReply', 'compose', 'calcAutoFeedbackBonus', 'applyAutoFeedbackBonus']) {
    assert.equal(typeof AF[fn], 'function', `manca la funzione ${fn}`);
  }
});

// ── analyzeReply: nessun segnale ──────────────────────────────────────────────

test('analyzeReply → kind:null per risposta normale senza segnali', () => {
  const result = AF.analyzeReply('Certo! Ecco come puoi salvare la pagina: clicca sull\'icona in alto a destra.', [], 'salva', FAKE_CAPS);
  assert.equal(result.kind, null);
});

test('analyzeReply → kind:null per risposta troppo corta', () => {
  const result = AF.analyzeReply('Ok.', [], 'cosa fai?', FAKE_CAPS);
  assert.equal(result.kind, null);
});

test('analyzeReply → kind:null per stringa vuota', () => {
  const result = AF.analyzeReply('', [], 'qualcosa', FAKE_CAPS);
  assert.equal(result.kind, null);
});

// ── analyzeReply: segnale fuori-capacità ──────────────────────────────────────

test('analyzeReply → kind:capability-gap quando la risposta dice "non posso fare"', () => {
  const reply = 'Mi dispiace, ma non posso fare questa azione perché Filo non gestisce i feed RSS al momento.';
  const result = AF.analyzeReply(reply, [], 'mostrami i feed rss', FAKE_CAPS);
  assert.equal(result.kind, 'capability-gap');
  assert.ok(result.genericDesc, 'genericDesc dovrebbe essere presente');
  // La descrizione non deve contenere l'input utente verbatim
  assert.ok(!result.genericDesc.includes('mostrami i feed rss'), 'la desc non deve contenere testo utente');
});

test('analyzeReply → kind:capability-gap con frase "non sono in grado di"', () => {
  const reply = 'Non sono in grado di aprire un lettore RSS integrato, questa funzione non fa parte delle capacità attuali di Filo.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  assert.equal(result.kind, 'capability-gap');
});

test('analyzeReply → kind:capability-gap con frase "non è supportato"', () => {
  const reply = 'Purtroppo il lettore RSS non è supportato al momento da Filo, non esiste questa funzionalità.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  assert.equal(result.kind, 'capability-gap');
});

test('analyzeReply → capabilityId identificato se il titolo della capacità è nella risposta', () => {
  const reply = 'Filo non può fare la traduzione di questa pagina in questo modo, al momento non è tra le mie capacità.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  assert.equal(result.kind, 'capability-gap');
  // "Traduzione" è nel titolo di FAKE_CAPS → capabilityId dovrebbe essere 'traduzione'
  assert.equal(result.capabilityId, 'traduzione');
});

test('analyzeReply → capabilityId=null se nessun titolo corrisponde', () => {
  const reply = 'Non posso fare questa cosa perché Filo non ha questa funzione sconosciuta.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  assert.equal(result.kind, 'capability-gap');
  assert.equal(result.capabilityId, null);
});

// ── analyzeReply: segnale di lamentela ────────────────────────────────────────

test('analyzeReply → kind:complaint con "non funziona correttamente"', () => {
  const reply = 'Sembra che il salvataggio pagine non funziona correttamente in questo momento, prova a ripetere l\'operazione.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  assert.equal(result.kind, 'complaint');
  assert.ok(result.genericDesc);
});

test('analyzeReply → kind:complaint con "si è verificato un errore"', () => {
  const reply = 'Si è verificato un errore imprevisto durante il caricamento della pagina, non riesco a procedere.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  assert.equal(result.kind, 'complaint');
});

// ── analyzeReply: priorità capability-gap su complaint ────────────────────────

test('analyzeReply → kind:capability-gap ha priorità su complaint nella stessa risposta', () => {
  const reply = 'Non posso fare questa azione, al momento non è supportato. Sembra che ci sia un problema anche con l\'interfaccia.';
  const result = AF.analyzeReply(reply, [], '', FAKE_CAPS);
  // La rilevazione di "non supportato" avviene prima → capability-gap
  assert.equal(result.kind, 'capability-gap');
});

// ── compose: payload sanitizzato ─────────────────────────────────────────────

test('compose → null per kind:null', () => {
  assert.equal(AF.compose({ kind: null }), null);
});

test('compose → null per analysis undefined', () => {
  assert.equal(AF.compose(undefined), null);
});

test('compose(capability-gap) → clientId strutturato per dedup F5', () => {
  const analysis = { kind: 'capability-gap', capabilityId: 'lettore-rss', genericDesc: 'Richiesta di funzione non disponibile: lettore-rss' };
  const payload = AF.compose(analysis);
  assert.ok(payload, 'compose dovrebbe restituire un payload');
  assert.equal(payload.clientId, 'auto:capability-gap:lettore-rss');
  assert.equal(payload.capabilityGapId, 'lettore-rss');
});

test('compose(capability-gap) → capabilityGapId=unknown quando capabilityId è null', () => {
  const analysis = { kind: 'capability-gap', capabilityId: null, genericDesc: 'Richiesta di funzione non disponibile in Filo' };
  const payload = AF.compose(analysis);
  assert.ok(payload);
  assert.equal(payload.capabilityGapId, 'unknown');
  assert.equal(payload.clientId, 'auto:capability-gap:unknown');
});

test('compose(capability-gap) → text NON contiene URL né testo utente', () => {
  const analysis = { kind: 'capability-gap', capabilityId: 'rss', genericDesc: 'Richiesta di funzione non disponibile: rss' };
  const payload = AF.compose(analysis);
  // Il testo non deve contenere URL (http/https)
  assert.ok(!payload.text.includes('http'), 'il testo non deve contenere URL');
  // Non deve contenere markup Markdown sospetto
  assert.ok(payload.text.length <= 500, 'testo entro 500 caratteri');
});

test('compose(complaint) → clientId auto:complaint, nessun capabilityGapId', () => {
  const analysis = { kind: 'complaint', genericDesc: 'Problema riscontrato durante l\'uso di Filo' };
  const payload = AF.compose(analysis);
  assert.ok(payload);
  assert.equal(payload.clientId, 'auto:complaint');
  assert.equal(payload.capabilityGapId, undefined);
  assert.ok(payload.text.length > 0);
});

test('compose: source riflette il kind', () => {
  const cap = AF.compose({ kind: 'capability-gap', capabilityId: 'x', genericDesc: 'desc' });
  assert.equal(cap.source, 'auto:capability-gap');
  const compl = AF.compose({ kind: 'complaint', genericDesc: 'desc' });
  assert.equal(compl.source, 'auto:complaint');
});

// ── calcAutoFeedbackBonus: logica idempotente ─────────────────────────────────

test('calcAutoFeedbackBonus → 0 se autoFeedbackEnabled=false', () => {
  const state = { lastAutoFeedbackBonusDate: '' };
  assert.equal(AF.calcAutoFeedbackBonus(state, '2026-06-24', false), 0);
});

test('calcAutoFeedbackBonus → 10 se enabled e bonus non ancora dato oggi', () => {
  const state = { lastAutoFeedbackBonusDate: '' };
  assert.equal(AF.calcAutoFeedbackBonus(state, '2026-06-24', true), 10);
});

test('calcAutoFeedbackBonus → 0 se il bonus è già stato dato oggi', () => {
  const state = { lastAutoFeedbackBonusDate: '2026-06-24' };
  assert.equal(AF.calcAutoFeedbackBonus(state, '2026-06-24', true), 0);
});

test('calcAutoFeedbackBonus → 10 se il bonus era stato dato ieri (non oggi)', () => {
  const state = { lastAutoFeedbackBonusDate: '2026-06-23' };
  assert.equal(AF.calcAutoFeedbackBonus(state, '2026-06-24', true), 10);
});

// ── applyAutoFeedbackBonus: mutazione corretta ────────────────────────────────

test('applyAutoFeedbackBonus → aggiunge +10 al saldo e aggiorna la data', () => {
  const state = { balance: 100, lastAutoFeedbackBonusDate: '', rewards: [] };
  const { state: s, bonusAdded } = AF.applyAutoFeedbackBonus(state, '2026-06-24', true);
  assert.equal(bonusAdded, 10);
  assert.equal(s.balance, 110);
  assert.equal(s.lastAutoFeedbackBonusDate, '2026-06-24');
  assert.equal(s.rewards.length, 1);
  assert.equal(s.rewards[0].kind, 'auto_feedback_bonus');
  assert.equal(s.rewards[0].credits, 10);
});

test('applyAutoFeedbackBonus → idempotente (stesso giorno, due volte)', () => {
  const state = { balance: 100, lastAutoFeedbackBonusDate: '', rewards: [] };
  const { state: s1 } = AF.applyAutoFeedbackBonus(state, '2026-06-24', true);
  const { bonusAdded, state: s2 } = AF.applyAutoFeedbackBonus(s1, '2026-06-24', true);
  assert.equal(bonusAdded, 0);
  assert.equal(s2.balance, 110); // +10 una sola volta
});

test('applyAutoFeedbackBonus → nessuna modifica se disabled', () => {
  const state = { balance: 200, lastAutoFeedbackBonusDate: '', rewards: [] };
  const { bonusAdded, state: s } = AF.applyAutoFeedbackBonus(state, '2026-06-24', false);
  assert.equal(bonusAdded, 0);
  assert.equal(s.balance, 200);
  assert.equal(s.lastAutoFeedbackBonusDate, '');
});

test('applyAutoFeedbackBonus → rewards opzionale: non crasha se rewards non è array', () => {
  const state = { balance: 50, lastAutoFeedbackBonusDate: '' };
  // state senza .rewards: deve gestirlo senza crash
  assert.doesNotThrow(() => AF.applyAutoFeedbackBonus(state, '2026-06-24', true));
});
