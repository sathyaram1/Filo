// Verifica #906 giro 1, rilievo 2: nella carta dei giudici fermi l'ora d'inizio e il numero delle segnalazioni in attesa
// non si leggono come un numero solo («alle 20:00 118 segnalazioni»).
import { createRequire } from 'node:module';
import { test, expect } from '../../fixtures/electron.mjs';

const require = createRequire(import.meta.url);
const G = require('../../../src/main/services/giudiciFermi.js');

test('r2 fra l\'ora e il conto delle segnalazioni c\'è una pausa', () => {
  const t = G.testi({ causa: 'credit', da: '2026-09-28T20:00:00.000Z', ultimoErrore: '2026-09-28T21:00:00.000Z', inAttesa: 118 });
  expect(t.testo).toMatch(/118 segnalazioni aspettano/);
  expect(t.testo, 'due numeri attaccati: ora e conto si fondono').not.toMatch(/\d{2}:\d{2} \d+ segnalazioni/);
});
