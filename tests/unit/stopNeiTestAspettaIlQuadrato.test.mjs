// Sentinella (#2180): il quadrato ignora i clic per mezzo secondo da quando compare (#1296), quindi uno spec che lo
// clicca prima aspetta `quadratoPronto` (tests/helpers/copione.mjs). Senza, su una macchina veloce lo stop non parte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALTA = new Set(['unit', 'verifica', 'node_modules', 'fixtures', 'helpers']);
const RIGHE_PRIMA = 6;

function spec(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return d.name.startsWith('.') || SALTA.has(d.name) ? [] : spec(join(dir, d.name));
    return d.name.endsWith('.spec.mjs') ? [join(dir, d.name)] : [];
  });
}

test('ogni clic sul quadrato di stop in uno spec aspetta che il quadrato sia pronto', () => {
  const scoperti = [];
  for (const file of spec(TESTS)) {
    const righe = readFileSync(file, 'utf8').split('\n');
    righe.forEach((riga, i) => {
      if (!/#stopBtn['"]\)\.click\(/.test(riga)) return;
      const prima = righe.slice(Math.max(0, i - RIGHE_PRIMA), i).join('\n');
      if (!/quadratoPronto\(|waitForTimeout\(\s*([6-9]\d\d|\d{4,})/.test(prima)) scoperti.push(`${relative(TESTS, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(scoperti, [], 'clic sullo stop senza `await quadratoPronto(page)` nelle righe prima');
});
