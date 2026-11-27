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
