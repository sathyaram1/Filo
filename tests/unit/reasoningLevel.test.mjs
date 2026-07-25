// Unit test per il livello di reasoning per-modello (#369).
//
// La feature: nella pagina "Modelli predefiniti" l'owner può fissare, per un
// modello del registry, un livello di reasoning ('off'/'low'/'medium'/'high').
// Quel livello è una proprietà della VOCE del registry e deve viaggiare su OGNI
// tentativo costruito per quel nickname (primario e fallback dello stesso
// modello), così i provider possono chiederlo. 'auto' (o assente) = nessun
// override → il tentativo non porta alcun campo `reasoning`, comportamento di
// prima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;

test('normalizeReasoning: normalizza e scarta i valori non validi', () => {
  assert.equal(C.normalizeReasoning(undefined), null);
  assert.equal(C.normalizeReasoning(''), null);
  assert.equal(C.normalizeReasoning('auto'), null);
  assert.equal(C.normalizeReasoning('HIGH'), 'high');
  assert.equal(C.normalizeReasoning(' Low '), 'low');
  assert.equal(C.normalizeReasoning('off'), 'off');
  assert.equal(C.normalizeReasoning('turbo'), null); // valore ignoto → nessun override
});

test('buildModelAttempts: il livello del modello finisce su ogni suo tentativo', () => {
  const registry = {
    smart: { provider: 'openrouter', model: 'x/smart', reasoning: 'high' },
    'smart-g': { provider: 'gemini', model: 'gemini-x', reasoning: 'high' },
    plain: { provider: 'openrouter', model: 'x/plain' }, // nessun livello
  };
  const apiKeys = { openrouter: 'or-key', gemini: 'gem-key' };

  // Modello primario + fallback (stesso modello su due provider): entrambi 'high'.
  const attempts = C.buildModelAttempts(['smart', 'smart-g'], registry, ['gemini', 'openrouter'], apiKeys);
  const or = attempts.find((a) => a.provider === 'openrouter');
  const gem = attempts.find((a) => a.provider === 'gemini');
  assert.equal(or.reasoning, 'high');
  assert.equal(gem.reasoning, 'high');

  // Modello senza livello → nessun campo reasoning sul tentativo (comportamento di prima).
  const plain = C.buildModelAttempts(['plain'], registry, ['gemini', 'openrouter'], apiKeys);
  assert.equal(plain.length, 1);
  assert.ok(!('reasoning' in plain[0]));
});

test('buildModelAttempts: livello auto/assente non aggiunge il campo', () => {
  const registry = { a: { provider: 'openrouter', model: 'x/a', reasoning: 'auto' } };
  const attempts = C.buildModelAttempts(['a'], registry, ['openrouter'], { openrouter: 'k' });
  assert.equal(attempts.length, 1);
  assert.ok(!('reasoning' in attempts[0]));
});
