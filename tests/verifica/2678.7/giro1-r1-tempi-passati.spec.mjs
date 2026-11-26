// Verifica #2678.7 giro 1: una password introdotta da un verbo al passato o composto («è diventata», «è stata cambiata
// in», «ho cambiato la password in», «was changed to») arriva al modello in chiaro. Logica pura: niente Filo aperto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
const V = 'Mela!Verde77';

test('r1 la password introdotta da un verbo al passato o composto non arriva al modello', () => {
  const frasi = [
    `la password è diventata ${V}`, `la password è rimasta ${V}`, `la password è stata ${V}`,
    `la password è sempre stata ${V}`, `la password era stata ${V}`, `la password è cambiata in ${V}`,
    `la password è stata cambiata in ${V}`, `la password è stata impostata a ${V}`, `la password diventò ${V}`,
    `la password è di nuovo ${V}`, `ho cambiato la password in ${V}`, `ho impostato la password a ${V}`,
    `la password è diventata «${V}»`,
    `the password has been ${V}`, `the password has become ${V}`, `the password became ${V}`,
    `the password remained ${V}`, `the password will become ${V}`, `the password was changed to ${V}`,
    `the password was set to ${V}`, `password changed to ${V}`, `the password was changed to "${V}"`,
  ];
  const inChiaro = frasi.filter((f) => P.oscura(f).includes(V));
  expect(inChiaro).toEqual([]);
});

test('r1 le frasi senza password restano intere', () => {
  for (const f of [
    'la password è diventata obsoleta', 'la password è stata cambiata ieri', 'ho cambiato la password in fretta',
    'the password was changed yesterday', 'the password has become too old', 'la password è rimasta la stessa',
  ]) expect(P.oscura(f), f).toBe(f);
});
