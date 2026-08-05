// Unit test per src/shared/editorNotes.js — la logica con cui Filo scrive gli
// appunti DENTRO i file dell'editor (fine dell'archivio separato).
//
// Asserisce il SUCCESSO della feature, non l'assenza di errori:
//   - un appunto compare COME TESTO nel file dell'editor;
//   - accodare sullo stesso argomento resta nello stesso file;
//   - cambiare argomento (o chiedere "nuovo") apre un file diverso;
//   - ogni scrittura lascia un punto di ripristino che riporta il file com'era;
//   - la migrazione trasforma i vecchi appunti in un file "Appunti" col testo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');
require(join(SHARED, 'editorStore.js'));
require(join(SHARED, 'editorVersions.js'));
require(join(SHARED, 'editorNotes.js'));

const STORE = globalThis.SN_EDITOR_STORE;
const NOTES = globalThis.SN_EDITOR_NOTES;

// Collezione vuota (nessun file): come la vede il main la prima volta.
function emptyCollection() {
  return { version: STORE.COLLECTION_VERSION, activeId: null, files: [] };
}

// Factory deterministiche di id, per asserire senza sorprese.
function ids() {
  let f = 0;
  let v = 0;
  return { file: () => `file-${f++}`, ver: () => `ver-${v++}` };
}

// Estrae tutto il testo di un file serializzato (concatena i nodi text).
function fileText(file) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text' && n.text) out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(file && file.content);
  return out.join('\n');
}

test('espone la sua API su globalThis', () => {
  assert.ok(NOTES);
  assert.equal(typeof NOTES.writeNote, 'function');
  assert.equal(typeof NOTES.buildNotesFile, 'function');
});

test('un appunto compare come testo in un file dell’editor', () => {
  const res = NOTES.writeNote({
    collection: emptyCollection(),
    versions: {},
    pointer: {},
    text: 'comprare il latte',
    topic: 'spesa',
    ids: ids(),
    now: 1000,
  });
  assert.equal(res.wrote, true);
  assert.equal(res.createdFile, true);
  const file = STORE.findFile(res.collection, res.fileId);
  assert.ok(file, 'il file deve esistere nella collezione');
  assert.match(fileText(file), /comprare il latte/);
  // il titolo del file nasce dall’argomento
  assert.equal(file.meta.title, 'Spesa');
});

test('due appunti sullo stesso argomento restano nello STESSO file, accodati', () => {
  const id = ids();
  let r = NOTES.writeNote({
    collection: emptyCollection(), versions: {}, pointer: {},
    text: 'prima riga', topic: 'progetto', ids: id, now: 1000,
  });
  r = NOTES.writeNote({
    collection: r.collection, versions: r.versions, pointer: r.pointer,
    text: 'seconda riga', topic: 'progetto', ids: id, now: 2000,
  });
  assert.equal(r.collection.files.length, 1, 'stesso argomento → un solo file');
  const txt = fileText(STORE.findFile(r.collection, r.fileId));
  assert.match(txt, /prima riga/);
  assert.match(txt, /seconda riga/);
  // ordine: prima riga prima della seconda
  assert.ok(txt.indexOf('prima riga') < txt.indexOf('seconda riga'));
});

test('cambiare argomento apre un file NUOVO', () => {
  const id = ids();
  let r = NOTES.writeNote({
    collection: emptyCollection(), versions: {}, pointer: {},
    text: 'nota di lavoro', topic: 'lavoro', ids: id, now: 1000,
  });
  const firstId = r.fileId;
  r = NOTES.writeNote({
    collection: r.collection, versions: r.versions, pointer: r.pointer,
    text: 'lista della spesa', topic: 'spesa', ids: id, now: 2000,
  });
  assert.equal(r.collection.files.length, 2, 'argomento diverso → due file');
  assert.notEqual(r.fileId, firstId);
  assert.match(fileText(STORE.findFile(r.collection, firstId)), /nota di lavoro/);
  assert.match(fileText(STORE.findFile(r.collection, r.fileId)), /lista della spesa/);
});

test('forceNew apre un file nuovo anche a parità di argomento', () => {
  const id = ids();
  let r = NOTES.writeNote({
    collection: emptyCollection(), versions: {}, pointer: {},
    text: 'a', topic: 'diario', ids: id, now: 1000,
  });
  r = NOTES.writeNote({
    collection: r.collection, versions: r.versions, pointer: r.pointer,
    text: 'b', topic: 'diario', forceNew: true, ids: id, now: 2000,
  });
  assert.equal(r.collection.files.length, 2);
});

test('ogni scrittura è reversibile: un punto di ripristino riporta il file com’era', () => {
  const V = globalThis.SN_EDITOR_VERSIONS;
  const id = ids();
  // prima scrittura (crea il file): storico = [vuoto, con-a]
  let r = NOTES.writeNote({
    collection: emptyCollection(), versions: {}, pointer: {},
    text: 'a', topic: 'note', ids: id, now: 1000,
  });
  // seconda scrittura (append): aggiunge un punto di ripristino "con-a+b"
  r = NOTES.writeNote({
    collection: r.collection, versions: r.versions, pointer: r.pointer,
    text: 'b', topic: 'note', ids: id, now: 2000,
  });
  const history = V.listFor(r.versions, r.fileId);
  assert.ok(history.length >= 2, 'devono esserci punti di ripristino');
  // Ogni punto di ripristino conserva l’INTERO file serializzato in `.content`
  // (stessa convenzione dell’editor: al ripristino il file viene rimpiazzato con
  // quello). Il penultimo punto è lo stato PRIMA dell’ultimo append: ha 'a', non 'b'.
  const beforeLast = history[history.length - 2];
  const beforeTxt = fileText(beforeLast.content);
  assert.match(beforeTxt, /a/);
  assert.doesNotMatch(beforeTxt, /b/);
  // lo stato attuale contiene entrambi
  const curTxt = fileText(STORE.findFile(r.collection, r.fileId));
  assert.match(curTxt, /a/);
  assert.match(curTxt, /b/);
});

test('testo vuoto è un no-op (niente file, niente scrittura)', () => {
  const r = NOTES.writeNote({
    collection: emptyCollection(), versions: {}, pointer: {},
    text: '   ', topic: 'x', ids: ids(), now: 1,
  });
  assert.equal(r.wrote, false);
  assert.equal(r.collection.files.length, 0);
});

test('MIGRAZIONE: i vecchi appunti diventano un file "Appunti" col loro testo, in ordine cronologico', () => {
  // L’archivio è più-recente-prima (come lo storage): la migrazione lo inverte.
  const oldNotes = [
    { text: 'il più recente', ts: '2026-01-03T00:00:00.000Z' },
    { text: 'quello di mezzo', ts: '2026-01-02T00:00:00.000Z' },
    { text: 'il più vecchio', ts: '2026-01-01T00:00:00.000Z' },
  ];
  const file = NOTES.buildNotesFile(oldNotes, { id: 'file-appunti', now: 5000 });
  assert.ok(file);
  assert.equal(file.meta.title, 'Appunti');
  const txt = fileText(file);
  assert.match(txt, /il più recente/);
  assert.match(txt, /quello di mezzo/);
  assert.match(txt, /il più vecchio/);
  // ordine cronologico: il più vecchio in cima
  assert.ok(txt.indexOf('il più vecchio') < txt.indexOf('il più recente'));
});

test('MIGRAZIONE senza appunti non produce alcun file', () => {
  assert.equal(NOTES.buildNotesFile([], {}), null);
  assert.equal(NOTES.buildNotesFile(null, {}), null);
});

test('MIGRAZIONE: data e argomento del vecchio archivio non si perdono', () => {
  const file = NOTES.buildNotesFile(
    [{ text: 'comprare il pane', ts: '2026-01-01T10:00:00.000Z', context: 'spesa' }],
    { id: 'file-appunti', now: 5000 },
  );
  const txt = fileText(file);
  assert.match(txt, /1 gennaio 2026/);
  assert.match(txt, /spesa/);
  // L'intestazione precede il testo dell'appunto a cui si riferisce.
  assert.ok(txt.indexOf('spesa') < txt.indexOf('comprare il pane'));
});

test('MIGRAZIONE: appunto senza data né argomento non guadagna righe vuote', () => {
  const file = NOTES.buildNotesFile([{ text: 'solo testo' }], { id: 'f', now: 1 });
  assert.equal(fileText(file), 'solo testo');
});

test('MIGRAZIONE: una data illeggibile non finisce nel file come "Invalid Date"', () => {
  const file = NOTES.buildNotesFile([{ text: 'nota', ts: 'non-una-data', context: 'x' }], { id: 'f', now: 1 });
  const txt = fileText(file);
  assert.ok(!/Invalid/i.test(txt), txt);
  assert.match(txt, /x/);
});
