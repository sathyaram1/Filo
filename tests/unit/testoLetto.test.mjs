// Quello che Filo ha LETTO, tenuto da parte per riconoscerlo se riparte dentro
// un indirizzo. Qui si guarda l'unica decisione che prende: da quale testo il
// freno anti-esfiltrazione si lascia fermare, e da quale no.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TL = require(join(ROOT, 'src', 'main', 'services', 'testoLetto.js'));

const SALDO = 'Saldo del conto corrente 12.482,50 euro';

test('quello che Filo ha letto da un sito non si tiene contro quel sito', () => {
  // Il titolo di un articolo sta anche dentro il suo indirizzo: riportarlo a
  // casa sua non è portare fuori niente, e la conferma era un falso allarme.
  TL.azzera();
  TL.ricorda(SALDO, 'https://banca.example/conto');
  assert.equal(TL.letto('https://banca.example/estratto').includes('12482'), false);
  assert.equal(TL.letto('https://www.banca.example/altro').includes('12482'), false);
});

test('ma verso un altro sito sì', () => {
  TL.azzera();
  TL.ricorda(SALDO, 'https://banca.example/conto');
  assert.equal(TL.letto('https://raccolta.example/c').includes('12482'), true);
  assert.equal(TL.letto('').includes('12482'), true);
});

test('un sito che somiglia a quello di partenza non è quello di partenza', () => {
  TL.azzera();
  TL.ricorda(SALDO, 'https://banca.example/conto');
  assert.equal(TL.letto('https://banca.example.raccolta.test/c').includes('12482'), true);
});

test('quello che non viene da un sito vale sempre', () => {
  TL.azzera();
  TL.ricorda('Estratto conto: giacenza media 1.234,56 euro');
  assert.equal(TL.letto('https://qualunque.example/x').includes('123456'), true);
});

test('il testo più vecchio esce quando il tetto è pieno', () => {
  TL.azzera();
  TL.ricorda('a'.repeat(TL.MAX_CHARS));
  TL.ricorda(SALDO);
  const dentro = TL.letto('');
  assert.ok(dentro.length <= TL.MAX_CHARS + SALDO.length);
  assert.equal(dentro.includes('12482'), true);
  TL.azzera();
});
