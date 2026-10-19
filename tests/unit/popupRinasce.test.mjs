// Una finestra a comparsa riusata (menu, fumetto, carta d'anteprima) col processo morto si butta e rinasce:
// tenuta, lascerebbe la finestra di Filo senza quel pezzo fino al riavvio (#1090).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const main = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main');

test('ogni finestra a comparsa riusata ascolta la morte del suo processo e si butta', () => {
  const file = readdirSync(main).filter((f) => /^popup-.*\.js$/.test(f));
  const conFinestra = file.filter((f) => /new BrowserWindow\(/.test(readFileSync(join(main, f), 'utf8')));
  assert.ok(conFinestra.length >= 3, `attese almeno tre finestre a comparsa, trovate: ${conFinestra.join(', ')}`);
  for (const f of conFinestra) {
    const src = readFileSync(join(main, f), 'utf8');
    assert.match(src, /\.on\('render-process-gone'/, `${f}: nessun ascolto della morte del processo`);
    assert.match(src, /\.destroy\(\)/, `${f}: la finestra col processo morto non si butta`);
  }
});
