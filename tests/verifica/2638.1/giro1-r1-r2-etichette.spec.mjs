// #2638.1 giro 1: un'etichetta o un modo di dire sopra il campo non sono una richiesta della password, e la riga
// sotto (la data, il modello, l'orario, le parole scritte nel campo) arriva intera ai modelli.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/novita.js');
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const P = require('../../../src/shared/pavimento.js');
const alModello = (campo, sopra) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra }).nuovo;

test('r1 il nome della password dopo un titolo, un passo numerato o un trattino resta un\'etichetta', () => {
  for (const p of [
    'Impostazioni - Password\nUltima modifica il 12/03/2024',
    'Account Google - Password\nUltima modifica il 12/03/2024',
    'Passo 2: Password\nModello AX1800-Pro',
    'Configurazione guidata\n1. Rete\n2. Password del wifi\nModello AX1800-Pro',
  ]) expect(P.oscura(p), p).toBe(p);
  for (const sopra of ['Impostazioni - Password', 'Passo 2: Password', '1. Password']) {
    expect(alModello('ultima modifica', sopra), sopra).toBe('ultima modifica');
  }
});

test('r2 un modo di dire dopo il nome della password non fa una richiesta', () => {
  for (const sopra of ['Marco: password del cavolo', 'Marco: password di merda']) {
    expect(alModello('ci penso io domani mattina', sopra), sopra).toBe('ci penso io domani mattina');
    const pagina = `${sopra}\nIo: ci vediamo alle 18:30 al bar`;
    expect(P.oscura(pagina), pagina).toBe(pagina);
  }
});
