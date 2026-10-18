// Verifica #428, giro 1, rilievo 2: la riga delle novità non promette che, lasciata la fila, le
// schede si allarghino e riempiano lo spazio libero: con poche schede si stringono e restano a sinistra.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOTE = fileURLToPath(new URL('../../../src/shared/patchNotes.js', import.meta.url));

test('la novità sulle schede che restano larghe non promette che poi si allarghino', () => {
  const riga = readFileSync(NOTE, 'utf8').split('\n').find((r) => /Quando chiudi una scheda col mouse/.test(r));
  expect(riga, 'la riga delle novità del #428 esiste').toBeTruthy();
  expect(riga).not.toMatch(/si allargano|riempiono lo spazio/);
});
