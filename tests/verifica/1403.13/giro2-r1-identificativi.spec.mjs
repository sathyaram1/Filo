// #1403.13 giro 2: il numero di un pacco, di un biglietto o di una banca, annunciato da un verbo nelle altre lingue,
// arriva al modello intero, come «Il codice postale è 00950» in italiano.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 col possessivo o con un nome dopo «code» il numero resta', () => {
  for (const frase of [
    'Le code de mon colis est 482913',
    'Le code de mon billet est 482913',
    'Le code de mon dossier est 482913',
    'El código de mi paquete es 482913',
    'El código de mi vuelo es 482913',
    'Der Code meines Pakets ist 482913',
    'Der Code meiner Sendung ist 482913',
    'O código do meu pacote é 482913',
    'Kod mojej paczki to 482913',
    'Le code banque est 30004',
    'Le code guichet est 00828',
    'Le code commune est 75056',
    'Le code douanier est 85171300',
    'Le code NAF est 6201Z',
    'El código CNAE es 6201',
  ]) {
    expect(P.oscura(frase), frase).toBe(frase);
  }
});
