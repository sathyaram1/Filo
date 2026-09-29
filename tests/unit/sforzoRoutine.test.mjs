// Le due definizioni degli agenti delle routine lavorano a sforzo xhigh
// (decisione dell'owner del 2026-09-27), e la prosa dell'orchestratore lo dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(resolve(ROOT, ...p), 'utf8');

for (const nome of ['routine-worker', 'routine-secaudit']) {
  test(`${nome}: effort xhigh nell'intestazione, e la descrizione non dice altro`, () => {
    const testo = leggi('.claude', 'agents', `${nome}.md`);
    const testa = /^---\n([\s\S]*?)\n---\n/.exec(testo);
    assert.ok(testa, 'intestazione YAML presente');
    const effort = testa[1].split('\n').filter((r) => /^effort:/.test(r));
    assert.deepEqual(effort, ['effort: xhigh']);
    const descrizione = testa[1].split('\n').find((r) => /^description:/.test(r)) || '';
    assert.match(descrizione, /sforzo xhigh/);
    assert.doesNotMatch(descrizione, /sforzo (?:low|medium|high)\b/);
  });
}

test('la prosa dell\'orchestratore dice lo stesso sforzo delle definizioni', () => {
  const testo = leggi('routines', 'roles', 'orchestrator.md');
  assert.match(testo, /Opus a sforzo `xhigh`/);
  assert.doesNotMatch(testo, /sforzo `(?:high|medium)`|a\s+`medium`/);
});
