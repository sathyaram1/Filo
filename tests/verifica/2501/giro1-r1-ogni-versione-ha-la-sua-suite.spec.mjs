// Giro 1 di #2501, rilievo 1: il segno «stabile» va solo alla versione costruita da un commit su cui la suite ha girato
// verde, ma la suite gira su circa metà delle fusioni (le altre si raccolgono nella corsa dopo): senza una corsa della
// suite sul commit di ogni versione pubblicata, il segno arriva per caso.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('r1 una versione pubblicata da un commit saltato dalla suite riceve comunque la sua corsa della suite', () => {
  const suite = leggi('.github/workflows/suite.yml');
  const release = leggi('.github/workflows/release.yml');
  const inizio = suite.split(/^jobs:/m)[0];
  const allaPubblicazione = /^\s{2}release:/m.test(inizio) || /^\s{4}tags:/m.test(inizio);
  const chiestaDallaPubblicazione = /gh\s+workflow\s+run\s+["']?suite\.yml|workflows\/suite\.yml\/dispatches/.test(release);
  expect(allaPubblicazione || chiestaDallaPubblicazione,
    'nessuna corsa della suite parte sul commit di una versione appena pubblicata: se quel commit era stato saltato, la versione non si segna mai stabile').toBe(true);
});
