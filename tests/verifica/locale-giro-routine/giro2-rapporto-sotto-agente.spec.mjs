// Prove del giro 2 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: il rapporto di fine sessione nella FORMA VERA delle routine. I
// worker sono sotto-agenti dell'orchestratore (routines/roles/orchestrator.md:
// `subagent_type: routine-worker`), e Claude Code scrive il loro transcript in
// `<sessione dell'orchestratore>/subagents/agent-….jsonl`, non fra i `.jsonl`
// della cartella del progetto. Qui si ricostruisce quella cartella (con
// CLAUDE_CONFIG_DIR finto) e si chiede il rapporto come lo chiede il rilascio
// del secondo worker. Due rilievi del giro 2, marcati come rossi attesi.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto, analizzaRighe, slugProgetto } from '../../../scripts/session-report.mjs';

const uso = (cw, out) => ({ input_tokens: 10, cache_creation_input_tokens: cw, cache_read_input_tokens: 0, output_tokens: out });
const turno = (id, ts, cw, out, sessionId) => JSON.stringify({ type: 'assistant', timestamp: ts, sessionId, message: { id, model: 'claude-opus-5', usage: uso(cw, out), content: [{ type: 'text', text: id }] } });

/** La cartella dei transcript come la scrive Claude Code: orchestratore + due worker. */
function cartellaRoutine() {
  const base = cartellaTemporanea('giro2-rapporto-');
  const progetto = join(base, 'repo');
  mkdirSync(progetto, { recursive: true });
  const config = join(base, 'config');
  const dir = join(config, 'projects', slugProgetto(progetto));
  const sub = join(dir, 'orch', 'subagents');
  mkdirSync(sub, { recursive: true });
  // L'orchestratore: 2 turni, scritti prima di lanciare i worker.
  writeFileSync(join(dir, 'orch.jsonl'), [turno('o1', '2026-09-16T08:00:00.000Z', 30000, 50, 'orch'), turno('o2', '2026-09-16T08:01:00.000Z', 1000, 50, 'orch')].join('\n') + '\n');
  // Il primo worker: 3 turni, finito da un pezzo (100.000 token di cache scritta).
  writeFileSync(join(sub, 'agent-w1.jsonl'), [turno('a1', '2026-09-16T08:02:00.000Z', 100000, 500, 'w1'), turno('a2', '2026-09-16T08:10:00.000Z', 1000, 500, 'w1'), turno('a3', '2026-09-16T08:20:00.000Z', 1000, 500, 'w1')].join('\n') + '\n');
  // Il secondo worker: 2 turni, è lui che sta rilasciando adesso.
  writeFileSync(join(sub, 'agent-w2.jsonl'), [turno('b1', '2026-09-16T09:00:00.000Z', 40000, 100, 'w2'), turno('b2', '2026-09-16T09:05:00.000Z', 1000, 100, 'w2')].join('\n') + '\n');
  const t = Date.now() / 1000;
  utimesSync(join(dir, 'orch.jsonl'), t - 3600, t - 3600);
  utimesSync(join(sub, 'agent-w1.jsonl'), t - 2400, t - 2400);
  utimesSync(join(sub, 'agent-w2.jsonl'), t, t);
  return { progetto, config };
}

test.describe('rapporto di fine sessione — nella forma vera delle routine', () => {
  test('al rilascio del secondo worker il rapporto descrive QUEL worker, non l\'orchestratore con tutti i worker prima di lui', async () => {
    // Oggi il rapporto prende il `.jsonl` più recente della cartella del
    // progetto — cioè l'orchestratore — e ci somma TUTTI i suoi sotto-agenti:
    // il rilascio del worker 2 allega l'orchestratore + worker 1 + worker 2,
    // e ogni rilascio ripete i costi dei rilasci prima. Su una sessione vera di
    // questa macchina (16/09): il sotto-agente che rilascia vale 25 turni e
    // 2,9 $; il rapporto che allegherebbe dice 1169 turni, 235 $ e 27 ore.
    // Rilievo del giro 2, livello 2, corretto nello stesso giro: conta il
    // transcript con l'ultimo messaggio dell'assistente, sotto-agenti compresi.
    const { progetto, config } = cartellaRoutine();
    const rep = await generaRapporto({ role: 'verifier', cwd: progetto, configDir: config });
    expect(rep.sessionId).toBe('w2');
    expect(rep.turns).toBe(2);
    expect(rep.durationS).toBe(300);
    expect(rep.tokens.cacheWrite).toBe(41000);
    expect(rep.costUsd).toBeLessThan(0.3);
  });

  test('un messaggio su più righe conta i token di output dell\'ULTIMA riga, non della prima (che è parziale)', async () => {
    // Nei transcript veri (verificato il 16/09 su questa macchina: 18 messaggi
    // su 18) la prima riga di un messaggio porta output_tokens parziali (2, 5,
    // 7) e l'ultima quelli veri (163, 273, 309). Contando la prima, su una
    // sessione vera l'output è 317.000 token invece di 1.927.000 e il costo
    // 235 $ invece di 283 $. Rilievo del giro 2, livello 1.
    test.fail(true, 'rilievo del giro 2: si conta la prima riga del messaggio, con l’output parziale');
    const primo = { input_tokens: 2, cache_creation_input_tokens: 32076, cache_read_input_tokens: 29159, output_tokens: 5 };
    const ultimo = { ...primo, output_tokens: 163, output_tokens_details: { thinking_tokens: 13 } };
    const righe = [
      { type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: primo, content: [{ type: 'text', text: 'penso' }] } },
      { type: 'assistant', timestamp: '2026-09-16T10:00:01.000Z', sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: ultimo, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
    ].map((r) => JSON.stringify(r));
    const rep = await analizzaRighe(righe, {});
    expect(rep.turns).toBe(1);
    expect(rep.tokens.output).toBe(163);
  });
});
