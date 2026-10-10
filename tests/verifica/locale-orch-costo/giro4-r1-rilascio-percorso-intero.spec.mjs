// Prova del giro 4 (verifica locale) sul costo dell'orchestratore allegato al rilascio.
// Non apre Filo: costruisce il transcript di una sessione di routine e chiede il rapporto come fa il rilascio.
// In cloud il preflight consegna i comandi col percorso intero fra virgolette (strumenti fissati fuori dal progetto).

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T0 = Date.parse('2026-10-01T08:00:00Z');
const ts = (min) => new Date(T0 + min * 60000).toISOString();

let n = 0;
const turno = (min, { cw = 2000, cr = 100000, tools = [] } = {}) => JSON.stringify({
  type: 'assistant', timestamp: ts(min), sessionId: 'S',
  message: { id: `msg${++n}`, model: 'claude-opus-5-5', content: tools,
    usage: { input_tokens: 10, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: cw, ephemeral_5m_input_tokens: 0 } } },
});
const agente = (id) => ({ type: 'tool_use', id, name: 'Agent', input: { description: 'w', prompt: 'p', subagent_type: 'routine-worker' } });
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const risultato = (min, id, text) => JSON.stringify({ type: 'user', timestamp: ts(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const lanciato = (min, id, agentId) => risultato(min, id, `Async agent launched successfully. agentId: ${agentId} (internal)`);
const fine = (min, task, tuid, status) => JSON.stringify({ type: 'user', timestamp: ts(min), message: { role: 'user',
  content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${tuid}</tool-use-id>\n<output-file>x</output-file>\n<status>${status}</status>\n<summary>Agent "w" ${status}</summary>\n</task-notification>` } });

// Worker uno in sottofondo muore; l'orchestratore riscrive la cache, rilascia il suo biglietto, chiede il biglietto
// nuovo e lancia il worker due, che lavora e rilascia.
function sessione(comandoRilascio) {
  return [
    turno(0, { cw: 40000, cr: 0 }), turno(1),
    turno(2, { tools: [agente('tw1')] }), lanciato(2.05, 'tw1', 'aw1'), turno(2.1),
    fine(80, 'aw1', 'tw1', 'failed'),
    turno(80.5, { cw: 200000, cr: 0 }), turno(81),
    turno(82, { tools: [bash('trel', comandoRilascio)] }), risultato(82.2, 'trel', 'rilasciato'),
    turno(82.5), turno(83, { tools: [bash('ttk', 'node scripts/routine-channel.mjs ticket "x" --json')] }), risultato(83.2, 'ttk', '{}'),
    turno(84, { tools: [agente('tw2')] }), lanciato(84.05, 'tw2', 'aw2'), turno(84.1),
  ];
}

async function orchestratoreDelWorkerDue(dir, comandoRilascio) {
  writeFileSync(join(dir, 'S.jsonl'), `${sessione(comandoRilascio).join('\n')}\n`);
  const sub = join(dir, 'S', 'subagents');
  mkdirSync(sub, { recursive: true });
  const w = join(sub, 'agent-aw2.jsonl');
  writeFileSync(w, `${[turno(84.2, { cw: 30000, cr: 0 }), turno(90, { tools: [bash('tw2rel', 'node scripts/routine-channel.mjs release TK2 --role verifier')] })].join('\n')}\n`);
  writeFileSync(join(sub, 'agent-aw2.meta.json'), JSON.stringify({ agentType: 'routine-worker', requestShape: 'background' }));
  const { generaRapporto } = await import(pathToFileURL(join(ROOT, 'scripts', 'session-report.mjs')).href);
  const rep = await generaRapporto({ transcript: w, role: 'verifier', ticket: 'TK2' });
  return rep.orchestrator;
}

test('r1 il rilascio per un worker morto scritto col percorso intero fra virgolette chiude la finestra come quello corto', async () => {
  const corto = cartellaTemporanea('vl1116-corto-');
  const intero = cartellaTemporanea('vl1116-intero-');
  try {
    const atteso = await orchestratoreDelWorkerDue(corto, 'node scripts/routine-channel.mjs release TK1 --role orchestrator');
    // I turni fra il rilascio dell'orchestratore e il rilascio del worker due: nessuno di quelli già nel rapporto del rilascio.
    expect(atteso.turns).toBe(4);
    expect(atteso.rewarmTurns).toBe(0);
    const cloud = await orchestratoreDelWorkerDue(intero, 'node "/tmp/filo-tools/scripts/routine-channel.mjs" release TK1 --role orchestrator');
    expect({ turns: cloud.turns, rewarmTurns: cloud.rewarmTurns, costUsd: cloud.costUsd })
      .toEqual({ turns: atteso.turns, rewarmTurns: atteso.rewarmTurns, costUsd: atteso.costUsd });
  } finally {
    togliCartella(corto);
    togliCartella(intero);
  }
});
