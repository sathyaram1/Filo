// Sentinella #1076: voti e riaperture della bacheca. Un account anonimo è gratis, quindi nessun ramo non-admin scrive
// `reopenRequests` (lo scrive il server, che fa pagare il portafoglio), sulla collezione vera nessun ramo non-admin
// nomina `votes` o `reopenRequests`, e il voto sulla scheda vuole un portafoglio e un peso entro il tetto dell'app.
// Prova col motore vero, a mano: tests/rules/bacheca-motore-vero.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
createRequire(import.meta.url)(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

function blocco(da, a) {
  const i = RULES.indexOf(da);
  const j = RULES.indexOf(a, i + 1);
  assert.ok(i > 0 && j > i, `firestore.rules: blocco ${da} non trovato`);
  return RULES.slice(i, j).replace(/\/\/[^\n]*/g, '');
}

function scritture(testo) {
  const out = [];
  for (const m of testo.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)) {
    const verbi = m[1].split(',').map((v) => v.trim());
    if (!verbi.some((v) => ['create', 'update', 'write'].includes(v))) continue;
    out.push({ verbi, cond: m[2].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

const privata = () => scritture(blocco('match /feedback/{', 'match /feedback-public/{'));
const scheda = () => scritture(blocco('match /feedback-public/{', 'match /counters/{'));
const diAdmin = (s) => /^\(?\s*isAdmin\(\)/.test(s.cond);

test('collezione vera: nessun ramo non-admin nomina votes o reopenRequests', () => {
  const rami = privata();
  assert.ok(rami.length >= 4, 'rami di scrittura del feedback non riconosciuti');
  for (const s of rami.filter((r) => !diAdmin(r))) {
    assert.ok(!/\bvotes\b|\breopenRequests\b/.test(s.cond), `ramo non-admin che scrive voti o riaperture: ${s.cond.slice(0, 160)}`);
  }
});

test('scheda pubblica: reopenRequests lo scrivono solo owner e server', () => {
  const rami = scheda();
  assert.ok(rami.length >= 2, 'rami di scrittura della scheda non riconosciuti');
  for (const s of rami.filter((r) => !diAdmin(r))) {
    assert.ok(!/\breopenRequests\b/.test(s.cond), `ramo utente che scrive reopenRequests: ${s.cond.slice(0, 160)}`);
  }
});

test('scheda pubblica: il voto vuole un portafoglio attivo e un peso entro il tetto dell\'app', () => {
  const voti = scheda().filter((r) => !diAdmin(r) && /\bvotes\b/.test(r.cond));
  assert.equal(voti.length, 1, 'atteso un solo ramo utente per i voti');
  const c = voti[0].cond;
  assert.match(c, /exists\(\/databases\/\$\(database\)\/documents\/wallet-accounts\/\$\(request\.auth\.uid\)\)/);
  assert.match(c, /wallet-accounts\/\$\(request\.auth\.uid\)\)\.data\.get\('disabled', false\) != true/);
  assert.match(c, /\.hasOnly\(\[request\.auth\.uid\]\)/, 'il voto tocca solo la chiave di chi vota');
  const tetto = c.match(/credibilitySnapshot <= ([\d.]+)/);
  assert.ok(tetto, 'manca il tetto a credibilitySnapshot');
  assert.equal(Number(tetto[1]), FB.CREDIBILITY_MAX, 'il tetto delle regole e quello con cui l\'app conta i voti divergono');
});
