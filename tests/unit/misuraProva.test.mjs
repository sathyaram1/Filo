// Una misura del pulsante «Prova» vale solo per la configurazione con cui è
// stata presa. Senza questa regola i numeri di un modello restavano sullo
// schermo sotto un altro modello, e nessuno poteva accorgersene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;

const MISURA = { ttftMs: 300, tokensPerSec: 40, model: 'vendor/uno', reasoning: 'high', sort: 'price' };

test('la misura vale per la stessa configurazione', () => {
  assert.equal(C.misuraValePer(MISURA, { model: 'vendor/uno', reasoning: 'high', sort: 'price' }), true);
});

test('cambiato il modello, la misura non vale più', () => {
  assert.equal(C.misuraValePer(MISURA, { model: 'vendor/due', reasoning: 'high', sort: 'price' }), false);
});

test('cambiati ragionamento o ordinamento degli host, la misura non vale più', () => {
  assert.equal(C.misuraValePer(MISURA, { model: 'vendor/uno', reasoning: 'low', sort: 'price' }), false);
  assert.equal(C.misuraValePer(MISURA, { model: 'vendor/uno', reasoning: 'high', sort: 'latency' }), false);
});

test('«auto», vuoto e assente sono lo stesso valore, e non invalidano la misura', () => {
  const senza = { ttftMs: 12, tokensPerSec: 3, model: 'vendor/uno' };
  assert.equal(C.misuraValePer(senza, { model: 'vendor/uno', reasoning: 'auto', sort: '' }), true);
  assert.equal(C.misuraValePer(senza, { model: 'vendor/uno' }), true);
  assert.equal(C.misuraValePer({ ...senza, sort: 'Price' }, { model: 'vendor/uno', sort: 'price' }), true);
});

test('una misura vuota o assente non vale niente', () => {
  assert.equal(C.misuraValePer(null, { model: 'vendor/uno' }), false);
  assert.equal(C.misuraValePer({ model: 'vendor/uno' }, { model: 'vendor/uno' }), false);
});
