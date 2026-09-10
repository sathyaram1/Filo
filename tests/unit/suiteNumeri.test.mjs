// Sentinella: i numeri della suite sono scritti in un posto solo, e gli altri
// documenti non li contraddicono.
//
// Il 2026-09-10 CLAUDE.md ha corretto la misura della suite (~390 spec,
// ~1.600 casi, quasi sette ore sulla macchina di chi sviluppa Filo) e la
// regola che ne segue (in locale non si lancia: `npm run finish:check`). La
// verifica di quel lavoro ha trovato la misura vecchia — «~100 spec, ~25 min»,
// «~465 volte in ~11 min» — ancora scritta nel README, in due spec di
// progetto e nella configurazione dei test, e in un documento persino la
// regola opposta dichiarata come vigente. Un numero vecchio in un documento
// che nessuno rilegge resta lì finché qualcuno non lo prende per vero.
//
// Diventa rossa se: un documento del repo torna a citare le misure vecchie;
// il numero di spec o di casi dichiarato in CLAUDE.md si allontana da quello
// dichiarato nel README; CLAUDE.md smette di indicare `finish:check`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const leggi = (f) => readFileSync(resolve(ROOT, f), 'utf8');

const DOCUMENTI = [
  'CLAUDE.md',
  'README.md',
  'ROUTINE-BRANCH-INTEGRITY.md',
  'SPEC-RIDISEGNO-MAX.md',
  'routines/roles/verifier.md',
  'playwright.config.js',
  'scripts/finish-local.mjs',
];

const MISURE_VECCHIE = /~100 spec|~25 min|~465 volte|~11 min/;

test('nessun documento del repo cita più le misure vecchie della suite', () => {
  for (const f of DOCUMENTI) {
    const m = leggi(f).match(MISURE_VECCHIE);
    assert.equal(m, null, `${f} cita ancora «${m && m[0]}»: la suite è ~390 spec, ~1.600 casi, quasi sette ore in locale`);
  }
});

test('README e CLAUDE.md dichiarano la stessa misura della suite', () => {
  const daClaude = leggi('CLAUDE.md').match(/SUITE COMPLETA \(~(\d+) spec, ~([\d.]+) casi\)/);
  assert.ok(daClaude, 'CLAUDE.md dichiara spec e casi della suite');
  const daReadme = leggi('README.md').match(/suite Playwright completa \(~(\d+) spec, ~([\d.]+) casi\)/);
  assert.ok(daReadme, 'README.md dichiara spec e casi della suite');
  assert.equal(daReadme[1], daClaude[1], 'numero di spec');
  assert.equal(daReadme[2], daClaude[2], 'numero di casi');
});

test('chi legge il README trova il comando dei controlli in locale', () => {
  assert.match(leggi('README.md'), /npm run finish:check/);
  assert.match(leggi('CLAUDE.md'), /npm run finish:check/);
});

test('il documento sull\'integrità del ramo non dichiara più rimossa la regola', () => {
  const t = leggi('ROUTINE-BRANCH-INTEGRITY.md');
  assert.doesNotMatch(t, /è stata \*\*rimossa\*\* da\n`CLAUDE\.md`/);
  assert.match(t, /finish:check/);
});
