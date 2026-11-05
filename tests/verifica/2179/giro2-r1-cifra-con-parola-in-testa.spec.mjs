// Prova del giro 2 su #2179: una tonda con una cifra e una parola («(3 su 3)», «(2 volte)») è testo
// a metà riga, e deve esserlo anche in testa alla riga o dopo una parola corta. Non apre Filo: legge
// la critica con lo stesso lettore che usa la registrazione.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/verifierRound.js');
const R = globalThis.SN_VERIFIER_ROUND;

test('r1 una cifra con una parola fra tonde vicino all\'inizio della riga passa come a metà riga', () => {
  // A metà riga passano già: sono il metro.
  expect(R.testoRilieviNonRiconosciuti('Provato: le prove (3 su 3) verdi. Nessun rilievo.')).toBe('');
  expect(R.testoRilieviNonRiconosciuti('Provato il giro (2 volte), regge. Nessun rilievo.')).toBe('');
  const critiche = [
    'Visto (3 su 3) prove verdi. Nessun rilievo.',
    'Ok: (2 volte) lo stesso giro, regge. Nessun rilievo.',
    'Provato:\n(2 volte) la stessa azione, regge.\nNessun rilievo.',
    'Provato:\n- (3 su 3) prove verdi\n- tema scuro regge',
  ];
  for (const c of critiche) {
    expect(R.testoRilieviNonRiconosciuti(c), c).toBe('');
  }
});
