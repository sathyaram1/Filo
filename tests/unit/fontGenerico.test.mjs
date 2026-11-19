// Sentinella di src/shared/fontGenerico.js (#1342): sui siti i riquadri chiusi usano la famiglia generica più vicina
// al carattere scelto, scritta come parola chiave senza virgolette (un @font-face del sito non la ridichiara).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
require(join(ROOT, 'src', 'shared', 'aestheticRefiner.js'));
require(join(ROOT, 'src', 'shared', 'fontGenerico.js'));
const F = globalThis.SN_FONT_GENERICO;
const SCELTE = globalThis.SN_AESTHETIC_REFINER?.FONT_CHOICES || globalThis.SN_AESTHETIC?.FONT_CHOICES;

// Solo parole chiave generiche, separate da virgola: niente virgolette, niente nomi di famiglia.
function soloParoleChiave(g) {
  assert.equal(typeof g, 'string');
  assert.doesNotMatch(g, /['"]/, `${g}: niente virgolette`);
  for (const p of g.split(',').map((s) => s.trim())) assert.ok(F.PAROLE.has(p), `${p} non è una famiglia generica`);
}

test('ogni carattere proposto da Filo ha una famiglia generica valida, quella che gli somiglia', () => {
  assert.ok(Array.isArray(SCELTE) && SCELTE.length >= 5, 'le scelte delle impostazioni si leggono');
  const attese = {
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif": 'system-ui, sans-serif',
    "Georgia, 'Times New Roman', serif": 'serif',
    'Verdana, Geneva, sans-serif': 'sans-serif',
    "'Courier New', ui-monospace, monospace": 'monospace',
    "'Trebuchet MS', Tahoma, sans-serif": 'sans-serif',
  };
  for (const { value } of SCELTE) {
    const g = F.generica(value);
    soloParoleChiave(g);
    assert.ok(globalThis.SN_THEME_TOKENS.validate('font', value), `${value} è un valore accettato`);
    if (attese[value]) assert.equal(g, attese[value], value);
  }
});

test('il carattere predefinito resta quello di sistema: chi non sceglie non vede cambiare niente', () => {
  assert.equal(F.generica(undefined), 'system-ui, sans-serif');
  assert.equal(F.generica(''), 'system-ui, sans-serif');
  assert.equal(F.generica(globalThis.SN_THEME_TOKENS.get('font').default), 'system-ui, sans-serif');
});

test('i nomi scritti a mano, con o senza virgolette e maiuscole, trovano la loro famiglia', () => {
  assert.equal(F.generica('Georgia'), 'serif');
  assert.equal(F.generica('"georgia"'), 'serif');
  assert.equal(F.generica('Consolas'), 'monospace');
  assert.equal(F.generica("'Comic Sans MS', cursive"), 'cursive');
  assert.equal(F.generica('Arial'), 'sans-serif');
});

test('uno sconosciuto dà sans-serif, a meno che la sua pila dichiari la sua generica', () => {
  assert.equal(F.generica('Carattere Inventato'), 'sans-serif');
  assert.equal(F.generica('Rockwell, serif'), 'serif');
  assert.equal(F.generica('Qualcosa, ui-monospace'), 'monospace');
  for (const v of ['Carattere Inventato', 'Rockwell, serif', ', ,', '"', "'Spia'", 'fantasy']) soloParoleChiave(F.generica(v));
});

test('ogni voce della tabella è una famiglia generica', () => {
  for (const [nome, g] of Object.entries(F.TABELLA)) {
    assert.equal(nome, nome.toLowerCase(), `${nome}: le chiavi sono minuscole`);
    soloParoleChiave(g);
  }
});
