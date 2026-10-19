// I segnaposto «%s» di SN_I18N.t si riempiono in un passaggio solo: un argomento scritto da qualcuno (un nickname
// di Modelli predefiniti, #833) che contiene «%s» o «$&» resta com'è e non sposta gli argomenti dopo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = {};
new Function('globalThis', readFileSync(resolve(ROOT, 'src/shared/i18n.js'), 'utf8')).call(g, g);
const I18n = g.SN_I18N;

test('ogni argomento va al suo segnaposto, anche se contiene «%s»', () => {
  assert.equal(I18n.t('admin_defaults_open_weights_to', 'mio%s', 'Spiega'), 'Passano a mio%s: Spiega');
});

test('i caratteri speciali di replace in un argomento restano lettere', () => {
  assert.equal(I18n.t('admin_defaults_open_weights_to', "a$&b$'c", 'Spiega'), "Passano a a$&b$'c: Spiega");
});

test('meno argomenti che segnaposto: quelli in più restano scritti, come prima', () => {
  assert.equal(I18n.t('admin_defaults_open_weights_to', 'deepseek'), 'Passano a deepseek: %s');
  assert.equal(I18n.t('options_open_weights_unavailable', 'Spiega', 'avanzo'), 'Si fermano (nessun equivalente a pesi aperti): Spiega');
});
