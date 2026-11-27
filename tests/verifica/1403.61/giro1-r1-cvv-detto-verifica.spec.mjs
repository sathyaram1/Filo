// Verifica #1403.61, giro 1: il CVV chiamato col nome della verifica («Código de verificación», «Kod weryfikacyjny
// karty»…) arriva ancora intero al modello. Logica pura: non apre Filo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/pavimento.js');
const P = globalThis.SN_PAVIMENTO;

test('r1 il CVV col nome della verifica, in ogni lingua, non arriva al modello', () => {
  const casi = [
    'Código de verificación de la tarjeta: 123',
    'Código de verificación: 123',
    'Code de vérification de la carte : 123',
    'Código de verificação do cartão: 123',
    'Kod weryfikacyjny karty: 123',
    'Kartenverifizierungsnummer: 123',
    'Codice di verifica della carta: 123',
  ];
  const interi = casi.filter((c) => P.oscura(c).includes('123'));
  expect(interi).toEqual([]);
});
