// Prove del giro 6 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: il rapporto di fine sessione di un WORKER che delega IN SOTTOFONDO.
//
// Dal giro 5 il rapporto riconosce i figli di un sotto-agente dal tempo: un
// figlio è chi comincia fra la chiamata Agent del worker e il suo risultato.
// Per un sotto-agente lanciato in sottofondo — oggi il modo di serie con cui
// l'harness lancia i sotto-agenti — quel risultato è la riga «avviato», che
// arriva SUBITO: misurato sui 37 nipoti veri di questa macchina (16/09/2026),
// la prima riga del figlio cade da 1,3 a 2,6 secondi dopo la chiamata, e il
// risultato immediato la segue di 137 millisecondi nel caso più stretto.
// Basta che l'ordine si inverta — un contenitore più lento, un compito più
// lungo da scrivere — perché il figlio cominci un attimo DOPO la chiusura
// della finestra, e il suo costo esca dal rapporto senza una nota. Eppure
// accanto a ogni transcript c'è `agent-<id>.meta.json`, con `parentAgentId`
// e `toolUseId`: il legame diretto, senza gare di orologi (guardato sui file
// veri di questa macchina). Le due prove costruiscono la cartella com'è
// davvero, col meta.json, e chiedono il rapporto del worker.
//
// La terza prova riguarda QUALE transcript il rilascio prende quando non
// gliene indicano uno: il più recente di tutta la cartella. Se il worker
// rilascia mentre un suo figlio in sottofondo sta ancora lavorando, il più
// recente è il figlio, e il rapporto firmato col ruolo del worker è quello
// del figlio.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto, slugProgetto } from '../../../scripts/session-report.mjs';

const SESSIONE = '66666666-7777-3333-4444-555555555555';

function riga(o) { return `${JSON.stringify(o)}\n`; }
function turno({ ms, id, agentId, usage, tools = [] }) {
  return riga({
    parentUuid: null, isSidechain: Boolean(agentId), agentId, type: 'assistant', sessionId: SESSIONE,
    message: { id, model: 'claude-opus-5', usage, content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: {} })) },
    timestamp: new Date(ms).toISOString(),
  });
}
function risultato({ ms, agentId, toolId, testo = 'fatto' }) {
  return riga({
    parentUuid: null, isSidechain: Boolean(agentId), agentId, type: 'user', sessionId: SESSIONE,
    message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: testo }] },
    timestamp: new Date(ms).toISOString(),
  });
}
function compito({ ms, agentId, testo }) {
  return riga({
    parentUuid: null, isSidechain: true, agentId, type: 'user', sessionId: SESSIONE,
    message: { role: 'user', content: testo },
    timestamp: new Date(ms).toISOString(),
  });
}

/**
 * La cartella dei transcript: l'orchestratore, il worker, e un figlio del
 * worker lanciato in sottofondo. `ritardoFiglioMs` è quanto la prima riga
 * del figlio arriva DOPO la risposta immediata «avviato» dello strumento.
 */
function cartella({ ritardoFiglioMs, figlioAncoraVivo = false }) {
  const base = cartellaTemporanea('giro6-rapporto-sottofondo-');
  const progetto = join(base, 'progetto');
  mkdirSync(progetto, { recursive: true });
  const dir = join(base, 'config', 'projects', slugProgetto(progetto));
  const sub = join(dir, SESSIONE, 'subagents');
  mkdirSync(sub, { recursive: true });
  const t0 = Date.parse('2026-09-16T10:00:00.000Z');
  writeFileSync(join(dir, `${SESSIONE}.jsonl`),
    turno({ ms: t0, id: 'o1', usage: { input_tokens: 100, output_tokens: 10 }, tools: [{ id: 'toolu_worker', name: 'Agent' }] }));
  writeFileSync(join(sub, 'agent-worker00000000.meta.json'), JSON.stringify({ agentType: 'routine-worker', toolUseId: 'toolu_worker', spawnDepth: 1, requestShape: 'foreground' }));
  const chiamata = t0 + 60_000;
  const avviato = chiamata + 2_000; // la risposta immediata dello strumento
  const primaRigaFiglio = avviato + ritardoFiglioMs;
  const fineWorker = figlioAncoraVivo ? chiamata + 100_000 : chiamata + 400_000;
  writeFileSync(join(sub, 'agent-worker00000000.jsonl'),
    compito({ ms: t0 + 1000, agentId: 'worker00000000', testo: 'compito' })
    + turno({ ms: chiamata, id: 'w1', agentId: 'worker00000000', usage: { input_tokens: 1000, output_tokens: 100 }, tools: [{ id: 'toolu_figlio', name: 'Agent' }] })
    + risultato({ ms: avviato, agentId: 'worker00000000', toolId: 'toolu_figlio', testo: 'Async agent launched successfully.' })
    + turno({ ms: fineWorker, id: 'w2', agentId: 'worker00000000', usage: { input_tokens: 1000, output_tokens: 100 } }));
  writeFileSync(join(sub, 'agent-figlio0000000.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'toolu_figlio', parentAgentId: 'worker00000000', spawnDepth: 2, requestShape: 'background', model: 'opus' }));
  // Il figlio: 1.000.000 di token di input (5 $ a tariffa opus), poi chiude (o continua, se ancora vivo).
  writeFileSync(join(sub, 'agent-figlio0000000.jsonl'),
    compito({ ms: primaRigaFiglio, agentId: 'figlio0000000', testo: 'esplora' })
    + turno({ ms: primaRigaFiglio + 10_000, id: 'f1', agentId: 'figlio0000000', usage: { input_tokens: 1_000_000, output_tokens: 1000 } })
    + turno({ ms: (figlioAncoraVivo ? fineWorker + 1_000 : chiamata + 200_000), id: 'f2', agentId: 'figlio0000000', usage: { input_tokens: 1000, output_tokens: 10 } }));
  return { progetto, configDir: join(base, 'config'), worker: join(sub, 'agent-worker00000000.jsonl') };
}

test.describe('rapporto di fine sessione — il figlio lanciato in sottofondo', () => {
  test('figlio che comincia PRIMA della risposta immediata (l\'ordine di oggi): sommato', async () => {
    const c = cartella({ ritardoFiglioMs: -300 });
    const rep = await generaRapporto({ transcript: c.worker, cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.subagents).toBe(1);
    expect(rep.subagentRuns).toBe(1);
    expect(rep.costUsd).toBeGreaterThan(5);
  });

  test('figlio che comincia mezzo secondo DOPO la risposta immediata: sommato lo stesso, o almeno dichiarato', async () => {
    test.fail(true, 'giro 6: la finestra si chiude alla risposta immediata «avviato», e un figlio che comincia dopo non viene riconosciuto; il meta.json accanto porta parentAgentId e toolUseId e non viene letto');
    const c = cartella({ ritardoFiglioMs: 500 });
    const rep = await generaRapporto({ transcript: c.worker, cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.subagents).toBe(1);
    const letto = rep.subagentRuns === 1 && rep.costUsd > 5;
    const dichiarato = rep.notes.some((n) => /sotto-agent/i.test(n) && /non (letto|trovato|riconosciut)/i.test(n));
    expect(letto || dichiarato).toBe(true);
  });

  test('il worker rilascia mentre il figlio in sottofondo lavora ancora: il rapporto senza transcript indicato è quello del worker, non del figlio', async () => {
    test.fail(true, 'giro 6: senza un transcript indicato si prende il più recente di tutta la cartella, e un figlio ancora vivo è più recente del worker che rilascia');
    const c = cartella({ ritardoFiglioMs: -300, figlioAncoraVivo: true });
    const rep = await generaRapporto({ cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    // Il rapporto del worker: due turni suoi più i due del figlio, con la chiamata Agent contata.
    expect(rep.subagents).toBe(1);
    expect(rep.subagentRuns).toBe(1);
  });
});
