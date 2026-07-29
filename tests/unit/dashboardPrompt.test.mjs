// Unit test per il prompt della home (dashboard) — src/shared/constants.js.
//
// Regressione del feedback "ho ricaricato ma rimane la stessa scritta (sono le
// 10 di mattina)": il prompt chiede all'LLM di adattare saluto e tono "al
// momento", ma il momento non gli veniva MAI passato. Senza orologio l'LLM non
// può indovinare la fascia oraria e il saluto poteva non combaciare con l'ora
// reale. Qui asseriamo che il momento entri DAVVERO nel prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));

const PROMPTS = globalThis.SN_CONST.PROMPTS;

const base = {
  profilo: 'PM di Filo',
  preferenze: 'risposte brevi',
  espansioni: '',
  lezioni: '',
  stato: '',
  notifiche: '',
  appunti: '',
  salvati: '',
  ultimoMessaggio: '',
  tabAperte: 0,
};

test('il prompt della home include la fascia oraria passata (momento)', () => {
  const p = PROMPTS.filoDashboard({ ...base, momento: 'mattina, giorno feriale' });
  // Senza il fix questa stringa NON compariva nel prompt: l'LLM restava cieco
  // sull'ora e poteva salutare con "buonasera" alle 10 del mattino.
  assert.match(p, /mattina, giorno feriale/);
  // Deve anche istruire a non citare l'ora esatta (il messaggio è in cache per
  // tutta la fascia: un orario preciso diventerebbe stale).
  assert.match(p, /NON citare l'ora/i);
});

test('fasce diverse producono prompt diversi (mattina ≠ sera)', () => {
  const mattina = PROMPTS.filoDashboard({ ...base, momento: 'mattina, giorno feriale' });
  const sera = PROMPTS.filoDashboard({ ...base, momento: 'sera, giorno di weekend' });
  assert.notEqual(mattina, sera);
  assert.match(sera, /sera, giorno di weekend/);
});

test('senza momento il prompt resta valido (nessuna riga ADESSO)', () => {
  const p = PROMPTS.filoDashboard({ ...base });
  assert.doesNotMatch(p, /ADESSO È:/);
  // il resto del prompt continua a esserci
  assert.match(p, /preparare la dashboard/);
});
