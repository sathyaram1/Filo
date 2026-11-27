// #1403.67 giro 1: la password nuova, o quella ricordata, detta con parole diverse da «è» non arriva al modello;
// una frase senza password arriva intera.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(`../../../src/shared/${m}.js`);
const P = globalThis.SN_PAVIMENTO;
const C = require('../../../src/main/services/correttoreRiservati.js');
const SEGRETI = /Mela|Verde77|Gatto1/;

test('r1 la password nuova detta con altri ponti fra il nome e il valore non arriva al modello', () => {
  const casi = [
    'ho cambiato la password da «Gatto1» a «Mela! Verde77»',
    'la password vecchia era «Gatto1», l\'ho cambiata in «Mela! Verde77»',
    'la vecchia password era «Gatto1» e la nuova è «Mela! Verde77»',
    'ho cambiato la password in «Mela! Verde77», la vecchia era «Gatto1»',
    'ho cambiato la password con «Mela! Verde77»',
    'ho sostituito la password con «Mela! Verde77»',
    'ho cambiato la password, ora è «Mela! Verde77»',
    'ho cambiato la password. Adesso è «Mela! Verde77»',
    'come password ho messo «Mela! Verde77»',
    'la password l\'ho messa «Mela! Verde77»',
    'Ti ricordi la password? «Mela! Verde77»',
    'Ricordi la password? Mi pare fosse «Mela! Verde77»',
    'Do you remember the password? It was "Mela! Verde77"',
    'j\'ai changé le mot de passe en «Mela! Verde77»',
    'he cambiado la contraseña a «Mela! Verde77»',
  ];
  const passano = casi.filter((t) => SEGRETI.test(P.oscura(t)) || SEGRETI.test(C.oscura(t)));
  expect(passano).toEqual([]);
});

test('r2 «Era ora!» dopo una domanda sulla password non è una password', () => {
  const t = 'Hai cambiato la password? Era ora! Ora te la dico, ora!';
  expect(P.oscura(t)).toBe(t);
});
