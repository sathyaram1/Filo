// Prova del giro 1 su #2179: un numero di più cifre fra tonde o graffe è testo in qualunque punto
// della riga del riassunto, anche in testa o dopo un segno di elenco. Non apre Filo: legge la critica
// con lo stesso lettore che usa la registrazione.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/verifierRound.js');
const R = globalThis.SN_VERIFIER_ROUND;

test('r1 un numero di più cifre fra tonde vicino all\'inizio della riga passa come a metà riga', () => {
  const critiche = [
    'Provato: il conteggio torna. Visto (2865) chiuso. Nessun rilievo.',
    'Visto (2865) chiuso, nessun rilievo.',
    'Provato:\n(2865) è il feedback del conteggio, regge.\nNessun rilievo.',
    'Provato:\n- (2865) il conteggio regge\n- tema scuro regge',
    'Provato:\n(10) volte la stessa azione, regge.',
    'Provato:\n{2179} chiuso.',
  ];
  for (const c of critiche) {
    expect(R.testoRilieviNonRiconosciuti(c), c).toBe('');
  }
});
