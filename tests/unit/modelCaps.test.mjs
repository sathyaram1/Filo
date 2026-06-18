// Unit test per src/shared/modelCaps.js — capacità dei modelli dedotte da
// provider + nome + (opzionali) metadati API, e ordinamento per recency.
//
// È logica pura e autonoma: il modulo si registra su globalThis e non richiede
// altri moduli caricati prima (le funzioni che usano SN_I18N/SN_CONST hanno
// fallback). Gira via `npm run test:unit`, senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// constants.js fornisce SN_CONST.ACTIONS (serve a requirementsFor per le azioni
// multimodali come DESCRIBE_IMAGE); modelCaps.js è il modulo sotto test.
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'modelCaps.js'));

const CAPS = globalThis.SN_MODEL_CAPS;
const { M } = CAPS;
const ACTIONS = globalThis.SN_CONST.ACTIONS;

test('modelCaps si registra su globalThis con la sua API', () => {
  assert.ok(CAPS, 'SN_MODEL_CAPS deve esistere');
  for (const fn of ['capabilitiesFor', 'categoryKey', 'recencyKey', 'sortByRecency', 'modelMatchesAction']) {
    assert.equal(typeof CAPS[fn], 'function', `${fn} deve essere una funzione`);
  }
});

test('capabilitiesFor: i metadati OpenRouter (modalità esplicite) hanno priorità sul nome', () => {
  const caps = CAPS.capabilitiesFor('openrouter', 'qualsiasi-cosa', {
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  });
  assert.deepEqual(caps.inputs.sort(), [M.IMAGE, M.TEXT].sort());
  assert.deepEqual(caps.outputs, [M.TEXT]);
});

test('capabilitiesFor: euristiche sul nome (Gemini senza metadati di modalità)', () => {
  // Sintesi vocale → audio in output.
  assert.deepEqual(CAPS.capabilitiesFor('gemini', 'gemini-2.5-flash-tts').outputs, [M.AUDIO]);
  // Embedding.
  assert.deepEqual(CAPS.capabilitiesFor('gemini', 'text-embedding-004').outputs, [M.EMBED]);
  // Generazione immagini → immagine in output e in input.
  const img = CAPS.capabilitiesFor('gemini', 'imagen-3.0');
  assert.ok(img.outputs.includes(M.IMAGE));
  assert.ok(img.inputs.includes(M.IMAGE));
  // Video.
  assert.deepEqual(CAPS.capabilitiesFor('gemini', 'veo-2').outputs, [M.VIDEO]);
});

test('capabilitiesFor: asimmetria gemini-* (multimodale in input) vs gemma-* (solo testo)', () => {
  const gemini = CAPS.capabilitiesFor('gemini', 'gemini-2.0-flash');
  assert.ok(gemini.inputs.includes(M.IMAGE), 'gemini-* accetta immagini in input');
  assert.ok(gemini.inputs.includes(M.AUDIO), 'gemini-* accetta audio in input');
  assert.deepEqual(gemini.outputs, [M.TEXT]);

  const gemma = CAPS.capabilitiesFor('gemini', 'gemma-3-27b-it');
  assert.deepEqual(gemma.inputs, [M.TEXT], 'gemma-* è solo testo in input');
  assert.deepEqual(gemma.outputs, [M.TEXT]);
});

test('categoryKey: mappa le capacità sulla categoria giusta del picker', () => {
  assert.equal(CAPS.categoryKey('gemini', 'gemini-2.5-flash-tts'), 'tts');
  assert.equal(CAPS.categoryKey('gemini', 'text-embedding-004'), 'embedding');
  assert.equal(CAPS.categoryKey('gemini', 'veo-2'), 'video');
  assert.equal(CAPS.categoryKey('gemini', 'imagen-3.0'), 'image');
  assert.equal(CAPS.categoryKey('gemini', 'gemini-2.0-flash'), 'multimodal');
  assert.equal(CAPS.categoryKey('gemini', 'gemma-3-27b-it'), 'text');
});

test('recencyKey: per Gemini la versione nel nome ordina dal più recente', () => {
  const newer = CAPS.recencyKey('gemini', 'gemini-3.5-pro');
  const mid = CAPS.recencyKey('gemini', 'gemini-2.5-flash');
  const older = CAPS.recencyKey('gemini', 'gemini-2.0-flash');
  assert.ok(newer > mid && mid > older, `atteso 3.5 > 2.5 > 2.0, avuto ${newer}, ${mid}, ${older}`);
});

test('recencyKey: per OpenRouter usa il timestamp `created` dai metadati', () => {
  assert.equal(CAPS.recencyKey('openrouter', 'x', { created: 1700000000 }), 1700000000);
  assert.equal(CAPS.recencyKey('openrouter', 'x', {}), 0, 'senza created → 0');
});

test('sortByRecency: ordina dal più recente, stabile per nome', () => {
  const items = [
    { id: 'gemini-2.0-flash', provider: 'gemini' },
    { id: 'gemini-3.5-pro', provider: 'gemini' },
    { id: 'gemini-2.5-flash', provider: 'gemini' },
  ];
  const sorted = CAPS.sortByRecency(items).map((x) => x.id);
  assert.deepEqual(sorted, ['gemini-3.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']);
  // non muta l'input
  assert.equal(items[0].id, 'gemini-2.0-flash');
});

test('modelMatchesAction: un modello TTS non soddisfa una funzione che vuole testo', () => {
  // Azione di default = richiede output testo. Un modello solo-audio deve fallire.
  const res = CAPS.modelMatchesAction('gemini', 'gemini-2.5-flash-tts', 'sn_summarize');
  assert.equal(res.ok, false);
  assert.equal(typeof res.reason, 'string');
  assert.ok(res.reason.length > 0, 'deve dare un motivo (chiave i18n) non vuoto');
});

test('modelMatchesAction: un modello di testo soddisfa una funzione testuale', () => {
  const res = CAPS.modelMatchesAction('gemini', 'gemini-2.0-flash', 'sn_summarize');
  assert.equal(res.ok, true);
});

test('capabilitiesFor: un modello OpenRouter senza metadati è marcato `uncertain`', () => {
  // Capacità ignote: il nome non rivela le modalità (non è image/tts/embed/…)
  // e non abbiamo i metadati. NON dobbiamo assumere "solo testo" con certezza.
  const caps = CAPS.capabilitiesFor('openrouter', 'stepfun/step-3.7-flash');
  assert.equal(caps.uncertain, true, 'OpenRouter senza metadati → uncertain');
  // gemma-* (gemini provider) resta una capacità NOTA, non incerta.
  assert.ok(!CAPS.capabilitiesFor('gemini', 'gemma-3-27b-it').uncertain);
  // Con i metadati di modalità espliciti NON è più incerto.
  const withMeta = CAPS.capabilitiesFor('openrouter', 'stepfun/step-3.7-flash', {
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  });
  assert.ok(!withMeta.uncertain, 'con metadati le capacità sono note');
});

test('modelMatchesAction: una vision OpenRouter NON va bloccata per "Descrizione immagini"', () => {
  // Il bug (#qG0): stepfun/step-3.7-flash legge le immagini ma, senza metadati,
  // l'euristica lo dava come solo-testo e il gate lo bloccava per DESCRIBE_IMAGE.
  // Ora, capacità ignote ⇒ nel dubbio non si blocca.
  const res = CAPS.modelMatchesAction('openrouter', 'stepfun/step-3.7-flash', ACTIONS.DESCRIBE_IMAGE);
  assert.equal(res.ok, true, 'un modello OpenRouter ignoto non va bloccato per le immagini');
  // Coi metadati che dichiarano l'input immagine resta ovviamente consentito.
  const withMeta = CAPS.modelMatchesAction('openrouter', 'x', ACTIONS.DESCRIBE_IMAGE, {
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  });
  assert.equal(withMeta.ok, true);
});

test('modelMatchesAction: gemma-* (capacità nota) resta bloccato per le immagini', () => {
  // La relax dell\'incertezza NON deve aprire le maglie a un modello la cui
  // incapacità è NOTA: gemma-* è solo testo in input → niente immagini.
  const res = CAPS.modelMatchesAction('gemini', 'gemma-3-27b-it', ACTIONS.DESCRIBE_IMAGE);
  assert.equal(res.ok, false, 'gemma-* resta incompatibile con le immagini');
});
