// Unit test — politica sui fornitori (#421).
//
// La politica di Filo ammette i modelli di Anthropic e i modelli a pesi aperti
// SOLO se serviti da fornitori indipendenti, mai dal produttore del modello. Il
// router (OpenRouter) di suo sceglie l'host col prezzo migliore, che può essere
// proprio il produttore escluso. Questo test verifica il MECCANISMO che fa
// rispettare e verificare la politica:
//   1. il match della lista di esclusione per forma base (variante regionale);
//   2. che la lista di esclusione arrivi nel body OpenRouter come provider.ignore
//      (senza routing → nessun blocco provider: retro-compat);
//   3. che l'host che ha DAVVERO servito la risposta venga estratto dalla
//      risposta (non-streaming e streaming), perché è la controprova.
//
// Ognuno ASSERISCE il successo: senza il fix il body non conterrebbe l'ignore e
// la risposta non riporterebbe chi ha servito.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const C = globalThis.SN_CONST;
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;

// ── 1. Match della lista di esclusione (logica pura) ─────────────────────────

test('isProviderExcluded: la forma base copre le varianti regionali', () => {
  const excl = ['Google', 'Mistral', 'Moonshot AI'];
  // Forma esatta
  assert.equal(C.isProviderExcluded('Google', excl), true);
  // Varianti regionali del produttore → coperte dalla forma base
  assert.equal(C.isProviderExcluded('Google Vertex', excl), true);
  assert.equal(C.isProviderExcluded('Google AI Studio', excl), true);
  assert.equal(C.isProviderExcluded('Mistral AI', excl), true);
  // Case-insensitive
  assert.equal(C.isProviderExcluded('MOONSHOT AI', excl), true);
  // Un host indipendente NON è escluso
  assert.equal(C.isProviderExcluded('DeepInfra', excl), false);
  assert.equal(C.isProviderExcluded('Together', excl), false);
  // Un nome che solo INIZIA per caso con lettere simili ma è altra parola: non
  // deve cadere sotto la base (confine di parola).
  assert.equal(C.isProviderExcluded('Googleplexish', excl), false);
  // Vuoti / non stringhe → non esclusi
  assert.equal(C.isProviderExcluded('', excl), false);
  assert.equal(C.isProviderExcluded(null, excl), false);
});

test('providerIgnoreList: deduplica e scarta i vuoti, preserva le forme', () => {
  const out = C.providerIgnoreList(['Google', 'google', ' OpenAI ', '', null, 'Google']);
  assert.deepEqual(out, ['Google', 'OpenAI']);
});

test('la lista di esclusione di default esiste e NON contiene Anthropic', () => {
  const list = C.DEFAULT_EXCLUDED_PROVIDERS;
  assert.ok(Array.isArray(list) && list.length > 0);
  // Anthropic è ammesso dalla politica: non deve essere escluso.
  assert.equal(C.isProviderExcluded('Anthropic', list), false);
  // Google (produttore di Gemini) è invece escluso.
  assert.equal(C.isProviderExcluded('Google Vertex', list), true);
});

test('Novita è escluso: host che ha restituito la risposta di un\'altra richiesta (#518)', () => {
  const list = C.DEFAULT_EXCLUDED_PROVIDERS;
  assert.equal(C.isProviderExcluded('Novita', list), true);
  // Varianti del nome (come per i produttori): la forma base le copre.
  assert.equal(C.isProviderExcluded('Novita AI', list), true);
  assert.equal(C.isProviderExcluded('novita', list), true);
  // L'esclusione parte per ogni modello che instrada, non solo per quello su
  // cui è stato colto: la lista non ha condizioni sul modello, quindi finisce
  // nell'ignore di QUALSIASI richiesta.
  assert.ok(C.providerIgnoreList(list).includes('Novita'));
  // Gli host indipendenti sani restano ammessi.
  for (const ok of ['DeepInfra', 'Modal', 'Relace', 'Together']) {
    assert.equal(C.isProviderExcluded(ok, list), false);
  }
});

// ── Deriva fra la lista del codice e quella scritta a mano ───────────────────
// La lista remota (config/models) SOSTITUISCE quella di build: un'esclusione
// aggiunta al codice non arriva dove esiste già una lista scritta a mano. Questa
// funzione è ciò che rende visibile la differenza.

test('missingExcludedProviders: nomina le voci del codice che la lista non copre', () => {
  const base = ['Google', 'Novita', 'Z.AI'];
  // Lista che ne copre solo una.
  assert.deepEqual(C.missingExcludedProviders(base, ['Google', 'DeepInfra']), ['Novita', 'Z.AI']);
  // La sola variante regionale NON copre la forma base ("Google AI Studio"
  // lascia passare "Google Vertex"): resta segnalata.
  assert.deepEqual(C.missingExcludedProviders(['Google'], ['Google AI Studio']), ['Google']);
  // Lista completa → niente da segnalare.
  assert.deepEqual(C.missingExcludedProviders(base, base), []);
  // Lista vuota/assente → mancano tutte (è il caso peggiore, non silenzio).
  assert.deepEqual(C.missingExcludedProviders(base, []), base);
  assert.deepEqual(C.missingExcludedProviders(base, null), base);
  // Doppioni e vuoti nella lista di partenza non si moltiplicano nell'esito.
  assert.deepEqual(C.missingExcludedProviders(['Novita', 'novita', '', null], []), ['Novita']);
});

// ── 2. La politica arriva nel body OpenRouter ────────────────────────────────

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => '' };
}
function withFetch(fn, run) {
  const orig = global.fetch;
  global.fetch = fn;
  return Promise.resolve(run()).finally(() => { global.fetch = orig; });
}
function sseResponse(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  const body = {
    getReader() {
      return {
        read() {
          if (i >= chunks.length) return Promise.resolve({ done: true, value: undefined });
          return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
        },
      };
    },
  };
  return { ok: true, body, status: 200, text: async () => '' };
}

test('complete: providerRouting.ignore finisce in body.provider.ignore', async () => {
  const sent = {};
  const res = await withFetch(
    (url, opts) => { Object.assign(sent, JSON.parse(opts.body)); return Promise.resolve(jsonResponse({ choices: [{ message: { content: 'ok' } }], provider: 'DeepInfra', usage: {} })); },
    () => OpenRouter.complete({
      apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'ciao' }],
      providerRouting: { ignore: ['Google', 'OpenAI'], sort: 'latency' },
    }),
  );
  assert.deepEqual(sent.provider.ignore, ['Google', 'OpenAI']);
  assert.equal(sent.provider.sort, 'latency');
  // Chi ha davvero servito viene estratto dalla risposta.
  assert.equal(res.servedBy, 'DeepInfra');
});

test('complete: senza providerRouting nessun blocco provider (retro-compat)', async () => {
  const sent = {};
  await withFetch(
    (url, opts) => { Object.assign(sent, JSON.parse(opts.body)); return Promise.resolve(jsonResponse({ choices: [{ message: { content: 'ok' } }], usage: {} })); },
    () => OpenRouter.complete({ apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'x' }] }),
  );
  assert.equal(sent.provider, undefined);
});

test('streamComplete: ignore nel body e servedBy estratto dallo stream', async () => {
  const chunks = [
    'data: ' + JSON.stringify({ provider: 'Together', choices: [{ delta: { content: 'La ' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ provider: 'Together', choices: [{ delta: { content: 'risposta.' } }] }) + '\n\n',
    'data: [DONE]\n\n',
  ];
  const sent = {};
  const got = [];
  const res = await withFetch(
    (url, opts) => { Object.assign(sent, JSON.parse(opts.body)); return Promise.resolve(sseResponse(chunks)); },
    () => OpenRouter.streamComplete({
      apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'x' }],
      providerRouting: { ignore: ['Google'] },
      onDelta: (d) => got.push(d),
    }),
  );
  assert.deepEqual(sent.provider.ignore, ['Google']);
  assert.equal(res.text, 'La risposta.');
  assert.equal(res.servedBy, 'Together');
});
