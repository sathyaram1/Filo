// Sentinella: in italiano Filo scrive le migliaia col punto anche a quattro cifre (4.990, 1.200). Da Electron 44 il
// default di Intl per l'italiano le lascia senza (4990), e i saldi e i conteggi cambiavano aspetto da soli: ogni numero
// formattato in italiano chiede `useGrouping: true`. Le date restano come sono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = /\b(day|month|year|hour|minute|second|weekday|dateStyle|timeStyle)\b/;

function sorgenti(dir = join(ROOT, 'src'), out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) sorgenti(p, out);
    else if (/\.(js|html)$/.test(nome)) out.push(p);
  }
  return out;
}

test('ogni numero formattato in italiano tiene il punto delle migliaia anche a quattro cifre', () => {
  const senza = [];
  for (const p of sorgenti()) {
    const src = readFileSync(p, 'utf8');
    const dove = (i) => `${relative(ROOT, p).replace(/\\/g, '/')}:${src.slice(0, i).split('\n').length}`;
    for (const m of src.matchAll(/new Intl\.NumberFormat\(([^)]*)\)/g)) {
      if (!m[1].includes('useGrouping')) senza.push(dove(m.index));
    }
    for (const m of src.matchAll(/\.toLocaleString\(\s*['"]it(?:-IT)?['"]\s*(,\s*\{[^}]*\})?\s*\)/g)) {
      const opzioni = m[1] || '';
      if (opzioni.includes('useGrouping') || DATA.test(opzioni)) continue;
      if (/Date\([^)]*\)\s*$/.test(src.slice(Math.max(0, m.index - 60), m.index))) continue;
      senza.push(dove(m.index));
    }
  }
  assert.deepEqual(senza, [], 'qui un numero in italiano esce senza il punto delle migliaia: aggiungi { useGrouping: true }');
});

test('con useGrouping il motore scrive 4.990, senza no', () => {
  assert.equal(new Intl.NumberFormat('it-IT', { useGrouping: true }).format(4990), '4.990');
  assert.equal(new Intl.NumberFormat('it-IT', { useGrouping: true, minimumFractionDigits: 2 }).format(1234.5), '1.234,50');
  assert.equal((999).toLocaleString('it-IT', { useGrouping: true }), '999');
});
