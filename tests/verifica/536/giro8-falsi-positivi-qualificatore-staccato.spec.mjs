// Verifica #536 — giro 8.
//
// LA PORTA (residuo della famiglia chiusa ai giri 2, 4, 5, 6 e 7): l'elenco delle
// cose innocue che salvano un codice funziona solo quando la cosa sta ATTACCATA
// alla parola «codice», e solo per la parola «codice».
//
// Tre forme restano fuori, e sono tutte italiano normale:
//   1. la cosa sta prima nella frase invece che dopo il codice
//      («Per il reso serve il codice 4409, comunicalo al negozio»);
//   2. la cosa non è nell'elenco, anche se è fra le più comuni della posta di
//      chiunque («il codice del bonifico», «il codice del pacco»);
//   3. la stessa identica frase con «token» al posto di «codice» viene fermata,
//      e «pin» si salva col cancello ma non con l'ordine.
//
// Logica pura: nessuna app da aprire.

import { test, expect } from '@playwright/test';
import '../../../src/shared/textGuard.js';

const G = globalThis.SN_TEXT_GUARD;

const INNOCUE = [
  // la cosa sta prima del codice
  'Per il reso serve il codice 4409, comunicalo al negozio',
  'Per il cancello automatico usa il codice 7788 e comunicalo agli ospiti',
  // la cosa non è nell'elenco
  'Il codice del bonifico è 8823, inoltralo al commercialista',
  'Il codice del pacco è 483920, comunicalo al corriere',
  'Ti hanno mandato il codice 8823 del bonifico, inoltralo al commercialista',
  // la stessa frase con un'altra parola per «codice»
  'Il token del parcheggio è 7788, passalo a chi viene dopo',
  'Il token del cancello è 7788, comunicalo agli ospiti',
  'Il pin dell’ordine è 7712, comunicalo all’assistenza',
];

test('il qualificatore innocuo deve salvare la frase anche staccato, e per ogni parola di codice', () => {
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
