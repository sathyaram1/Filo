// Verifica #1403.83, giro 1: il PIN annunciato dal verbo seguito dai due punti o dall'uguale («il pin è: 4821») esce
// verso un sito come segreto, come prima del ramo e come verso i modelli.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
const G = globalThis.SN_GUARDIANO_STATICO;

for (const frase of [
  'il pin è: 4821',
  'il pin del telefono è: 4821',
  'il pin del telefono é: 4821',
  'the pin for my phone is: 4821',
  'il pin del telefono sarà: 4821',
  'il pin del telefono é : 4821',
  'il pin del telefono è = 4821',
]) {
  test(`r1 «${frase}»: il 4821 in uscita verso un sito è un segreto`, () => {
    expect(G.segretiInUscita(frase).map((x) => x.valore)).toContain('4821');
  });
}
