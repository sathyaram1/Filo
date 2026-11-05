// Verifica #1202.2, giro 4: il racconto della pulizia prima del verdetto dice la regola del codice (decidono livello e segno).

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 il file di pattern della pulizia non fa dipendere la fermata dalla domanda', async () => {
  const testo = readFileSync(join(APP_ROOT, 'patterns', 'le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md'), 'utf8')
    .replace(/\s+/g, ' ');
  const { fermaDiSicuro } = await import('../../../scripts/lib/prove-tolte.mjs');
  // Il codice: un 2 col ?! ferma comunque, la domanda non conta.
  expect(fermaDiSicuro([{ level: 2, sede: 'i', decision: true, irreversibile: true, domanda: { blocca: false } }])).toBe(true);
  // Il racconto deve dire lo stesso.
  expect(testo).not.toMatch(/la cui domanda blocca/);
  expect(testo).not.toMatch(/"blocca": false` il lavoro va avanti/);
});
