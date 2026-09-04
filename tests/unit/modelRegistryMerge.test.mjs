// Unit test — i nickname integrati devono restare risolvibili anche quando il
// registry remoto (doc Firestore config/models) non li elenca.
//
// Regressione reale: il registry remoto conteneva solo 4 nickname curati
// dall'admin ('text', 'immagine', …). Le azioni ASSENTI dal doc remoto (es. le
// azioni dei mazzi, appena introdotte) ricadono sulle catene di default che
// citano i nickname integrati ('flash, flash-or'): siccome il registry remoto
// SOSTITUIVA interamente quello di build, quei nickname non risolvevano più e
// finivano GREZZI a OpenRouter → 400 "flash is not a valid model ID".
//
// Il fix: il registry remoto si sovrappone (merge) a quello di build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Carica SN_CONST (IIFE su globalThis) e il defaultsStore.
require(join(ROOT, 'src', 'shared', 'constants.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const C = globalThis.SN_CONST;

// Doc remoto realistico: registry curato dall'admin SENZA i nickname integrati,
// e mappa models che NON copre le azioni dei mazzi.
const REMOTE_MODELS_DOC = {
  fields: {
    models: {
      mapValue: {
        fields: {
          explain: { stringValue: 'text' },
        },
      },
    },
    modelRegistry: {
      mapValue: {
        fields: {
          text: {
            mapValue: {
              fields: {
                provider: { stringValue: 'openrouter' },
                model: { stringValue: 'deepseek/deepseek-v4-pro' },
              },
            },
          },
        },
      },
    },
  },
};

async function refreshWithRemoteDoc(doc) {
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('config/models')) {
      return { ok: true, status: 200, async json() { return doc; }, async text() { return ''; } };
    }
    return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
  };
  try {
    return await Defaults.refresh();
  } finally {
    global.fetch = realFetch;
  }
}

test('il registry remoto si fonde con quello di build (i nickname integrati restano)', async () => {
  const eff = await refreshWithRemoteDoc(REMOTE_MODELS_DOC);

  // L'override remoto vince sul nickname che definisce…
  assert.equal(eff.modelRegistry.text.model, 'deepseek/deepseek-v4-pro');
  // …ma i nickname integrati citati dalle catene di default restano risolvibili.
  for (const nick of ['deepseek', 'deepseek-flash', 'gemma', 'claude', 'kokoro', 'whisper', 'qwen-embed']) {
    assert.ok(eff.modelRegistry[nick], `nickname integrato "${nick}" sparito dal registry effettivo`);
  }
});

test('con il registry effettivo le azioni dei mazzi risolvono in modelli concreti (mai nickname grezzi)', async () => {
  const eff = await refreshWithRemoteDoc(REMOTE_MODELS_DOC);

  // Le azioni dei mazzi non sono nel doc remoto → catena di default.
  const chain = eff.models[C.ACTIONS.DECKS_CHAT];
  assert.ok(chain, 'manca la catena di default per la chat dei mazzi');

  const refs = C.parseModelRefs(chain);
  const attempts = C.buildModelAttempts(refs, eff.modelRegistry, ['openrouter'], {
    openrouter: 'k2',
  });
  assert.ok(attempts.length > 0, 'nessun tentativo costruito per la chat dei mazzi');
  // Un nickname non risolto passerebbe grezzo al provider (es. model === 'flash',
  // che OpenRouter rifiuta con 400): ogni tentativo deve usare l'id concreto
  // del registry di build corrispondente a uno dei nickname della catena.
  const concreteIds = refs.map((r) => C.DEFAULT_MODEL_REGISTRY[r]?.model).filter(Boolean);
  for (const a of attempts) {
    assert.ok(concreteIds.includes(a.model),
      `il tentativo usa "${a.model}" che non è un modello concreto della catena "${chain}"`);
  }
});

test('ogni nickname citato dalle catene di default esiste nel registry di build', () => {
  for (const [action, chain] of Object.entries(C.DEFAULT_MODELS)) {
    for (const ref of C.parseModelRefs(chain)) {
      assert.ok(C.DEFAULT_MODEL_REGISTRY[ref],
        `l'azione ${action} cita il nickname "${ref}" assente dal registry di build`);
    }
  }
});

test("l'editor dei modelli per azione espone anche le azioni dei mazzi", () => {
  require(join(ROOT, 'src', 'shared', 'modelChainEditor.js'));
  const labels = globalThis.SN_MODEL_CHAIN.actionLabels().map(([action]) => action);
  for (const a of [C.ACTIONS.DECKS_CHAT, C.ACTIONS.DECKS_OPINION, C.ACTIONS.DECKS_AUTOTAG, C.ACTIONS.DECKS_SEARCH_FILTER]) {
    assert.ok(labels.includes(a), `azione mazzi "${a}" assente dall'editor modelli per azione`);
  }
});
