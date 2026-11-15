// La prova del test nuovo (#2505): su un ramo di prova in un repo temporaneo, il caso che prova il lavoro esce rosso senza
// e verde con; un caso verde anche senza il lavoro esce segnalato. I test girano davvero (node --test), Playwright no.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { esitiDaPlaywright, esitiDaTap, provaTestNuovi, testNuoviDelRamo, testoDellaProva } from '../../scripts/lib/prova-test-nuovi.mjs';

function ramoDiProva() {
  const root = cartellaTemporanea('filo-prova-nuovi-test-');
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const scrivi = (f, t) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'prova@example.invalid');
  g('config', 'user.name', 'prova');
  g('config', 'core.hooksPath', join(root, '.git', 'nessun-gancio'));
  scrivi('src/somma.mjs', 'export const somma = (a, b) => a - b;\n');
  scrivi('tests/unit/vecchio.test.mjs', "import { test } from 'node:test';\ntest('vecchio caso', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'lavoro');
  scrivi('src/somma.mjs', 'export const somma = (a, b) => a + b;\n');
  scrivi('tests/unit/somma.test.mjs', [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { somma } from '../../src/somma.mjs';",
    "test('somma due numeri', () => { assert.equal(somma(2, 3), 5); });",
    "test('somma col neutro', () => { assert.equal(somma(4, 0), 4); });",
    '',
  ].join('\n'));
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  return { root, base, head: g('rev-parse', 'HEAD') };
}

test('sul ramo di prova: rosso senza il lavoro e verde con; il caso verde anche senza esce segnalato', () => {
  const { root, base, head } = ramoDiProva();
  try {
    assert.deepEqual(testNuoviDelRamo(root, base, head), [{ file: 'tests/unit/somma.test.mjs', tipo: 'unit', casi: ['somma due numeri', 'somma col neutro'] }]);
    const p = provaTestNuovi({ root, base, head });
    assert.deepEqual(p.casi, [
      { file: 'tests/unit/somma.test.mjs', caso: 'somma due numeri', senza: 'rosso', con: 'verde' },
      { file: 'tests/unit/somma.test.mjs', caso: 'somma col neutro', senza: 'verde', con: 'verde' },
    ]);
    assert.equal(p.verdiSenza, 1);
    assert.equal(p.nonVerdiCon, 0);
    assert.match(testoDellaProva(p), /somma col neutro: senza verde, con verde {2}VERDE ANCHE SENZA IL LAVORO/);
    assert.doesNotMatch(testoDellaProva(p), /somma due numeri.*VERDE ANCHE/);
    assert.equal(execFileSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length, 1, 'le copie si tolgono');
  } finally { togliCartella(root); }
});

test('un ramo senza prove nuove lo dice, non inventa casi', () => {
  const { root, base } = ramoDiProva();
  try {
    const p = provaTestNuovi({ root, base, head: base });
    assert.deepEqual(p.casi, []);
    assert.match(testoDellaProva(p), /nessun caso di prova nuovo o cambiato/);
  } finally { togliCartella(root); }
});

test('i rapporti: TAP di node --test e JSON di Playwright, saltati esclusi', () => {
  const tap = ['ok 1 - uno', 'not ok 2 - due', 'ok 3 - tre # SKIP manca', '    not ok 1 - dentro'].join('\n');
  assert.deepEqual([...esitiDaTap(tap)], [['uno', 'verde'], ['due', 'rosso'], ['dentro', 'rosso']]);
  const pw = { suites: [{ specs: [{ title: 'a', tests: [{ status: 'expected' }] }], suites: [{ specs: [{ title: 'b', tests: [{ status: 'unexpected' }] }, { title: 'c', tests: [{ status: 'skipped' }] }] }] }] };
  assert.deepEqual([...esitiDaPlaywright(pw)], [['a', 'verde'], ['b', 'rosso']]);
});
