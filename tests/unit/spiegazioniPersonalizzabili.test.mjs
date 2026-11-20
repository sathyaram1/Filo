// Sentinella #2388: ogni stile delle spiegazioni al passaggio che i fogli o lo script leggono (--sn-spiega-*) è fra quelli
// che l'utente cambia in Preferenze o chiedendo a Filo; e la chat dei Mazzi riapre i nomi delle carte con la tabella del
// renderer, non con una copia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
require(join(ROOT, 'src', 'shared', 'filoMarkdown.js'));
const T = globalThis.SN_THEME_TOKENS;
const Md = globalThis.SN_MARKDOWN;

test('#2388 gli stili --sn-spiega-* letti da fogli e script sono token modificabili', () => {
  const sorgenti = ['src/styles/theme.css', 'src/shared/spiegazioni.js'].map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');
  const usati = [...new Set(sorgenti.match(/--sn-spiega-[a-z-]+/g) || [])];
  assert.ok(usati.length >= 2, 'le spiegazioni leggono almeno attesa e colore');
  const registrati = new Set(T.names().map((n) => T.get(n).css));
  assert.deepEqual(usati.filter((v) => !registrati.has(v)), []);
  assert.equal(T.durataMs(T.defaultValue('spiega.ritardo')), 350);
  assert.equal(T.validate('spiega.colore', 'red; x'), false);
});

test('#2388 disescapa riapre tutto quello che escapeHtml chiude, e i Mazzi usano quella', () => {
  const s = `Urza's Saga & <Co> "x"`;
  assert.equal(Md.disescapa(Md.escapeHtml(s)), s);
  const mazzi = readFileSync(join(ROOT, 'src', 'pages', 'decks', 'decks.js'), 'utf8');
  assert.match(mazzi, /Md\.disescapa\(/);
  assert.doesNotMatch(mazzi, /'&#39;': "'"/);
});
