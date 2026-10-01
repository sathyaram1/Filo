// Sentinella #908: `localOnly` toglie una pratica alle routine, quindi lo scrive solo
// l'admin (create e ramo di triage), sempre nella forma { by, at } con `at` intero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8').replace(/\/\/[^\n]*/g, '');

function bloccoFeedback() {
  const da = RULES.indexOf('match /feedback/{');
  const a = RULES.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco della collezione feedback non trovato');
  return RULES.slice(da, a);
}

function scritture() {
  const out = [];
  for (const m of bloccoFeedback().matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)) {
    const verbi = m[1].split(',').map((v) => v.trim());
    if (!verbi.some((v) => ['create', 'update', 'write'].includes(v))) continue;
    out.push({ verbi, cond: m[2].replace(/\s+/g, ' ').trim() });
  }
  assert.ok(out.length >= 4, 'rami di scrittura del feedback non riconosciuti');
  return out;
}

const liste = (cond) => [...cond.matchAll(/hasOnly\(\s*\[([^\]]*)\]\s*\)/g)]
  .map((m) => [...m[1].matchAll(/'([A-Za-z_]\w*)'/g)].map((q) => q[1]));

test('nessun ramo non-admin nomina localOnly', () => {
  for (const s of scritture()) {
    if (/^isAdmin\(\)/.test(s.cond)) continue;
    assert.ok(!liste(s.cond).flat().includes('localOnly'), `ramo non-admin che ammette localOnly: ${s.cond.slice(0, 120)}`);
    assert.ok(!s.cond.includes('localOnly'), `ramo non-admin che parla di localOnly: ${s.cond.slice(0, 120)}`);
  }
});

test('create e update admin controllano la forma di localOnly', () => {
  const admin = scritture().filter((s) => /^isAdmin\(\)/.test(s.cond));
  const create = admin.filter((s) => s.verbi.includes('create'));
  const update = admin.filter((s) => s.verbi.includes('update'));
  assert.equal(create.length, 1);
  assert.equal(update.length, 1);
  assert.match(create[0].cond, /localOnlyValido\(request\.resource\.data\)/);
  assert.ok(liste(update[0].cond)[0].includes('localOnly'), 'il triage admin deve poterlo mettere e togliere');
  assert.match(update[0].cond, /localOnlyValido\(request\.resource\.data\)/);
});

test('la forma: una mappa con by (testo, non vuoto) e at (intero)', () => {
  const m = /function localOnlyValido\(d\) \{([\s\S]*?)\n\s*\}/.exec(RULES);
  assert.ok(m, 'funzione localOnlyValido non trovata');
  const corpo = m[1].replace(/\s+/g, ' ');
  assert.match(corpo, /!\('localOnly' in d\)/, 'assente = feedback normale');
  assert.match(corpo, /keys\(\)\.hasOnly\(\['by', 'at'\]\)/);
  assert.match(corpo, /get\('by', ''\) is string/);
  assert.match(corpo, /get\('by', ''\)\.size\(\) > 0/);
  assert.match(corpo, /get\('at', 0\) is int/);
});

test('una scheda pubblica non si scrive per un lavoro locale, anche da un codice che non lo sa', () => {
  const da = RULES.indexOf('match /feedback-public/{');
  const a = RULES.indexOf('match /counters/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco di feedback-public non trovato');
  const rami = [...RULES.slice(da, a).matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)]
    .map((m) => ({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].replace(/\s+/g, ' ').trim() }));
  const pubblicatore = rami.filter((r) => r.verbi.includes('create'));
  assert.equal(pubblicatore.length, 1, 'un solo ramo crea le schede');
  assert.match(pubblicatore[0].cond, /^\(isAdmin\(\) \|\| isRoutine\(\)\)/);
  assert.ok(pubblicatore[0].cond.includes("!('localOnly' in get(/databases/$(database)/documents/feedback/$(doc)).data)"),
    'il segno sta sul feedback vero: la scheda con lo stesso id si rifiuta finché c\'è');
  const togli = rami.filter((r) => r.verbi.includes('delete'));
  assert.equal(togli.length, 1);
  assert.ok(!togli[0].cond.includes('localOnly'), 'togliere una scheda deve funzionare sempre');
});
