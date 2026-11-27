// Verifica #1403.67, giro 2: la password detta in una frase non arriva al modello, qualunque ponte la leghi al suo nome.
// Si prova il pavimento che il cancello dei modelli applica a ogni testo in uscita; asserisce che il valore non c'è più.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
require('../../../src/shared/riservatiNelTesto.js');
const P = require('../../../src/shared/pavimento.js');

const porte = [
  ['scelta dopo il cambio', 'ho cambiato la password e ho scelto «Mela! Verde77»', 'Mela! Verde77'],
  ['gerundio', 'ho cambiato la password scegliendo «Mela! Verde77»', 'Mela! Verde77'],
  ['uso al presente', 'ho rifatto la password: adesso uso «Mela! Verde77»', 'Mela! Verde77'],
  ['inciso prima del valore', 'ho cambiato la password, che adesso è più lunga: «Mela! Verde77»', 'Mela! Verde77'],
  ['inciso lungo prima di «è»', 'la password, quella nuova che mi hai chiesto ieri sera al telefono, è «Mela! Verde77»', 'Mela! Verde77'],
  ['frase lunga', "Ho cambiato la password stamattina dopo aver letto l'articolo sulla sicurezza, alla fine ho scelto «Mela! Verde77»", 'Mela! Verde77'],
  ['a capo dopo il punto', 'Ho cambiato la password.\nOra è «Mela! Verde77»', 'Mela! Verde77'],
  ['a capo dopo il punto esclamativo', 'Ho cambiato la password!\nOra è «Mela! Verde77»', 'Mela! Verde77'],
  ['seconda password con «e poi in»', 'ho cambiato la password in «Gatto1!» e poi in «Pera? Gialla88»', 'Pera? Gialla88'],
  ['seconda password con «, poi in»', 'ho cambiato la password in «Gatto1!», poi in «Pera? Gialla88»', 'Pera? Gialla88'],
  ['in inglese con «as»', "I set the password as 'Mela! Verde77'", 'Mela! Verde77'],
  ['«ho impostato»', 'come password ho impostato «Mela! Verde77»', 'Mela! Verde77'],
  ['«ho inserito»', 'come password ho inserito «Mela! Verde77»', 'Mela! Verde77'],
  ['francese da una all\'altra', "j'ai changé le mot de passe de «Gatto1!» en «Mela! Verde77»", 'Mela! Verde77'],
  ['spagnolo da una all\'altra', 'he cambiado la contraseña de «Gatto1!» a «Mela! Verde77»', 'Mela! Verde77'],
  ['senza virgolette dopo la domanda', 'Nuova password? Mela!Verde77', 'Mela!Verde77'],
  ['senza virgolette con «messa»', "la password l'ho messa Mela!Verde77", 'Mela!Verde77'],
  ['senza virgolette con «ho messo»', 'come password ho messo Mela!Verde77', 'Mela!Verde77'],
  ['senza virgolette con «ho usato»', 'per la password ho usato Mela!Verde77', 'Mela!Verde77'],
  ['senza virgolette dopo «Qual è»', 'Qual è la password? Mela!Verde77', 'Mela!Verde77'],
];

for (const [nome, frase, valore] of porte) {
  test(`r1 ${nome}: il valore non arriva al modello`, () => {
    const fuori = P.oscuraTutto(frase);
    expect(fuori, frase).not.toContain(valore);
    expect(fuori).toContain(P.SEGNAPOSTO);
  });
}
