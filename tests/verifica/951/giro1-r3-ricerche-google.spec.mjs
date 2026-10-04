// Verifica #951, giro 1, rilievo 3: dal tasto destro Filo apre ricerche su Google (testo selezionato, immagine con
// Lens), ma l'elenco degli altri servizi nel documento sulla privacy cita Google solo per la barra degli indirizzi.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

test('le ricerche su Google dal tasto destro compaiono fra gli altri servizi', () => {
  const azioni = leggi('src/content/actions.js');
  const privacy = leggi('transparency/privacy.md');
  test.skip(!/lens\.google\.com/.test(azioni), 'il tasto destro non apre più Google Lens');
  expect(privacy).toMatch(/Lens/);
});
