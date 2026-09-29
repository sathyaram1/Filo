// Giro locale prezzi-opus55, giro 1, rilievo 1: un modello nuovo di una famiglia
// nota (il prossimo Opus, il prossimo Sonnet) viene prezzato in silenzio col
// listino di un modello vecchio, com'era successo a Opus 5.5 prezzato da Opus 5.
// L'owner che legge il rapporto deve almeno sapere che quel costo è una stima.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RAPPORTO = fileURLToPath(new URL('../../../scripts/session-report.mjs', import.meta.url));

function rapportoDi(dir, model) {
  const f = join(dir, `${model}.jsonl`);
  const riga = {
    type: 'assistant', timestamp: '2026-09-29T10:00:00.000Z', sessionId: 's1',
    message: {
      id: 'msg_1', model, role: 'assistant', content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 1000 },
    },
  };
  writeFileSync(f, `${JSON.stringify(riga)}\n`);
  return JSON.parse(execFileSync(process.execPath, [RAPPORTO, '--transcript', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

test('un modello che il listino non conosce per nome lo dice nel rapporto', () => {
  const dir = join(cartellaTemporanea(), `verifica-prezzi-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    for (const model of ['claude-opus-6', 'claude-sonnet-6']) {
      const rep = rapportoDi(dir, model);
      expect(rep.costUsd, `${model}: il rapporto ha un costo`).toBeGreaterThan(0);
      expect(rep.notes.some((n) => n.includes(model)), `${model}: nessuna nota dice che il costo è stimato da un altro listino`).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
