// Sentinella: nessun test riduce a icona la finestra da solo, passa da tests/helpers/riduzione.mjs.
// Senza gestore di finestre (routine, suite in GitHub) `minimize()` non avviene: a mano la prova o è
// rossa lì (#810.10), o prova un'altra uscita dalla vista e la riduzione resta provata solo su Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const AMMESSO = join(TESTS, 'helpers', 'riduzione.mjs');

function fileDiTest(dir = TESTS, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out);
    else if (/\.(m|c)?js$/.test(nome)) out.push(p);
  }
  return out;
}

test('nessun test chiama minimize() fuori dall\'helper della riduzione', () => {
  const colpevoli = fileDiTest()
    .filter((p) => p !== AMMESSO && /\.minimize\s*\(/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(TESTS, p).replace(/\\/g, '/'));
  assert.deepEqual(colpevoli, [],
    'questi file riducono a icona da soli: usa `riduciAIcona(app)` e `rialza(app, come)` da '
    + 'tests/helpers/riduzione.mjs, che senza gestore di finestre finge la risposta del sistema');
});

test('l\'helper si accorge che la riduzione non è avvenuta e finge la risposta del sistema', () => {
  const testo = readFileSync(AMMESSO, 'utf8');
  assert.match(testo, /\.minimize\s*\(/);
  assert.match(testo, /isMinimized\s*=\s*\(\)\s*=>\s*true/, 'senza gestore di finestre isMinimized deve rispondere vero');
  assert.match(testo, /emit\(\s*'minimize'\s*\)/, 'e la finestra deve dare l\'evento che il sistema darebbe');
  assert.doesNotMatch(testo, /\.hide\s*\(/, 'nascondere al posto di ridurre prova un\'altra strada');
});
