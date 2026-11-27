// #1403.89 giro 2: il codice del proprio telefono detto con un verbo di cambio, in un altro ordine o col nome della marca
// esce da un'azione senza chiedere.
import { test, expect } from '@playwright/test';
import { segretoCercando } from './aiuto-uscita.mjs';

const CASI = [
  'Ho cambiato il codice del telefono in 4829',
  'Il codice del mio telefono è diventato 4829',
  'Il codice del mio telefono è cambiato in 4829',
  'Il codice che uso sul telefono è 4829',
  'Sul telefono uso il codice 4829',
  'Per il mio telefono il codice è 4829',
  'Il codice del mio Samsung è 4829',
];

for (const testo of CASI) {
  test(`r1 ${testo}`, () => {
    expect(segretoCercando(testo), `«${testo}» esce senza chiedere`).not.toBe('');
  });
}
