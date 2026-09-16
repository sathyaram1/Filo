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
import { execFileSync } from 'node:child_process';
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

// ─── Giro 2 della verifica (16/09/2026) ──────────────────────────────────────
// Tre porte trovate lì: la prima riga di un messaggio su più righe porta un
// output parziale; chi rilascia nelle routine è un SOTTO-AGENTE
// dell'orchestratore, col transcript in <sessione>/subagents/; da una
// cartella di lavoro separata (worktree) i transcript stanno nella cartella
// del checkout principale.

const turnoDi = (id, ts, cw, out, sessionId, model = 'claude-opus-5') => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId,
  message: { id, model, usage: { input_tokens: 10, cache_creation_input_tokens: cw, cache_read_input_tokens: 0, output_tokens: out }, content: [{ type: 'text', text: id }] },
});

test('un messaggio su più righe: vale l\'ULTIMA usage, perché l\'output della prima riga è parziale', async () => {
  const primo = { input_tokens: 2, cache_creation_input_tokens: 32076, cache_read_input_tokens: 29159, output_tokens: 5 };
  const ultimo = { ...primo, output_tokens: 163, output_tokens_details: { thinking_tokens: 13 } };
  const righe = [
    JSON.stringify({ type: 'assistant', timestamp: T('00:00'), sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: primo, content: [{ type: 'text', text: 'penso' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: T('00:01'), sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: ultimo, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } }),
  ];
  const rep = await analizzaRighe(righe, {});
  assert.equal(rep.turns, 1);
  assert.equal(rep.tokens.output, 163);
  assert.equal(rep.tokens.cacheWrite, 32076);
  assert.equal(rep.tools.total, 1);
  assert.ok(Math.abs(rep.costUsd - (2 * 5 + 32076 * 6.25 + 29159 * 0.5 + 163 * 25) / 1e6) < 1e-4);
});

test('chi rilascia è un sotto-agente: il rapporto è il suo, non la sessione madre con tutti i sotto-agenti', async () => {
  const base = cartellaTemporanea('filo-rapporto-sotto-');
  try {
    const progetto = join(base, 'repo');
    mkdirSync(progetto);
    const config = join(base, 'config');
    const dir = join(config, 'projects', slugProgetto(progetto));
    const sub = join(dir, 'orch', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, 'orch.jsonl'), [turnoDi('o1', T('00:00'), 30000, 50, 'orch'), turnoDi('o2', T('01:00'), 1000, 50, 'orch')].join('\n') + '\n');
    writeFileSync(join(sub, 'agent-w1.jsonl'), [turnoDi('a1', T('02:00'), 100000, 500, 'w1'), turnoDi('a2', T('10:00'), 1000, 500, 'w1')].join('\n') + '\n');
    writeFileSync(join(sub, 'agent-w2.jsonl'), [turnoDi('b1', T('20:00'), 40000, 100, 'w2'), turnoDi('b2', T('25:00'), 1000, 100, 'w2')].join('\n') + '\n');
    const t = Date.now() / 1000;
    utimesSync(join(dir, 'orch.jsonl'), t - 3600, t - 3600);
    utimesSync(join(sub, 'agent-w1.jsonl'), t - 2400, t - 2400);
    utimesSync(join(sub, 'agent-w2.jsonl'), t, t);
    // Il worker 2 sta rilasciando: il suo transcript è l'ultimo scritto.
    const rep = await generaRapporto({ role: 'verifier', cwd: progetto, configDir: config });
    assert.equal(rep.sessionId, 'w2');
    assert.equal(rep.turns, 2);
    assert.equal(rep.durationS, 300);
    assert.equal(rep.tokens.cacheWrite, 41000);
    assert.equal(rep.subagentRuns, 0);
    assert.ok(rep.notes.some((n) => /sotto-agente della sessione orch/.test(n)), rep.notes.join(' | '));
    // La sessione madre riceve righe di servizio anche mentre aspetta: il suo
    // file può essere scritto DOPO quello del sotto-agente, ma senza un
    // messaggio dell'assistente più recente non è lei che sta rilasciando.
    writeFileSync(join(dir, 'orch.jsonl'), JSON.stringify({ type: 'queue-operation', timestamp: T('26:00'), sessionId: 'orch' }) + '\n', { flag: 'a' });
    utimesSync(join(dir, 'orch.jsonl'), t + 1, t + 1);
    assert.equal((await generaRapporto({ cwd: progetto, configDir: config })).sessionId, 'w2');
    // L'orchestratore che rilascia il biglietto di un worker morto: il suo
    // messaggio dell'assistente è l'ultimo, e la finestra del biglietto
    // (`since`) lascia fuori i suoi turni di prima e il worker 1.
    writeFileSync(join(dir, 'orch.jsonl'), turnoDi('o3', T('30:00'), 1000, 50, 'orch') + '\n', { flag: 'a' });
    const orch = await generaRapporto({ role: 'orchestrator', cwd: progetto, configDir: config, since: T('15:00') });
    assert.equal(orch.sessionId, 'orch');
    assert.equal(orch.subagentRuns, 2, 'i due file dei sotto-agenti si leggono…');
    assert.equal(orch.turns, 3, '…ma nella finestra ci sono solo il rilascio e i turni del worker 2');
    assert.equal(orch.tokens.cacheWrite, 42000);
    // Senza finestra, la sessione madre resta la somma di tutto (era così prima).
    const tutto = await generaRapporto({ cwd: progetto, configDir: config });
    assert.equal(tutto.turns, 7);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('da una cartella di lavoro separata (worktree) si trova la cartella dei transcript del checkout principale', async () => {
  const base = cartellaTemporanea('filo-rapporto-worktree-');
  try {
    const repo = join(base, 'repo');
    const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    mkdirSync(repo);
    g(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    g(repo, 'add', '-A');
    g(repo, 'commit', '-q', '-m', 'base');
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true });
    const wt = join(repo, '.claude', 'worktrees', 'lavoro');
    g(repo, 'worktree', 'add', '-q', wt, '-b', 'claude/lavoro');
    const config = join(base, 'config');
    const dir = join(config, 'projects', slugProgetto(repo));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sess.jsonl'), turnoDi('m1', T('00:00'), 30000, 50, 'sess') + '\n');
    const rep = await generaRapporto({ cwd: wt, configDir: config });
    assert.equal(rep.sessionId, 'sess', rep.notes.join(' | '));
    assert.equal(rep.turns, 1);
    // Dal checkout principale, come prima.
    assert.equal((await generaRapporto({ cwd: repo, configDir: config })).sessionId, 'sess');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ─── Giro del 14/09, terza verifica: due forme vere dei transcript ───────────

test('le parole «timed out» nel testo di un file letto non sono un timeout: conta il risultato in errore che comincia così', async () => {
  const uso = { input_tokens: 10, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 40 };
  const righe = [
    assistant('m1', 'claude-opus-5', uso, [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }], T('00:00')),
    result('tu1', "12\tif (/timed out/i.test(testo)) n += 1; // 'Command timed out after 2m 0s'", T('00:01')),
    assistant('m2', 'claude-opus-5', uso, [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: {} }], T('00:02')),
    result('tu2', 'Command timed out after 2m 0s\nnpm run finish:check', T('02:02'), true),
  ];
  const rep = await analizzaRighe(righe, {});
  assert.equal(rep.tools.total, 2);
  assert.equal(rep.tools.timeouts, 1);
  assert.equal(rep.tools.errors, 1);
});

test('una riga col modello «<synthetic>» (zero token) non è un turno e non lascia la nota del modello sconosciuto', async () => {
  const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const uso = { input_tokens: 10, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 40 };
  const righe = [
    assistant('m1', 'claude-opus-5', uso, [{ type: 'text', text: 'ciao' }], T('00:00')),
    assistant('sint-1', '<synthetic>', zero, [{ type: 'text', text: 'Request interrupted' }], T('00:05')),
    assistant('m2', 'claude-opus-5', uso, [{ type: 'text', text: 'fine' }], T('01:00')),
  ];
  const rep = await analizzaRighe(righe, {});
  assert.equal(rep.turns, 2);
  assert.deepEqual(rep.models, ['claude-opus-5']);
  assert.deepEqual(rep.notes, []);
});

// ─── Giro 4 della verifica (16/09/2026): la cache a un'ora costa il doppio ──
test('una scrittura in cache a un\'ora è prezzata a 2× l\'input, quella a cinque minuti a 1,25×; senza dettaglio vale cinque minuti', async () => {
  const soloUnOra = [assistant('u1', 'claude-opus-5', {
    input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100000 },
  }, [], T('00:00'))];
  const a = await analizzaRighe(soloUnOra);
  assert.equal(a.costUsd, 1.0, '100.000 token a un\'ora, Opus: 10 $/M → 1,00 $ (non 0,625)');
  assert.equal(a.tokens.cacheWrite, 100000);

  const miste = [assistant('u2', 'claude-fable-5-1', {
    input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 200000,
    cache_creation: { ephemeral_5m_input_tokens: 100000, ephemeral_1h_input_tokens: 100000 },
  }, [], T('00:00'))];
  const b = await analizzaRighe(miste);
  // Fable 5.1: 100.000 × 12,5 + 100.000 × 20 = 3,25 $
  assert.equal(b.costUsd, 3.25);

  const senzaDettaglio = [assistant('u3', 'claude-opus-5', {
    input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100000,
  }, [], T('00:00'))];
  const c = await analizzaRighe(senzaDettaglio);
  assert.equal(c.costUsd, 0.625, 'un transcript senza il dettaglio per durata: tutto a cinque minuti, come prima');

  // Il dettaglio che non torna col totale: la differenza si conta a cinque minuti.
  const storto = [assistant('u4', 'claude-opus-5', {
    input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40000 },
  }, [], T('00:00'))];
  const d = await analizzaRighe(storto);
  assert.equal(d.costUsd, Math.round((40000 * 10 + 60000 * 6.25) / 1e6 * 10000) / 10000);
  assert.equal(d.tokens.cacheWrite, 100000);
  for (const k of ['opus', 'sonnet', 'sonnet-4', 'haiku', 'fable', 'fable-5']) {
    assert.equal(PREZZI[k].cacheWrite1h, PREZZI[k].input * 2, `${k}: la scrittura a un'ora è 2× l'input`);
  }
});

// Un sotto-agente che lancia sotto-agenti suoi: Claude Code li scrive ACCANTO
// a lui, nella stessa cartella subagents/ della sessione madre, senza un
// puntatore al lanciatore (verificato dal vivo il 16/09/2026). Nelle routine il
// worker è un sotto-agente e delega le letture grosse: il suo rapporto deve
// comprenderli, e li riconosce dal tempo (cominciano fra la sua chiamata
// Agent e il risultato). Un fratello di un altro giro resta fuori.
test('i sotto-agenti di un sotto-agente stanno accanto a lui: nel suo rapporto entrano quelli cominciati dentro le sue chiamate Agent', async () => {
  const base = cartellaTemporanea('filo-rapporto-nipoti-');
  try {
    const progetto = join(base, 'repo');
    mkdirSync(progetto);
    const config = join(base, 'config');
    const dir = join(config, 'projects', slugProgetto(progetto));
    const sub = join(dir, 'orch', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, 'orch.jsonl'), turnoDi('o1', T('00:00'), 30000, 50, 'orch') + '\n');
    // Un worker di un giro PRIMA: fuori da ogni finestra del worker che rilascia.
    writeFileSync(join(sub, 'agent-prima.jsonl'), turnoDi('p1', T('01:00'), 100000, 500, 'orch') + '\n');
    // Il worker che rilascia: chiama Agent alle 10:00, riceve il risultato alle 12:00, chiude alle 13:00.
    writeFileSync(join(sub, 'agent-worker.jsonl'), [
      assistant('w1', 'claude-opus-5', { input_tokens: 1000, output_tokens: 100 }, [{ type: 'tool_use', id: 'tA', name: 'Agent', input: {} }], T('10:00')),
      result('tA', 'fatto', T('12:00')),
      turnoDi('w2', T('13:00'), 1000, 100, 'orch'),
    ].join('\n') + '\n');
    // Il figlio: comincia alle 10:01, un milione di token (5 $ a tariffa opus).
    writeFileSync(join(sub, 'agent-figlio.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: T('10:01'), sessionId: 'orch', message: { role: 'user', content: 'leggi tutto' } }),
      assistant('f1', 'claude-opus-5', { input_tokens: 1000000, output_tokens: 10 }, [], T('11:00')),
    ].join('\n') + '\n');
    // Un fratello di DOPO (un worker successivo): fuori dalla finestra.
    writeFileSync(join(sub, 'agent-dopo.jsonl'), turnoDi('d1', T('20:00'), 100000, 500, 'orch') + '\n');

    const rep = await generaRapporto({ transcript: join(sub, 'agent-worker.jsonl'), cwd: progetto, configDir: config, role: 'resolver' });
    assert.equal(rep.subagents, 1, 'la chiamata Agent del worker');
    assert.equal(rep.subagentRuns, 1, 'solo il figlio, non i fratelli degli altri giri');
    assert.equal(rep.turns, 3);
    assert.ok(rep.subagentCostUsd > 5 && rep.subagentCostUsd < 5.01, String(rep.subagentCostUsd));
    assert.ok(rep.costUsd > 5, String(rep.costUsd));
    // Senza una chiamata Agent nel transcript nessun fratello entra (era il caso del giro 2).
    const prima = await generaRapporto({ transcript: join(sub, 'agent-prima.jsonl'), cwd: progetto, configDir: config });
    assert.equal(prima.subagentRuns, 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('giro 6: il legame figlio → lanciatore si legge dal meta; il tempo resta un ripiego dichiarato; senza transcript indicato si risale al lanciatore', async () => {
  const base = cartellaTemporanea('filo-rapporto-meta-');
  try {
    const progetto = join(base, 'repo');
    mkdirSync(progetto);
    const config = join(base, 'config');
    const dir = join(config, 'projects', slugProgetto(progetto));
    const sub = join(dir, 'orch', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, 'orch.jsonl'), turnoDi('o1', T('00:00'), 30000, 50, 'orch') + '\n');
    // Il worker: chiama Agent alle 10:00, la risposta immediata «avviato» arriva alle 10:00:02, chiude alle 13:00.
    writeFileSync(join(sub, 'agent-worker.jsonl'), [
      assistant('w1', 'claude-opus-5', { input_tokens: 1000, output_tokens: 100 }, [{ type: 'tool_use', id: 'tA', name: 'Agent', input: {} }], T('00:00')),
      result('tA', 'Async agent launched successfully.', '2026-09-16T10:00:02.000Z'),
      turnoDi('w2', T('13:00'), 1000, 100, 'orch'),
    ].join('\n') + '\n');
    writeFileSync(join(sub, 'agent-worker.meta.json'), JSON.stringify({ agentType: 'routine-worker', toolUseId: 'toolu_w' }));
    // Il figlio in sottofondo: comincia DOPO la risposta immediata, e resta vivo dopo la chiusura del worker.
    writeFileSync(join(sub, 'agent-figlio.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-09-16T10:00:03.000Z', sessionId: 'orch', message: { role: 'user', content: 'leggi tutto' } }),
      assistant('f1', 'claude-opus-5', { input_tokens: 1000000, output_tokens: 10 }, [], T('11:00')),
      turnoDi('f2', T('14:00'), 10, 10, 'orch'),
    ].join('\n') + '\n');
    writeFileSync(join(sub, 'agent-figlio.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'tA', parentAgentId: 'worker' }));
    // Un nipote: figlio del figlio, fuori da ogni finestra del worker.
    writeFileSync(join(sub, 'agent-nipote.jsonl'), turnoDi('n1', T('20:00'), 200000, 10, 'orch') + '\n');
    writeFileSync(join(sub, 'agent-nipote.meta.json'), JSON.stringify({ parentAgentId: 'figlio' }));
    // Un fratello di un altro giro col meta: punta a un altro lanciatore, dentro la finestra o no non conta.
    writeFileSync(join(sub, 'agent-altro.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-09-16T10:00:01.000Z', sessionId: 'orch', message: { role: 'user', content: 'altro giro' } }),
      turnoDi('a1', T('10:30'), 100000, 10, 'orch'),
    ].join('\n') + '\n');
    writeFileSync(join(sub, 'agent-altro.meta.json'), JSON.stringify({ parentAgentId: 'worker-di-prima' }));

    const rep = await generaRapporto({ transcript: join(sub, 'agent-worker.jsonl'), cwd: progetto, configDir: config, role: 'resolver' });
    assert.equal(rep.subagentRuns, 2, 'figlio e nipote dal meta; il fratello di un altro giro no');
    assert.ok(rep.subagentCostUsd > 5, String(rep.subagentCostUsd));
    assert.ok(!rep.notes.some((n) => /senza meta/.test(n)), 'col meta nessun ripiego dichiarato');

    // Senza transcript indicato: il più recente è il figlio (14:00), ma il rapporto è del lanciatore.
    const scelto = trovaTranscript({ cwd: progetto, configDir: config, env: {} });
    assert.equal(resolve(scelto.file), resolve(join(sub, 'agent-worker.jsonl')));

    // Ripiego dal tempo: un figlio SENZA meta dentro la finestra entra, e il rapporto lo dice.
    writeFileSync(join(sub, 'agent-orfano.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-09-16T10:00:01.000Z', sessionId: 'orch', message: { role: 'user', content: 'senza meta' } }),
      turnoDi('x1', T('10:10'), 1000, 10, 'orch'),
    ].join('\n') + '\n');
    const conOrfano = await generaRapporto({ transcript: join(sub, 'agent-worker.jsonl'), cwd: progetto, configDir: config, role: 'resolver' });
    assert.equal(conOrfano.subagentRuns, 3);
    assert.ok(conOrfano.notes.some((n) => /agent-orfano\.jsonl senza meta/.test(n) && /tempo/.test(n)), conOrfano.notes.join(' | '));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('giro 6: la data della prima riga si trova anche oltre i 64 KB di compito', async () => {
  const base = cartellaTemporanea('filo-rapporto-lungo-');
  try {
    const { primoTimestampMs } = await import('../../scripts/session-report.mjs');
    const p = join(base, 'agent-x.jsonl');
    writeFileSync(p, JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(200_000) }, timestamp: T('05:00') }) + '\n');
    assert.equal(primoTimestampMs(p), Date.parse(T('05:00')));
    const senza = join(base, 'agent-y.jsonl');
    writeFileSync(senza, 'niente\n{"type":"user"}\n');
    assert.ok(Number.isNaN(primoTimestampMs(senza)));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
