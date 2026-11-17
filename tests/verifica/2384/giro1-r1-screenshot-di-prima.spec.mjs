// #2384 giro 1 — il criterio «Oggetti e tipi» chiede di confrontare lo screenshot di prima con quello di dopo:
// chi verifica non cambia ramo e non guarda il diff, quindi il criterio deve dirgli da dove prende quello di prima.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CRITERI = fileURLToPath(new URL('../../../routines/roles/_criteri-verifica.md', import.meta.url));

test('r1 il criterio sugli oggetti dice come si ottiene lo screenshot di prima, su main', () => {
  const t = readFileSync(CRITERI, 'utf8').replace(/\r\n/g, '\n');
  const i = t.indexOf('**Oggetti e tipi.**');
  expect(i, 'il criterio non c\'è').toBeGreaterThanOrEqual(0);
  const criterio = t.slice(i, t.indexOf('\n\n', i) > 0 ? t.indexOf('\n\n', i) : undefined);
  expect(criterio, 'lo screenshot di prima non ha una fonte: chi verifica non può cambiare ramo').toMatch(/\bmain\b/);
});
