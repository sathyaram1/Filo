// Sentinella: sotto tests/ una finestra non si riconosce dall'inizio di un indirizzo che più finestre condividono
// (`'data:'`, `'filo://shell/'`): il fumetto nato all'avvio veniva preso per il menu, poi per la finestra principale (#1722).
// Si usa l'indirizzo esatto della pagina o `_filoTabs`. Le prove dei giri (tests/verifica/) restano com'erano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFISSO_CONDIVISO = /startsWith\(\s*(['"`])(data:|filo:\/\/shell\/?)\1\s*\)/;

function fileDiTest(dir = TESTS, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules' || nome === 'verifica') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out);
    else if (/\.(mjs|js|cjs)$/.test(nome)) out.push(p);
  }
  return out;
}

test('nessuna prova riconosce una finestra da un prefisso che il fumetto, il menu e la finestra principale condividono', () => {
  const trovati = [];
  for (const f of fileDiTest()) {
    const rel = relative(TESTS, f);
    // Gli unit test non aprono finestre: un `'data:'` lì è un indirizzo dentro un HTML.
    if (rel.split(/[\\/]/)[0] === 'unit') continue;
    readFileSync(f, 'utf8').split('\n').forEach((riga, i) => {
      if (PREFISSO_CONDIVISO.test(riga)) trovati.push(`${rel}:${i + 1}: ${riga.trim()}`);
    });
  }
  assert.deepEqual(trovati, [], `indirizzo esatto della pagina, o la finestra con _filoTabs:\n${trovati.join('\n')}`);
});

test('la guardia riconosce il prefisso nudo e lascia passare l\'indirizzo esatto', () => {
  assert.ok(PREFISSO_CONDIVISO.test("w.url().startsWith('data:')"));
  assert.ok(PREFISSO_CONDIVISO.test('w.getURL().startsWith("filo://shell/")'));
  assert.ok(PREFISSO_CONDIVISO.test("u.startsWith('filo://shell')"));
  assert.ok(!PREFISSO_CONDIVISO.test("w.url().startsWith('filo://shell/shell.html')"));
  assert.ok(!PREFISSO_CONDIVISO.test("w.url().startsWith('data:text/html')"));
});
