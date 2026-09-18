// Giro di verifica locale del ramo claude/link-invito — giro 3.
//
// Il giro 1 ha provato tredici forme del link, tutte riconosciute. Qui si
// prova la forma in cui il link arriva davvero più spesso: non il link da
// solo, ma il MESSAGGIO intero, copiato con un dito da WhatsApp («tieni
// premuto → Copia» copia tutto il messaggio, non solo l'indirizzo). Il saluto
// davanti e il congedo dietro non devono far sparire il link.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

const CODICE = 'ABCDEFGH';

test('il messaggio intero copiato da una chat, col saluto davanti e il congedo dietro', () => {
  const messaggi = [
    'Ecco qua: https://filo.red/i/ABCDEFGH — scaricalo',
    'Dai apri https://filo.red/i/ABCDEFGH e fammi sapere',
    'ecco il link https://filo.red/i/ABCDEFGH grazie mille',
    'https://filo.red/i/ABCDEFGH valido fino al 30/09',
    'https://filo.red/i/ABCDEFGH\nScarica Filo e apri',
    '«https://filo.red/i/ABCDEFGH»',
    '(https://filo.red/i/ABCDEFGH)',
    'HTTPS://FILO.RED/I/ABCDEFGH',
    'https://filo.red/i/ABCDEFGH.',
    // Il saluto con un nome di quattro lettere davanti al link, e una parola
    // dietro: è un messaggio qualunque, e il link dentro è intero.
    'Ciao Anna, ecco: https://filo.red/i/ABCDEFGH fammi sapere',
    'Ciao Luca, ecco: https://filo.red/i/ABCDEFGH ci vediamo',
  ];
  for (const m of messaggi) {
    expect(W.codeFromInput(m), `messaggio non riconosciuto: ${JSON.stringify(m)}`).toBe(CODICE);
  }
});

test('un messaggio senza nessun link non diventa un codice per sbaglio', () => {
  for (const m of ['Ciao Anna, come stai?', 'Ecco qua il numero: 3331234567', 'buon giro a tutti']) {
    expect(W.codeFromInput(m), `accettato per sbaglio: ${JSON.stringify(m)}`).toBeNull();
  }
});
