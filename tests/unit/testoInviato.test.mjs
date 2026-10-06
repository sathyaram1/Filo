// Sentinella del testo che una richiesta porta al sito (#824): le righe dell'utente si ritrovano
// in ogni forma in cui i siti le scrivono, e un testo che la richiesta non porta non c'è.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { testoDellaRichiesta, LIMITE_CORPO } = require('../../src/main/services/testoInviato.js');

const pulito = (s) => String(s).replace(/[\s​-‍⁠﻿]+/g, '');
const corpo = (s) => [{ bytes: Buffer.from(s, 'utf8') }];
const porta = (richiesta, riga) => testoDellaRichiesta(richiesta).includes(pulito(riga));

test('un modulo mandato come indirizzo o come corpo porta le righe scritte', () => {
  const r = { url: 'https://voli.example.it/api/cerca?da=milano&a=Parigi+Orly', uploadData: corpo('nome=Mario+Rossi&msg=Ciao%2C%20arrivo%0D%0Aalle%208&lang=C%2B%2B') };
  for (const riga of ['milano', 'Parigi Orly', 'Mario Rossi', 'Ciao, arrivo', 'alle 8', 'C++']) assert.ok(porta(r, riga), riga);
});

test('un corpo JSON porta il testo con gli a capo, gli accenti e le emoji scritti come codici', () => {
  const r = { url: 'https://social.example.com/graphql', uploadData: corpo(JSON.stringify({ q: 'x' }).slice(0, -1) + ',"testo":"Prima riga\\nSeconda \\u00e8 qui \\ud83d\\ude42 e C++"}') };
  assert.ok(porta(r, 'Prima riga'));
  assert.ok(porta(r, 'Seconda è qui 🙂 e C++'));
  assert.ok(porta(r, 'Prima riga\nSeconda è qui 🙂 e C++'), 'il testo intero, senza gli a capo');
});

test('un editor che manda HTML porta il testo delle righe e il testo intero', () => {
  const r = { url: 'https://posta.example.org/sync', uploadData: corpo(JSON.stringify({ corpo: '<div dir="ltr">Ciao &amp; grazie</div><div>a&nbsp;presto &#127881;</div>' })) };
  assert.ok(porta(r, 'Ciao & grazie'));
  assert.ok(porta(r, 'a presto 🎉'));
  assert.ok(porta(r, 'Ciao & grazie\na presto 🎉'));
});

test('il testo che la richiesta non porta non c’è', () => {
  const r = { url: 'https://negozio.example.it/carrello?id=42', uploadData: corpo('{"evento":"passo_2"}') };
  assert.equal(porta(r, 'Gentile ufficio, vorrei candidarmi'), false);
  assert.equal(testoDellaRichiesta({ url: 'non un indirizzo' }), '');
});

test('un corpo enorme si legge fino al limite: quello che c’è dentro conta, il resto no', () => {
  const inizio = 'Lettera in testa al corpo';
  const fondo = 'Riga oltre il limite';
  const r = { url: 'https://example.it/carica', uploadData: [{ bytes: Buffer.from(inizio) }, { bytes: Buffer.alloc(LIMITE_CORPO, 0x61) }, { bytes: Buffer.from(fondo) }, { file: '/tmp/foto.jpg' }] };
  assert.ok(porta(r, inizio));
  assert.equal(porta(r, fondo), false);
});

test('il testo uscito da una scheda arriva solo ai frame del sito che l’ha ricevuto', () => {
  const W = require('../../src/main/services/impostazioniPerOrigine.js');
  const arrivati = [];
  const frame = (url) => ({ url, detached: false, send: (_c, m) => arrivati.push({ url, m }) });
  const scheda = {
    isDestroyed: () => false,
    getURL: () => 'https://posta.example.it/',
    mainFrame: { framesInSubtree: ['https://posta.example.it/', 'https://pubblicita.example.com/', 'https://allegati.example.it/'].map(frame) },
  };
  const sito = (url) => /example\.it\//.test(url);
  W.spingiAllaScheda(scheda, { type: 'form_sent', testo: 'Ciaoatutti' }, { inVista: false, soloFrame: sito });
  assert.deepEqual(arrivati.map((a) => a.url), ['https://posta.example.it/', 'https://allegati.example.it/']);
  assert.equal(arrivati[0].m.testo, 'Ciaoatutti');
});
