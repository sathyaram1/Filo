// Unit test per src/shared/feedbackSanitizer.js (DD2).
//
// Asserisce il SUCCESSO (fallisce senza il modulo):
//   1. Testo CON info personali + llmFn che segnala REDACTED: → info personali
//      spariscono dalla versione sanitizzata.
//   2. Testo PULITO + llmFn che segnala CLEAN: → testo passa invariato.
//   3. Metadati identificanti (clientId, userAgent, createdAt, …) sono SEMPRE
//      assenti nella versione sanitizzata.
//   4. llmFn che fallisce (throw) → fallback conservativo: sanitizedText = null,
//      solo il titolo (name) sopravvive.
//   5. Casi limite: testo vuoto, doc null, campo text mancante, ciphertext S1.
//
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'feedbackSanitizer.js'));
const SAN = globalThis.SN_FEEDBACK_SANITIZER;

// ── Helper: costruisce un doc feedback realistico ──────────────────────────

function makeFeedback(overrides = {}) {
  return {
    // campi identificanti (NON devono sopravvivere)
    _id: 'fb-test-123',
    clientId: 'client:abc123',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: '2026-06-24T10:00:00.000Z',
    resolvedAt: '2026-06-24T12:00:00.000Z',
    // campi tecnici owner (NON devono sopravvivere)
    status: 'done',
    notes: 'Fix applicato in handlers/nav.js riga 42.',
    priority: 2,
    branch: 'worker/fb-test-123',
    archiveOverride: null,
    parentId: null,
    votes: { uid1: { vote: 'works', at: '2026-06-24T13:00:00.000Z', credibilitySnapshot: 1 } },
    // campi sicuri (devono sopravvivere)
    name: 'bottone X non risponde',
    seq: 22,
    subSeq: 0,
    statusPublic: 'closed',
    resolvedInVersion: '0.2.80',
    // testo in chiaro (viene redatto se contiene PII)
    text: 'Bugsegnalato',
    url: 'https://example.com/private',
    title: 'Pagina personale',
    ...overrides,
  };
}

// ── LLM mock: risponde CLEAN: o REDACTED: in base al contenuto del prompt ──

function makeLlm({ mode = 'clean', throws = false } = {}) {
  return async (prompt) => {
    if (throws) throw new Error('LLM timeout');
    const text = prompt.split('\n').slice(-1)[0] || '';
    if (mode === 'redact') {
      // Simula la rimozione di PII dal testo passato nel prompt.
      const redacted = text
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g, '[RIMOSSO]')
        .replace(/\+?[\d\s\-()]{8,}/g, '[RIMOSSO]')
        .replace(/via\s+\w+\s+\d+/gi, '[RIMOSSO]');
      return `REDACTED:${redacted}`;
    }
    return `CLEAN:${text}`;
  };
}

// ── Test suite ──────────────────────────────────────────────────────────────

test('espone l\'API attesa su globalThis', () => {
  assert.ok(SAN, 'SN_FEEDBACK_SANITIZER deve esistere su globalThis');
  assert.equal(typeof SAN.sanitizeMetadata, 'function');
  assert.equal(typeof SAN.sanitizeText, 'function');
  assert.equal(typeof SAN.sanitize, 'function');
  assert.ok(Array.isArray(SAN.ALLOWED_FIELDS));
  assert.ok(SAN.ALLOWED_FIELDS.includes('name'));
  assert.ok(SAN.ALLOWED_FIELDS.includes('seq'));
  assert.ok(SAN.ALLOWED_FIELDS.includes('statusPublic'));
  assert.ok(SAN.ALLOWED_FIELDS.includes('sanitizedText'));
});

// ── CRITERIO DONE 1: testo CON PII → viene REDATTO ─────────────────────────

test('testo con email → viene redatto (PII sparisce)', async () => {
  const dirtyText = 'Ciao, scrivimi a mario.rossi@gmail.com per dettagli.';
  const llm = makeLlm({ mode: 'redact' });
  const result = await SAN.sanitizeText(dirtyText, llm);
  assert.ok(result !== null, 'il risultato non deve essere null');
  assert.ok(!result.includes('mario.rossi@gmail.com'), 'l\'email deve essere rimossa');
  assert.ok(result.includes('[RIMOSSO]'), 'deve comparire il segnaposto di redazione');
});

test('testo con email, telefono e indirizzo → TUTTE le PII rimosse', async () => {
  const dirtyText = 'Scrivimi a mario.rossi@gmail.com, abito in Via X 3, tel +39 333 1234567.';
  const llm = makeLlm({ mode: 'redact' });
  const result = await SAN.sanitizeText(dirtyText, llm);
  assert.ok(result !== null, 'il risultato non deve essere null');
  assert.ok(!result.includes('mario.rossi@gmail.com'), 'email rimossa');
  assert.ok(!result.includes('+39 333 1234567'), 'telefono rimosso');
  assert.ok(!result.includes('Via X 3'), 'indirizzo rimosso');
});

// ── CRITERIO DONE 2: testo PULITO → passa invariato ────────────────────────

test('testo senza PII → passa invariato (CLEAN)', async () => {
  const cleanText = 'Quando clicco sul bottone X la scheda si chiude invece di ricaricarsi.';
  const llm = makeLlm({ mode: 'clean' });
  const result = await SAN.sanitizeText(cleanText, llm);
  assert.equal(result, cleanText, 'il testo pulito deve passare invariato');
});

test('testo pulito: non vengono introdotte modifiche non richieste', async () => {
  const cleanText = 'Il menu contestuale non mostra l\'opzione "Salva".';
  const llm = makeLlm({ mode: 'clean' });
  const result = await SAN.sanitizeText(cleanText, llm);
  assert.equal(result, cleanText);
});

// ── CRITERIO DONE 3: metadati identificanti SEMPRE assenti ─────────────────

test('sanitizeMetadata: clientId non sopravvive', () => {
  const doc = makeFeedback();
  const out = SAN.sanitizeMetadata(doc);
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'clientId'), 'clientId non deve esserci');
});

test('sanitizeMetadata: userAgent non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'userAgent'), 'userAgent non deve esserci');
});

test('sanitizeMetadata: createdAt non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'createdAt'), 'createdAt non deve esserci');
});

test('sanitizeMetadata: resolvedAt non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'resolvedAt'), 'resolvedAt non deve esserci');
});

test('sanitizeMetadata: status (fine) non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'status'), 'status fine non deve esserci');
});

test('sanitizeMetadata: notes non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'notes'), 'notes non deve esserci');
});

test('sanitizeMetadata: votes non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'votes'), 'votes non deve esserci');
});

test('sanitizeMetadata: url non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'url'), 'url non deve esserci');
});

test('sanitizeMetadata: text grezzo non sopravvive', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'text'), 'text grezzo non deve esserci');
});

test('sanitizeMetadata: i campi sicuri sopravvivono', () => {
  const doc = makeFeedback();
  const out = SAN.sanitizeMetadata(doc);
  assert.equal(out.name, doc.name, 'name deve sopravvivere');
  assert.equal(out.seq, doc.seq, 'seq deve sopravvivere');
  assert.equal(out.subSeq, doc.subSeq, 'subSeq deve sopravvivere');
  assert.equal(out.statusPublic, doc.statusPublic, 'statusPublic deve sopravvivere');
  assert.equal(out.resolvedInVersion, doc.resolvedInVersion, 'resolvedInVersion deve sopravvivere');
});

test('sanitizeMetadata: sanitizedText inizia sempre a null (lo popola passo 2)', () => {
  const out = SAN.sanitizeMetadata(makeFeedback());
  assert.equal(out.sanitizedText, null, 'sanitizedText deve essere null dal solo passo 1');
});

// ── CRITERIO DONE 4: llmFn che fallisce → fallback conservativo ────────────

test('llmFn che lancia → sanitizedText=null (fallback conservativo)', async () => {
  const doc = makeFeedback({ text: 'Problema con il bottone X.' });
  const llm = makeLlm({ throws: true });
  const out = await SAN.sanitize(doc, llm);
  assert.equal(out.sanitizedText, null, 'fallback: null, non pubblicare il testo');
  // I metadati sicuri devono comunque esserci.
  assert.equal(out.name, doc.name, 'name deve esserci anche con fallback');
  assert.equal(out.statusPublic, doc.statusPublic);
});

test('llmFn assente (undefined) → sanitizedText=null (fallback conservativo)', async () => {
  const doc = makeFeedback({ text: 'Problema con il bottone X.' });
  const out = await SAN.sanitize(doc, undefined);
  assert.equal(out.sanitizedText, null);
});

test('llmFn che risponde in formato non valido → sanitizedText=null', async () => {
  const doc = makeFeedback({ text: 'testo di test' });
  // LLM risponde con qualcosa che non inizia con CLEAN: né REDACTED:.
  const llm = async () => 'Certo! Il testo sembra pulito, non ho trovato PII.';
  const out = await SAN.sanitize(doc, llm);
  assert.equal(out.sanitizedText, null, 'risposta non conforme → fallback conservativo');
});

test('llmFn che risponde REDACTED: vuoto → sanitizedText=null (malformata)', async () => {
  const doc = makeFeedback({ text: 'qualcosa' });
  const llm = async () => 'REDACTED:'; // corpo vuoto dopo il prefisso
  const out = await SAN.sanitize(doc, llm);
  assert.equal(out.sanitizedText, null);
});

// ── Casi limite ─────────────────────────────────────────────────────────────

test('doc null → restituisce oggetto con sanitizedText=null senza crash', async () => {
  const out = await SAN.sanitize(null, makeLlm());
  assert.equal(typeof out, 'object', 'deve restituire un oggetto');
  assert.equal(out.sanitizedText, null);
});

test('doc senza campo text → sanitizedText=null, metadati sicuri ok', async () => {
  const doc = makeFeedback();
  delete doc.text;
  const llm = makeLlm({ mode: 'clean' });
  const out = await SAN.sanitize(doc, llm);
  assert.equal(out.sanitizedText, null, 'senza text il testo sanitizzato è null');
  assert.equal(out.name, doc.name);
});

test('campo text con ciphertext S1 (FENC1:) → sanitizedText=null (non decifrabile qui)', async () => {
  const doc = makeFeedback({ text: 'FENC1:YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo' });
  const llm = makeLlm({ mode: 'clean' });
  const out = await SAN.sanitize(doc, llm);
  assert.equal(out.sanitizedText, null, 'il ciphertext non deve essere passato all\'LLM');
});

test('sanitizeText con testo vuoto → null', async () => {
  assert.equal(await SAN.sanitizeText('', makeLlm()), null);
  assert.equal(await SAN.sanitizeText('   ', makeLlm()), null);
  assert.equal(await SAN.sanitizeText(null, makeLlm()), null);
});

test('sanitize end-to-end: testo con PII + metadati → PII redatta E metadati rimossi', async () => {
  const doc = makeFeedback({
    text: 'Contattami a test@example.com per aiuto.',
  });
  const llm = makeLlm({ mode: 'redact' });
  const out = await SAN.sanitize(doc, llm);

  // Metadati identificanti assenti.
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'clientId'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'userAgent'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'createdAt'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'status'));

  // PII rimossa dal testo sanitizzato.
  assert.ok(out.sanitizedText !== null, 'il testo sanitizzato deve esserci');
  assert.ok(!out.sanitizedText.includes('test@example.com'), 'email rimossa');

  // Campi sicuri presenti.
  assert.equal(out.name, doc.name);
  assert.equal(out.statusPublic, 'closed');
  assert.equal(out.resolvedInVersion, '0.2.80');
});

test('sanitize end-to-end: testo pulito → sanitizedText = testo originale invariato', async () => {
  const cleanText = 'Il bottone "Salva" non è visibile su schermi piccoli.';
  const doc = makeFeedback({ text: cleanText });
  const llm = makeLlm({ mode: 'clean' });
  const out = await SAN.sanitize(doc, llm);

  assert.equal(out.sanitizedText, cleanText, 'testo pulito deve passare invariato');
  assert.equal(out.name, doc.name);
});
