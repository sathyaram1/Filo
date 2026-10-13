// Sentinella: da Electron 44 gli appunti del main rispondono con una Promise. Letti senza attesa danno un oggetto, e chi
// lo confronta con un testo sbaglia in silenzio (la password svuotata dalla cronologia ci rientrava al primo «Incolla»).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LETTURA = /clipboard\.(readText|read|has)\s*\(/;
const ATTESA = /await\s[^;]*clipboard\.|\.then\(\s*\(\)\s*=>\s*clipboard\.|Promise\.resolve\(/;

function fileJs(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...fileJs(p));
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out;
}

test('ogni lettura degli appunti nel main aspetta la sua Promise', () => {
  const sbagliate = [];
  for (const f of fileJs(join(ROOT, 'src', 'main'))) {
    readFileSync(f, 'utf8').split('\n').forEach((riga, i) => {
      if (LETTURA.test(riga) && !ATTESA.test(riga)) sbagliate.push(`${relative(ROOT, f)}:${i + 1}: ${riga.trim()}`);
    });
  }
  assert.deepEqual(sbagliate, [], 'leggi gli appunti con `await clipboard.readText()` (o dentro un .then)');
});

test('la sentinella riconosce una lettura senza attesa', () => {
  assert.equal(LETTURA.test("const t = require('electron').clipboard.readText();"), true);
  assert.equal(ATTESA.test("const t = require('electron').clipboard.readText();"), false);
  assert.equal(ATTESA.test("const t = await require('electron').clipboard.readText();"), true);
});
