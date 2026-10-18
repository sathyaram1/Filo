// #1170 giro 1, rilievo 1: un rilascio arrivato al server, ma con l'uscita filtrata o lanciato in sottofondo, non
// viene riconosciuto come confine e i turni dell'orchestratore finiscono in due rapporti. Non apre Filo.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { cartellaTemporanea, togliCartella } = await import(pathToFileURL(resolve(ROOT, 'tests', 'helpers', 'percorsi.mjs')).href);
const { generaRapporto } = await import(pathToFileURL(resolve(ROOT, 'scripts', 'session-report.mjs')).href);

const H = (s) => `2026-10-07T${s}.000Z`;
const riga = (sessionId, id, ts, { cw = 0, cr = 0, tools = null } = {}) => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId,
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 10 }, content: tools || [{ type: 'text', text: id }] },
});
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const agente = (id) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'routine-worker', prompt: 'p' } });
const esito = (id, ts, testo, sessionId = 'orch') => JSON.stringify({ type: 'user', timestamp: ts, sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: testo }] } });
const REL = 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" release tkt --role verifier';

function scena(w1Comando, w1Esito) {
  const base = cartellaTemporanea('filo-1170-r1-');
  const sub = join(base, 'orch', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(base, 'orch.jsonl'), [
    riga('orch', 'o1', H('09:00:00'), { cw: 30000 }),
    riga('orch', 'o2', H('09:00:30'), { cr: 30000, tools: [agente('a1')] }),
    esito('a1', H('09:30:00'), 'fatto'),
    riga('orch', 'o3', H('09:30:10'), { cr: 30000 }),
    riga('orch', 'o4', H('09:30:40'), { cr: 30000, tools: [agente('a2')] }),
  ].join('\n') + '\n');
  writeFileSync(join(sub, 'agent-w1.jsonl'), [
    riga('w1', 'w1a', H('09:00:40'), { cw: 25000 }),
    riga('w1', 'w1r', H('09:29:00'), { cr: 25000, tools: [bash('r1', w1Comando)] }),
    esito('r1', H('09:29:05'), w1Esito, 'w1'),
  ].join('\n') + '\n');
  writeFileSync(join(sub, 'agent-w2.jsonl'), [
    riga('w2', 'w2a', H('09:30:50'), { cw: 25000 }),
    riga('w2', 'w2r', H('10:00:00'), { cr: 25000, tools: [bash('r2', REL)] }),
  ].join('\n') + '\n');
  return { base, w2: join(sub, 'agent-w2.jsonl') };
}

test('r1 il rilascio del worker uno è arrivato col suo rapporto: il worker due porta solo o3 e o4', async () => {
  for (const [comando, uscita] of [
    [`${REL} > /tmp/rilascio.log 2>&1; echo "exit=$?"`, 'exit=0'],
    [`${REL} 2>&1 | grep -v "^rapporto sessione"  | tail -2 | head -1`, "ramo 'worker/x' spedito su origin"],
    [REL, 'Command running in background with ID: b1. Output is being written to: /tmp/x.output'],
  ]) {
    const s = scena(comando, uscita);
    try {
      const o = (await generaRapporto({ transcript: s.w2, role: 'verifier' })).orchestrator;
      expect(o.turns, `${comando} → ${uscita}: o1 e o2 stanno già nel rapporto del worker uno`).toBe(2);
    } finally { togliCartella(s.base); }
  }
});
