// Esplorazione del giro 1 di #2695.4: ogni caso dice se il segreto arriva al cancello. Si cancella prima del verdetto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

const CASI = [
  ['C', 'la password scade, la nuova è gattonero', 'gattonero'],
  ['C', 'la password scade, e la nuova è gattonero', 'gattonero'],
  ['C', 'la password scade, ma la nuova è gattonero', 'gattonero'],
  ['C', 'la password scade, comunque la nuova è gattonero', 'gattonero'],
  ['C', 'la password scade, quindi adesso è gattonero', 'gattonero'],
  ['C', 'la password è cambiata, è gattonero', 'gattonero'],
  ['C', 'the password changed, now it\'s gattonero', 'gattonero'],
  ['C', 'my password expired, use gattonero instead', 'gattonero'],
  ['C', 'la password scade, la prossima è gattonero', 'gattonero'],
  ['C', 'la password è scaduta, rimettila a gattonero', 'gattonero'],
  ['C', 'la password scade, te la mando: gattonero', 'gattonero'],
  ['C', 'la password del wifi non va più, quella nuova te la scrivo qui: gattonero', 'gattonero'],
  ['C', 'la password è sbagliata, prova gattonero oppure micio77', 'micio77'],
  ['C', 'le mot de passe a expiré, le nouveau est gattonero', 'gattonero'],
  ['C', 'la password su whatsapp, comunque è gattonero', 'gattonero'],
  ['C', 'la pasword scade, la nuova è gattonero', 'gattonero'],
  ['C', 'la pasword è gattonero', 'gattonero'],
  ['P', 'la password scade, e la nuova è Gatto!Nero77', 'Gatto!Nero77'],
  ['C', 'la password scade, e la nuova è Gatto!Nero77', 'Gatto!Nero77'],
  ['P', 'la password scade, ma la nuova è Gatto!Nero77', 'Gatto!Nero77'],
  ['P', 'la password scade, la nuova è Gatto!Nero77', 'Gatto!Nero77'],
  ['P', 'la password è sbagliata, prova Gatto!Nero77', 'Gatto!Nero77'],
  ['P', 'il pin è cambiato, adesso 4821', '4821'],
  ['P', 'il pin è 4821', '4821'],
  ['P', 'la password è cambiata, è Gatto!Nero77', 'Gatto!Nero77'],
  ['P', 'the password changed, now it\'s Gatto!Nero77', 'Gatto!Nero77'],
];

for (const [g, t, s] of CASI) {
  test(`${g} ${t}`, () => {
    const fuori = g === 'C' ? alCorrettore(t) : P.oscura(t);
    expect(fuori).not.toContain(s);
  });
}

for (const t of ['the password expired, new one coming', 'password changed, now working', 'the password is wrong, try harder',
  'password cambiata ieri, adesso dimmi', 'la password è sbagliata, prova Marco']) {
  test(`FP ${t}`, () => { expect(alCorrettore(t)).toBe(t); });
}

for (const [n, t] of [['spazi virgola', 'password,' + ' '.repeat(8000) + 'adesso gattonero'], ['spazi senza virgola', 'password' + ' '.repeat(8000) + 'x']]) {
  test(`T ${n}`, () => {
    let a = Date.now();
    alCorrettore(t);
    const c = Date.now() - a; a = Date.now();
    P.oscura(t);
    const p = Date.now() - a;
    expect({ c: c < 1000, p: p < 1000, c_ms: c, p_ms: p }).toMatchObject({ c: true, p: true });
  });
}
