// Sentinella del testo che una richiesta porta al sito (#824): le righe dell'utente si ritrovano
// in ogni forma in cui i siti le scrivono, e un testo che la richiesta non porta non c'è.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { testoDellaRichiesta, corpoDa, essenziale, LIMITE_CORPO } = require('../../src/main/services/testoInviato.js');

const corpo = (s) => [{ bytes: Buffer.from(s, 'utf8') }];
const leggi = ({ url, uploadData }) => testoDellaRichiesta({ url, corpo: corpoDa(uploadData) });
const porta = (richiesta, riga) => leggi(richiesta).includes(essenziale(riga));

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

test('un editor che manda HTML porta il testo delle righe e il testo intero, anche con le lettere accentate per nome', () => {
  const r = { url: 'https://posta.example.org/sync', uploadData: corpo(JSON.stringify({ corpo: '<div dir="ltr">Ciao &amp; grazie</div><div>a&nbsp;presto &#127881; perch&eacute; &Egrave; cos&igrave;</div>' })) };
  assert.ok(porta(r, 'Ciao & grazie'));
  assert.ok(porta(r, 'a presto 🎉 perché È così'));
  assert.ok(porta(r, 'Ciao & grazie\na presto 🎉 perché È così'));
});

test('un post mandato in Markdown porta le righe scritte in grassetto o in corsivo', () => {
  const r = { url: 'https://social.example.com/api/post', uploadData: corpo(JSON.stringify({ post: 'Oggi ho **finito** la _maratona_ di Firenze' })) };
  assert.ok(porta(r, 'Oggi ho finito la maratona di Firenze'));
});

test('un «<» scritto dall’utente non fa sparire il testo che segue', () => {
  const r = { url: 'https://forum.example.it/api', uploadData: corpo(JSON.stringify({ t: 'se a < b allora b > a' })) };
  assert.ok(porta(r, 'se a < b allora b > a'));
});

test('il testo che la richiesta non porta non c’è', () => {
  const r = { url: 'https://negozio.example.it/carrello?id=42', uploadData: corpo('{"evento":"passo_2"}') };
  assert.equal(porta(r, 'Gentile ufficio, vorrei candidarmi'), false);
  assert.equal(leggi({ url: 'non un indirizzo' }), '');
});

test('un corpo enorme si legge fino al limite: quello che c’è dentro conta, il resto no', () => {
  const inizio = 'Lettera in testa al corpo';
  const fondo = 'Riga oltre il limite';
  const r = { url: 'https://example.it/carica', uploadData: [{ bytes: Buffer.from(inizio) }, { bytes: Buffer.alloc(LIMITE_CORPO, 0x2e) }, { bytes: Buffer.from(fondo) }, { file: '/tmp/foto.jpg' }] };
  assert.ok(porta(r, inizio));
  assert.equal(porta(r, fondo), false);
  assert.ok(corpoDa(r.uploadData).length <= LIMITE_CORPO);
});

test('un corpo binario non si legge: conta solo l’indirizzo', () => {
  const r = { url: 'https://example.it/carica?nome=vacanze', uploadData: [{ bytes: Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from('Didascalia nascosta')]) }] };
  assert.equal(corpoDa(r.uploadData).length, 0);
  assert.ok(porta(r, 'vacanze'));
  assert.equal(porta(r, 'Didascalia nascosta'), false);
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
  W.spingiAllaScheda(scheda, { type: 'form_sent', testo: 'ciaoatutti' }, { inVista: false, soloFrame: sito });
  assert.deepEqual(arrivati.map((a) => a.url), ['https://posta.example.it/', 'https://allegati.example.it/']);
  assert.equal(arrivati[0].m.testo, 'ciaoatutti');
});
