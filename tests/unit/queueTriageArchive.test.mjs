// Unit test per il substrato DB2 in scripts/queue-triage.mjs:
// lo stato `archived` e il flag ⭐ `starred` accodati nello spool su git.
//
// FILO_SPOOL_DIR punta a una dir temporanea: il test NON tocca la coda vera
// feedback-triage/ (che l'hook di auto-commit pusherebbe su origin/main).
// Niente Electron né rete: gira via `npm run test:unit`.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'filo-triage-'));
process.env.FILO_SPOOL_DIR = tmp;

// Import dinamico DOPO l'env: lo script risolve SPOOL_DIR al load.
const { queueTriage } = await import('../../scripts/queue-triage.mjs');

after(() => { rmSync(tmp, { recursive: true, force: true }); });

const read = (id) => JSON.parse(readFileSync(join(tmp, `${id}.json`), 'utf8'));

test('queueTriage accetta il nuovo stato archived', () => {
  const file = queueTriage('arch1', 'archived', 'archiviato a mano', 'routine-test');
  assert.ok(file.endsWith('arch1.json'));
  const e = read('arch1');
  assert.equal(e.status, 'archived');
  assert.equal(e.id, 'arch1');
});

test('queueTriage rifiuta uno status sconosciuto', () => {
  assert.throws(() => queueTriage('x', 'spostato', '', 'routine-test'), /status non valido/);
  // `verified`/`ignored` restano fuori dalla coda (sono decisioni owner, non triage).
  assert.throws(() => queueTriage('x', 'verified', '', 'routine-test'), /status non valido/);
});

test('queueTriage serializza il flag starred quando booleano', () => {
  queueTriage('star1', 'archived', '', 'routine-test', '', true);
  assert.equal(read('star1').starred, true);

  queueTriage('star2', 'todo', '', 'routine-test', '', false);
  assert.equal(read('star2').starred, false);
});

test('queueTriage NON scrive starred se omesso (undefined → non tocca il flag)', () => {
  queueTriage('nostar', 'done', '', 'routine-test');
  assert.equal('starred' in read('nostar'), false);
});

test('starred convive con branch (review/blocked) senza calpestarsi', () => {
  queueTriage('combo', 'review', 'in revisione', 'routine-test', 'worker/combo', true);
  const e = read('combo');
  assert.equal(e.branch, 'worker/combo');
  assert.equal(e.starred, true);
  assert.equal(e.status, 'review');
});
