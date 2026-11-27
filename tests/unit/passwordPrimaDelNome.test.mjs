// #2695.8 — la password detta prima del suo nome («gattonero è la password», «usa Gatto2024 come password») non arriva
// in chiaro ai modelli: il correttore la toglie come dopo il nome, il pavimento quando ha cifre, simboli o virgolette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';

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
    'the problem is the password', 'non so se questa è la password', 'funziona anche come password',
    'mai usare la data di nascita come password', 'gattonero è il nome del gatto']) {
    assert.equal(P.oscura(frase), frase, `pavimento: ${frase}`);
    assert.equal(alCorrettore(frase), frase, `correttore: ${frase}`);
  }
});

// Giro 1 della verifica: la punteggiatura attaccata, le forme che dopo il nome valgono già (lingue, «pass», «e» senza
// accento, l'elenco condiviso degli annunci coi modali) e le frasi qualunque che finiscono con «è la password».
test('con la punteggiatura attaccata e nelle forme valide dopo il nome la password non passa', () => {
  for (const frase of ['Gatto2024! è la password', 'usa Gatto2024! come password', 'Gatto2024! è la mia password',
    'Gatto2024!! è la password', 'Gatto2024? è la password', 'Gatto2024, è la password',
    'Gatto2024 ist das Passwort', 'Gatto2024 est le mot de passe', 'Gatto2024 es la contraseña',
    'benutze Gatto2024 als Passwort', 'usa Gatto2024 como contraseña', 'usa Gatto2024 come pass',
    'Gatto2024 e la password', 'Gatto2024 sarebbe la password', 'Gatto2024 dovrebbe essere la password',
    'Gatto2024 remains the password', 'ciao\nGatto2024 è la password']) {
    const pav = P.oscura(frase);
    assert.ok(!pav.includes('Gatto2024') && pav.includes(S), `pavimento: ${frase} -> ${pav}`);
    const cor = alCorrettore(frase);
    assert.ok(!cor.includes('Gatto2024') && cor.includes(S), `correttore: ${frase} -> ${cor}`);
  }
  assert.equal(P.oscura('Gatto2024! è la password'), `${S} è la password`, 'il «!» va via con la password');
  assert.ok(!alCorrettore('gattonero sarebbe la password').includes('gattonero'));
});

test('una frase qualunque che finisce con «è la password» resta intera, anche con un segno o un nome corto', () => {
  for (const frase of ['la cosa che mi manca è la password', "l'unica cosa che non ricordo è la password",
    'quello che ho dimenticato è la password', 'la cosa più importante è la password', 'gattonero e la password',
    "l'utente e la password", 'dopo il 2024, è la password che non va', 'Grazie! è la password che cercavo',
    'il pass per la partita è 2024', 'usa il pass come password', 'Gatto2024 è il password managers']) {
    assert.equal(P.oscura(frase), frase, `pavimento: ${frase}`);
    assert.ok(!alCorrettore(frase).startsWith(S) && !alCorrettore(frase).includes(`${S} è`), `correttore: ${frase} -> ${alCorrettore(frase)}`);
  }
  for (const frase of ['la cosa che mi manca è la password', 'quello che ho dimenticato è la password']) {
    assert.equal(alCorrettore(frase), frase, frase);
  }
});

test('di sole lettere e senza virgolette il pavimento la lascia, come dopo il nome', () => {
  // Il pavimento non toglie una parola qualunque: «la password è gattonero» passa, e così l'ordine inverso.
  assert.equal(P.oscura('la password è gattonero'), 'la password è gattonero');
  assert.equal(P.oscura('gattonero è la password'), 'gattonero è la password');
});

test('un testo lungo che ripete il nome della password si legge in fretta', () => {
  const RT = globalThis.SN_RISERVATI_TESTO;
  assert.ok(!alCorrettore('gattonero è la password '.repeat(200)).includes('gattonero'));
  // Misurata sulla macchina di chi l'ha scritta: circa 2 unità per 120.000 caratteri; il tetto ne lascia dieci volte tanto.
  let k = 0;
  const c = costoInUnita(() => RT.primaDelNome(`${'gattonero è la password '.repeat(5000)}${k++}`), { tetto: 20 });
  assert.ok(c.unita <= 20, `${c.unita.toFixed(1)} unità`);
});
