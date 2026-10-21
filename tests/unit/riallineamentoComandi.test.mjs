// I rebase delle routine si scrivono un comando per chiamata, nella forma nuda: solo così ogni comando combacia da solo
// con una regola dei permessi, e il classificatore della modalità auto non lo giudica (e non lo ferma) (#1454).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RADICE = resolve(import.meta.dirname, '..', '..');
const ruolo = (n) => readFileSync(join(RADICE, 'routines', 'roles', n), 'utf8');
// Le forme vietate nominate da sole (`git -C`, `cd`, `&&`) non sono comandi: un comando ha almeno tre parole.
const comandiGit = (t) => [...t.matchAll(/`([^`\n]*\bgit\b[^`\n]*)`/g)].map((m) => m[1].trim()).filter((c) => c.split(/\s+/).length >= 3);

test('riallineamento e allineamento del giro: fetch e rebase in due comandi nudi, nessuno composto', () => {
  for (const n of ['resolver-rebase.md', 'orchestrator.md']) {
    const cmd = comandiGit(ruolo(n));
    assert.ok(cmd.includes('git fetch origin main'), `${n}: il fetch va scritto da solo`);
    assert.ok(cmd.includes('git rebase origin/main'), `${n}: il rebase va scritto da solo`);
    for (const c of cmd) {
      assert.doesNotMatch(c, /&&|\|\||;|^cd\b|\bgit -C\b|\bgit pull\b/, `${n}: «${c}» non combacia da solo con una regola dei permessi`);
    }
  }
});

test('il comando composto di prima non torna', () => {
  const t = (ruolo('resolver-rebase.md') + ruolo('orchestrator.md')).replace(/\s+/g, ' ');
  assert.doesNotMatch(t, /git fetch origin main && git rebase/);
  assert.doesNotMatch(t, /git pull --rebase/);
});
