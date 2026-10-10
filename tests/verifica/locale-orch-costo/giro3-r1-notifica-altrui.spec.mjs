// Verifica locale «orch-costo», giro 3, rilievo 1: una notifica che non è di un worker (l'evento di un Monitor,
// o il testo di un turno che nomina le notifiche) non deve chiudere il worker in corso e spostare la finestra.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto } from '../../../scripts/session-report.mjs';

const SID = 'sess-orch-costo-g3';
const t = (min) => new Date(Date.UTC(2026, 9, 10, 8, 0, 0) + min * 60_000).toISOString();
const uso = (cw, cr) => ({ input_tokens: 2, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: cw, ephemeral_5m_input_tokens: 0 } });
let n = 0;
const turno = (min, cw, cr, content = [{ type: 'text', text: 'ok' }]) => ({ type: 'assistant', timestamp: t(min), sessionId: SID, message: { id: `msg_${++n}`, model: 'claude-opus-5-5', role: 'assistant', usage: uso(cw, cr), content } });
const lancio = (min, id) => turno(min, 500, 250_000, [{ type: 'tool_use', id, name: 'Agent', input: { description: 'worker', prompt: 'lavora', run_in_background: true } }]);
const lanciato = (min, id, agentId) => ({ type: 'user', timestamp: t(min), sessionId: SID, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Async agent launched successfully. agentId: ${agentId}` }] }] } });
const notifica = (min, corpo) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: t(min), sessionId: SID, content: `<task-notification>\n${corpo}\n</task-notification>` });

function scrivi(righeOrch) {
  const dir = cartellaTemporanea('orch-costo-g3-');
  const sub = join(dir, SID, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(dir, `${SID}.jsonl`), righeOrch.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const w = join(sub, 'agent-bbb.jsonl');
  writeFileSync(w, [
    turno(37, 30_000, 0),
    turno(60, 500, 30_000),
    turno(120, 500, 30_000, [{ type: 'tool_use', id: 'toolu_rel', name: 'Bash', input: { command: 'node scripts/routine-channel.mjs release abc --role verifier' } }]),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return w;
}

// Worker uno in sottofondo per un'ora e mezza, poi quattro turni dell'orchestratore (il primo riscrive tutta la
// cache) e il lancio del worker due, che rilascia: il rapporto deve contare cinque turni e un'ora e mezza d'attesa.
function base(inMezzo) {
  n = 0;
  return [
    turno(0, 250_000, 0),
    lancio(1, 'toolu_A'),
    lanciato(1, 'toolu_A', 'aaa'),
    notifica(91, '<task-id>aaa</task-id>\n<tool-use-id>toolu_A</tool-use-id>\n<status>completed</status>'),
    turno(92, 250_000, 0),
    turno(93, 500, 250_000),
    turno(94, 500, 250_000),
    turno(95, 500, 250_000),
    lancio(96, 'toolu_B'),
    lanciato(96, 'toolu_B', 'bbb'),
    ...inMezzo,
  ];
}

async function orchestratore(righe) {
  const rep = await generaRapporto({ transcript: scrivi(righe), role: 'verifier' });
  return rep.orchestrator;
}

test('controllo: senza notifiche altrui il rapporto conta i cinque turni e l’attesa lunga', async () => {
  const o = await orchestratore(base([]));
  expect(o.turns).toBe(5);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBeGreaterThanOrEqual(90 * 60);
});

test('r1 l’evento di un Monitor mentre il worker due lavora non toglie dal rapporto i turni prima del suo lancio', async () => {
  const o = await orchestratore(base([
    notifica(110, '<task-id>bp26ct7t3</task-id>\n<summary>Monitor event: "finish:check completion"</summary>\n<event>EXIT 1</event>'),
  ]));
  expect(o.turns).toBe(5);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBeGreaterThanOrEqual(90 * 60);
});

test('r1 un turno dell’orchestratore che nomina le notifiche non chiude il worker due', async () => {
  const o = await orchestratore(base([
    turno(100, 500, 250_000, [{ type: 'text', text: 'Il worker due è partito: aspetto la sua task-notification.' }]),
  ]));
  expect(o.turns).toBe(6);
  expect(o.rewarmTurns).toBe(1);
  expect(o.attesaPrimaS).toBeGreaterThanOrEqual(90 * 60);
});
