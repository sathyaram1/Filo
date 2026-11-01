// Verifica #1959 giro 1: la priorità 2 la mette solo il manutentore; i testi che dicono ancora che i difetti rimasti
// nascono a priorità 2 (o «con la priorità uguale al livello») contraddicono la scala nuova.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(REPO, p), 'utf8').replace(/\s+/g, ' ');

test('r3 nessun testo fa nascere a priorità 2 i difetti rimasti', () => {
  expect(leggi('src/pages/manage/manage.html')).not.toMatch(/figli del lavoro, a priorità 2/);
  expect(leggi('routines/roles/_critica-e-livelli.md')).not.toMatch(/con la priorità uguale al livello/);
});
