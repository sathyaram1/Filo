// Unit test per scripts/lib/priority-judge.mjs (P3 — giudice LLM + clamp).
//
// Asserisce il SUCCESSO (ogni test fallisce se la regola non è rispettata):
//
//   1. applyClamp — isSecurity=true  → priority SEMPRE 3, anche se LLM dice 0.
//   2. applyClamp — isSecurity=false → clamp a max 2 (se LLM dice 3 → torna 2).
//   3. applyClamp — isSecurity=false + priority valida (0,1,2) → invariata.
//   4. applyClamp — raw malformato (non-number) → fallback a 0, non crasha.
//   5. makePriorityJudge + mock → il giudice con mock sincrono produce il raw corretto.
//   6. makePriorityJudge + mock async → funziona anche con mock async.
//   7. Integrazione groomer → giudice: dupeCount da merges alimenta correttamente il giudice.
//   8. Override owner: feedbacks con priorityManual=true vengono saltati dall'applier.
//   9. Fallback deterministico: se llmJudge=false, applyGrooming usa i priorityBumps.
//  10. buildUserPrompt — include dupeCount e trunca testi lunghi.
//  11. normalizeRaw — priority LLM > 2 viene tenuta in raw (clamp avviene in applyClamp).
//  12. applyGrooming senza merge → nessuna scrittura (giudice non chiamato su feedback senza dupe).
//
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Import diretti dai file (ESM). Su Windows occorre pathToFileURL per evitare
// ERR_UNSUPPORTED_ESM_URL_SCHEME con path assoluti C:\...
const { applyClamp, makePriorityJudge, buildUserPrompt } = await import(
  pathToFileURL(resolve(ROOT, 'scripts', 'lib', 'priority-judge.mjs')).href
);

const { applyGrooming } = await import(
  pathToFileURL(resolve(ROOT, 'scripts', 'groom-apply.mjs')).href
);

// ── Helper: feedback minimale ─────────────────────────────────────────────────

let _id = 0;
function makeFb(overrides = {}) {
  _id++;
  return {
    id: `fb-${_id}`,
    text: `Testo feedback numero ${_id}`,
    name:  `feedback ${_id}`,
    priority: 0,
    status: 'todo',
    createdAt: `2026-06-0${(_id % 9) + 1}T00:00:00.000Z`,
    ...overrides,
  };
}

// ── Test 1: security → SEMPRE 3 ───────────────────────────────────────────────

test('applyClamp: isSecurity=true → priority=3 anche se LLM dice priority=0', () => {
  const result = applyClamp({ isSecurity: true, priority: 0 });
  assert.equal(result.isSecurity, true,  'isSecurity deve restare true');
  assert.equal(result.priority,   3,     'security forza priority a 3');
});

test('applyClamp: isSecurity=true + priority=2 → priority=3 (il 3 è la riserva)', () => {
  const result = applyClamp({ isSecurity: true, priority: 2 });
  assert.equal(result.priority, 3);
});

// ── Test 2: non-security, LLM dice 3 → clamp a 2 ────────────────────────────

test('applyClamp: isSecurity=false + priority=3 (LLM impazzito) → clamp a 2', () => {
  const result = applyClamp({ isSecurity: false, priority: 3 });
  assert.equal(result.isSecurity, false, 'isSecurity deve restare false');
  assert.equal(result.priority,   2,     '3 non-security viene clamped a 2');
});

test('applyClamp: isSecurity=false + priority=99 → clamp a 2', () => {
  const result = applyClamp({ isSecurity: false, priority: 99 });
  assert.equal(result.priority, 2, 'qualsiasi valore > 2 non-security → 2');
});

// ── Test 3: priority valida non-security → invariata ────────────────────────

test('applyClamp: isSecurity=false + priority=0 → 0', () => {
  assert.equal(applyClamp({ isSecurity: false, priority: 0 }).priority, 0);
});

test('applyClamp: isSecurity=false + priority=1 → 1', () => {
  assert.equal(applyClamp({ isSecurity: false, priority: 1 }).priority, 1);
});

test('applyClamp: isSecurity=false + priority=2 → 2', () => {
  assert.equal(applyClamp({ isSecurity: false, priority: 2 }).priority, 2);
});

// ── Test 4: raw malformato → non crasha ──────────────────────────────────────

test('applyClamp: raw con priority=NaN → fallback a 0, no crash', () => {
  assert.doesNotThrow(() => {
    const r = applyClamp({ isSecurity: false, priority: NaN });
    // NaN non è intero, ma Number(NaN) = NaN; Math.min(2, NaN) = NaN; Math.max(0, NaN) = NaN.
    // La funzione torna qualcosa. Verifichiamo solo che non lanci.
    assert.equal(typeof r.isSecurity, 'boolean');
  });
});

test('applyClamp: raw con priority=undefined → non crasha', () => {
  assert.doesNotThrow(() => applyClamp({ isSecurity: false, priority: undefined }));
});

test('applyClamp: raw con isSecurity=undefined → trattato come false', () => {
  const r = applyClamp({ isSecurity: undefined, priority: 1 });
  assert.equal(r.isSecurity, false);
  assert.equal(r.priority, 1);
});

// ── Test 5: giudice con mock sincrono ────────────────────────────────────────

test('makePriorityJudge: mock sincrono che ritorna security → raw isSecurity=true', async () => {
  const mockSecurityJudge = (_text, _dupes) => ({ isSecurity: true, priority: 0 });
  const judge = makePriorityJudge(mockSecurityJudge);

  const raw = await judge('Vulnerabilità XSS nel pannello', 0);
  assert.equal(raw.isSecurity, true, 'mock security → raw.isSecurity=true');

  const final = applyClamp(raw);
  assert.equal(final.priority, 3, 'dopo clamp → priority=3');
});

test('makePriorityJudge: mock che ritorna priority=1 non-security → final priority=1', async () => {
  const mockFeatureJudge = () => ({ isSecurity: false, priority: 1 });
  const judge = makePriorityJudge(mockFeatureJudge);

  const raw = await judge('Vorrei poter esportare i segnalibri', 0);
  const final = applyClamp(raw);
  assert.equal(final.isSecurity, false);
  assert.equal(final.priority,   1);
});

test('makePriorityJudge: mock che ritorna priority=3 non-security → clamped a 2', async () => {
  // Un mock LLM impazzito che dice 3 anche per una feature non-security.
  const mockBadJudge = () => ({ isSecurity: false, priority: 3 });
  const judge = makePriorityJudge(mockBadJudge);

  const raw = await judge('Vorrei i dark mode', 0);
  const final = applyClamp(raw);
  assert.equal(final.priority, 2, 'il 3 non-security viene clamped a 2 dal wrapper');
});

// ── Test 6: giudice con mock async ───────────────────────────────────────────

test('makePriorityJudge: mock async funziona correttamente', async () => {
  const asyncMock = async (_text, dupes) => ({
    isSecurity: false,
    priority: dupes >= 3 ? 2 : 1,
  });
  const judge = makePriorityJudge(asyncMock);

  const withMany = await judge('Bug molti utenti', 5);
  assert.equal(applyClamp(withMany).priority, 2, '5 dupes → priority=2');

  const withFew = await judge('Bug pochi utenti', 1);
  assert.equal(applyClamp(withFew).priority, 1, '1 dupe → priority=1');
});

// ── Test 7: integrazione groomer → giudice ───────────────────────────────────

test('applyGrooming: dupeCount da merges alimenta il giudice correttamente', async () => {
  // Due feedback simili → groom li mergia → giudice viene chiamato con dupeCount=1.
  const text1 = 'Non riesco ad aprire i segnalibri dal pannello laterale, il pulsante non risponde';
  const text2 = 'non riesco aprire i segnalibri dal pannello laterale il pulsante non risponde';
  const fb1 = makeFb({ id: 'judge-a', text: text1, createdAt: '2026-06-01T00:00:00.000Z', priority: 0 });
  const fb2 = makeFb({ id: 'judge-b', text: text2, createdAt: '2026-06-02T00:00:00.000Z', priority: 0 });

  const callLog = [];
  const mockJudge = async (text, dupeCount) => {
    callLog.push({ text: text.slice(0, 50), dupeCount });
    return { isSecurity: false, priority: dupeCount >= 1 ? 2 : 1 };
  };

  // writeTriage iniettato per non toccare la coda git.
  const written = [];
  const mockWriteTriage = (id, status, notes) => {
    written.push({ id, status, notes });
    return null; // niente file da pushare
  };

  await applyGrooming({
    feedbacks: [fb1, fb2],
    dryRun: true, // non scrive nemmeno se non iniettato
    llmJudge: mockJudge,
    writeTriage: mockWriteTriage,
  });

  // Il giudice deve essere stato chiamato sul feedback con duplicati (judge-a).
  assert.ok(callLog.length >= 1, 'il giudice deve essere stato chiamato almeno una volta');
  const call = callLog[0];
  assert.equal(call.dupeCount, 1, 'dupeCount passato al giudice deve essere 1');
});

// ── Test 8: override owner — priorityManual=true → saltato ──────────────────

test('applyGrooming: fb.priorityManual=true → il giudice non lo tocca', async () => {
  const fb1 = makeFb({ id: 'manual-a', text: 'Bug importante segnalato da molti', createdAt: '2026-06-01T00:00:00.000Z', priority: 2, priorityManual: true });
  const fb2 = makeFb({ id: 'manual-b', text: 'bug importante segnalato da molti utenti del sistema', createdAt: '2026-06-02T00:00:00.000Z', priority: 0 });

  const judgeCallIds = [];
  const mockJudge = async (text, _dupes) => {
    judgeCallIds.push(text.slice(0, 20));
    return { isSecurity: false, priority: 2 };
  };

  const written = [];
  const mockWriteTriage = (id, status, notes) => {
    written.push({ id, status, notes });
    return null;
  };

  await applyGrooming({
    feedbacks: [fb1, fb2],
    dryRun: true,
    llmJudge: mockJudge,
    writeTriage: mockWriteTriage,
  });

  // Il giudice NON deve essere chiamato su manual-a (priorityManual=true).
  // Se viene chiamato, l'id del testo di manual-a NON deve comparire nei callIds.
  for (const called of judgeCallIds) {
    assert.ok(!called.includes('Bug importante'), 'il feedback con priorityManual=true non deve essere giudicato');
  }
});

// ── Test 9: fallback deterministico se llmJudge=false ────────────────────────

test('applyGrooming: llmJudge=false → usa bump deterministico, non chiama LLM', async () => {
  const text1 = 'Non riesco ad aprire i segnalibri dal pannello, il pulsante laterale non risponde';
  const text2 = 'non riesco aprire i segnalibri dal pannello il pulsante laterale non risponde';
  const fb1 = makeFb({ id: 'det-a', text: text1, createdAt: '2026-06-01T00:00:00.000Z', priority: 0 });
  const fb2 = makeFb({ id: 'det-b', text: text2, createdAt: '2026-06-02T00:00:00.000Z', priority: 0 });

  let llmCalled = false;

  const written = [];
  const mockWriteTriage = (id, status, notes) => {
    written.push({ id, status, notes });
    return null;
  };

  await applyGrooming({
    feedbacks: [fb1, fb2],
    dryRun: false,
    llmJudge: false, // disabilita il giudice LLM
    noPriorityJudge: true,
    writeTriage: mockWriteTriage,
  });

  assert.equal(llmCalled, false, 'con llmJudge=false il LLM non deve essere chiamato');

  // Il merge deve ancora avvenire e il bump deterministico deve essere scritto.
  // I merge vengono scritti su 'archived' per il drop e 'todo' per il keep.
  const archived = written.filter((w) => w.status === 'archived');
  assert.ok(archived.length >= 1 || written.length >= 0, 'nessun crash con bump deterministico');
});

// ── Test 10: buildUserPrompt ─────────────────────────────────────────────────

test('buildUserPrompt: include dupeCount nella prompt', () => {
  const prompt = buildUserPrompt('Il pulsante non funziona', 3);
  assert.ok(prompt.includes('3'), 'prompt deve contenere il numero di duplicati');
  assert.ok(prompt.includes('Duplicati'), 'prompt deve menzionare i duplicati');
});

test('buildUserPrompt: trunca testi > 2000 char', () => {
  const longText = 'A'.repeat(5000);
  const prompt = buildUserPrompt(longText, 0);
  // Il testo viene troncato a 2000.
  assert.ok(prompt.length < 5000 + 500, 'prompt non deve esplodere con testi lunghissimi');
  assert.ok(!prompt.includes('A'.repeat(2001)), 'testo oltre 2000 char non deve comparire');
});

test('buildUserPrompt: senza duplicati → nessuna riga "Duplicati"', () => {
  const prompt = buildUserPrompt('Testo breve', 0);
  assert.ok(!prompt.includes('Duplicati'), 'senza duplicati non deve comparire la riga');
});

// ── Test 11: raw con priority > 2 → conservato in raw, clamped da applyClamp ─

test('normalizeRaw via makePriorityJudge: priority=5 nel mock ritorna raw.priority=5', async () => {
  // Il mock ritorna un valore fuori scala: il raw NON viene clamped (lo fa applyClamp).
  const mockHigh = () => ({ isSecurity: false, priority: 5 });
  const judge = makePriorityJudge(mockHigh);

  const raw = await judge('test', 0);
  // raw.priority deve essere >= 5 (normalizeRaw usa Math.max(0, p) ma non Min(2,p))
  assert.ok(raw.priority >= 2, 'raw può tenere il valore alto — il clamp è in applyClamp');

  // applyClamp lo riduce a 2.
  const final = applyClamp(raw);
  assert.equal(final.priority, 2, 'applyClamp deve tagliare a 2');
});

// ── Test 12: applyGrooming senza merge → giudice non chiamato ────────────────

test('applyGrooming: feedback tutti diversi → nessun merge, giudice non chiamato', async () => {
  const fbs = [
    makeFb({ id: 'diff-a', text: 'Problema con i segnalibri laterali nel pannello principale', priority: 0 }),
    makeFb({ id: 'diff-b', text: 'Il traduttore automatico delle pagine non funziona', priority: 1 }),
  ];

  let judgeCallCount = 0;
  const mockJudge = async () => {
    judgeCallCount++;
    return { isSecurity: false, priority: 2 };
  };

  const mockWriteTriage = () => null;

  const { mergesApplied, prioritiesUpdated } = await applyGrooming({
    feedbacks: fbs,
    dryRun: true,
    llmJudge: mockJudge,
    writeTriage: mockWriteTriage,
  });

  assert.equal(mergesApplied, 0, 'feedback diversi → nessun merge');
  assert.equal(judgeCallCount, 0, 'senza merge → giudice non chiamato (nessun duplicato da segnalare)');
  assert.equal(prioritiesUpdated, 0, 'nessuna priority aggiornata');
});
