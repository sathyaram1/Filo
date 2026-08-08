// Chiusura di un lavoro locale — spec: ROUTINE-BRANCH-INTEGRITY.md §Sessioni locali
//
// Logica pura di `scripts/finish-local.mjs`. Il caso che conta è il secondo: in
// locale il ramo principale è quasi sempre GIÀ aperto in un'altra cartella di
// lavoro (una per compito), e git rifiuta di aprire lo stesso ramo due volte.
// Senza riconoscerlo, il comando fallirebbe proprio nel setup normale.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { specsForChangedFiles, mainWorktree } from '../../scripts/finish-local.mjs';

describe('quali spec lanciare', () => {
  test('una pagina toccata porta con sé il suo spec', () => {
    assert.deepEqual(specsForChangedFiles(['src/pages/manage/manage.js']), ['tests/manage']);
  });

  test('uno spec modificato a mano viene incluso così com’è', () => {
    assert.deepEqual(specsForChangedFiles(['tests/editor-chat.spec.mjs']), ['tests/editor-chat']);
  });

  test('niente duplicati quando più file portano allo stesso spec', () => {
    const out = specsForChangedFiles(['src/pages/manage/manage.js', 'src/pages/manage/manage.html']);
    assert.deepEqual(out, ['tests/manage']);
  });

  test('i file fuori dall’app non tirano dentro spec a caso', () => {
    assert.deepEqual(specsForChangedFiles(['README.md', 'scripts/dispatch.mjs', '.gitignore']), []);
  });

  test('lista vuota o non valida non esplode', () => {
    assert.deepEqual(specsForChangedFiles([]), []);
    assert.deepEqual(specsForChangedFiles(null), []);
  });
});

describe('dove fondere', () => {
  const porcelain = [
    'worktree C:/repo',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree C:/repo/.claude/worktrees/task',
    'HEAD def',
    'branch refs/heads/claude/task',
    '',
  ].join('\n');

  test('trova la cartella che ha già aperto il ramo principale', () => {
    assert.equal(mainWorktree(porcelain, 'main'), 'C:/repo',
      'la fusione va fatta lì: git non apre lo stesso ramo due volte');
  });

  test('se nessuno lo tiene aperto, si fonde sul posto', () => {
    const solo = 'worktree C:/repo\nHEAD abc\nbranch refs/heads/claude/task\n';
    assert.equal(mainWorktree(solo, 'main'), null);
  });

  test('una cartella in stato staccato non viene scambiata per il ramo principale', () => {
    const detached = 'worktree C:/repo\nHEAD abc\ndetached\n';
    assert.equal(mainWorktree(detached, 'main'), null);
  });
});
