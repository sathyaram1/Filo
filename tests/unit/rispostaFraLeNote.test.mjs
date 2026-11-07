// #1921.1 — la risposta scritta insieme alle azioni finisce fra le note; se l'ultimo giro non la riscrive (GLM chiude
// con la sola battuta che segue) torna nella risposta. Il ciclo vero: tests/chat-risposta-fra-le-note.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { rispostaFraLeNote } = require(join(ROOT, 'src', 'main', 'services', 'giroAzioni.js'));

const RISPOSTA = 'Quasi tutto resta sul tuo computer: chat, memorie e cronologia non hanno copie altrove. '
  + 'Escono solo i testi che servono al modello per risponderti, e passano da OpenRouter.';
const BATTUTA = 'Torniamo a noi: chi sei, e a cosa ti serve di solito il computer?';

test('una risposta fra le note e un finale che è solo la battuta dopo: la risposta torna', () => {
  assert.equal(rispostaFraLeNote([RISPOSTA], BATTUTA), RISPOSTA);
  assert.equal(rispostaFraLeNote(['Guardo il documento della privacy.', RISPOSTA], BATTUTA), RISPOSTA);
});

test('il finale che la riscrive, anche riassunta, la lascia fra le note', () => {
  assert.equal(rispostaFraLeNote([RISPOSTA], `${RISPOSTA} ${BATTUTA}`), '');
  assert.equal(rispostaFraLeNote([RISPOSTA], RISPOSTA.slice(0, 100)), '');
});

test('una nota di lavoro vera resta una nota anche davanti a un finale corto', () => {
  assert.equal(rispostaFraLeNote(['Guardo subito cosa dicono i documenti, così rispondo esatto.'], 'Fatto.'), '');
  assert.equal(rispostaFraLeNote([], BATTUTA), '');
  assert.equal(rispostaFraLeNote(undefined, ''), '');
});
