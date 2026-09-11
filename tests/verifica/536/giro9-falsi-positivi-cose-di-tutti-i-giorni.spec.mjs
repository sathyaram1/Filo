// Verifica #536 — giro 9.
//
// LA PORTA (settima comparsa della stessa famiglia: giri 2, 4, 5, 6, 7 e 8).
// L'elenco delle cose innocue che salvano un codice è scritto a mano, e ogni
// giro ne trova un'altra che manca. Restano fuori cose di tutti i giorni:
// telepass, posteggio, preventivo, distributore, lavanderia. Lì basta che la
// frase dica anche di passare il codice a qualcuno — che è il motivo per cui
// quel codice esiste — perché la risposta sparisca.
//
// Logica pura: nessuna app da aprire.

import { test, expect } from '@playwright/test';
import '../../../src/shared/textGuard.js';

const G = globalThis.SN_TEXT_GUARD;

const INNOCUE = [
  'Il codice del telepass è 4821, comunicalo al casello',
  'Il codice del posteggio è 3390, comunicalo a chi viene a prenderti',
  'Il codice del preventivo è 4409, inoltralo al geometra',
  'Il codice del distributore è 7788, comunicalo al benzinaio',
  'Il codice della lavanderia è 8823, comunicalo a mia madre',
];

test('le cose di tutti i giorni non devono far sparire la risposta', () => {
  const fermate = [];
  for (const frase of INNOCUE) {
    const r = G.controlliStatici({ testo: frase });
    if (r.blocca) fermate.push(`${frase}  →  ${r.motivo}`);
  }
  expect(
    fermate,
    'frasi innocue fermate dal controllo automatico: la risposta sparisce e l’utente deve andarla a ripescare in Preferenze',
  ).toEqual([]);
});
