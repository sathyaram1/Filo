// Verifica #1115 giro 1, rilievo 2: il controllo delle date non segna una data che ha un'altra lettura giusta.
// Logica pura: si carica il modulo nel processo dei test, senza aprire Filo. Oggi = mercoledì 14 ottobre 2026.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/content/coerenza.js');
const C = globalThis.SN_COERENZA;
const OGGI = new Date(2026, 9, 14);
const segni = (testo) => C.dateDi(testo, OGGI).map((s) => s.segment);

test('r2 «lunedì 2/3 ore» è una quantità, non il 2 marzo', () => {
  expect(segni('lunedì 2/3 ore di lavoro e poi basta')).toEqual([]);
});

test('r2 «mercoledì 9 ottobre del 2024» ha l\'anno, ed era mercoledì', () => {
  expect(segni('era mercoledì 9 ottobre del 2024')).toEqual([]);
});

test('r2 «lunedì 2 marzo» detto in ottobre: il 2 marzo passato era lunedì, nel dubbio si tace', () => {
  expect(segni('ci siamo visti lunedì 2 marzo')).toEqual([]);
});

test('r2 il lapsus vero resta segnato', () => {
  expect(segni('ci vediamo mercoledì 9 ottobre')).toEqual(['mercoledì 9 ottobre']);
});
