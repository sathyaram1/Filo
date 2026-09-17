// Prove del giro 4 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: il costo nel rapporto di fine sessione. Nei transcript veri di
// questa macchina un messaggio su cinque porta una scrittura in cache a UN'ORA
// (`usage.cache_creation.ephemeral_1h_input_tokens`), che costa il doppio del
// prezzo base, non 1,25 volte come quella a cinque minuti. Il rapporto somma
// tutto in `cache_creation_input_tokens` e lo prezza a 1,25: su sei sessioni
// vere lette il 16/09/2026 il costo esce più basso del 18-39%.

import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { analizzaRighe, PREZZI } = await import(`file://${ROOT.replace(/\\/g, '/')}/scripts/session-report.mjs`);

function turno(id, usage) {
  return JSON.stringify({
    type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 'sess-1h',
    message: { id, model: 'claude-opus-5', usage, content: [{ type: 'text', text: 'x' }] },
  });
}

test.describe('rapporto di fine sessione — la cache a un\'ora costa il doppio, non 1,25', () => {
  test('una scrittura in cache a un\'ora è prezzata a 2× l\'input (come dice Anthropic), non a 1,25×', async () => {
    const righe = [turno('m1', {
      input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 100000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100000 },
    })];
    const rep = await analizzaRighe(righe);
    // Opus: input 5 $/M → scrittura a un'ora 10 $/M → 100.000 token = 1,00 $.
    expect(PREZZI.opus.input).toBe(5);
    expect(rep.costUsd).toBeCloseTo(1.0, 3);
  });

  test('con cinque minuti e un\'ora insieme il costo è la somma delle due tariffe', async () => {
    const righe = [turno('m1', {
      input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 200000,
      cache_creation: { ephemeral_5m_input_tokens: 100000, ephemeral_1h_input_tokens: 100000 },
    })];
    const rep = await analizzaRighe(righe);
    // 100.000 × 6,25 $/M + 100.000 × 10 $/M = 0,625 + 1,00 = 1,625 $.
    expect(rep.costUsd).toBeCloseTo(1.625, 3);
  });

  test('senza il dettaglio per durata (transcript vecchio) resta la tariffa a cinque minuti', async () => {
    const righe = [turno('m1', {
      input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 100000,
    })];
    const rep = await analizzaRighe(righe);
    expect(rep.costUsd).toBeCloseTo(0.625, 3);
  });
});
