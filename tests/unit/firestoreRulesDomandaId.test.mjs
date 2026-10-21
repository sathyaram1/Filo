// Sentinella #1358: il legame fra un feedback fermo e la sua domanda (`domandaId`) lo scrive solo il server, con la
// domanda, nella stessa transazione. Nessun ramo di scrittura delle regole lo ammette: un client che se lo scrivesse
// sposterebbe un feedback dai Ricevuti a In coda, col segno verso una domanda che non è la sua.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

test('nessuna hasOnly delle regole del feedback ammette domandaId, e l’update admin ne ha una', () => {
  const da = RULES.indexOf('match /feedback/{');
  const a = RULES.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco della collezione feedback non trovato');
  const blocco = RULES.slice(da, a).replace(/\/\/[^\n]*/g, '');
  const rami = [...blocco.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)]
    .map((m) => ({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2] }))
    .filter((r) => r.verbi.some((v) => ['create', 'update', 'write'].includes(v)));
  assert.ok(rami.length >= 4, 'rami di scrittura del feedback non riconosciuti');
  const adminUpdate = rami.filter((r) => r.verbi.includes('update') && /^\s*isAdmin\(\)/.test(r.cond));
  assert.equal(adminUpdate.length, 1, 'atteso un solo ramo update admin');
  assert.match(adminUpdate[0].cond, /hasOnly\(/, 'l’update admin senza hasOnly potrebbe scrivere qualunque campo');
  for (const r of rami) {
    for (const m of r.cond.matchAll(/hasOnly\(\s*\[([^\]]*)\]\s*\)/g)) {
      assert.ok(!/'domandaId'/.test(m[1]), `un ramo ammette domandaId: ${r.cond.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
});
