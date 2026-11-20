// Nei passi dei workflow niente `comando | grep -q`: con `shell: bash` Actions accende pipefail, grep -q esce alla
// prima riga trovata e il SIGPIPE di chi scrive ancora fa fallire il tubo, cioè un «manca» falso (#2402).
// Si scrive `grep -q … <<< "$VAR"`; la prova eseguita sta in releaseWindows.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

const TUBO_IN_GREP_Q = /\|\s*grep\s+(?:-[A-Za-z]*q|[^|\n]*\s-[A-Za-z]*q\b|[^|\n]*--quiet\b)/;

test('il riconoscitore prende le forme del tubo in grep -q e lascia le altre', () => {
  for (const riga of [
    'echo "$ELENCO" | grep -qx "$ATTESO" || exit 1',
    'lipo -info x | grep -q arm64',
    'cat f | grep -E -q "a|b"',
    'cat f | grep --quiet a',
  ]) assert.match(riga, TUBO_IN_GREP_Q, riga);
  for (const riga of [
    'grep -qxF "$ATTESO" <<< "$ELENCO" || exit 1',
    'grep -q x file.yml',
    'cat f | grep -c x',
    'ls | grep -v quick',
  ]) assert.doesNotMatch(riga, TUBO_IN_GREP_Q, riga);
});

test('nessun workflow manda un tubo in grep -q', () => {
  const trovati = [];
  for (const nome of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    readFileSync(join(WORKFLOWS, nome), 'utf8').split('\n').forEach((riga, i) => {
      if (!riga.trimStart().startsWith('#') && TUBO_IN_GREP_Q.test(riga)) trovati.push(`${nome}:${i + 1}: ${riga.trim()}`);
    });
  }
  assert.deepEqual(trovati, [], 'con pipefail il tubo in grep -q fallisce a caso: si scrive grep -q … <<< "$VAR"');
});
