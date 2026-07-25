// Unit test per src/shared/editorStore.js — il modello a COLLEZIONE di file
// dell'editor e, soprattutto, la MIGRAZIONE dal vecchio documento singolo.
//
// Il cuore del feedback "editor multi-file": il documento unico esistente deve
// diventare il primo file della collezione SENZA perdere contenuto, commenti,
// moduli o dimensione griglia. Questi test asseriscono proprio quello, più le
// operazioni di gestione (crea/elimina/rinomina) e le loro invarianti, senza
// aprire Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'editorStore.js'));

const S = globalThis.SN_EDITOR_STORE;

// Doc singolo legacy realistico: contenuto, un commento, moduli con celle e una
// griglia personalizzata (9×12).
function legacyDoc() {
  return {
    meta: { title: 'Il mio romanzo', created: '2026-01-01T00:00:00.000Z', version: 1, grid: { cols: 9, rows: 12 } },
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C\'era una volta' }] }] },
    comments: [{ id: 'c1', text: 'rivedere', anchor: 'C\'era' }],
    modules: [{ id: 'mod-1', type: 'word-count', cells: [{ x: 0, y: 0, z: 0 }], data: { count: 'words' } }],
  };
}

const idSeq = () => { let n = 0; return () => `file-test-${n++}`; };
const blank = () => ({ meta: { title: 'Documento senza titolo' }, content: { type: 'doc', content: [] }, comments: [], modules: [] });

test('si registra su globalThis con la sua API', () => {
  assert.ok(S);
  assert.equal(typeof S.migrateToCollection, 'function');
  assert.equal(S.COLLECTION_VERSION, 2);
});

test('MIGRAZIONE: il doc singolo diventa il primo file, senza perdere nulla', () => {
  const legacy = legacyDoc();
  const col = S.migrateToCollection({ legacyDoc: legacy, idFactory: idSeq(), blankFactory: blank });

  assert.equal(col.version, 2);
  assert.equal(col.files.length, 1, 'un solo file dopo la migrazione');
  const f = col.files[0];
  assert.equal(col.activeId, f.id, 'il file migrato è quello attivo');
  assert.ok(f.id, 'al file è stato assegnato un id');

  // Contenuto/commenti/moduli/griglia integri.
  assert.deepEqual(f.content, legacy.content, 'contenuto preservato');
  assert.deepEqual(f.comments, legacy.comments, 'commenti preservati');
  assert.deepEqual(f.modules, legacy.modules, 'moduli (con celle) preservati');
  assert.deepEqual(f.meta.grid, { cols: 9, rows: 12 }, 'dimensione griglia preservata');
  assert.equal(f.meta.title, 'Il mio romanzo', 'titolo preservato');
});

test('MIGRAZIONE: senza doc e senza collezione → un unico file vuoto', () => {
  const col = S.migrateToCollection({ idFactory: idSeq(), blankFactory: blank });
  assert.equal(col.files.length, 1);
  assert.equal(col.activeId, col.files[0].id);
  assert.equal(col.files[0].meta.title, 'Documento senza titolo');
});

test('MIGRAZIONE: una collezione già presente viene solo normalizzata', () => {
  const existing = { version: 2, activeId: 'file-b', files: [
    { id: 'file-a', meta: { title: 'A' }, content: {}, comments: [], modules: [] },
    { id: 'file-b', meta: { title: 'B' }, content: {}, comments: [], modules: [] },
  ] };
  const col = S.migrateToCollection({ collection: existing, idFactory: idSeq(), blankFactory: blank });
  assert.equal(col.files.length, 2);
  assert.equal(col.activeId, 'file-b', 'activeId valido conservato');
});

test('MIGRAZIONE: activeId che punta a un file inesistente ripiega sul primo', () => {
  const existing = { version: 2, activeId: 'sparito', files: [
    { id: 'file-a', meta: { title: 'A' }, content: {}, comments: [], modules: [] },
  ] };
  const col = S.migrateToCollection({ collection: existing, idFactory: idSeq(), blankFactory: blank });
  assert.equal(col.activeId, 'file-a');
});

test('MIGRAZIONE: la collezione ha priorità sul doc legacy (già migrato in passato)', () => {
  const existing = { version: 2, activeId: 'file-a', files: [
    { id: 'file-a', meta: { title: 'Nuovo' }, content: {}, comments: [], modules: [] },
  ] };
  const col = S.migrateToCollection({ collection: existing, legacyDoc: legacyDoc(), idFactory: idSeq(), blankFactory: blank });
  assert.equal(col.files.length, 1);
  assert.equal(col.files[0].meta.title, 'Nuovo', 'usa la collezione, non il legacy');
});

test('addFile aggiunge in coda e rende attivo il nuovo file', () => {
  const col = S.migrateToCollection({ legacyDoc: legacyDoc(), idFactory: idSeq(), blankFactory: blank });
  const f = S.addFile(col, blank(), idSeq());
  assert.equal(col.files.length, 2);
  assert.equal(col.activeId, f.id);
});

test('removeFile: eliminando l\'attivo l\'attivo passa al vicino', () => {
  const col = S.migrateToCollection({ collection: { version: 2, activeId: 'b', files: [
    { id: 'a', meta: { title: 'A' } }, { id: 'b', meta: { title: 'B' } }, { id: 'c', meta: { title: 'C' } },
  ] }, idFactory: idSeq(), blankFactory: blank });
  const res = S.removeFile(col, 'b');
  assert.equal(res.removed, true);
  assert.equal(res.emptied, false);
  assert.equal(col.files.length, 2);
  assert.equal(col.activeId, 'a', 'passa al precedente');
});

test('removeFile: eliminando l\'ultimo file la collezione resta vuota (segnalato)', () => {
  const col = S.migrateToCollection({ collection: { version: 2, activeId: 'a', files: [
    { id: 'a', meta: { title: 'A' } },
  ] }, idFactory: idSeq(), blankFactory: blank });
  const res = S.removeFile(col, 'a');
  assert.equal(res.emptied, true, 'segnala che serve creare un nuovo file');
  assert.equal(col.files.length, 0);
  assert.equal(col.activeId, null);
});

test('renameFile cambia il titolo; un nome vuoto ripiega sul default', () => {
  const col = S.migrateToCollection({ legacyDoc: legacyDoc(), idFactory: idSeq(), blankFactory: blank });
  const id = col.files[0].id;
  S.renameFile(col, id, '  Bozza 2  ');
  assert.equal(col.files[0].meta.title, 'Bozza 2', 'trimma e applica');
  S.renameFile(col, id, '   ');
  assert.equal(col.files[0].meta.title, 'Documento senza titolo', 'vuoto → default');
});

test('replaceFile aggiorna il contenuto mantenendo l\'id', () => {
  const col = S.migrateToCollection({ legacyDoc: legacyDoc(), idFactory: idSeq(), blankFactory: blank });
  const id = col.files[0].id;
  S.replaceFile(col, id, { meta: { title: 'Il mio romanzo' }, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nuovo testo' }] }] }, comments: [], modules: [] });
  assert.equal(col.files.length, 1, 'stesso file, non duplicato');
  assert.equal(col.files[0].id, id, 'id invariato');
  assert.equal(col.files[0].content.content[0].content[0].text, 'nuovo testo');
});
