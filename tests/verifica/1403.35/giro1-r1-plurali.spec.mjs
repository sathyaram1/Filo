// Verifica #1403.35, giro 1: i nomi del PIN al plurale col verbo al plurale («Die Geheimzahlen sind 4829»).
// Il ramo ha messo i plurali fra i nomi, ma il verbo plurale non apre il valore: il PIN arriva al modello.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src', 'shared', 'urlExfil.js'));
const P = require(resolve(RADICE, 'src', 'shared', 'pavimento.js'));

const FRASI = [
  'Die Geheimzahlen sind 4829 und 1234',
  'Meine Geheimzahlen lauten 4829',
  'Die Geheimnummern sind 4829',
  'Les numéros secrets sont 4829',
  'Los números secretos son 4829',
];

for (const frase of FRASI) {
  test(`r1 ${frase}: il PIN non arriva al modello`, () => {
    const uscita = P.oscura(frase);
    expect(uscita).toContain(P.SEGNAPOSTO);
    expect(uscita).not.toContain('4829');
  });
}
