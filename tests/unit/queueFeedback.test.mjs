// Unit test per scripts/queue-feedback.mjs — l'accodamento della CREAZIONE di
// un feedback (sub-feedback di una spec spezzata) nello spool su git.
//
// FILO_SPOOL_DIR punta a una dir temporanea: il test NON tocca la coda vera
// feedback-triage/ (che l'hook di auto-commit pusherebbe su origin/main,
// facendo creare feedback fasulli alla GitHub Action).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'filo-spool-'));
process.env.FILO_SPOOL_DIR = tmp;

// Import dinamico DOPO aver impostato l'env: lo script risolve SPOOL_DIR al load.
const { buildCreateEntry, queueFeedbackCreate } = await import('../../scripts/queue-feedback.mjs');

after(() => { rmSync(tmp, { recursive: true, force: true }); });

test('buildCreateEntry: entry completa e normalizzata', () => {
  const e = buildCreateEntry({
    text: '  Implementare la rotazione delle chiavi  ',
    name: 'rotazione chiavi',
    parentId: 'abc123',
    priority: '2',
    notes: 'dalla spec gestione segreti',
    queuedBy: 'routine-test',
  });
  assert.equal(e.op, 'create');
  assert.equal(e.text, 'Implementare la rotazione delle chiavi');
  assert.equal(e.name, 'rotazione chiavi');
  assert.equal(e.parentId, 'abc123');
  assert.equal(e.status, 'todo');
  assert.equal(e.priority, 2);
  assert.equal(e.notes, 'dalla spec gestione segreti');
  assert.equal(e.queuedBy, 'routine-test');
  assert.ok(e.queuedAt);
});

test('buildCreateEntry: default = top-level, todo, priorità 0', () => {
  const e = buildCreateEntry({ text: 'task autonomo', name: 'titolo' });
  assert.equal(e.parentId, '');
  assert.equal(e.status, 'todo');
  assert.equal(e.priority, 0);
});

test('buildCreateEntry: status clarify ammesso, altri no', () => {
  assert.equal(buildCreateEntry({ text: 't', name: 'n', status: 'clarify' }).status, 'clarify');
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', status: 'done' }), /status non valido/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', status: 'new' }), /status non valido/);
});

test('buildCreateEntry: input invalidi rifiutati', () => {
  assert.throws(() => buildCreateEntry({ text: '', name: 'n' }), /testo mancante/);
  assert.throws(() => buildCreateEntry({ text: 't', name: '' }), /--name mancante/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', parentId: '../evil' }), /caratteri non ammessi/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', priority: '7' }), /--priority non valida/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', priority: 'alta' }), /--priority non valida/);
});

test('queueFeedbackCreate: scrive un file new-*.json con l\'entry dentro lo spool', () => {
  const file = queueFeedbackCreate({ text: 'testo del sub-task', name: 'sub-task', parentId: 'p1' });
  assert.ok(file.startsWith(tmp), `file fuori dallo spool di test: ${file}`);
  const base = file.split(/[\\/]/).pop();
  assert.match(base, /^new-\d+-[a-z0-9]+\.json$/);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.op, 'create');
  assert.equal(saved.text, 'testo del sub-task');
  assert.equal(saved.parentId, 'p1');
  // Il prefisso "new-" è il discriminante per apply-triage: niente collisioni
  // possibili con i file di triage (id Firestore non contengono "-"… ma il
  // punto è che un id non può iniziare per "new-<timestamp>").
  const files = readdirSync(tmp);
  assert.ok(files.every((f) => f.startsWith('new-')), `file inattesi nello spool: ${files}`);
});
