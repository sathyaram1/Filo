// Verifica #536 — giro 2.
//
// LA PORTA (residuo di quella chiusa al giro 1): la riga «ho fermato un avviso»
// non deve consegnare un indirizzo cliccabile scelto da chi attacca.
//
// Il motivo del blocco viene ripulito e gli indirizzi spariscono. Il MITTENTE
// no: resta scritto per intero, ed è giusto — è la cosa che serve sapere. Ma
// chi manda la mail sceglie il proprio indirizzo, e se lo fa cominciare per
// «www.» quello che resta nella riga è un dominio che la colonna degli avvisi
// trasforma in un collegamento vivo, dentro la riga che dovrebbe rassicurare.
//
// Qui si guarda la logica pura (nessuna app da aprire): la riga di blocco e i
// collegamenti che una superficie ci troverebbe dentro.

import { test, expect } from '@playwright/test';
import '../../../src/shared/textGuard.js';

const G = globalThis.SN_TEXT_GUARD;

test('il mittente di una mail non deve diventare un collegamento nella riga di blocco', () => {
  const riga = G.frasediBlocco({
    origine: 'Banca Esempio <avvisi@www.truffa-esempio.it>',
    motivo: 'chiedeva le credenziali del conto',
  });
  expect(riga).toContain('Ho fermato un avviso');
  expect(
    G.linkDelTesto(riga).map((l) => l.url),
    'la riga del blocco contiene un indirizzo che diventa cliccabile',
  ).toEqual([]);
});
