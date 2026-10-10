// Porte dei giri passati ri-provate al giro 5 (verifica locale): il confine della finestra dell'orchestratore
// nel rapporto del worker due, su transcript costruiti con la forma di quelli veri. Non apre Filo.

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
function turno(min, { cr = 50000, cw = 2000, out = 300, tools = [], model = 'claude-opus-5-5' } = {}) {
  nid += 1;
  return { type: 'assistant', timestamp: iso(min), sessionId: 'S', message: { id: `msg_${nid}`, model, usage: { input_tokens: 5, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out }, content: tools.length ? tools : [{ type: 'text', text: 'ok' }] } };
}
const usa = (id, name, input) => ({ type: 'tool_use', id, name, input });
const risultato = (min, id, testo) => ({ type: 'user', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: testo }] } });
const notifica = (min, id, taskId, stato = 'completed') => ({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(min), content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${stato}</status>\n<summary>finished</summary>\n</task-notification>` });

async function rapportoDelWorkerDue(principale) {
  const base = cartellaTemporanea('orch-costo-g5p-');
  const sub = join(base, 'S', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(base, 'S.jsonl'), principale.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const w2 = [turno(83.1, { cr: 0, cw: 25000 }), turno(100), turno(120, { tools: [usa('w_rel', 'Bash', { command: 'node scripts/routine-channel.mjs release T2 --role verifier' })] })];
  writeFileSync(join(sub, 'agent-w2.jsonl'), w2.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return generaRapporto({ transcript: join(sub, 'agent-w2.jsonl'), role: 'verifier', cwd: base });
}

/** Worker uno in sottofondo che muore dopo 78 minuti; l'orchestratore riscalda, rilascia per lui, lancia il due. */
function conRilascio(comando) {
  return [
    turno(0, { cr: 0, cw: 30000 }),
    turno(1, { tools: [usa('t_w1', 'Agent', { prompt: 'w1' })] }),
    risultato(1.01, 't_w1', 'Async agent launched successfully.\nagentId: w1'),
    turno(1.02),
    notifica(79, 't_w1', 'w1', 'failed'),
    turno(79.5, { cr: 0, cw: 200000 }),
    turno(80, { cr: 200000, cw: 1000, tools: [usa('t_rel', 'Bash', { command: comando })] }),
    risultato(81, 't_rel', 'OK: biglietto rilasciato.'),
    turno(81.5, { tools: [usa('t_tk', 'Bash', { command: 'node scripts/routine-channel.mjs ticket "x" --json' })] }),
    risultato(82, 't_tk', '{"ticket":"T2"}'),
    turno(83, { tools: [usa('t_w2', 'Agent', { prompt: 'w2' })] }),
    risultato(83.01, 't_w2', 'Async agent launched successfully.\nagentId: w2'),
    turno(83.02),
  ];
}

test('il rilascio per un worker morto è un confine comunque sia scritto il comando', async () => {
  for (const comando of [
    'node scripts/routine-channel.mjs release T1 --role orchestrator',
    'node "/home/user/Filo/scripts/routine-channel.mjs" release T1 --role orchestrator',
    "cd /home/user/Filo && node '/home/user/Filo/scripts/routine-channel.mjs' release T1 --role orchestrator 2>&1 | tail -3",
    '& node "C:\\Users\\x\\Filo\\scripts\\routine-channel.mjs" release T1 --role orchestrator',
  ]) {
    const o = (await rapportoDelWorkerDue(conRilascio(comando))).orchestrator;
    expect(o.turns, comando).toBe(3);
    expect(o.rewarmTurns, comando).toBe(0);
  }
});

test('un evento di Monitor e una richiesta fallita non spostano il confine né accorciano l’attesa', async () => {
  const P = [
    turno(0, { cr: 0, cw: 30000 }),
    turno(1, { tools: [usa('t_w1', 'Agent', { prompt: 'w1' })] }),
    risultato(1.01, 't_w1', 'Async agent launched successfully.\nagentId: w1'),
    turno(1.02),
    notifica(91, 't_w1', 'w1'),
    turno(95, { model: '<synthetic>', cr: 0, cw: 0, out: 0 }),
    turno(100, { cr: 0, cw: 200000 }),
    turno(101), turno(102),
    turno(103, { tools: [usa('t_w2', 'Agent', { prompt: 'w2' })] }),
    risultato(103.01, 't_w2', 'Async agent launched successfully.\nagentId: w2'),
    turno(103.02),
    { type: 'queue-operation', operation: 'enqueue', timestamp: iso(110), content: '<task-notification>\n<task-id>bmon1</task-id>\n<status>running</status>\n<summary>Monitor event</summary>\n</task-notification>' },
  ];
  const o = (await rapportoDelWorkerDue(P)).orchestrator;
  expect(o.turns).toBe(5);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBe(Math.round((100 - 1.02) * 60));
});
