// Unit test per #158: l'assistente della home (FILO_CHAT) deve sapere QUALE
// modello lo sta eseguendo, e il nome passato dev'essere quello CONCRETO con cui
// il codice invoca il modello (es. 'gemini-3.1-flash-lite'), NON il nickname/label
// del registry (es. la chiave 'flash-lite-3' o l'etichetta 'Gemini 3.1 Flash Lite').
//
// Due pezzi puri, testabili senza Electron né rete:
//   1) il template del prompt (PROMPTS.filoChat) include il nome del modello;
//   2) la risoluzione nickname → id concreto (buildModelAttempts), che è ciò che
//      l'handler passa al prompt (attempts[0].model).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;

const basePayload = { profilo: 'x', preferenze: 'y', stato: 'z' };

test('PROMPTS.filoChat: con modelName, il prompt comunica il nome del modello', () => {
  const p = C.PROMPTS.filoChat({ ...basePayload, modelName: 'gemini-3.1-flash-lite' });
  assert.match(p, /gemini-3\.1-flash-lite/);
  // E istruisce a rispondere con QUEL nome se gli chiedono che modello è.
  assert.match(p, /quale modello/i);
});

test('PROMPTS.filoChat: senza modelName resta retrocompatibile (niente riga rotta)', () => {
  const p = C.PROMPTS.filoChat({ ...basePayload });
  // Non deve esserci la riga "Il modello che ti sta eseguendo è …" (né con un
  // valore mancante "undefined").
  assert.doesNotMatch(p, /modello che ti sta eseguendo/);
  assert.doesNotMatch(p, /eseguendo è (undefined|null)/);
});

test('risoluzione: il nickname si risolve nell\'id CONCRETO del modello, non nel nickname/label', () => {
  const registry = C.DEFAULT_MODEL_REGISTRY;
  // 'deepseek-flash' è il nickname (chiave del registry); 'DeepSeek V4 Flash…'
  // è la label; 'deepseek/deepseek-v4-flash' è il nome con cui il codice lo invoca.
  const refs = C.parseModelRefs('deepseek-flash');
  const attempts = C.buildModelAttempts(refs, registry, ['openrouter'], { openrouter: 'k' });
  assert.ok(attempts.length > 0);
  assert.equal(attempts[0].model, 'deepseek/deepseek-v4-flash'); // id concreto
  assert.notEqual(attempts[0].model, 'deepseek-flash');          // non il nickname
  assert.notEqual(attempts[0].model, registry['deepseek-flash'].label); // non la label
});

test('integrazione concettuale: ciò che l\'handler passa al prompt è l\'id concreto', () => {
  // Replica la catena dell'handler: parseModelRefs → buildModelAttempts →
  // attempts[0].model → PROMPTS.filoChat({ modelName }). Il prompt contiene l'id
  // concreto, mai il nickname.
  const registry = C.DEFAULT_MODEL_REGISTRY;
  const attempts = C.buildModelAttempts(C.parseModelRefs('deepseek-flash'), registry, ['openrouter'], { openrouter: 'k' });
  const modelName = attempts[0].model;
  const p = C.PROMPTS.filoChat({ ...basePayload, modelName });
  assert.match(p, /deepseek\/deepseek-v4-flash/);
  assert.doesNotMatch(p, /[^/-]deepseek-flash\b/);
});
