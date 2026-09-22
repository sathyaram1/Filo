// Un file dell'utente sta su QUESTO computer (#533, settimo giro di verifica).
// Un percorso di rete apre una connessione verso il nome che c'è dentro e su
// Windows ci manda le credenziali: il nome lo sceglie il modello, e dopo una
// lettura è la sua via d'uscita senza nemmeno un clic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DR = require('../../src/main/services/documentRead.js');

test('un percorso di rete non è un file di questo computer', () => {
  for (const p of [
    '\\\\segreto.example\\condivisione\\x.txt',
    '//segreto.example/condivisione/x.txt',
    '\\/segreto.example/x.txt',
    '  "\\\\segreto.example\\x.txt"  ',
  ]) {
    assert.equal(DR.percorsoDiRete(p), true, p);
  }
});

test('i percorsi normali passano', () => {
  for (const p of [
    '/home/utente/bolletta.pdf',
    'C:\\Users\\agenti AI\\bolletta.pdf',
    '~/Documenti/bolletta.pdf',
    '/',
    '',
    null,
  ]) {
    assert.equal(DR.percorsoDiRete(p), false, String(p));
  }
});

test('leggere un documento su un computer in rete viene rifiutato, e lo dice', async () => {
  const r = await DR.readDocument('\\\\segreto.example\\condivisione\\x.txt');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'rete');
  assert.match(r.detail, /rete/);
});
