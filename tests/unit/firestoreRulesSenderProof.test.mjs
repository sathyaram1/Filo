// Sentinella #595: `senderProof` sul feedback è una PROVA solo finché nessun
// ramo non-admin delle regole lo può scrivere. Il server si fida di un prefisso
// riservato (owner:/routine:/agent:/local:) solo se il documento la porta.
// Prova col motore vero: feedbackMittente.motore-vero.mjs, accanto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

function bloccoFeedback() {
  const da = RULES.indexOf('match /feedback/{');
  const a = RULES.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco della collezione feedback non trovato');
  return RULES.slice(da, a).replace(/\/\/[^\n]*/g, '');
}

// Le scritture del blocco: { verbi, cond } con la condizione senza commenti.
function scritture() {
  const out = [];
  for (const m of bloccoFeedback().matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)) {
    const verbi = m[1].split(',').map((v) => v.trim());
    if (!verbi.some((v) => ['create', 'update', 'write'].includes(v))) continue;
    out.push({ verbi, cond: m[2].replace(/\s+/g, ' ').trim() });
  }
  assert.ok(out.length >= 4, 'firestore.rules: rami di scrittura del feedback non riconosciuti');
  return out;
}

const liste = (cond) => [...cond.matchAll(/hasOnly\(\s*\[([^\]]*)\]\s*\)/g)]
  .map((m) => [...m[1].matchAll(/'([A-Za-z_]\w*)'/g)].map((q) => q[1]));

test('la create anonima NON ammette senderProof', () => {
  const anonime = scritture().filter((s) => s.verbi.includes('create') && !/^isAdmin\(\)/.test(s.cond));
  assert.equal(anonime.length, 1, 'attesa una sola create non-admin');
  const [campi] = liste(anonime[0].cond);
  assert.ok(campi && campi.includes('text'), 'hasOnly della create anonima non trovata');
  assert.ok(!campi.includes('senderProof'),
    'la create anonima ammette senderProof: chiunque potrebbe firmarsi owner:/local: e il server gli crederebbe');
});

test('nessun ramo non-admin può scrivere senderProof, e ognuno ha la sua hasOnly', () => {
  for (const s of scritture()) {
    if (/^isAdmin\(\)/.test(s.cond)) continue;
    const l = liste(s.cond);
    assert.ok(l.length > 0, `ramo non-admin senza hasOnly (potrebbe scrivere qualunque campo): ${s.cond.slice(0, 120)}`);
    assert.ok(!l.flat().includes('senderProof'), `ramo non-admin che ammette senderProof: ${s.cond.slice(0, 120)}`);
  }
});

test('il ramo update admin ammette senderProof solo con i valori admin e server', () => {
  const admin = scritture().filter((s) => s.verbi.includes('update') && /^isAdmin\(\)/.test(s.cond));
  assert.equal(admin.length, 1, 'atteso un solo ramo update admin');
  assert.ok(liste(admin[0].cond)[0].includes('senderProof'), 'serve al ripasso dei documenti vecchi');
  assert.ok(
    admin[0].cond.includes("request.resource.data.senderProof in ['admin', 'server']"),
    'sparito il vincolo sul valore di senderProof nel ramo admin',
  );
});
