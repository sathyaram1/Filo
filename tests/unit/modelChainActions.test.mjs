// Unit test per feedback #300 — "rendi possibile impostare il modello nei menu
// (modelli predefiniti → modelli)".
//
// Due invarianti coperte:
//
// 1. COMPLETEZZA DELL'EDITOR: la griglia "Modelli per azione" (usata sia dalla
//    pagina Opzioni sia dalla pagina admin "Modelli predefiniti") deve esporre
//    TUTTE le azioni di DEFAULT_MODELS. Un'azione assente dalla griglia non è
//    impostabile da nessun menu E sparisce dalla config `models` salvata
//    dall'admin (collect() serializza solo le azioni della griglia), restando
//    inchiodata alla catena hardcoded. Era il caso di DECKS_CHAT/OPINION/
//    AUTOTAG (chat dei Mazzi), EDIT_TEXT, EXPLAIN_LINK, FILO_LESSON,
//    FILO_COMPACT.
//
// 2. RETE DI SICUREZZA DEI NICKNAME: se la catena di un'azione cita un
//    nickname che NON è nel registry attivo (config admin/utente più vecchia
//    dell'azione), resolveModel deve ripiegare sul registry PREDEFINITO invece
//    di spedire il nickname nudo a OpenRouter come fosse un id raw. Senza
//    fallback la chat dei Mazzi moriva con «OpenRouter 400: "flash-or is not a
//    valid model ID"» (il sintomo nello screenshot del feedback).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'i18n.js'));
require(join(ROOT, 'src', 'shared', 'modelChainEditor.js'));

const C = globalThis.SN_CONST;
const I18n = globalThis.SN_I18N;
const ModelChain = globalThis.SN_MODEL_CHAIN;

// ── 1. La griglia copre tutte le azioni con un modello di default ────────────

test('actionLabels espone TUTTE le azioni di DEFAULT_MODELS (nessuna azione senza menu)', () => {
  const expected = Object.keys(C.DEFAULT_MODELS).sort();
  const exposed = ModelChain.actionLabels().map(([action]) => action).sort();
  assert.deepEqual(exposed, expected,
    'ogni azione con una catena di modelli deve essere impostabile dalla griglia '
    + '"Modelli per azione" (Opzioni e admin "Modelli predefiniti")');
});

test('le azioni dei Mazzi sono impostabili dai menu', () => {
  const exposed = new Set(ModelChain.actionLabels().map(([action]) => action));
  for (const a of [C.ACTIONS.DECKS_CHAT, C.ACTIONS.DECKS_OPINION, C.ACTIONS.DECKS_AUTOTAG]) {
    assert.ok(exposed.has(a), `l'azione "${a}" deve comparire nella griglia dei modelli`);
  }
});

test('ogni azione della griglia ha un\'etichetta i18n reale (non la chiave nuda)', () => {
  for (const [action, key] of ModelChain.actionLabels()) {
    const label = I18n.t(key);
    assert.notEqual(label, key, `manca la stringa i18n "${key}" per l'azione "${action}"`);
    assert.ok(label.trim().length > 0, `etichetta vuota per l'azione "${action}"`);
  }
});

test('actionLabels non contiene duplicati', () => {
  const actions = ModelChain.actionLabels().map(([action]) => action);
  assert.equal(new Set(actions).size, actions.length);
});

// ── 2. resolveModel ripiega sul registry predefinito per i nickname noti ─────

test('nickname assente dal registry attivo → risolto dal registry PREDEFINITO, non spedito raw', () => {
  // Registry "salvato" che non contiene più 'flash-or' (config più vecchia
  // dell'azione, o admin che l'ha rimosso).
  const savedRegistry = {
    'mio-modello': { provider: 'openrouter', model: 'vendor/mio-modello-1' },
  };
  const resolved = C.resolveModel('flash-or', 'openrouter', savedRegistry);
  assert.equal(resolved, C.DEFAULT_MODEL_REGISTRY['flash-or'].model,
    'il nickname di default deve risolversi nel suo id concreto, non restare "flash-or"');
  assert.notEqual(resolved, 'flash-or');
});

test('il registry attivo vince sul predefinito per lo stesso nickname', () => {
  const savedRegistry = {
    'flash-or': { provider: 'openrouter', model: 'vendor/override-esplicito' },
  };
  assert.equal(C.resolveModel('flash-or', 'openrouter', savedRegistry), 'vendor/override-esplicito');
});

test('id raw legacy (non nickname) resta passthrough su OpenRouter', () => {
  assert.equal(C.resolveModel('anthropic/claude-3.5-haiku', 'openrouter', {}), 'anthropic/claude-3.5-haiku');
});

test('buildModelAttempts: la catena di default dei Mazzi produce id concreti anche con registry sguarnito', () => {
  // Scenario del feedback #300: catena hardcoded 'flash, flash-or' per la chat
  // dei Mazzi, registry attivo senza quei nickname, solo chiave OpenRouter.
  const refs = C.parseModelRefs(C.DEFAULT_MODELS[C.ACTIONS.DECKS_CHAT]);
  const attempts = C.buildModelAttempts(refs, {}, ['gemini', 'openrouter'], { openrouter: 'k-or' });
  assert.ok(attempts.length > 0, 'deve esserci almeno un tentativo');
  for (const a of attempts) {
    assert.ok(!C.DEFAULT_MODEL_REGISTRY[a.model],
      `il tentativo deve usare l'id concreto, non il nickname "${a.model}"`);
  }
  assert.ok(attempts.some((a) => a.provider === 'openrouter' && a.model === C.DEFAULT_MODEL_REGISTRY['flash-or'].model));
});
