// Verifica #1403.14, giro 1: la password data in chat a chi la chiede in francese, tedesco o spagnolo si riconosce
// come in italiano, senza oscurare le parole che in italiano restano.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const T = require('../../../src/shared/riservatiNelTesto.js');
const C = require('../../../src/main/services/correttoreRiservati.js');

const partono = (sopra, campo) => JSON.stringify(C.richiestaSenzaRiservati({
  prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra, luogo: { conversazione: sopra }, contesto: { prima: sopra },
}));

for (const [domanda, chi] of [
  ['Marco: le mdp du wifi ?', 'Luc'],
  ["Marco: tu peux m'envoyer le mdp ?", 'Luc'],
  ['Marco: ¿me pasas la clave del wifi?', 'Luis'],
  ['Marco: wie ist der WLAN-Schlüssel?', 'Luca'],
  ['Marco: wie ist das Wlanpasswort?', 'Luca'],
  ['Marco: schick mir mal das Routerpasswort', 'Luca'],
]) {
  test(`r1 «${domanda}» e sotto «${chi}: Gatto2024»: la password si oscura nel testo`, () => {
    expect(T.trova(`${domanda}\n${chi}: Gatto2024`)).toContain('gatto2024');
  });
  test(`r1 «${domanda}» e nel campo «Gatto2024»: la password non parte`, () => {
    expect(partono(domanda, 'Gatto2024 ')).not.toContain('Gatto2024');
  });
}

test('r1 «me pasas el código del portal?» e sotto «4821»: il codice si oscura come «mi mandi il codice del portone?»', () => {
  expect(T.trova('Marco: mi mandi il codice del portone?\nLuca: 4821')).toContain('4821');
  expect(T.trova('Marco: me pasas el código del portal?\nLuis: 4821')).toContain('4821');
});

for (const domanda of [
  "Marco: le mot de passe du wifi s'il te plaît",
  'Marco: le mot de passe du wifi stp',
  'Marco: das WLAN-Passwort bitte',
  'Marco: la contraseña del wifi por favor',
]) {
  test(`r2 «${domanda}» senza punto di domanda, come «password del wifi per favore»: la risposta si oscura`, () => {
    expect(T.trova('Marco: password del wifi per favore\nLuca: Gatto2024')).toContain('gatto2024');
    expect(T.trova(`${domanda}\nLuc: Gatto2024`)).toContain('gatto2024');
  });
}

test('r3 una pagina italiana con «preciso» accanto alla password non perde il numero d\'ordine della riga dopo', () => {
  for (const testo of [
    'Preciso che la password del portale scade ogni 90 giorni\nOrdine ABCD5678 spedito',
    'Ti preciso una cosa sulla password del portale\nOrdine ABCD5678 spedito',
  ]) {
    expect(T.trova(testo, { sotto: true })).not.toContain('abcd5678');
    expect(T.trova(testo, { sotto: true })).not.toContain('ordine');
  }
});

test('r4 nella risposta francese restano «c\'est» e «mot de passe», come «è» e «la password» in italiano', () => {
  expect(T.trova('Marco: mi mandi la password?\nLuca: la password è Gatto2024')).toEqual(['gatto2024']);
  expect(T.trova("Marco: tu peux m'envoyer le mot de passe ?\nLuc: oui, c'est Gatto2024")).toEqual(['gatto2024']);
  expect(T.trova("Marco: tu peux m'envoyer le mot de passe ?\nLuc: le mot de passe est Gatto2024")).toEqual(['gatto2024']);
});
