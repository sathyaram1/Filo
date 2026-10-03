// Come si scrive un conteggio di feedback (src/shared/feedback.js): un numero
// da una lettura che non è arrivata in fondo NON è un totale, e scriverlo come
// tale ("312") è peggio che non scriverlo. Il "+" è la forma onesta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;

test('feedback espone la pagina di lettura e come si scrive un conteggio', () => {
  assert.equal(typeof FB.LIST_PAGE_SIZE, 'number');
  assert.ok(FB.LIST_PAGE_SIZE > 0);
  assert.equal(typeof FB.countLabel, 'function');
  assert.equal(typeof FB.COUNT_INCOMPLETE_HINT, 'string');
});

test('countLabel: "(24)" è un totale, "(24+)" è un minimo', () => {
  assert.equal(FB.countLabel(24, false), '(24)');
  assert.equal(FB.countLabel(24, true), '(24+)');
  // Zero è una risposta quando il dato è completo…
  assert.equal(FB.countLabel(0, false), '(0)');
  // …e resta un minimo quando non lo è: la sezione può non essere vuota davvero.
  assert.equal(FB.countLabel(0, true), '(0+)');
});

test('countLabel: numeri storti non producono etichette storte', () => {
  assert.equal(FB.countLabel(undefined, false), '(0)');
  assert.equal(FB.countLabel(null, false), '(0)');
  assert.equal(FB.countLabel(NaN, false), '(0)');
  assert.equal(FB.countLabel(-3, false), '(0)');
  assert.equal(FB.countLabel(2.7, false), '(2)');
  assert.equal(FB.countLabel('7', true), '(7+)');
});
