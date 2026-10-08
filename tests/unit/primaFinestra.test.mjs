// Sentinella: sotto tests/ la prima finestra di Filo si prende da tests/helpers/primaFinestra.mjs, mai con
// `firstWindow()` nudo: da Electron 44 arriva vuota e naviga subito dopo, e lo spec cade con «Execution context was
// destroyed». Le prove dei giri (tests/verifica/) restano com'erano: le scrive e le corre chi verifica.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');

function fileDiTest(dir = TESTS, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules' || nome === 'verifica') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out);
    else if (/\.(mjs|js|cjs)$/.test(nome)) out.push(p);
  }
  return out;
}

test('la prima finestra di Filo si aspetta col suo documento, non con firstWindow() nudo', () => {
  const nudi = fileDiTest()
    .filter((p) => !p.endsWith(join('helpers', 'primaFinestra.mjs')) && !p.endsWith(join('unit', 'primaFinestra.test.mjs')))
    .filter((p) => /\.firstWindow\s*\(/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(TESTS, p).replace(/\\/g, '/'));
  assert.deepEqual(nudi, [], 'usa `primaFinestra(app)` da tests/helpers/primaFinestra.mjs');
});
