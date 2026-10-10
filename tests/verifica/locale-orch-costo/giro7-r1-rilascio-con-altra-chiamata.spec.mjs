// Giro 7 (verifica locale), rilievo 1: il turno dell'orchestratore che rilascia per un worker morto e, nello
// stesso turno, chiama un altro strumento finisce sia nel rapporto di quel rilascio sia in quello del worker dopo.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { cartellaTemporanea } = await import(pathToFileURL(resolve(ROOT, 'tests', 'helpers', 'percorsi.mjs')).href);
const { generaRapporto } = await import(pathToFileURL(resolve(ROOT, 'scripts', 'session-report.mjs')).href);

const T0 = Date.parse('2026-10-01T08:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const U = (cr, cw, out = 300) => ({ input_tokens: 5, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out });
const riga = (min, id, u, content) => ({ type: 'assistant', timestamp: iso(min), sessionId: 'S', message: { id, model: 'claude-opus-5-5', usage: u, content } });
let nid = 0;
const turno = (min, { cr = 50000, cw = 2000, tools = [] } = {}) => riga(min, `msg_${++nid}`, U(cr, cw), tools.length ? tools : [{ type: 'text', text: 'ok' }]);
const usa = (id, name, input) => ({ type: 'tool_use', id, name, input });
const risultato = (min, id, testo) => ({ type: 'user', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: testo }] } });
const notifica = (min, id, taskId, stato) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(min), content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${stato}</status>\n<summary>finished</summary>\n</task-notification>` });

/** Worker uno muore; il turno che riscalda la cache rilascia T1 e in parallelo riporta la cartella su main. */
function principale() {
  return [
    turno(0, { cr: 0, cw: 30000 }),
    turno(1, { tools: [usa('t_w1', 'Agent', { prompt: 'w1' })] }),
    risultato(1.01, 't_w1', 'Async agent launched successfully.\nagentId: w1'),
    turno(1.02),
    notifica(79, 't_w1', 'w1', 'failed'),
    riga(79.5, 'msg_R', U(0, 200000, 400), [{ type: 'text', text: 'rilascio' }]),
    riga(79.51, 'msg_R', U(0, 200000, 400), [usa('t_rel', 'Bash', { command: 'node scripts/routine-channel.mjs release T1 --role orchestrator' })]),
    riga(79.52, 'msg_R', U(0, 200000, 400), [usa('t_lp', 'Bash', { command: 'node scripts/dispatch.mjs --linea-principale' })]),
    risultato(80, 't_rel', 'OK: biglietto rilasciato.'),
    risultato(80.1, 't_lp', 'ok'),
    turno(81.5, { tools: [usa('t_tk', 'Bash', { command: 'node scripts/routine-channel.mjs ticket "x" --json' })] }),
    risultato(82, 't_tk', '{"ticket":"T2"}'),
    turno(83, { tools: [usa('t_w2', 'Agent', { prompt: 'w2' })] }),
    risultato(83.01, 't_w2', 'Async agent launched successfully.\nagentId: w2'),
    turno(83.02),
  ];
}

test('r1 il turno che rilascia per un worker morto non torna nel rapporto del worker dopo', async () => {
  const base = cartellaTemporanea('orch-costo-g7r1-');
  const sub = join(base, 'S', 'subagents');
  mkdirSync(sub, { recursive: true });
  const P = principale();
  // Il rilascio di T1, fatto dall'orchestratore mentre il suo turno è già tutto scritto.
  writeFileSync(join(base, 'S.jsonl'), P.filter((x) => Date.parse(x.timestamp) <= T0 + 79.52 * 60000).map((x) => JSON.stringify(x)).join('\n') + '\n');
  const morto = await generaRapporto({ transcript: join(base, 'S.jsonl'), role: 'orchestrator', ticket: 'T1', cwd: base });
  expect(morto.rewarmTokens).toBe(200000);

  writeFileSync(join(base, 'S.jsonl'), P.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const w2 = [turno(83.1, { cr: 0, cw: 25000 }), turno(100), turno(120, { tools: [usa('w_rel', 'Bash', { command: 'node scripts/routine-channel.mjs release T2 --role verifier' })] })];
  writeFileSync(join(sub, 'agent-w2.jsonl'), w2.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const o = (await generaRapporto({ transcript: join(sub, 'agent-w2.jsonl'), role: 'verifier', cwd: base })).orchestrator;
  expect(o.rewarmTurns).toBe(0);
  expect(o.turns).toBe(3);
});
