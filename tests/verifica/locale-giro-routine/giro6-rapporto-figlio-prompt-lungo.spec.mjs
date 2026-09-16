// Prove del giro 6 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: il rapporto di fine sessione di un WORKER che delega, quando il
// compito consegnato al sotto-agente è lungo.
//
// Il giro 5 ha chiuso la porta dei figli del worker: Claude Code li scrive
// accanto a lui, e il rapporto li riconosce dal tempo, leggendo la data della
// prima riga del loro transcript. Quella prima riga è il PROMPT del figlio,
// scritto come una riga JSON sola, con la data IN CODA (verificato sui file
// veri di questa macchina il 16/09/2026: in un transcript di 1.715 byte la
// chiave della data sta al byte 1.434, dopo il testo del prompt). La lettura
// della data guarda solo i primi 64 KB del file: con un compito più lungo di
// così — un worker che incolla nel compito del sotto-agente il testo di un
// feedback con gli allegati, o la storia delle critiche dei giri prima — la
// data non entra nel buffer, il figlio non viene riconosciuto e il suo costo
// sparisce dal rapporto senza una nota. La prova costruisce quel caso.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto, slugProgetto } from '../../../scripts/session-report.mjs';

const SESSIONE = '66666666-2222-3333-4444-555555555555';

function riga(o) { return `${JSON.stringify(o)}\n`; }

/** Un turno dell'assistente, con eventuale tool_use. La data in coda, come nei file veri. */
function turno({ ms, id, agentId, usage, tools = [] }) {
  return riga({
    parentUuid: null, isSidechain: Boolean(agentId), agentId, type: 'assistant', sessionId: SESSIONE,
    message: { id, model: 'claude-opus-5', usage, content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: {} })) },
    timestamp: new Date(ms).toISOString(),
  });
}
function risultato({ ms, agentId, toolId }) {
  return riga({
    parentUuid: null, isSidechain: Boolean(agentId), agentId, type: 'user', sessionId: SESSIONE,
    message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: 'fatto' }] },
    timestamp: new Date(ms).toISOString(),
  });
}
/** La prima riga di un sotto-agente: il compito ricevuto, con la data dopo il testo. */
function compito({ ms, agentId, testo }) {
  return riga({
    parentUuid: null, isSidechain: true, agentId, type: 'user', sessionId: SESSIONE,
    message: { role: 'user', content: testo },
    timestamp: new Date(ms).toISOString(),
  });
}

function cartellaDeiTranscript(lunghezzaCompito) {
  const base = cartellaTemporanea('giro6-rapporto-prompt-');
  const progetto = join(base, 'progetto');
  mkdirSync(progetto, { recursive: true });
  const dir = join(base, 'config', 'projects', slugProgetto(progetto));
  const sub = join(dir, SESSIONE, 'subagents');
  mkdirSync(sub, { recursive: true });
  const t0 = Date.parse('2026-09-16T10:00:00.000Z');
  writeFileSync(join(dir, `${SESSIONE}.jsonl`),
    turno({ ms: t0, id: 'o1', usage: { input_tokens: 100, output_tokens: 10 }, tools: [{ id: 'tA', name: 'Agent' }] }));
  // Il worker: riceve il compito, lancia un sotto-agente, aspetta, chiude.
  writeFileSync(join(sub, 'agent-worker00000000.jsonl'),
    compito({ ms: t0 + 1000, agentId: 'worker00000000', testo: 'compito breve' })
    + turno({ ms: t0 + 60_000, id: 'w1', agentId: 'worker00000000', usage: { input_tokens: 1000, output_tokens: 100 }, tools: [{ id: 'tB', name: 'Agent' }] })
    + risultato({ ms: t0 + 120_000, agentId: 'worker00000000', toolId: 'tB' })
    + turno({ ms: t0 + 130_000, id: 'w2', agentId: 'worker00000000', usage: { input_tokens: 1000, output_tokens: 100 } }));
  // Il figlio: il compito che gli ha scritto il worker, poi 1.000.000 di token (5 $ a tariffa opus).
  writeFileSync(join(sub, 'agent-figlio0000000.jsonl'),
    compito({ ms: t0 + 60_500, agentId: 'figlio0000000', testo: 'x'.repeat(lunghezzaCompito) })
    + turno({ ms: t0 + 70_000, id: 'f1', agentId: 'figlio0000000', usage: { input_tokens: 1_000_000, output_tokens: 1000 } })
    + turno({ ms: t0 + 110_000, id: 'f2', agentId: 'figlio0000000', usage: { input_tokens: 1000, output_tokens: 10 } }));
  return { progetto, configDir: join(base, 'config'), worker: join(sub, 'agent-worker00000000.jsonl') };
}

test.describe('rapporto di fine sessione — il figlio del worker con un compito lungo', () => {
  test('con un compito di 10.000 caratteri il figlio entra nel rapporto del worker', async () => {
    const c = cartellaDeiTranscript(10_000);
    const rep = await generaRapporto({ transcript: c.worker, cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.subagents).toBe(1);
    expect(rep.subagentRuns).toBe(1);
    expect(rep.costUsd).toBeGreaterThan(5);
  });

  test('con un compito di 100.000 caratteri il figlio entra lo stesso: il suo costo non sparisce senza una nota', async () => {
    test.fail(true, 'giro 6: la data della prima riga si cerca nei primi 64 KB, e in un transcript vero sta DOPO il testo del compito; oltre quel tetto il figlio non viene riconosciuto e il rapporto non lo dice');
    const c = cartellaDeiTranscript(100_000);
    const rep = await generaRapporto({ transcript: c.worker, cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.subagents).toBe(1);
    // O il figlio è sommato, oppure il rapporto dice che uno dei sotto-agenti non è stato letto.
    const letto = rep.subagentRuns === 1 && rep.costUsd > 5;
    const dichiarato = rep.notes.some((n) => /sotto-agent/i.test(n) && /non (letto|trovato|riconosciut)/i.test(n));
    expect(letto || dichiarato).toBe(true);
  });
});
