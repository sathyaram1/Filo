// #1130 — un giro di comandi secchi riusciti, o fermi sulla conferma dell'utente, chiude il turno senza richiamare il
// modello; un esito da leggere, un fallimento o un rifiuto lo fanno ripartire. Il ciclo vero: tests/chat-comandi-secchi.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cmdClassify', 'actionLevels']) require(join(ROOT, 'src', 'shared', `${f}.js`));
const { chiudeIlTurno } = require(join(ROOT, 'src', 'main', 'services', 'giroAzioni.js'));
const L = globalThis.SN_ACTION_LEVELS;

const esito = (type, res) => ({ action: { type }, res, rendered: { type } });
const riuscita = (type, output) => esito(type, { executed: true, kept: true, ...(output ? { output } : {}) });
const chiude = (...esiti) => chiudeIlTurno(esiti);

test('un timer riuscito chiude il turno; uno fallito no', () => {
  assert.equal(chiude(riuscita('TIMER')), true);
  assert.equal(chiude(esito('TIMER', { executed: false, kept: false })), false);
});

test('una ricerca ha un esito da leggere: il modello riparte, anche insieme a un timer', () => {
  const ricerca = riuscita('CERCA_WEB', { results: [{ title: 'x' }] });
  assert.equal(chiude(ricerca), false);
  assert.equal(chiude(riuscita('TIMER'), ricerca), false);
  assert.equal(chiudeIlTurno([riuscita('TIMER')], { daLeggere: () => true }), false);
});

test('un\'azione ferma sulla conferma dell\'utente chiude il turno col suo pulsante, di qualunque tipo', () => {
  assert.equal(chiude(esito('INVIA_FEEDBACK', { executed: false, kept: true, needsConfirm: 2 })), true);
  assert.equal(chiude(esito('ESEGUI_COMANDO', { executed: false, kept: true, needsConfirm: 3 })), true);
  assert.equal(chiude(riuscita('TIMER'), esito('WIFI', { executed: false, kept: true, needsConfirm: 2 })), true);
});

test('una conferma col testo del giro richiama il modello: quel testo è stato scritto prima di sapere che serviva l\'OK', () => {
  const wifi = esito('WIFI', { executed: false, kept: true, needsConfirm: 2 });
  assert.equal(chiudeIlTurno([wifi], { testo: 'Fatto, ho spento il wifi.' }), false);
  assert.equal(chiudeIlTurno([riuscita('TIMER'), wifi], { testo: 'Timer messo.' }), false);
  assert.equal(chiudeIlTurno([wifi], { testo: '  \n ' }), true);
  assert.equal(chiudeIlTurno([riuscita('TIMER')], { testo: 'Fatto, 10 minuti.' }), true);
});

test('un\'azione rifiutata, negata, bloccata o con una domanda fa ripartire il modello', () => {
  assert.equal(chiude(esito('TIMER', { executed: false, kept: false, rejected: true })), false);
  assert.equal(chiude(esito('TIMER', { executed: false, kept: false, no: true, error: 'no' })), false);
  assert.equal(chiude(esito('NAVIGA', { executed: false, kept: true, output: { blocked: 'site', host: 'x.test' } })), false);
  assert.equal(chiude(esito('PULISCI_TAB', { executed: false, kept: true, domanda: 'quali?' })), false);
  assert.equal(chiude(esito('TIMER', null)), false);
  assert.equal(chiudeIlTurno([]), false);
});

test('un esito riuscito che lascia qualcosa da dire fa ripartire il modello', () => {
  assert.equal(chiude(riuscita('ZOOM_PAGINA', { zoom: 'ok', percentuale: 150 })), true);
  assert.equal(chiude(riuscita('ZOOM_PAGINA', { zoom: 'ok', percentuale: 500, richiesto: 900, limitato: true })), false);
  assert.equal(chiude(riuscita('VOLUME', { ok: true, cosa: 'volume', volume: 100, limitato: true })), false);
  assert.equal(chiude(riuscita('IMPOSTA_PREFERENZA', { etichetta: 'Tema → Scuro' })), true);
  assert.equal(chiude(riuscita('IMPOSTA_PREFERENZA', { etichetta: 'Modello', costoModello: '0,02 € al mese' })), false);
  assert.equal(chiude(riuscita('IMPOSTA_PREFERENZA', { etichetta: 'Siti delicati', avviso: 'spenta una difesa' })), false);
  assert.equal(chiude(riuscita('COMANDO_FINESTRA', { window: 'home', already: true })), false);
  assert.equal(chiude(riuscita('WIFI', { ok: true, cosa: 'wifi', acceso: false })), true);
  assert.equal(chiude(riuscita('WIFI', { ok: true, cosa: 'wifi', elenco: [{ nome: 'Casa' }], acceso: true })), false);
  assert.equal(chiude(riuscita('ANNULLA_CAMBIO', { annullato: 'c1', frase: 'x', saltati: ['timer pasta'] })), false);
});

test('il bottone dell\'evento proposto conta come riuscito', () => {
  assert.equal(chiude(esito('EVENTO_CALENDARIO', { executed: false, kept: true, output: { proposta: true, evento: {} } })), true);
  assert.equal(chiude(esito('EVENTO_CALENDARIO', { executed: false, kept: false, output: { event: 'invalid' } })), false);
});

test('le azioni che parlano da sé sono azioni del registro, e nessuna è una lettura', () => {
  for (const t of Object.keys(L.TERMINALI)) {
    assert.ok(L.REGISTRY[t], `${t} non è nel registro delle azioni`);
    assert.equal(L.diSolaLettura(t), false, `${t} è una lettura: il suo esito va letto dal modello`);
  }
  assert.equal(L.parlaDaSe('timer', { executed: true }), true);
  assert.equal(L.parlaDaSe('constructor', { executed: true }), false);
  assert.equal(L.parlaDaSe('CERCA_WEB', { executed: true }), false);
});
