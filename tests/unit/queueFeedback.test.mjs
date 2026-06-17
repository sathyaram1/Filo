// Unit test per scripts/queue-feedback.mjs — l'accodamento della CREAZIONE di
// un feedback (sub-feedback di una spec spezzata) nello spool su git.
//
// FILO_SPOOL_DIR punta a una dir temporanea: il test NON tocca la coda vera
// feedback-triage/ (che l'hook di auto-commit pusherebbe su origin/main,
// facendo creare feedback fasulli alla GitHub Action).

import { test, after } from 'node:test';
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

test('buildCreateEntry: status new/clarify ammessi, altri no', () => {
  // 'new' = inbox/"Ricevuti": lo usano le passate proattive di audit per
  // depositare i ritrovamenti da far rivedere all'utente prima di lavorarli.
  assert.equal(buildCreateEntry({ text: 't', name: 'n', status: 'new' }).status, 'new');
  assert.equal(buildCreateEntry({ text: 't', name: 'n', status: 'clarify' }).status, 'clarify');
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', status: 'done' }), /status non valido/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', status: 'verified' }), /status non valido/);
});

test('buildCreateEntry: input invalidi rifiutati', () => {
  assert.throws(() => buildCreateEntry({ text: '', name: 'n' }), /testo mancante/);
  assert.throws(() => buildCreateEntry({ text: 't', name: '' }), /--name mancante/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', parentId: '../evil' }), /caratteri non ammessi/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', priority: '7' }), /--priority non valida/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', priority: 'alta' }), /--priority non valida/);
});

test('buildCreateEntry: images = URL http(s) normalizzati, max 5', () => {
  // Senza images: array vuoto (non undefined) così l'applier scrive sempre il campo.
  assert.deepEqual(buildCreateEntry({ text: 't', name: 'n' }).images, []);
  // URL validi: tenuti e ripuliti (trim + scarto dei vuoti).
  const e = buildCreateEntry({
    text: 't', name: 'n',
    images: ['  https://x/a.png ', '', 'http://y/b.jpg'],
  });
  assert.deepEqual(e.images, ['https://x/a.png', 'http://y/b.jpg']);
  // Cap a 5.
  const many = Array.from({ length: 8 }, (_, i) => `https://x/${i}.png`);
  assert.equal(buildCreateEntry({ text: 't', name: 'n', images: many }).images.length, 5);
});

test('buildCreateEntry: images non-URL o non-array rifiutati', () => {
  // Un path locale NON è un URL: deve fallire (l'upload produce sempre http(s)).
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', images: ['/tmp/shot.png'] }), /URL immagine non valido/);
  assert.throws(() => buildCreateEntry({ text: 't', name: 'n', images: 'https://x/a.png' }), /deve essere un array/);
});

test('buildCreateEntry: genera una uid valida come id documento (idempotenza)', () => {
  // La uid serve da chiave di de-dup: applicata due volte la stessa entry crea
  // il doc con lo STESSO id Firestore → la seconda POST riceve 409 invece di un
  // duplicato. Deve essere un id documento valido (lettere/cifre/-/_).
  const e = buildCreateEntry({ text: 't', name: 'n' });
  assert.match(e.uid, /^[A-Za-z0-9_-]{1,128}$/, `uid non è un id documento valido: ${e.uid}`);
  // Due entry distinte → uid distinte (niente collisione tra creazioni diverse).
  const e2 = buildCreateEntry({ text: 't', name: 'n' });
  assert.notEqual(e.uid, e2.uid, 'due entry diverse devono avere uid diverse');
  // Una uid valida passata esplicitamente viene preservata (idempotenza stabile
  // se la stessa creazione venisse ri-accodata con la stessa uid).
  const fixed = buildCreateEntry({ text: 't', name: 'n', uid: 'abc-123_XY' });
  assert.equal(fixed.uid, 'abc-123_XY');
  // Una uid non valida (caratteri proibiti) viene scartata e rigenerata.
  const sanitized = buildCreateEntry({ text: 't', name: 'n', uid: '../evil/id' });
  assert.match(sanitized.uid, /^[A-Za-z0-9_-]{1,128}$/);
  assert.notEqual(sanitized.uid, '../evil/id');
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
  // La uid di idempotenza viaggia nel file: l'applier la usa come id documento.
  assert.match(saved.uid, /^[A-Za-z0-9_-]{1,128}$/);
  // Il prefisso "new-" è il discriminante per apply-triage: niente collisioni
  // possibili con i file di triage (id Firestore non contengono "-"… ma il
  // punto è che un id non può iniziare per "new-<timestamp>").
  const files = readdirSync(tmp);
  assert.ok(files.every((f) => f.startsWith('new-')), `file inattesi nello spool: ${files}`);
});
