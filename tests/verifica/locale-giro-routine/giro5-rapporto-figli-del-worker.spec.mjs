// Prove del giro 5 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: il rapporto di fine sessione di un WORKER che a sua volta delega.
//
// Nelle routine il worker è un sotto-agente dell'orchestratore, e il suo
// transcript sta in <sessione>/subagents/agent-<worker>.jsonl (giro 2). Se
// il worker lancia sotto-agenti suoi (le regole del repo glielo chiedono per
// ogni esplorazione), Claude Code NON li annida sotto di lui: li scrive
// accanto, nella stessa cartella subagents/ della sessione madre, con lo
// stesso sessionId (verificato dal vivo su questa macchina il 16/09/2026:
// un sotto-agente lanciato da un sotto-agente è finito in
// <sessione>/subagents/agent-<figlio>.jsonl, fratello del suo lanciatore, e
// il rapporto del lanciatore diceva «sotto-agenti 1 · sotto-agenti letti 0,
// il loro costo $0»). Il rapporto cerca i figli in
// <worker>/subagents/, che non esiste: i figli del worker non entrano nel
// suo costo, esattamente la porta del giro 1, un livello più in basso.
//
// La prova costruisce quella cartella com'è davvero e chiede il rapporto del
// worker: deve comprendere il figlio.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto, slugProgetto } from '../../../scripts/session-report.mjs';

const SESSIONE = '11111111-2222-3333-4444-555555555555';

function riga(o) { return `${JSON.stringify(o)}\n`; }

/** Un turno dell'assistente, con eventuale tool_use. */
function turno({ ms, id, agentId, usage, tools = [] }) {
  return riga({
    type: 'assistant', sessionId: SESSIONE, agentId, isSidechain: Boolean(agentId),
    timestamp: new Date(ms).toISOString(),
    message: { id, model: 'claude-opus-5', usage, content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: {} })) },
  });
}
function risultato({ ms, agentId, toolId }) {
  return riga({
    type: 'user', sessionId: SESSIONE, agentId, isSidechain: Boolean(agentId),
    timestamp: new Date(ms).toISOString(),
    message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: 'fatto' }] },
  });
}

/** La cartella dei transcript come la scrive Claude Code: sessione, e i sotto-agenti tutti allo stesso livello. */
function cartellaDeiTranscript() {
  const base = cartellaTemporanea('giro5-rapporto-figli-');
  const progetto = join(base, 'progetto');
  mkdirSync(progetto, { recursive: true });
  const dir = join(base, 'config', 'projects', slugProgetto(progetto));
  const sub = join(dir, SESSIONE, 'subagents');
  mkdirSync(sub, { recursive: true });
  const t0 = Date.parse('2026-09-16T10:00:00.000Z');
  // L'orchestratore: un turno, poi aspetta il worker.
  writeFileSync(join(dir, `${SESSIONE}.jsonl`),
    turno({ ms: t0, id: 'o1', usage: { input_tokens: 100, output_tokens: 10 }, tools: [{ id: 'tA', name: 'Agent' }] }));
  // Il worker: un turno, lancia un sotto-agente suo, poi riceve il risultato e chiude.
  writeFileSync(join(sub, 'agent-worker00000000.jsonl'),
    turno({ ms: t0 + 60_000, id: 'w1', agentId: 'worker00000000', usage: { input_tokens: 1000, output_tokens: 100 }, tools: [{ id: 'tB', name: 'Agent' }] })
    + risultato({ ms: t0 + 120_000, agentId: 'worker00000000', toolId: 'tB' })
    + turno({ ms: t0 + 130_000, id: 'w2', agentId: 'worker00000000', usage: { input_tokens: 1000, output_tokens: 100 } }));
  // Il figlio del worker: 1.000.000 di token di input, cioè 5 $ a tariffa opus. Fratello del worker, non figlio nella cartella.
  writeFileSync(join(sub, 'agent-figlio0000000.jsonl'),
    turno({ ms: t0 + 70_000, id: 'f1', agentId: 'figlio0000000', usage: { input_tokens: 1_000_000, output_tokens: 1000 } })
    + turno({ ms: t0 + 110_000, id: 'f2', agentId: 'figlio0000000', usage: { input_tokens: 1000, output_tokens: 10 } }));
  return { base, progetto, configDir: join(base, 'config'), worker: join(sub, 'agent-worker00000000.jsonl') };
}

test.describe('rapporto di fine sessione — i sotto-agenti del worker', () => {
  test('il rapporto che il rilascio del worker allega comprende i sotto-agenti lanciati dal worker', async () => {
    test.fail(true, 'giro 5: i figli di un sotto-agente stanno accanto a lui, non sotto; il rapporto cerca <worker>/subagents/ e non li trova');
    const c = cartellaDeiTranscript();
    // Come al rilascio: nessun transcript esplicito, si prende il più recente (il worker).
    const rep = await generaRapporto({ cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.notes.join(' ')).toContain('sotto-agente della sessione');
    // Il worker ha lanciato un sotto-agente…
    expect(rep.subagents).toBe(1);
    // …e il rapporto lo ha letto e sommato: i 5 $ del figlio stanno nel costo.
    expect(rep.subagentRuns).toBe(1);
    expect(rep.costUsd).toBeGreaterThan(5);
  });

  test('lo stesso col transcript indicato a mano (--transcript, FILO_TRANSCRIPT)', async () => {
    test.fail(true, 'giro 5: stessa porta, altra strada');
    const c = cartellaDeiTranscript();
    const rep = await generaRapporto({ transcript: c.worker, cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.subagents).toBe(1);
    expect(rep.subagentRuns).toBe(1);
    expect(rep.costUsd).toBeGreaterThan(5);
  });

  test('il rapporto dell\'orchestratore, invece, li somma tutti (la porta del giro 1 resta chiusa)', async () => {
    const c = cartellaDeiTranscript();
    const rep = await generaRapporto({ transcript: join(c.configDir, 'projects', slugProgetto(c.progetto), `${SESSIONE}.jsonl`), cwd: c.progetto, configDir: c.configDir, env: {} });
    expect(rep.subagentRuns).toBe(2);
    expect(rep.costUsd).toBeGreaterThan(5);
  });
});
