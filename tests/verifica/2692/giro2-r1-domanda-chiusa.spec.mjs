// #2692 giro 2: una domanda sul PIN rimasta senza risposta non vale per i numeri dati dopo ad altre domande,
// come succede già con la password; il PIN dato davvero si toglie sempre.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');

test('r1 il numero dato a un\'altra domanda, dopo un PIN non dato, arriva al modello', () => {
  for (const [t, numero] of [
    ['Marco: qual è il pin della carta?\nLuc: te lo dico dopo\nMarco: quanto hai speso ieri?\nLuc: 1250', '1250'],
    ['Marco: qual è il pin della carta?\nLuc: non me lo ricordo\nAnna: quanti km hai fatto?\nLuc: 3200', '3200'],
    ['Marco: qual è il pin?\nLuc: dopo\nMarco: ok\nAnna: domani vieni?\nLuc: sì\nAnna: a che ora?\nLuc: 1830', '1830'],
    ['Marco: hai cambiato il pin?\nLuc: sì, ieri\nLuc: comunque arrivo alle 1830', '1830'],
  ]) {
    expect(P.oscura(t), t).toContain(numero);
  }
  expect(P.oscura('Marco: qual è il pin della carta?\nLuc: aspetta che controllo\nLuc: 4821')).not.toContain('4821');
});
