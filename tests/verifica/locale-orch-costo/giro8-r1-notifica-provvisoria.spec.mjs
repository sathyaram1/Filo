// Giro 8, rilievo 1: la notifica provvisoria di un worker che si è fermato ad aspettare un suo comando in
// sottofondo (come chiede la ricetta per i controlli automatici) non è la sua fine. Non apre Filo.

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
const lancio = (min, id, agentId) => ({ type: 'user', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId}` }] }] } });
// Le due forme viste sulla macchina dell'owner il 10/10: la provvisoria porta il tool-use-id, la finale no.
const provvisoria = (min, id, agentId) => {
  const s = `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>Agent "w" finished</summary>\n<note>This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports, and the same task-id notifies again if it does; the result below may be interim.</note>\n<result>This agent has not reported yet: it is waiting on its own background work.\n</result>\n</task-notification>`;
  return [{ type: 'queue-operation', operation: 'enqueue', timestamp: iso(min), content: s }, { type: 'user', timestamp: iso(min + 0.001), message: { role: 'user', content: s } }];
};
const finale = (min, id, agentId) => {
  const s = `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>Agent "w" finished</summary>\n<result>done</result>\n</task-notification>`;
  return [{ type: 'queue-operation', operation: 'enqueue', timestamp: iso(min), content: s }, { type: 'user', timestamp: iso(min + 0.001), message: { role: 'user', content: s } }];
};

const rilascio = (min, t) => turno(min, { tools: [usa(`rel_${t}`, 'Bash', { command: `node scripts/routine-channel.mjs release ${t} --role verifier` })] });

async function rapporto(principale, worker, agentId) {
  const base = cartellaTemporanea('orch-costo-g8-');
  const sub = join(base, 'S', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(base, 'S.jsonl'), principale.map((x) => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(join(sub, `agent-${agentId}.jsonl`), worker.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return generaRapporto({ transcript: join(sub, `agent-${agentId}.jsonl`), role: 'verifier', cwd: base });
}

// Worker zero finisce al minuto 10; dopo 70 minuti l'orchestratore riscalda, lavora e lancia il worker uno.
// Il worker uno al minuto 100 si ferma ad aspettare i suoi controlli in sottofondo: arriva la notifica
// provvisoria, l'orchestratore risponde con un turno. Al 120 il worker uno riprende, rilascia e finisce al 121.
const fino100 = [
  turno(0, { cr: 0, cw: 30000 }),
  turno(1, { tools: [usa('t_w0', 'Agent', { prompt: 'w0' })] }),
  lancio(1.01, 't_w0', 'w0'),
  turno(1.02),
  ...finale(10, 't_w0', 'w0'),
  turno(80, { cr: 0, cw: 200000 }),
  turno(81), turno(82),
  turno(83, { tools: [usa('t_w1', 'Agent', { prompt: 'w1' })] }),
  lancio(83.01, 't_w1', 'w1'),
  turno(83.02),
  ...provvisoria(100, 't_w1', 'w1'),
  turno(100.1),
];
const w1 = [turno(83.1, { cr: 0, cw: 25000 }), turno(99), turno(119), rilascio(120, 'T1')];

test('r1 il rapporto del worker uno conta i turni dell’orchestratore prima del suo lancio, compreso quello che riscalda', async () => {
  const o = (await rapporto(fino100, w1, 'w1')).orchestrator;
  expect(o.turns).toBe(6);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBe(Math.round((80 - 1.02) * 60));
});

test('r1 il rapporto del worker due parte dalla fine vera del worker uno e non riconta il turno della notifica provvisoria', async () => {
  const P = [
    ...fino100,
    ...finale(121, 't_w1', 'w1'),
    turno(121.2),
    turno(122, { tools: [usa('t_w2', 'Agent', { prompt: 'w2' })] }),
    lancio(122.01, 't_w2', 'w2'),
    turno(122.02),
  ];
  const w2 = [turno(122.1, { cr: 0, cw: 25000 }), turno(130), rilascio(140, 'T2')];
  const o = (await rapporto(P, w2, 'w2')).orchestrator;
  expect(o.turns).toBe(3);
  expect(o.attesaPrimaS).toBe(Math.round((121.2 - 100.1) * 60));
});
