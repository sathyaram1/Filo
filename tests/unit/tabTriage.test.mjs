// Unit test della logica pura del riordino schede (src/shared/tabTriage.js).
//
// Feedback #239: il riordino aveva chiuso solo YouTube quando avrebbe dovuto
// chiudere soprattutto le impostazioni aperte e le home duplicate. La causa: le
// pagine interne filo:// erano escluse in blocco dai candidati e i duplicati
// erano lasciati al giudizio (inaffidabile) dell'LLM.
//
// Senza il fix questi assert diventano rossi: isTriageableUrl escludeva ogni
// filo:// (home/impostazioni non candidabili) e findDuplicateIndices non
// esisteva (nessun collasso deterministico delle home duplicate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
// «È un indirizzo della rete di casa?» è una domanda sola, e vive col
// rilevamento siti pericolosi: il riordino la legge da lì (#591, ottavo giro).
import '../../src/main/services/safebrowse/index.js';
import '../../src/shared/tabTriage.js';

const T = globalThis.SN_TAB_TRIAGE;

test('le pagine interne effimere (home/impostazioni) sono candidabili al riordino', () => {
  assert.equal(T.isTriageableUrl('filo://newtab/'), true);
  assert.equal(T.isTriageableUrl('filo://options/options.html'), true);
  assert.equal(T.isTriageableUrl('filo://preferences/preferences.html'), true);
  assert.equal(T.isEphemeralInternalUrl('filo://newtab/'), true);
});

test('i siti web restano candidabili', () => {
  assert.equal(T.isTriageableUrl('https://youtube.com/watch?v=x'), true);
  assert.equal(T.isTriageableUrl('http://example.com'), true);
});

test('le pagine interne NON effimere (lavoro) non sono candidabili', () => {
  // editor/board/decks/cronologia possono contenere lavoro: restano fuori.
  assert.equal(T.isTriageableUrl('filo://editor/editor.html'), false);
  assert.equal(T.isTriageableUrl('filo://board/board.html'), false);
  assert.equal(T.isTriageableUrl('filo://decks/decks.html'), false);
  assert.equal(T.isEphemeralInternalUrl('filo://editor/editor.html'), false);
});

test('le home duplicate vengono collassate: tutte le extra sono marcate', () => {
  // 3 nuove-schede candidate + nessuna attiva della stessa: se ne tiene 1, 2 vanno.
  const tabs = [
    { url: 'filo://newtab/', lastInteractionAt: 30 },
    { url: 'filo://newtab/', lastInteractionAt: 10 },
    { url: 'filo://newtab/', lastInteractionAt: 20 },
  ];
  const dup = T.findDuplicateIndices(tabs, '');
  assert.equal(dup.size, 2);
  // Tiene la più recente (indice 0, lastInteractionAt 30): non è tra i duplicati.
  assert.equal(dup.has(0), false);
  assert.equal(dup.has(1), true);
  assert.equal(dup.has(2), true);
});

test('se la scheda ATTIVA è una home, TUTTE le home candidate sono duplicati', () => {
  const tabs = [
    { url: 'filo://newtab/', lastInteractionAt: 5 },
    { url: 'filo://newtab/', lastInteractionAt: 9 },
  ];
  const dup = T.findDuplicateIndices(tabs, 'filo://newtab/');
  assert.equal(dup.size, 2); // l'attiva occupa già l'URL: nessuna candidata si salva
});

test('i doppioni di siti web sono duplicati; pagine diverse no', () => {
  const tabs = [
    { url: 'https://youtube.com/watch?v=a' },
    { url: 'https://youtube.com/watch?v=a#t=10' }, // stesso URL, fragment diverso
    { url: 'https://youtube.com/watch?v=b' },      // video diverso: NON duplicato
  ];
  const dup = T.findDuplicateIndices(tabs, '');
  assert.equal(dup.has(1), true);
  assert.equal(dup.has(2), false);
  assert.equal(dup.size, 1);
});

test('un duplicato con form non inviato non viene collassato', () => {
  const tabs = [
    { url: 'https://sito.com/form' },
    { url: 'https://sito.com/form', formDirty: true },
  ];
  const dup = T.findDuplicateIndices(tabs, '');
  // Quello con form sporco (indice 1) è saltato; l'altro è unico → nessun dup.
  assert.equal(dup.has(1), false);
  assert.equal(dup.size, 0);
});

// #591, ottavo giro — il riordino parte da solo ed è acceso di serie, e di ogni
// scheda che prende manda al modello indirizzo, titolo ed estratto del testo.
// Le pagine della rete di casa (router, NAS, stampante, applicazione in prova)
// non devono uscire di casa: è la porta che il quinto giro ha chiuso sul
// riconoscimento del blocco geografico, che manda le stesse cose.
test('le pagine della rete di casa non sono candidabili al riordino', () => {
  for (const url of [
    'http://192.168.1.1/admin',
    'http://10.0.0.5/setup',
    'http://172.16.4.2/status',
    'http://127.0.0.1:3000/',
    'http://localhost:8080/',
    'http://mio-nas.local/files',
    'http://stampante.lan/',
  ]) assert.equal(T.isTriageableUrl(url), false, url);
});
