// #1403.14 giro 2 — le parole aggiunte per le richieste in altre lingue («da», «preciso da») sono anche italiane: una
// nota come «password da cambiare» non chiede niente, e il codice d'ordine sotto deve arrivare intero al modello.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

test('r1 una nota italiana con «da» non fa del codice sotto una password, nella pagina', () => {
  for (const t of [
    'Promemoria: password da cambiare\nOrdine ABCD5678 spedito',
    'Attenzione, password da aggiornare\nCodice cliente AB12345',
    'Elenco attività: password da cambiare\nRiferimento PRJ-2291 in corso',
    'Preciso da subito che la password del portale scade ogni 90 giorni\nOrdine ABCD5678 spedito',
  ]) {
    expect(P.oscura(t), t).toBe(t);
  }
});

test('r1 nel campo sotto la nota le parole qualunque restano', () => {
  const fuori = R.richiestaSenzaRiservati({ prima: '', nuovo: 'Ordine 48213 spedito', dopo: '', sopra: 'Avviso, codice da inserire' });
  expect(fuori.nuovo).toBe('Ordine 48213 spedito');
  const nota = R.richiestaSenzaRiservati({ prima: '', nuovo: 'Ordine spedito ieri', dopo: '', sopra: 'Promemoria: password da cambiare' });
  expect(nota.nuovo).toBe('Ordine spedito ieri');
});

test('r1 la richiesta straniera con «da» resta riconosciuta', () => {
  const t = 'Ana: preciso da senha\nLuc: Gatto2024';
  expect(P.oscura(t)).not.toContain('Gatto2024');
});
