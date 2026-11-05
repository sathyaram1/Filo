// #1097.3 giro 1 — chi legge la risposta come dati (un'etichetta, un JSON, la memoria riscritta) non riceve mai un pezzo
// tagliato: dal tetto o da un errore a metà flusso arriva un errore che lo dice. Chi la mostra a una persona la riceve con la riga.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const memoria = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => ({ [k]: memoria[k] }),
      set: async (o) => { Object.assign(memoria, JSON.parse(JSON.stringify(o))); },
    },
  },
};
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/costTracker.js');
require('../../src/main/services/modelGate.js');

const { ACTIONS } = globalThis.SN_CONST;
const CE = globalThis.SN_CHAT_ERRORS;
let risposta;
globalThis.SN_PROVIDERS = {
  completeWithFallback: async ({ attempts }) => ({ ...risposta, provider: attempts[0].provider, model: attempts[0].model }),
  getProvider: () => null,
};
const Gate = globalThis.SN_MODEL_GATE.create({
  getSettings: async () => ({ monthlyLimitEur: 50, usdToEur: 1, pricing: {}, excludedProviders: [] }),
  buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: 'deepseek/deepseek-v4-flash' }],
  modelFor: () => 'deepseek-flash',
  costs: globalThis.SN_COSTS,
  auditDelaysMs: [0],
});

test('una risposta tagliata dal tetto o da un errore non arriva come testo a chi la legge come dati', async () => {
  risposta = { text: '{"decisions":[{"id":1', finishReason: 'length', usage: {} };
  await assert.rejects(Gate.text({ action: ACTIONS.FILE_NAME, messages: [] }), (e) => e.code === 'RISPOSTA_TAGLIATA' && /Preferenze/.test(CE.sentence(e)));
  risposta = { text: 'mezza', finishReason: 'error', usage: {} };
  await assert.rejects(Gate.text({ action: ACTIONS.FILE_NAME, messages: [] }), (e) => e.code === 'RISPOSTA_TAGLIATA' && CE.rimedio(e) === '');
  risposta = { text: 'intera', finishReason: 'stop', usage: {} };
  assert.equal(await Gate.text({ action: ACTIONS.FILE_NAME, messages: [] }), 'intera');
});

test('chi la mostra la riceve con la riga che lo dice, e il seguito si chiede con le stesse parole ovunque', () => {
  assert.equal(CE.troncata('length'), true);
  assert.equal(CE.troncata('error'), true);
  assert.equal(CE.troncata('stop'), false);
  assert.equal(CE.troncata(null), false);
  assert.match(CE.rispostaInterrotta('error'), /si è fermato a metà/);
  assert.equal(CE.eFraseInterrotta(` ${CE.rispostaInterrotta('length')} `), true);
  assert.equal(CE.eFraseInterrotta('Le tappe del viaggio'), false);
  assert.match(CE.CHIEDI_SEGUITO, /^Continua da dove ti sei interrotto/);
});

// #1302 — sentinella: le pagine che usano la risposta come dato la chiedono `intera`, così un pezzo fermato dal tetto
// torna come errore che lo dice (il main lo prova in tests/risposta-tagliata-come-dato.spec.mjs).
const src = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
// Il pezzo di sorgente dalla prima occorrenza di `da`, lungo quanto basta a contenere la sua richiesta.
const intorno = (testo, da, n = 600) => { const i = testo.indexOf(da); assert.ok(i >= 0, da); return testo.slice(i, i + n); };

test('descrizione di un\'immagine, riassunto e titolo dell\'Editor, ricerca della Gestione: chiedono la risposta intera', () => {
  assert.match(intorno(src('src/content/actions.js'), 'action: ACTIONS.DESCRIBE_IMAGE,'), /intera: true/);
  const editor = src('src/pages/editor/editor.js');
  assert.match(intorno(editor, "chiediSulDocumento(ACTIONS.EDITOR_SUMMARY", 200), /intera: true[\s\S]*intera: true/);
  assert.match(intorno(editor, "chiediSulDocumento(ACTIONS.EDITOR_TITLE", 200), /intera: true[\s\S]*intera: true/);
  assert.match(intorno(src('src/pages/manage/manage.js'), 'SN_CONST.ACTIONS.MANAGE_SEARCH', 400), /intera: true/);
  assert.match(intorno(src('src/main/services/handlers/scryfall.js'), 'payload: { messages: retryMessages }', 200), /intera: true/);
});

test('il canale delle pagine porta `intera` fino a chi chiama il modello', () => {
  const ai = src('src/main/services/handlers/ai.js');
  assert.match(ai, /const intera = msg && msg\.intera === true;/);
  assert.match(ai, /handleAIRequest\(\{ action: msg\.action, payload: msg\.payload, origin, sender, noCache, intera, conSeguito \}\)/);
});

// #1302 — il tetto finito nel ragionamento prima di una parola: dove c'è «Continua» la nota e il seguito, altrove l'errore.
test('risposta vuota fermata ragionando: nota e «Continua» dove ci sono, errore per chi legge un dato o non ha il seguito', () => {
  const vuota = { text: '', toolCalls: [], finishReason: 'tetto_ragionamento' };
  assert.equal(CE.erroreDelTaglio(vuota), null);
  assert.equal(CE.erroreDelTaglio(vuota, { intera: true }).code, 'RISPOSTA_TAGLIATA');
  assert.equal(CE.erroreDelTaglio(vuota, { senzaSeguito: true }).code, 'RISPOSTA_TAGLIATA');
  assert.equal(CE.erroreDelTaglio({ ...vuota, finishReason: 'length' }).code, 'RISPOSTA_TAGLIATA');
  const handlers = src('src/main/services/handlers.js');
  assert.match(handlers, /erroreDelTaglio\(r, \{ intera, senzaSeguito: !conSeguito \}\)/);
  assert.match(intorno(handlers, 'action: ACTIONS.FILO_CHAT,\n        payload: { ...payloadBase, threadMessages },', 200), /conSeguito: true/);
  assert.match(intorno(src('src/main/services/handlers/scryfall.js'), 'action: ACTIONS.DECKS_CHAT,', 200), /conSeguito: true/);
  assert.match(intorno(src('src/content/actions.js'), 'action: ACTIONS.EXPLAIN,', 200), /conSeguito: true/);
  assert.match(intorno(src('src/content/sidebar.js'), 'action: ACTIONS.HELP,', 200), /conSeguito: true/);
});

test('la nota del tetto finito nel ragionamento non promette «Continua» né più spazio: compare anche dove non ci sono', () => {
  const nota = CE.rispostaInterrotta('tetto_ragionamento');
  assert.match(nota, /ragionando/);
  assert.doesNotMatch(nota, /continu|più spazio/i);
});
