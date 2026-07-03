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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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

test('starred convive con branch senza calpestarsi (e i nomi RITIRATI vengono rimappati)', () => {
  // `review` è ritirato: la coda lo rimappa al canonico `revision_capability`.
  queueTriage('combo', 'review', 'in revisione', 'routine-test', 'worker/combo', true);
  const e = read('combo');
  assert.equal(e.branch, 'worker/combo');
  assert.equal(e.starred, true);
  assert.equal(e.status, 'revision_capability');
});

test('queueTriage serializza il motivo strutturato `reason` (es. loop)', () => {
  // `blocked` è ritirato → `design` (macchina a stati); il reason resta.
  queueTriage('loop1', 'blocked', 'bloccato dopo 3 fallimenti', 'routine-test', 'worker/loop1', undefined, 'loop');
  const e = read('loop1');
  assert.equal(e.status, 'design');
  assert.equal(e.branch, 'worker/loop1');
  assert.equal(e.reason, 'loop');
});

test('queueTriage NON scrive reason se omesso o vuoto (status canonico)', () => {
  queueTriage('noreason', 'design', '', 'routine-test', 'worker/x');
  assert.equal('reason' in read('noreason'), false);
  queueTriage('emptyreason', 'design', '', 'routine-test', 'worker/x', undefined, '   ');
  assert.equal('reason' in read('emptyreason'), false);
  // Il legacy `blocked` senza reason invece EREDITA il motivo loop dal remap.
  queueTriage('legacyblocked', 'blocked', '', 'routine-test', 'worker/x');
  assert.equal(read('legacyblocked').status, 'design');
  assert.equal(read('legacyblocked').reason, 'loop');
});

// CLI: --reason <slug> finisce sull'entry (stesso pattern di --branch).
test('CLI queue-triage.mjs --reason loop accoda entry.reason', () => {
  const { execFileSync } = require('node:child_process');
  const { fileURLToPath } = require('node:url');
  const { dirname, join } = require('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, '..', '..', 'scripts', 'queue-triage.mjs');
  execFileSync(process.execPath, [script, 'cli-loop', 'design', 'nota', '--branch', 'worker/cli', '--reason', 'loop', '--no-git'],
    { env: { ...process.env, FILO_SPOOL_DIR: tmp }, encoding: 'utf8' });
  const e = read('cli-loop');
  assert.equal(e.status, 'design');
  assert.equal(e.branch, 'worker/cli');
  assert.equal(e.reason, 'loop');
  // La nota positional non viene mangiata dai flag.
  assert.equal(e.notes, 'nota');
});
