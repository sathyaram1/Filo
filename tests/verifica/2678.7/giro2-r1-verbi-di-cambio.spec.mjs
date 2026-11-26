// Verifica #2678.7 giro 2: una password introdotta da un verbo di cambio al presente o all'imperativo («cambia la
// password in», «imposta la password a»), o da un verbo di cambio fuori elenco («settata a», «è passata a», «con»),
// arriva al modello in chiaro. Logica pura: niente Filo aperto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
const V = 'Mela!Verde77';

test('r1 la password dopo un verbo di cambio in ogni tempo non arriva al modello', () => {
  const frasi = [
    `cambia la password in ${V}`, `cambio la password in ${V}`, `imposta la password a ${V}`,
    `la password la cambio in ${V}`, `la password l'ho messa ${V}`, `ho cambiato la password con ${V}`,
    `la password è passata a ${V}`, `la password è stata settata a ${V}`, `ho settato la password a ${V}`,
    `ho resettato la password a ${V}`, `password reset to ${V}`, `la password è stata cambiata e ora è ${V}`,
  ];
  const inChiaro = frasi.filter((f) => P.oscura(f).includes(V));
  expect(inChiaro).toEqual([]);
});

test('r1 le frasi senza password restano intere', () => {
  for (const f of [
    'cambia la password in fretta', 'imposta la password a mano', 'la password è passata a tutti',
    'ho resettato la password ieri', 'cambio la password in settimana',
  ]) expect(P.oscura(f), f).toBe(f);
});
