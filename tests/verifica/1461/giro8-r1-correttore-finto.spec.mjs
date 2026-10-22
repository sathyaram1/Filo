// Giro 8, rilievo 1: dopo l'incontro con main il controllo rapido del correttore ha un'altra forma (regole nel
// messaggio di sistema, testo fra <testo_nuovo>), e il finto della prova dei contatori non la riconosce più.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const leggi = (f) => readFileSync(path.join(radice, f), 'utf8');

test('r1 il finto della prova dei contatori riconosce il controllo rapido come lo scrive il correttore', () => {
  const costanti = leggi('src/shared/constants.js');
  const prova = leggi('tests/contatori-anonimi.spec.mjs');
  for (const segno of ['Sei il controllo rapido di un correttore', 'TESTO NUOVO:']) {
    if (prova.includes(segno)) expect(costanti, `la prova cerca «${segno}», che il correttore non scrive più`).toContain(segno);
  }
});
