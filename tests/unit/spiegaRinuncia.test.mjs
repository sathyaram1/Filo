// Cosa resta da mostrare quando «Spiega» rinuncia (#724).
// La rinuncia non deve portarsi via la conversione scritta accanto.
// Regola e prompt che la genera: src/shared/constants.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
const { spiegazioneDaMostrare: resta, PROMPTS } = globalThis.SN_CONST;

test('la rinuncia da sola è una rinuncia', () => {
  assert.equal(resta('NESSUNA SPIEGAZIONE'), '');
  assert.equal(resta('  nessuna spiegazione.  '), '');
  assert.equal(resta('NESSUNA SPIEGAZIONE()'), '');
  assert.equal(resta(''), '');
  assert.equal(resta(null), '');
});

test('la conversione accanto alla rinuncia resta da leggere', () => {
  // Il prompt chiede al modello due cose insieme: di rinunciare sul testo
  // italiano comune e di convertire gli importi in valuta. «3000 rupie» è tutti
  // e due, e prima Filo buttava via la risposta intera.
  assert.equal(resta('NESSUNA SPIEGAZIONE (3000 rupie = circa 32,61 €)'), '3000 rupie = circa 32,61 €');
  assert.equal(resta('NESSUNA SPIEGAZIONE. 70°F sono 21,11 °C'), '70°F sono 21,11 °C');
  assert.equal(resta('3000 rupie = circa 32,61 €\nNESSUNA SPIEGAZIONE'), '3000 rupie = circa 32,61 €');
});

test('una spiegazione normale passa intera', () => {
  assert.equal(resta('Moneta dell\'India.'), 'Moneta dell\'India.');
  assert.equal(resta('  (nota fra parentesi)  '), '(nota fra parentesi)');
});

test('il prompt dice al modello quale delle due istruzioni vince', () => {
  const testo = PROMPTS.explain({ selection: '3000 rupie', sentence: '3000 rupie', fxLine: 'Cambi attuali: 1 EUR = 92.00 INR.' });
  assert.match(testo, /NON rispondere "NESSUNA SPIEGAZIONE"/);
});
