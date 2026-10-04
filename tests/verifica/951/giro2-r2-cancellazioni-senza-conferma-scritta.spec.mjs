// Verifica #951, giro 2, rilievo 2: il documento sulla sicurezza dice che ogni cancellazione chiede di scrivere
// «conferma», ma cancellare le pagine visitate dalla chat (senza ritorno) chiede solo un OK.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

test('se cancellare le pagine visitate chiede solo un OK, il documento sulla sicurezza lo dice', () => {
  const livelli = leggi('src/shared/actionLevels.js');
  const soloOk = /CANCELLA_PAGINE:\s*\{\s*level:\s*2\b/.test(livelli);
  test.skip(!soloOk, 'cancellare le pagine visitate non è più di livello 2');
  const sicurezza = leggi('transparency/security.md').replace(/\s+/g, ' ');
  expect(sicurezza).toMatch(/pagine visitate|cronologia/);
});
