// La politica sui modelli pubblica è una sola, transparency/models.md: una versione superata in radice, o un rimando
// della guida alla sicurezza verso un file che non c'è o non è la politica di oggi, manda chi legge alla regola sbagliata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const radice = fileURLToPath(new URL('../../', import.meta.url));
const SEGNO_DI_OGGI = /modelli stretti/;

test('ogni copia della politica sui modelli in radice è la versione di oggi, non una superata', () => {
  assert.match(readFileSync(join(radice, 'transparency', 'models.md'), 'utf8'), SEGNO_DI_OGGI);
  const copie = readdirSync(radice).filter(n => /^filo-model-policy.*\.md$/.test(n));
  for (const n of copie) {
    assert.match(readFileSync(join(radice, n), 'utf8'), SEGNO_DI_OGGI, `${n} è una versione superata: va fuori dal repo`);
  }
});

test('i documenti citati dalla guida alla sicurezza esistono, e la politica citata è quella pubblicata', () => {
  const guida = readFileSync(join(radice, 'SECURITY.md'), 'utf8');
  const citati = [...new Set([...guida.matchAll(/`([^`\s]+\.md)`/g)].map(m => m[1]))];
  assert.ok(citati.length > 0);
  for (const c of citati) assert.ok(existsSync(join(radice, c)), `la guida cita ${c}, che non c'è`);
  for (const c of citati.filter(c => /model/.test(c))) {
    assert.match(readFileSync(join(radice, c), 'utf8'), SEGNO_DI_OGGI, `la guida manda a ${c}, versione superata`);
  }
});
