// #504 — «traducimi la pagina» si chiede anche a Filo: lo strumento c'è, il registro gli dà un costo, la riga del diario
// dice com'è andata. La traduzione vera la prova tests/traduci-pagina-chat.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/sistema.js');
require('../../src/shared/esitoAzione.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');
require('../../src/shared/autonomia.js');
require('../../src/shared/righeAttivita.js');
require('../../src/shared/capabilities.js');
const Tools = globalThis.SN_ACTION_TOOLS;
const L = globalThis.SN_ACTION_LEVELS;
const A = globalThis.SN_AUTONOMIA;
const R = globalThis.SN_RIGHE_ATTIVITA;

test('scheda(traduci) arriva a TRADUCI_PAGINA, anche per tornare all\'originale', () => {
  assert.equal(Tools.AZIONI.scheda.traduci, 'TRADUCI_PAGINA');
  const [traduci, originale] = Tools.toolCallsToActions([
    { name: 'scheda', arguments: JSON.stringify({ azione: 'traduci' }) },
    { name: 'scheda', arguments: JSON.stringify({ azione: 'traduci', originale: true }) },
  ]);
  assert.equal(traduci.type, 'TRADUCI_PAGINA');
  assert.equal(L.alOriginale(traduci), false);
  assert.equal(originale.type, 'TRADUCI_PAGINA');
  assert.equal(L.alOriginale(originale), true);
  // Un modello che scrive il booleano come testo vuole la stessa cosa.
  assert.equal(L.alOriginale({ originale: ' TRUE ' }), true);
  assert.equal(L.alOriginale({ originale: 'false' }), false);
  const def = Tools.definitions().find((d) => d.function.name === 'scheda');
  assert.ok(def.function.parameters.properties.azione.enum.includes('traduci'));
  assert.equal(def.function.parameters.properties.originale.type, 'boolean');
});

test('la capacità «Traduci l\'intera pagina» dice alla chat lo strumento, non «solo a mano»', () => {
  assert.match(globalThis.SN_CAPABILITIES.renderDetailForPrompt(['translate-page']), /Dalla chat: scheda\(traduci\)\./);
});

test('si disfa come il clic: parte da sola, e dopo un testo altrui chiede solo al livello Conservativo', () => {
  assert.equal(L.costoFor({ type: 'TRADUCI_PAGINA' }), 1);
  assert.equal(L.costoFor({ type: 'TRADUCI_PAGINA', originale: true }), 1);
  assert.equal(A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo: 1 }).risposta, 'si');
  assert.equal(A.decideDettaglio({ livello: 'conservativo', stato: 'contaminato', costo: 1 }).risposta, 'chiede');
  assert.equal(L.describe({ type: 'TRADUCI_PAGINA' }), 'Tradurre la pagina in italiano');
  assert.equal(L.describe({ type: 'TRADUCI_PAGINA', originale: true }), 'Rimettere la pagina nella sua lingua originale');
});

test('il turno si chiude da solo solo quando la pagina ha fatto quello che si era chiesto', () => {
  const esito = (traduzione, executed = true) => ({ executed, output: { traduzione } });
  for (const s of ['partita', 'originale', 'fermata']) assert.equal(L.parlaDaSe('TRADUCI_PAGINA', esito(s)), true, s);
  for (const s of ['gia_tradotta', 'in_corso', 'niente']) assert.equal(L.parlaDaSe('TRADUCI_PAGINA', esito(s)), false, s);
  assert.equal(L.parlaDaSe('TRADUCI_PAGINA', esito('muto', false)), false);
});

test('la riga del diario dice com\'è andata, non un «tradotta» generico', () => {
  const riga = (output, executed = true) => R.rigaAttivita({ type: 'TRADUCI_PAGINA', _executed: executed, _output: output }).text;
  assert.equal(riga({ traduzione: 'partita', come: 'pagina' }), 'Traduzione della pagina avviata');
  assert.equal(riga({ traduzione: 'partita', come: 'ripresa', mancanti: 3, di: 10 }), 'Traduzione della pagina ripresa');
  assert.equal(riga({ traduzione: 'partita', come: 'nuovo' }), 'Traduzione del testo nuovo avviata');
  assert.equal(riga({ traduzione: 'gia_tradotta' }), 'Pagina già tradotta');
  assert.equal(riga({ traduzione: 'originale', originale: true }), 'Pagina rimessa nella lingua originale');
  assert.equal(riga({ traduzione: 'niente', originale: true }), 'Pagina già nella lingua originale');
  assert.equal(riga({ traduzione: 'no-page' }, false), 'Traduzione non cambiata · nessuna pagina web aperta');
  assert.equal(riga({ traduzione: 'spento' }, false), 'Traduzione non cambiata · Filo è spento su questo sito');
});
