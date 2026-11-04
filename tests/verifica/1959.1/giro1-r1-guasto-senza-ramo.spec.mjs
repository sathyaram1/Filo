// Giro 1 di #1959.1: chi smista una domanda o applica una risposta riceve, nello stesso testo, due promesse opposte
// su cosa succede dopo un guasto: «torna in coda da sé» nel suo ruolo, «resta fermo sul suo ramo finché il
// manutentore non lo sblocca» nel pezzo condiviso. Il testo composto è quello che arriva al worker.

import { test, expect } from '@playwright/test';
import { readRoleInstructions } from '../../../scripts/dispatch.mjs';

const piatto = (s) => s.replace(/\s+/g, ' ');

for (const ruolo of ['risposta', 'smistamento']) {
  test(`r1 il ruolo ${ruolo} dice una cosa sola su cosa succede dopo il guasto`, () => {
    const t = piatto(readRoleInstructions(ruolo, {}));
    const daSe = /torna in coda da sé/.test(t);
    const fermo = /resta fermo sul suo ramo finché il manutentore/.test(t);
    expect(daSe && fermo, `${ruolo}: «torna in coda da sé» e «resta fermo sul suo ramo finché il manutentore» nello stesso testo`).toBe(false);
  });
}
