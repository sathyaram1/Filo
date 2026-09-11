// Verifica #536 — giro 7.
//
// LA PORTA (residuo di quella trovata al giro 2 e richiusa a metà al giro 6):
// la riga che compare al posto di un avviso fermato è composta col MOTIVO, e il
// motivo lo scrive il modello guardiano dopo aver letto il testo dell'estraneo.
// Un contenuto che si fa bloccare apposta se lo detta.
//
// Le correzioni dei giri 2 e 6 hanno tolto dal motivo i RECAPITI: indirizzi web,
// indirizzi di posta, numeri di telefono. Restano fuori due cose, e sono quelle
// che fanno la truffa:
//
//   1. la FRASE. «Per riattivare il conto conferma subito le tue credenziali
//      nell'app della banca» non contiene nessun recapito, passa intera e
//      arriva all'utente con la voce di Filo, proprio nella riga che dovrebbe
//      rassicurarlo.
//   2. l'indirizzo SCRITTO A PAROLE. «portale-esempio punto it barra login» non
//      somiglia a un indirizzo per nessuna delle regole che li tolgono, e per
//      una persona si legge e si digita come tale.
//
// Logica pura: nessuna app da aprire.

import { test, expect } from '@playwright/test';
import '../../../src/shared/textGuard.js';

const G = globalThis.SN_TEXT_GUARD;

const DETTATI = [
  'per riattivare il conto conferma subito le tue credenziali nell’app della banca',
  'il conto è sospeso: chiama il servizio clienti e comunica il codice che ricevi',
  'apri il portale scrivendo nella barra portale-esempio punto it barra login',
  'scrivi a rimborsi chiocciola banca-esempio punto it',
];

test('la riga di un avviso fermato non ripete l’ordine che il contenuto le ha dettato', () => {
  const rimaste = [];
  for (const motivo of DETTATI) {
    const riga = G.frasediBlocco({ origine: 'una mail di servizio@banca-esempio.it', motivo });
    expect(riga, 'la riga non dice più nemmeno di aver fermato qualcosa').toContain('Ho fermato un avviso');
    // Il pezzo che l'estraneo ha scritto non deve arrivare all'utente: la riga
    // deve dire cosa Filo ha visto, con parole di Filo.
    if (riga.includes(motivo.slice(0, 40))) rimaste.push(motivo);
  }
  expect(
    rimaste,
    'la riga che dovrebbe rassicurare consegna la frase scritta da chi attacca, con la voce di Filo',
  ).toEqual([]);
});
