// Verifica locale «prezzi Opus 5.5», giro 2, rilievo 1: un turno in modalità
// veloce (usage.speed = "fast") costa il doppio; il rapporto deve contarlo o
// almeno dirlo, non prezzarlo in silenzio a tariffa normale.

import { test, expect } from '@playwright/test';
import { analizzaRighe } from '../../../scripts/session-report.mjs';

const M = 1_000_000;
function riga(model, speed) {
  return JSON.stringify({
    type: 'assistant', timestamp: '2026-09-29T10:00:00.000Z', sessionId: 'sess-veloce',
    message: { id: 'v1', model, usage: {
      input_tokens: M, cache_creation_input_tokens: 2 * M,
      cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M },
      cache_read_input_tokens: M, output_tokens: M, speed } },
  });
}
async function rapporto(r) {
  async function* gen() { yield r; }
  return analizzaRighe(gen(), {});
}

test('Opus 5.5 in modalità veloce: costo raddoppiato o nota nel rapporto', async () => {
  const normale = await rapporto(riga('claude-opus-5-5', 'standard'));
  const veloce = await rapporto(riga('claude-opus-5-5', 'fast'));
  const contato = veloce.costUsd > normale.costUsd * 1.5;
  const detto = veloce.notes.some((n) => /veloc|fast/i.test(n));
  expect(contato || detto, `costo veloce ${veloce.costUsd} contro normale ${normale.costUsd}, note: ${veloce.notes.join(' | ') || 'nessuna'}`).toBe(true);
});
