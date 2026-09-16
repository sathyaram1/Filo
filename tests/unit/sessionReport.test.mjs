// Il rapporto di fine sessione (scripts/session-report.mjs) su un transcript
// sintetico di dieci righe: numeri attesi precisi, non «maggiore di zero».
//
// Il transcript ha la forma vera (verificata sui file di ~/.claude/projects il
// 16/09/2026): un messaggio assistant può stare su più righe con la stessa
// `usage` ripetuta — si conta una volta; una riga può non essere JSON — si
// salta e si annota.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const {
  analizzaRighe, generaRapporto, trovaTranscript, slugProgetto, chiaveSicura,
  famigliaPrezzo, rapportoVuoto, riassunto, PREZZI,
} = await import('../../scripts/session-report.mjs');

const T = (s) => `2026-09-16T10:${s}.000Z`;
const assistant = (id, model, usage, content, ts) => JSON.stringify({
  type: 'assistant', sessionId: 'sess-1', timestamp: ts,
  message: { id, model, role: 'assistant', usage, content },
});
const result = (toolUseId, content, ts, isError) => JSON.stringify({
  type: 'user', sessionId: 'sess-1', timestamp: ts,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError === true, content }] },
});

const RIGHE = [
  // 1. il prompt dell'utente
  JSON.stringify({ type: 'user', sessionId: 'sess-1', timestamp: T('00:00'), message: { role: 'user', content: 'fai una cosa' } }),
  // 2. primo turno (caldo per definizione: il primo è escluso dal conto dei freddi)
  assistant('m1', 'claude-opus-5', { input_tokens: 100, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 50 },
    [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }], T('00:05')),
  // 3. risultato dopo 5 s
  result('tu1', 'ok', T('00:10')),
  // 4. secondo turno, caldo, lancia un sotto-agente
  assistant('m2', 'claude-opus-5', { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 30000, output_tokens: 20 },
    [{ type: 'tool_use', id: 'tu2', name: 'Agent', input: {} }], T('00:15')),
  // 5. il sotto-agente va in timeout dopo 60 s, ed è un errore
  result('tu2', 'Command timed out after 120s', T('01:15'), true),
  // 6. terzo turno: FREDDO (cache letta 0, scritta 25.000), strumento col punto nel nome
  assistant('m3', 'claude-opus-5', { input_tokens: 5, cache_creation_input_tokens: 25000, cache_read_input_tokens: 0, output_tokens: 30 },
    [{ type: 'tool_use', id: 'tu3', name: 'mcp__x__read.me', input: {} }], T('01:20')),
  // 7. risultato in forma di blocchi
  result('tu3', [{ type: 'text', text: 'letto' }], T('01:22')),
  // 8. lo STESSO messaggio m3 su una seconda riga (un blocco di testo): usage ripetuta, da non contare
  assistant('m3', 'claude-opus-5', { input_tokens: 5, cache_creation_input_tokens: 25000, cache_read_input_tokens: 0, output_tokens: 30 },
    [{ type: 'text', text: 'fatto' }], T('01:23')),
  // 9. quarto turno su un altro modello
  assistant('m4', 'claude-fable-5-1', { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 40000, output_tokens: 10 },
    [{ type: 'text', text: 'fine' }], T('01:30')),
  // 10. una riga che non è JSON
  'questa riga non è JSON',
];

test('dieci righe: turni, freddi, token, strumenti, timeout, sotto-agenti, durata', async () => {
  const rep = await analizzaRighe(RIGHE, { role: 'resolver', ticket: 'tkt-1' });
  assert.equal(rep.v, 1);
  assert.equal(rep.role, 'resolver');
  assert.equal(rep.ticket, 'tkt-1');
  assert.equal(rep.sessionId, 'sess-1');
  assert.deepEqual(rep.models, ['claude-opus-5', 'claude-fable-5-1']);
  assert.equal(rep.turns, 4, 'm3 sta su due righe e conta una volta');
  assert.equal(rep.coldTurns, 1, 'solo m3: m1 è il primo turno ed è escluso');
  assert.deepEqual(rep.tokens, { input: 116, cacheRead: 70000, cacheWrite: 55500, output: 110 });
  assert.equal(rep.tools.total, 3);
  assert.deepEqual(rep.tools.byName, { Bash: 1, Agent: 1, mcp__x__read_me: 1 });
  assert.equal(rep.tools.timeouts, 1);
  assert.equal(rep.tools.errors, 1);
  assert.equal(rep.subagents, 1);
  assert.equal(rep.longestToolS, 60);
  assert.equal(rep.startedAt, T('00:00'));
  assert.equal(rep.endedAt, T('01:30'));
  assert.equal(rep.durationS, 90);
  assert.deepEqual(rep.notes, ['1 righe del transcript non erano JSON e sono state saltate']);
});

test('il costo somma le quattro tariffe per famiglia, cache di Fable 5.1 a 0,25 $/M', async () => {
  const rep = await analizzaRighe(RIGHE);
  // opus m1: 100·5 + 30000·6,25 + 0 + 50·25 = 189.250
  // opus m2: 10·5 + 500·6,25 + 30000·0,5 + 20·25 = 18.675
  // opus m3: 5·5 + 25000·6,25 + 0 + 30·25 = 157.025
  // fable m4: 1·10 + 0 + 40000·0,25 + 10·50 = 10.510
  // totale 375.460 / 1e6 = 0,37546 → 0,3755
  assert.equal(rep.costUsd, 0.3755);
});

test('modello sconosciuto: tariffa opus e una nota', async () => {
  const righe = [assistant('z', 'claude-nuovo-9', { input_tokens: 1000000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, [], T('00:00'))];
  const rep = await analizzaRighe(righe);
  assert.equal(rep.costUsd, PREZZI.opus.input);
  assert.match(rep.notes[0], /claude-nuovo-9.*opus/);
  assert.equal(famigliaPrezzo('claude-fable-5').key, 'fable-5');
  assert.equal(famigliaPrezzo('claude-fable-5-1').key, 'fable');
  assert.equal(famigliaPrezzo('claude-sonnet-4-6').key, 'sonnet-4');
  assert.equal(famigliaPrezzo('claude-sonnet-5').key, 'sonnet');
  assert.equal(famigliaPrezzo('claude-haiku-4-5').key, 'haiku');
});

test('lo slug della cartella dei transcript e le chiavi ammesse da Firestore', () => {
  assert.equal(slugProgetto('C:\\Users\\agenti AI\\Desktop\\Filo\\Filo'), 'C--Users-agenti-AI-Desktop-Filo-Filo');
  assert.equal(slugProgetto('/home/worker/filo'), '-home-worker-filo');
  assert.equal(chiaveSicura('mcp__a.b/c'), 'mcp__a_b_c');
  assert.equal(chiaveSicura(''), '_');
});

test('senza transcript: rapporto minimo con la nota, mai un errore', async () => {
  const casa = cartellaTemporanea('filo-rapporto-vuoto-');
  try {
    const rep = await generaRapporto({ role: 'verifier', ticket: 't', cwd: casa, configDir: join(casa, 'niente'), env: {} });
    const atteso = rapportoVuoto({ role: 'verifier', ticket: 't' });
    assert.deepEqual({ ...rep, notes: [] }, atteso);
    assert.equal(rep.notes.length, 1);
    assert.match(rep.notes[0], /nessuna cartella di transcript/);
    assert.equal(riassunto(rep).length, 5);
  } finally { rmSync(casa, { recursive: true, force: true }); }
});

test('trova il .jsonl più recente nella cartella del progetto; --transcript e FILO_TRANSCRIPT vincono', async () => {
  const casa = cartellaTemporanea('filo-rapporto-cerca-');
  try {
    const cwd = join(casa, 'repo con spazio');
    mkdirSync(cwd, { recursive: true });
    const cartella = join(casa, 'claude', 'projects', slugProgetto(resolve(cwd)));
    mkdirSync(cartella, { recursive: true });
    const vecchio = join(cartella, 'vecchio.jsonl');
    const nuovo = join(cartella, 'nuovo.jsonl');
    writeFileSync(vecchio, `${RIGHE[1]}\n`, 'utf8');
    writeFileSync(nuovo, RIGHE.join('\n'), 'utf8');
    const t0 = Date.now() / 1000;
    utimesSync(vecchio, t0 - 3600, t0 - 3600);
    utimesSync(nuovo, t0, t0);

    assert.equal(trovaTranscript({ cwd, configDir: join(casa, 'claude'), env: {} }).file, nuovo);
    const rep = await generaRapporto({ cwd, configDir: join(casa, 'claude'), env: {} });
    assert.equal(rep.turns, 4, 'ha letto il più recente');
    assert.equal(trovaTranscript({ explicit: vecchio, cwd, configDir: join(casa, 'claude'), env: {} }).file, vecchio);
    assert.equal(trovaTranscript({ cwd, configDir: join(casa, 'claude'), env: { FILO_TRANSCRIPT: vecchio } }).file, vecchio);
    const assente = trovaTranscript({ explicit: join(casa, 'no.jsonl'), cwd, env: {} });
    assert.equal(assente.file, '');
    assert.match(assente.note, /assente/);
  } finally { rmSync(casa, { recursive: true, force: true }); }
});

// I transcript dei sotto-agenti stanno in <sessione>/subagents/*.jsonl coi loro
// token. Le regole del repo dicono di delegare: un rapporto che li ignorava
// diceva 29 $ per una sessione in cui un solo sotto-agente su diciassette ne
// valeva 55 (giro del 14/09, verifica).
test('i sotto-agenti entrano nel conto: costo, token, turni e strumenti sommati, con la loro parte a vista', async () => {
  const casa = cartellaTemporanea('filo-rapporto-sotto-');
  try {
    const file = join(casa, 'sess-1.jsonl');
    writeFileSync(file, RIGHE.join('\n'), 'utf8');
    const sub = join(casa, 'sess-1', 'subagents');
    mkdirSync(sub, { recursive: true });
    // 100000·6,25 + 1000·25 = 650.000 / 1e6 = 0,65 $
    writeFileSync(join(sub, 'agent-a.jsonl'), `${assistant('s1', 'claude-opus-5',
      { input_tokens: 0, cache_creation_input_tokens: 100000, cache_read_input_tokens: 0, output_tokens: 1000 },
      [{ type: 'tool_use', id: 'su1', name: 'Read', input: {} }], T('00:20'))}\n`, 'utf8');
    writeFileSync(join(sub, 'agent-a.meta.json'), '{}', 'utf8');
    const solo = await analizzaRighe(RIGHE);
    const rep = await generaRapporto({ transcript: file });
    assert.equal(rep.subagentRuns, 1);
    assert.equal(rep.subagentCostUsd, 0.65);
    assert.equal(rep.costUsd, Math.round((solo.costUsd + 0.65) * 10000) / 10000, 'il costo totale comprende i sotto-agenti');
    assert.equal(rep.tokens.output, solo.tokens.output + 1000);
    assert.equal(rep.tokens.cacheWrite, solo.tokens.cacheWrite + 100000);
    assert.equal(rep.tools.total, solo.tools.total + 1);
    assert.equal(rep.tools.byName.Read, 1);
    assert.equal(rep.turns, solo.turns + 1);
    assert.equal(rep.durationS, solo.durationS, 'la durata resta quella della sessione madre');
    assert.match(riassunto(rep)[4], /sotto-agenti letti: 1, il loro costo \$0\.6500/);
    // Senza sotto-agenti il rapporto è quello di prima, con i due contatori a zero.
    const senza = await generaRapporto({ transcript: join(casa, 'altra.jsonl') });
    assert.equal(senza.subagentRuns, 0);
    assert.equal(senza.subagentCostUsd, 0);
  } finally { rmSync(casa, { recursive: true, force: true }); }
});
