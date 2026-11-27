// #2678.9 giro 1: un avverbio qualunque fra il verbo e il valore non deve far passare PIN e password verso i modelli,
// non solo quelli di un elenco chiuso («il pin è ormai 4821», «the pin is probably 4821»).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 un avverbio fuori dall\'elenco fra il verbo e il valore non fa passare il segreto', () => {
  for (const [frase, segreto] of [
    ['il pin è ormai 4821', '4821'],
    ['il pin è solo 4821', '4821'],
    ['il pin è quindi 4821', '4821'],
    ['il pin è probabilmente 4821', '4821'],
    ['la password è purtroppo casa1234', 'casa1234'],
    ['la password è sicuramente casa1234', 'casa1234'],
    ['la password è praticamente casa1234', 'casa1234'],
    ['the pin is probably 4821', '4821'],
    ['the password is definitely casa1234', 'casa1234'],
    ['il pin è sempre e comunque 4821', '4821'],
  ]) {
    expect(P.oscura(frase), frase).not.toContain(segreto);
  }
});

test('r1 le frasi che parlano del PIN senza dirlo restano intere', () => {
  for (const frase of ['il pin è probabilmente sbagliato', 'la password è solo di 8 caratteri', 'il pin è ormai scaduto']) {
    expect(P.oscura(frase), frase).toBe(frase);
  }
});
