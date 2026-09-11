// Verifica #536 — giro 7.
//
// LA PORTA (residuo della famiglia chiusa ai giri 2, 4 e 5): il codice di casa,
// quando la frase dice anche di passarlo a qualcuno.
//
// Il giro 5 ha insegnato al controllo che «il codice di accesso all'appartamento»
// non è una credenziale, e quella metà funziona: la cosa fisica viene
// riconosciuta quando sta DOPO la funzione del codice («codice di accesso al
// portone»). L'altra forma — quella più corta e più comune — è rimasta fuori:
// «il codice DEL portone», «il codice DEL citofono», «la password DEL wifi». Lì
// la cosa fisica sta attaccata a «codice», dove l'elenco dei qualificatori
// innocui conosce sconti, ordini e prenotazioni ma non portoni, cancelli,
// citofoni, biciclette e wifi. Basta allora un verbo qualunque di quelli che
// chiedono di passare il codice — e in una mail di casa c'è quasi sempre, perché
// il codice di casa serve proprio a darlo a qualcun altro — perché la risposta
// sparisca.
//
// Logica pura: nessuna app da aprire.

import { test, expect } from '@playwright/test';
import '../../../src/shared/textGuard.js';

const G = globalThis.SN_TEXT_GUARD;

const INNOCUE = [
  'Il codice del portone è 4821, comunicalo anche a chi arriva con te',
  'Ti lascio il codice 3390 del cancello: passalo pure a tua sorella',
  'Il codice 7788 della cassetta delle chiavi: comunicalo all’idraulico',
  'Il codice 2210 del citofono, comunicalo al corriere',
  'Il codice 4409 della bici, dimmelo appena la prendi',
  'Il wifi di casa: rete CasaMare, digita la password OSPITI24',
  'Per collegarti al wifi digita la password OSPITI24',
];

test('la mail di casa non deve far sparire la risposta', () => {
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
