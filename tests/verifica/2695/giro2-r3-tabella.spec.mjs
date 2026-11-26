// #2695 giro 2: una riga di tabella che descrive la password (scadenza, lunghezza, come recuperarla) arriva intera ai
// modelli, come la stessa riga fuori dalla tabella; la password vera nella cella resta fuori.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r3 una riga di tabella che descrive la password arriva intera ai due cancelli', () => {
  const rotte = [];
  for (const riga of [
    '| Scadenza password: | 90 giorni |',
    '| Lunghezza password: | 12 caratteri |',
    '| Password: | da cambiare ogni 90 giorni |',
    '| Password: | scade ogni 90 giorni |',
    '| Password: | vedi sotto |',
    '| Recupero password: | via email |',
    '| Password dimenticata: | clicca il link |',
  ]) {
    if (P.oscura(riga) !== riga) rotte.push(`pavimento: ${riga} -> ${P.oscura(riga)}`);
    if (alCorrettore(riga) !== riga) rotte.push(`correttore: ${riga} -> ${alCorrettore(riga)}`);
  }
  expect(rotte).toEqual([]);
  expect(P.oscura('| Password: | Nyckel!2024 |')).not.toContain('Nyckel!2024');
});
