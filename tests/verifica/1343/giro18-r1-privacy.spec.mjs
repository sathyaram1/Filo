// Verifica #1343 giro 18, rilievo 1: la pagina sulla privacy non nomina più le icone del tasto destro, che non ci sono più.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('r1 la pagina sulla privacy misura le icone della barra laterale, non quelle del tasto destro', () => {
  const testo = readFileSync(new URL('../../../transparency/privacy.md', import.meta.url), 'utf8');
  expect(testo).not.toMatch(/icone del tasto destro/);
});
