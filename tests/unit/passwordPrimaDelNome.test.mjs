// #2695.8 — la password detta prima del suo nome («gattonero è la password», «usa Gatto2024 come password») non arriva
// in chiaro ai modelli: il correttore la toglie come dopo il nome, il pavimento quando ha cifre, simboli o virgolette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const R = require('../../src/main/services/correttoreRiservati.js');
const S = P.SEGNAPOSTO;
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('la password di sole lettere detta prima del nome non arriva al modello del correttore', () => {
  for (const frase of ['usa gattonero come password', 'gattonero è la password', 'gattonero è la password del wifi',
    'metti gattonero come password del wifi', 'gattonero is the password', 'use gattonero as password',
    'gattonero è la pw', 'gattonero è la pass del wifi', 'penso che gattonero sia la password',
    'gattonero ora è la nuova password', 'usa pure gattonero come password', 'Marco: gattonero è la password',
    'GATTONERO È LA PASSWORD', 'ho messo gattonero come password', 'gattonero era la vecchia password',
    'imposta gattonero come password del router', 'gattonero è la mia password']) {
    const fuori = alCorrettore(frase);
    assert.ok(!/gattonero/i.test(fuori) && fuori.includes(S), `${frase} -> ${fuori}`);
  }
});

test('con cifre, simboli o virgolette prima del nome il valore non passa da nessuno dei due cancelli', () => {
  for (const [frase, v] of [['Gatto2024 è la password', 'Gatto2024'], ['usa Gatto2024 come password', 'Gatto2024'],
    ['Mela!Verde77 è la password del wifi', 'Mela!Verde77'], ['«gattonero» è la password', 'gattonero'],
    ['"gattonero" è la password', 'gattonero'], ['use Nyckel!2024 as the password', 'Nyckel!2024'],
    ['metti “gattonero” come password', 'gattonero']]) {
    const pav = P.oscura(frase);
    assert.ok(!pav.includes(v) && pav.includes(S), `pavimento: ${frase} -> ${pav}`);
    const cor = alCorrettore(frase);
    assert.ok(!cor.includes(v) && cor.includes(S), `correttore: ${frase} -> ${cor}`);
  }
});

test('una frase che parla della password senza dirla arriva intera ai due cancelli', () => {
  for (const frase of ['il problema è la password', 'quello che serve è la password', 'questa è la password',
    'qual è la password', 'cosa è la password', 'la mia è la password più lunga', 'usa una frase lunga come password',
    'usa il nome del cane come password', 'il codice fiscale vale come password', 'Marco, è la password?',
    'ecco, è la password', "l'unica cosa che manca è la password", 'la cosa importante è la password',
    'davvero è la password?', 'sicuramente è la password', 'this is the password', 'what is the password',
    'the problem is the password', 'non so se questa è la password giusta', 'funziona anche come password',
    'la data di nascita come password è una pessima idea', 'gattonero è il nome del gatto']) {
    assert.equal(P.oscura(frase), frase, `pavimento: ${frase}`);
    assert.equal(alCorrettore(frase), frase, `correttore: ${frase}`);
  }
});

test('di sole lettere e senza virgolette il pavimento la lascia, come dopo il nome', () => {
  // Il pavimento non toglie una parola qualunque: «la password è gattonero» passa, e così l'ordine inverso.
  assert.equal(P.oscura('la password è gattonero'), 'la password è gattonero');
  assert.equal(P.oscura('gattonero è la password'), 'gattonero è la password');
});

test('un testo lungo che ripete il nome della password si legge in fretta', () => {
  const lungo = 'gattonero è la password '.repeat(5000);
  const t0 = Date.now();
  const fuori = alCorrettore(lungo);
  P.oscura(lungo);
  assert.ok(!fuori.includes('gattonero'));
  assert.ok(Date.now() - t0 < 8000, `${Date.now() - t0} ms`);
});
