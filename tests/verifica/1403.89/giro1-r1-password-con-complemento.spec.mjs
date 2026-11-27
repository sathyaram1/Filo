// #1403.89 giro 1: i segreti che il pavimento toglie ai modelli ma che un'azione di Filo manda a un sito senza chiedere.
import { test, expect } from '@playwright/test';
import { segretoCercando } from './aiuto-uscita.mjs';

const CASI = [
  'La password del mio telefono è 4829',
  'La password di sblocco del mio telefono è 4829',
  'The password for my phone is 4829',
  'La password del mio computer è Ciao2024',
  'La password della mia mail è Ciao2024',
  'La password del wifi è Casa2024!',
  'Il CVV della mia carta è 123',
  'Il codice di sicurezza della carta è 123',
];

for (const testo of CASI) {
  test(`r1 ${testo}`, () => {
    expect(segretoCercando(testo), `«${testo}» esce senza chiedere`).not.toBe('');
  });
}
