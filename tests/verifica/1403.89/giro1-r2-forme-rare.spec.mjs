// #1403.89 giro 1: il codice del proprio telefono detto in forme meno comuni esce da un'azione senza chiedere.
import { test, expect } from '@playwright/test';
import { segretoCercando } from './aiuto-uscita.mjs';

const CASI = [
  'Il codice del telefono mio è 4829',
  'Lo sblocco del mio telefono è 4829',
  'Il mio telefono si sblocca con 4829',
  'Il PUK del mio telefono è 12345678',
  'Il codice del mio telefno è 4829',
  'Il codice del mio telefono è 48 29',
];

for (const testo of CASI) {
  test(`r2 ${testo}`, () => {
    expect(segretoCercando(testo), `«${testo}» esce senza chiedere`).not.toBe('');
  });
}
