// #839 — nel file dei dati entra solo un'anteprima piccola, e il processo
// principale non decodifica immagini che non ha prodotto lui (le rimpicciolisce
// una pagina isolata): qui la parte che si verifica senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { accettabile, grande, MAX_BYTE } = require(join(ROOT, 'src', 'main', 'services', 'miniature.js'));

const dataUrl = (byte, tipo = 'jpeg') => `data:image/${tipo};base64,` + 'A'.repeat(Math.ceil(byte / 3) * 4);

test('alla porta dei dati passa solo un\'anteprima già piccola', () => {
  const piccola = dataUrl(20 * 1024);
  assert.equal(accettabile(piccola), piccola);
  assert.equal(accettabile(dataUrl(20 * 1024, 'png')), dataUrl(20 * 1024, 'png'), 'una PNG minuscola di un backup resta com\'è');
  assert.equal(accettabile(dataUrl(MAX_BYTE + 3000)), '', 'una schermata intera non entra');
  for (const v of ['', null, undefined, 42, 'https://esempio.it/a.png', 'data:text/html;base64,AAAA']) {
    assert.equal(accettabile(v), '', `rifiutato: ${String(v)}`);
  }
});

test('«grande» vuol dire oltre la soglia, solo per le immagini', () => {
  assert.equal(grande(dataUrl(MAX_BYTE + 3000, 'png')), true);
  assert.equal(grande(dataUrl(MAX_BYTE - 3000)), false);
  assert.equal(grande('x'.repeat(MAX_BYTE * 2)), false);
});

test('il cammino delle miniature non decodifica immagini arrivate da fuori nel processo principale', () => {
  const file = [
    'src/main/services/miniature.js',
    'src/main/services/savedPages.js',
    'src/main/services/handlers/pages.js',
    'src/main/shortcuts.js',
  ];
  for (const f of file) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /createFrom(DataURL|Buffer|Bitmap|Path)\s*\(/, `${f} decodifica un'immagine nel processo principale`);
  }
});
