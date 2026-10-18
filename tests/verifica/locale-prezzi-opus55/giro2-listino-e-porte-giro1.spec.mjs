// Verifica locale «prezzi Opus 5.5», giro 2: il rapporto di fine sessione
// prezza Opus 5.5 a 4/20 (cache letta 0,20, scritta 5 e 8), gli altri modelli
// come prima, e un modello non riconosciuto per nome lascia la nota (porta del giro 1).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { analizzaRighe } from '../../../scripts/session-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'session-report.mjs');
const M = 1_000_000;

// Un milione di token per voce: input, scrittura a 5 minuti, a un'ora, lettura, output.
function riga(model, id, ts = '2026-09-29T10:00:00.000Z') {
  return {
    type: 'assistant', timestamp: ts, sessionId: 'sess-prezzi',
    message: { id, model, usage: {
      input_tokens: M, cache_creation_input_tokens: 2 * M,
      cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M },
      cache_read_input_tokens: M, output_tokens: M, speed: 'standard' } },
  };
}
async function rapporto(righe) {
  async function* gen() { for (const r of righe) yield JSON.stringify(r); }
  return analizzaRighe(gen(), {});
}

// Listino della skill claude-api, calcolato a mano: in + 1,25·in + 2·in + lettura + out.
const ATTESI = {
  'claude-opus-5-5': 37.2,
  'claude-opus-5-5[1m]': 37.2,
  'us.anthropic.claude-opus-5-5-v1:0': 37.2,
  'claude-opus-5-5@20261101': 37.2,
  'claude-opus-5': 46.75,
  'claude-opus-4-8': 46.75,
  'claude-opus-4-6': 46.75,
  'claude-sonnet-5': 18.7,
  'claude-sonnet-4-6': 28.05,
  'claude-haiku-4-5-20251001': 9.35,
  'claude-fable-5-1': 92.75,
  'claude-fable-5': 93.5,
};

test('ogni modello noto costa quanto dice il listino, Opus 5.5 compreso, e senza note', async () => {
  for (const [m, atteso] of Object.entries(ATTESI)) {
    const rep = await rapporto([riga(m, 'x1')]);
    expect(rep.costUsd, m).toBeCloseTo(atteso, 4);
    expect(rep.notes, m).toEqual([]);
  }
});

test('sessione vera su Opus 5.5 con un sotto-agente Haiku: lo script da riga di comando somma il conto giusto', async () => {
  const dir = cartellaTemporanea('prezzi-opus55-');
  const sess = join(dir, 'sess-prezzi.jsonl');
  writeFileSync(sess, [riga('claude-opus-5-5', 'a1'), riga('claude-opus-5-5', 'a2', '2026-09-29T10:01:00.000Z')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  mkdirSync(join(dir, 'sess-prezzi', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'sess-prezzi', 'subagents', 'agent-1.jsonl'), JSON.stringify(riga('claude-haiku-4-5', 'h1', '2026-09-29T10:00:30.000Z')) + '\n');
  const out = spawnSync(process.execPath, [SCRIPT, '--transcript', sess], { encoding: 'utf8', cwd: ROOT });
  expect(out.status).toBe(0);
  const rep = JSON.parse(out.stdout);
  expect(rep.costUsd).toBeCloseTo(2 * 37.2 + 9.35, 4);
  expect(rep.subagentCostUsd).toBeCloseTo(9.35, 4);
  expect(out.stderr).toContain('costo stimato: $83.7500');
});

test('porta del giro 1: il modello dopo di una famiglia nota esce con la nota, al costo di prima', async () => {
  const casi = {
    'claude-opus-6': [46.75, 'Opus 5'],
    'claude-sonnet-6': [18.7, 'Sonnet 5'],
    'claude-haiku-5': [9.35, 'Haiku 4.5'],
    'claude-fable-6': [92.75, 'Fable 5.1'],
  };
  for (const [m, [costo, tariffa]] of Object.entries(casi)) {
    const rep = await rapporto([riga(m, 'x1')]);
    expect(rep.costUsd, m).toBeCloseTo(costo, 4);
    expect(rep.notes.join(' | '), m).toContain(`«${m}»`);
    expect(rep.notes.join(' | '), m).toContain(tariffa);
  }
});
