// Rilievo 1 del giro 6 (verifica locale): il confine della finestra dell'orchestratore cade più tardi del vero
// ritorno dell'orchestratore dopo il worker di prima, e i suoi primi turni (la cache riscritta) si perdono. Non apre Filo.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { cartellaTemporanea } = await import(pathToFileURL(resolve(ROOT, 'tests', 'helpers', 'percorsi.mjs')).href);
const { generaRapporto } = await import(pathToFileURL(resolve(ROOT, 'scripts', 'session-report.mjs')).href);

const T0 = Date.parse('2026-10-01T08:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
let nid = 0;
function turno(min, { cr = 50000, cw = 2000, out = 300, tools = [] } = {}) {
  nid += 1;
  return { type: 'assistant', timestamp: iso(min), sessionId: 'S', message: { id: `msg_${nid}`, model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out }, content: tools.length ? tools : [{ type: 'text', text: 'ok' }] } };
}
const usa = (id, name, input) => ({ type: 'tool_use', id, name, input });
const risultato = (min, id, testo, err = false) => ({ type: 'user', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: testo, ...(err ? { is_error: true } : {}) }] } });
const notifica = (min, id, taskId) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(min), content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>finished</summary>\n</task-notification>` });
// La consegna del rapporto finale di un sotto-agente in sottofondo, come la scrive Claude Code nel thread principale.
const consegna = (min, agentId) => ({ type: 'user', timestamp: iso(min), message: { role: 'user', content: [{ type: 'text', text: `Another Claude session sent a message: <agent-message from="${agentId}">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to.\nfatto\n</agent-message>` }] } });

/** Il rapporto del worker due al suo rilascio (minuto 120): il thread principale fin lì. */
async function rapportoDelWorkerDue(principale) {
  const base = cartellaTemporanea('orch-costo-g6r1-');
  const sub = join(base, 'S', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(base, 'S.jsonl'), principale.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const w2 = [turno(92.1, { cr: 0, cw: 25000 }), turno(120, { tools: [usa('w_rel', 'Bash', { command: 'node scripts/routine-channel.mjs release T2 --role verifier' })] })];
  writeFileSync(join(sub, 'agent-w2.jsonl'), w2.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return (await generaRapporto({ transcript: join(sub, 'agent-w2.jsonl'), role: 'verifier', cwd: base })).orchestrator;
}

const inizio = [
  turno(0, { cr: 0, cw: 30000 }),
  turno(1, { tools: [usa('t_w1', 'Agent', { prompt: 'w1' })] }),
  risultato(1.01, 't_w1', 'Async agent launched successfully.\nagentId: w1'),
  turno(1.02),
];
const lancioDue = [
  turno(92, { cr: 200000, tools: [usa('t_w2', 'Agent', { prompt: 'w2', subagent_type: 'general-purpose' })] }),
  risultato(92.01, 't_w2', 'Async agent launched successfully.\nagentId: w2'),
  turno(92.02, { cr: 200000 }),
];
const ATTESA = Math.round((90.2 - 1.02) * 60);

test('r1 il worker uno consegna il rapporto finale prima della notifica: il turno che riscrive la cache resta nel rapporto', async () => {
  // Su questa macchina 8 consegne su 190 hanno turni dell'orchestratore prima della notifica, fino a 23 secondi dopo.
  const o = await rapportoDelWorkerDue([
    ...inizio,
    consegna(90, 'w1'),
    turno(90.2, { cr: 0, cw: 200000 }),
    notifica(90.4, 't_w1', 'w1'),
    turno(91, { cr: 200000 }),
    ...lancioDue,
  ]);
  expect(o.turns).toBe(4);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBe(ATTESA);
});

test('r1 un lancio fallito e riprovato per lo stesso biglietto non sposta l’inizio della finestra', async () => {
  const o = await rapportoDelWorkerDue([
    ...inizio,
    notifica(90, 't_w1', 'w1'),
    turno(90.2, { cr: 0, cw: 200000 }),
    turno(91, { cr: 200000 }),
    turno(91.5, { cr: 200000, tools: [usa('t_w2x', 'Agent', { prompt: 'w2', subagent_type: 'routine-worker' })] }),
    risultato(91.51, 't_w2x', "Agent type 'routine-worker' not found. Available agents: general-purpose", true),
    ...lancioDue,
  ]);
  expect(o.turns).toBe(5);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBe(ATTESA);
});
