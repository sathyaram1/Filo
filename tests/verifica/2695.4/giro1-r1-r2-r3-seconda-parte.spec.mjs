// #2695.4 giro 1: la password detta nella seconda parte della frase, dopo la virgola, non arriva ai modelli; le parole
// che non sono password arrivano intere al correttore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 con una congiunzione, un avverbio o un altro giro di parole nella seconda parte la password non arriva al correttore', () => {
  const passate = [];
  for (const frase of [
    'la password scade, e la nuova è gattonero',
    'la password scade, ma la nuova è gattonero',
    'la password scade, comunque la nuova è gattonero',
    'la password scade, quindi adesso è gattonero',
    'la password è cambiata, è gattonero',
    'la password scade, la prossima è gattonero',
    'la password è scaduta, rimettila a gattonero',
    'the password changed, now it\'s gattonero',
    'my password expired, use gattonero instead',
    'la password scade, te la mando: gattonero',
    'la password del wifi non va più, quella nuova te la scrivo qui: gattonero',
    'le mot de passe a expiré, le nouveau est gattonero',
    'la password su whatsapp, comunque è gattonero',
  ]) {
    const arriva = alCorrettore(frase);
    if (arriva.includes('gattonero')) passate.push(`${frase} -> ${arriva}`);
  }
  expect(passate).toEqual([]);
});

test('r1 con «e» o «ma» davanti una password con cifre e simboli non arriva a nessuno dei due cancelli', () => {
  const passate = [];
  for (const frase of ['la password scade, e la nuova è Gatto!Nero77', 'la password scade, ma la nuova è Gatto!Nero77']) {
    if (alCorrettore(frase).includes('Gatto!Nero77')) passate.push(`correttore: ${frase}`);
    if (P.oscura(frase).includes('Gatto!Nero77')) passate.push(`pavimento: ${frase}`);
  }
  expect(passate).toEqual([]);
});

test('r2 dopo «prova» due password in alternativa restano fuori tutte e due', () => {
  const arriva = alCorrettore('la password è sbagliata, prova gattonero oppure micio77');
  expect(arriva).not.toContain('gattonero');
  expect(arriva).not.toContain('micio77');
});

test('r3 una parola che non è una password, dopo «adesso», «now», «try» o «new one», arriva intera al correttore', () => {
  const rotte = [];
  for (const frase of [
    'password cambiata ieri, adesso dimmi',
    'password changed, now working',
    'the password is wrong, try harder',
    'the password expired, new one coming',
  ]) {
    const arriva = alCorrettore(frase);
    if (arriva !== frase) rotte.push(`${frase} -> ${arriva}`);
  }
  expect(rotte).toEqual([]);
  expect(alCorrettore('la password scade, la nuova è gattonero')).not.toContain('gattonero');
});
