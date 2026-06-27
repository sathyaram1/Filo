// Il correttore "rosso" (correzione di una singola parola via LLM) suggeriva
// parole inglesi anche quando il testo era in italiano (feedback alpha): il
// prompt non chiedeva mai di rispondere nella lingua del testo, così il modello
// ripiegava sull'inglese. Questo test verifica che il prompt vincoli la
// correzione alla STESSA lingua della frase.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadConstants() {
  const code = readFileSync(resolve(ROOT, 'src/shared/constants.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.SN_CONST;
}

test('spellcheckWord vincola la correzione alla lingua del testo', () => {
  const C = loadConstants();
  const prompt = C.PROMPTS.spellcheckWord({
    word: 'paaese',
    sentence: 'Questo è un bel paaese in collina.',
    prev: '',
    next: '',
  });
  const low = prompt.toLowerCase();
  // Deve chiedere esplicitamente la stessa lingua del testo…
  expect(low).toContain('stessa lingua');
  // …e scoraggiare la traduzione / il ripiego sull'inglese.
  expect(low).toMatch(/non tradurre|in un'altra lingua|termine inglese/);
});
