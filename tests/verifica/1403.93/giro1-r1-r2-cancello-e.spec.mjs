// #1403.93 giro 1: il codice di quello che si apre detto col refuso «e» dopo un complemento («del cancello di casa e
// 4829») non esce, come quello del telefono; e la «e» congiunzione dopo il cancello non toglie un numero che non è il codice.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 il codice del cancello o della porta col complemento e la «e» senza accento non arriva al modello', () => {
  // Il telefono lo regge già: «Il codice del mio telefono di casa e 4829».
  for (const t of ['Il codice del cancello di casa e 4829', 'Il codice della porta di casa e 4829',
    'Il codice del cancello del condominio e 4829', 'Il codice del cancello di sotto e 4829']) {
    expect(P.oscura(t), t).not.toContain('4829');
  }
});

test('r2 la «e» congiunzione dopo il cancello lascia il numero che segue', () => {
  for (const t of ['Ho cambiato il codice del cancello e 4829 persone lo sanno',
    'Il codice del cancello e 4829 sono due cose diverse']) {
    expect(P.oscura(t), t).toBe(t);
  }
});
