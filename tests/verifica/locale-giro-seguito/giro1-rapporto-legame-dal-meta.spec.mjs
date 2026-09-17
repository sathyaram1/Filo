// Prove del giro 1 (verifica locale) sul lavoro «seguito del giro»,
// punto D: il rapporto di fine sessione lega figlio e lanciatore dal file
// `agent-<id>.meta.json` (parentAgentId), col tempo solo come ripiego
// dichiarato nel rapporto; la data della prima riga si cerca anche oltre i
// 64 KB; al rilascio senza transcript indicato si sceglie il transcript del
// lanciatore, non il figlio ancora vivo.
// Le prove del giro 6 (locale-giro-routine) coprono il figlio in sottofondo
// e il compito lungo CON il meta: qui si aprono le porte accanto — il nipote,
// il fratello di un altro lanciatore dentro la stessa finestra di tempo, il
// figlio senza meta con la prima riga oltre i 64 KB, la risalita dal nipote.

import { test, expect } from '@playwright/test';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto, slugProgetto, trovaTranscript, primoTimestampMs } from '../../../scripts/session-report.mjs';

const SESSIONE = '77777777-1111-2222-3333-444444444444';

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

const UN_MILIONE = { input_tokens: 1_000_000, output_tokens: 1000 }; // 5 $ a tariffa opus

/**
 * La cartella dei transcript, com'è davvero sul disco:
 *   sessione (orchestratore)
 *   └ subagents/
 *       worker        (meta senza lanciatore)         ← il rapporto è il suo
 *       figlio        (meta → worker)                  sommato
 *       nipote        (meta → figlio)                  sommato
 *       cugino        (meta → altroWorker)             NON sommato, anche se comincia nella finestra
 *       altroWorker   (meta senza lanciatore)          NON sommato
 *       orfano        (SENZA meta, prima riga di 150 KB, dentro la finestra)   sommato dal tempo, dichiarato
 *       fuori         (SENZA meta, fuori dalla finestra)                        NON sommato
 */
function cartella({ nipoteAncoraVivo = false } = {}) {
  const base = cartellaTemporanea('giro1-rapporto-meta-');
  const progetto = join(base, 'progetto');
  mkdirSync(progetto, { recursive: true });
  const dir = join(base, 'config', 'projects', slugProgetto(progetto));
  const sub = join(dir, SESSIONE, 'subagents');
  mkdirSync(sub, { recursive: true });
  const t0 = Date.parse('2026-09-17T10:00:00.000Z');
  const file = (nome, testo, meta) => {
    const p = join(sub, `agent-${nome}.jsonl`);
    writeFileSync(p, testo);
    if (meta) writeFileSync(join(sub, `agent-${nome}.meta.json`), JSON.stringify(meta));
    return p;
  };
  writeFileSync(join(dir, `${SESSIONE}.jsonl`),
    turno({ ms: t0, id: 'o1', usage: { input_tokens: 100, output_tokens: 10 }, tools: [{ id: 'toolu_worker', name: 'Agent' }, { id: 'toolu_altro', name: 'Agent' }] }));
  const chiamata = t0 + 60_000; // il worker lancia il figlio
  const avviato = chiamata + 2_000;
  const fineWorker = chiamata + 400_000;
  const worker = file('worker0000000',
    compito({ ms: t0 + 1000, agentId: 'worker0000000', testo: 'compito del worker' })
    + turno({ ms: chiamata, id: 'w1', agentId: 'worker0000000', usage: { input_tokens: 1000, output_tokens: 100 }, tools: [{ id: 'toolu_figlio', name: 'Agent' }] })
    + risultato({ ms: avviato, agentId: 'worker0000000', toolId: 'toolu_figlio', testo: 'Async agent launched successfully.' })
    + turno({ ms: fineWorker, id: 'w2', agentId: 'worker0000000', usage: { input_tokens: 1000, output_tokens: 100 } }),
    { agentType: 'routine-worker', toolUseId: 'toolu_worker', spawnDepth: 1 });
  const figlio = file('figlio00000000',
    compito({ ms: chiamata + 1500, agentId: 'figlio00000000', testo: 'esplora' })
    + turno({ ms: chiamata + 5000, id: 'f1', agentId: 'figlio00000000', usage: { input_tokens: 500, output_tokens: 50 }, tools: [{ id: 'toolu_nipote', name: 'Agent' }] })
    + risultato({ ms: chiamata + 6000, agentId: 'figlio00000000', toolId: 'toolu_nipote', testo: 'Async agent launched successfully.' })
    + turno({ ms: chiamata + 10_000, id: 'f2', agentId: 'figlio00000000', usage: UN_MILIONE }),
    { agentType: 'Explore', toolUseId: 'toolu_figlio', parentAgentId: 'worker0000000', spawnDepth: 2 });
  const fineNipote = nipoteAncoraVivo ? fineWorker + 5_000 : chiamata + 20_000;
  const nipote = file('nipote00000000',
    compito({ ms: chiamata + 7000, agentId: 'nipote00000000', testo: 'esplora più a fondo' })
    + turno({ ms: fineNipote, id: 'n1', agentId: 'nipote00000000', usage: UN_MILIONE }),
    { agentType: 'Explore', toolUseId: 'toolu_nipote', parentAgentId: 'figlio00000000', spawnDepth: 3 });
  file('altrowork00000',
    compito({ ms: t0 + 1200, agentId: 'altrowork00000', testo: 'compito di un altro worker' })
    + turno({ ms: chiamata + 3000, id: 'a1', agentId: 'altrowork00000', usage: UN_MILIONE, tools: [{ id: 'toolu_cugino', name: 'Agent' }] }),
    { agentType: 'routine-worker', toolUseId: 'toolu_altro', spawnDepth: 1 });
  // Il cugino comincia DENTRO la finestra del worker (fra la sua chiamata Agent e il risultato): il tempo lo scambierebbe per un figlio.
  file('cugino00000000',
    compito({ ms: chiamata + 1000, agentId: 'cugino00000000', testo: 'compito del cugino' })
    + turno({ ms: chiamata + 4000, id: 'c1', agentId: 'cugino00000000', usage: UN_MILIONE }),
    { agentType: 'Explore', toolUseId: 'toolu_cugino', parentAgentId: 'altrowork00000', spawnDepth: 2 });
  // L'orfano: nessun meta, e la prima riga è un compito da 150 KB col timestamp in coda.
  const orfano = file('orfano00000000',
    compito({ ms: chiamata + 1200, agentId: 'orfano00000000', testo: 'x'.repeat(150 * 1024) })
    + turno({ ms: chiamata + 8000, id: 'r1', agentId: 'orfano00000000', usage: UN_MILIONE }),
    null);
  file('fuori000000000',
    compito({ ms: t0 + 5000, agentId: 'fuori000000000', testo: 'comincia prima della chiamata' })
    + turno({ ms: t0 + 9000, id: 'u1', agentId: 'fuori000000000', usage: UN_MILIONE }),
    null);
  // Le date di modifica: il nipote è l'ultimo scritto (se ancora vivo), poi il figlio, poi il worker.
  // Tutte le date di modifica si fissano a mano: il disco le metterebbe a «adesso», tutte uguali.
  const tocca = (p, ms) => utimesSync(p, new Date(ms), new Date(ms));
  tocca(join(dir, `${SESSIONE}.jsonl`), t0);
  for (const n of ['altrowork00000', 'cugino00000000', 'orfano00000000', 'fuori000000000']) tocca(join(sub, `agent-${n}.jsonl`), chiamata + 30_000);
  tocca(worker, fineWorker);
  tocca(figlio, fineWorker + 1000);
  tocca(nipote, fineWorker + (nipoteAncoraVivo ? 5000 : -1000));
  return { progetto, configDir: join(base, 'config'), worker, figlio, nipote, orfano, sub };
}

test.describe('rapporto di fine sessione — il legame dal meta, il tempo come ripiego dichiarato', () => {
  test('nel rapporto del worker entrano figlio, nipote e l\'orfano senza meta dentro la finestra; non il cugino di un altro lanciatore né chi è fuori', async () => {
    const c = cartella();
    const rep = await generaRapporto({ transcript: c.worker, cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    // Le chiamate Agent si sommano come tutto il resto: quella del worker e quella del figlio (il nipote).
    expect(rep.subagents).toBe(2);
    expect(rep.subagentRuns).toBe(3);
    // Tre milioni di token in ingresso a tariffa opus: 15 $, più le briciole del worker e del figlio.
    expect(rep.costUsd).toBeGreaterThan(15);
    expect(rep.costUsd).toBeLessThan(16);
    // Il ripiego dal tempo si dichiara, e nomina chi ha legato.
    const note = rep.notes.filter((n) => /senza meta/.test(n));
    expect(note).toHaveLength(1);
    expect(note[0]).toMatch(/orfano00000000/);
    expect(note[0]).toMatch(/tempo/);
    // Chi ha il meta non passa per il ripiego: nessuna nota su figlio, nipote, cugino.
    expect(rep.notes.join('\n')).not.toMatch(/figlio00000000|nipote00000000|cugino00000000|fuori000000000/);
  });

  test('la data della prima riga si legge anche quando la riga supera i 64 KB', () => {
    const c = cartella();
    expect(primoTimestampMs(c.orfano)).toBe(Date.parse('2026-09-17T10:01:01.200Z'));
  });

  test('senza transcript indicato, col nipote ancora vivo (l\'ultimo scritto), si risale fino al worker', async () => {
    const c = cartella({ nipoteAncoraVivo: true });
    const t = trovaTranscript({ cwd: c.progetto, configDir: c.configDir, env: {} });
    expect(t.file).toBe(c.worker);
    const rep = await generaRapporto({ cwd: c.progetto, configDir: c.configDir, env: {}, role: 'resolver' });
    expect(rep.subagentRuns).toBe(3);
  });

  test('un figlio il cui meta punta a un lanciatore che non c\'è resta il transcript scelto (non si risale nel vuoto)', () => {
    const base = cartellaTemporanea('giro1-rapporto-meta-vuoto-');
    const progetto = join(base, 'progetto');
    mkdirSync(progetto, { recursive: true });
    const sub = join(base, 'config', 'projects', slugProgetto(progetto), SESSIONE, 'subagents');
    mkdirSync(sub, { recursive: true });
    const solo = join(sub, 'agent-solo0000000000.jsonl');
    writeFileSync(solo, turno({ ms: Date.now(), id: 's1', agentId: 'solo0000000000', usage: { input_tokens: 10, output_tokens: 1 } }));
    writeFileSync(join(sub, 'agent-solo0000000000.meta.json'), JSON.stringify({ parentAgentId: 'sparito000000' }));
    expect(trovaTranscript({ cwd: progetto, configDir: join(base, 'config'), env: {} }).file).toBe(solo);
  });
});
