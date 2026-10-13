// Sentinella #1148: la fiducia (SPEC-DOMANDE.md §1.7) la scrive solo l'Admin SDK. Nessun ramo delle regole, admin
// compreso (l'admin è anche ogni sessione locale), ammette `fiducia`, `fiduciaDa`, `genitori` o `mergePreapproved`;
// `bigliettoLocale` solo nella create admin. Prova col motore vero: feedbackMittente.motore-vero.mjs, accanto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const VIETATI = ['fiducia', 'fiduciaDa', 'genitori', 'mergePreapproved'];

function bloccoFeedback() {
  const da = RULES.indexOf('match /feedback/{');
  const a = RULES.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco della collezione feedback non trovato');
  return RULES.slice(da, a).replace(/\/\/[^\n]*/g, '');
}

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

test('la create admin (senza vincoli di forma) vieta esplicitamente i campi della fiducia', () => {
  const admin = scritture().filter((s) => s.verbi.includes('create') && /^isAdmin\(\)/.test(s.cond));
  assert.equal(admin.length, 1, 'attesa una sola create admin');
  const m = admin[0].cond.match(/!request\.resource\.data\.keys\(\)\.hasAny\(\[([^\]]*)\]\)/);
  assert.ok(m, 'la create admin non vieta i campi della fiducia: una sessione locale potrebbe scriversi fidata');
  const vietati = [...m[1].matchAll(/'([A-Za-z_]\w*)'/g)].map((q) => q[1]);
  for (const campo of VIETATI) assert.ok(vietati.includes(campo), `la create admin ammette ${campo}`);
  assert.match(admin[0].cond, /bigliettoLocaleValido\(request\.resource\.data\)/, 'forma del biglietto locale non controllata');
});

test('ogni altro ramo di scrittura ha la sua hasOnly, e nessuna ammette la fiducia o il biglietto locale', () => {
  for (const s of scritture()) {
    if (s.verbi.includes('create') && /^isAdmin\(\)/.test(s.cond)) continue;
    const l = liste(s.cond);
    assert.ok(l.length > 0, `ramo senza hasOnly (potrebbe scrivere qualunque campo): ${s.cond.slice(0, 120)}`);
    for (const campo of VIETATI.concat(['bigliettoLocale'])) {
      assert.ok(!l.flat().includes(campo), `un ramo ammette ${campo}: ${s.cond.slice(0, 120)}`);
    }
  }
});

test('il ramo update admin non tiene più la forma di mergePreapproved: il campo non si scrive', () => {
  const admin = scritture().filter((s) => s.verbi.includes('update') && /^isAdmin\(\)/.test(s.cond));
  assert.equal(admin.length, 1, 'atteso un solo ramo update admin');
  assert.ok(!admin[0].cond.includes('mergePreapproved'), 'il ramo admin parla ancora di mergePreapproved');
});

test('bigliettoLocale: una stringa di al più 64 caratteri, facoltativa', () => {
  const f = RULES.match(/function bigliettoLocaleValido\(d\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(f, 'funzione bigliettoLocaleValido non trovata');
  const corpo = f[1].replace(/\s+/g, ' ');
  assert.match(corpo, /!\('bigliettoLocale' in d\)/);
  assert.match(corpo, /d\.bigliettoLocale is string && d\.bigliettoLocale\.size\(\) <= 64/);
});
