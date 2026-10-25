// Sentinella #1515: `inCoda` è il segno su cui la coda delle routine sceglie i feedback da servire. Lo scrive solo il
// server (Admin SDK) a ogni cambio di stato: nessun ramo delle regole lo ammette, nemmeno l'admin, che è anche ogni
// sessione locale. Prova col motore vero: feedbackAllegati.motore-vero.mjs, accanto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8').replace(/\/\/[^\n]*/g, '');
const CAMPO = 'inCoda';

function scritture() {
  const da = RULES.indexOf('match /feedback/{');
  const a = RULES.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco della collezione feedback non trovato');
  const out = [];
  for (const m of RULES.slice(da, a).matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)) {
    const verbi = m[1].split(',').map((v) => v.trim());
    if (!verbi.some((v) => ['create', 'update', 'write'].includes(v))) continue;
    out.push({ verbi, cond: m[2].replace(/\s+/g, ' ').trim() });
  }
  assert.ok(out.length >= 4, 'firestore.rules: rami di scrittura del feedback non riconosciuti');
  return out;
}

const liste = (cond) => [...cond.matchAll(/hasOnly\(\s*\[([^\]]*)\]\s*\)/g)]
  .map((m) => [...m[1].matchAll(/'([A-Za-z_]\w*)'/g)].map((q) => q[1]));

test('la create admin, senza hasOnly, vieta inCoda per nome', () => {
  const admin = scritture().filter((s) => s.verbi.includes('create') && /^isAdmin\(\)/.test(s.cond));
  assert.equal(admin.length, 1, 'attesa una sola create admin');
  const m = admin[0].cond.match(/!request\.resource\.data\.keys\(\)\.hasAny\(\[([^\]]*)\]\)/);
  assert.ok(m, 'la create admin non ha la lista dei campi vietati');
  assert.ok(m[1].includes(`'${CAMPO}'`), 'la create admin ammette inCoda: una sessione locale metterebbe in coda un feedback');
});

test('nessun altro ramo di scrittura ammette inCoda', () => {
  for (const s of scritture()) {
    if (s.verbi.includes('create') && /^isAdmin\(\)/.test(s.cond)) continue;
    const l = liste(s.cond);
    assert.ok(l.length > 0, `ramo senza hasOnly (potrebbe scrivere qualunque campo): ${s.cond.slice(0, 120)}`);
    assert.ok(!l.flat().includes(CAMPO), `un ramo ammette inCoda: ${s.cond.slice(0, 120)}`);
  }
});
