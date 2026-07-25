// Modello di storage dell'editor: una COLLEZIONE di file (non più un solo doc).
//
// Ogni "file" è un documento nel formato serializzato dell'editor
// (meta / content / comments / modules), più un `id` stabile. La collezione
// tiene la lista dei file e un puntatore `activeId` al file corrente, così alla
// riapertura si torna sull'ultimo file aperto.
//
// Questo modulo è LOGICA PURA (nessun DOM, nessun localStorage): trasforma
// oggetti collezione e migra il vecchio documento singolo. La persistenza vera
// (localStorage) e il parse/serialize legati al DOM restano in editor.js. Così
// la migrazione e le operazioni sulla collezione sono unit-testabili senza
// aprire Electron (vedi tests/unit/editorStore.test.mjs).

(function (global) {
  'use strict';

  const COLLECTION_VERSION = 2;
  const DEFAULT_TITLE = 'Documento senza titolo';

  function defaultIdFactory() {
    return 'file-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Assicura che un file serializzato abbia sempre meta, id e titolo.
  function normalizeFile(raw, idFactory) {
    const mkId = idFactory || defaultIdFactory;
    const f = raw && typeof raw === 'object' ? { ...raw } : {};
    if (!f.meta || typeof f.meta !== 'object') f.meta = {};
    else f.meta = { ...f.meta };
    if (!f.id) f.id = mkId();
    if (!f.meta.title) f.meta.title = DEFAULT_TITLE;
    return f;
  }

  // Migra a una collezione v2 partendo da (in ordine di priorità):
  //  1) una collezione già presente e valida (solo normalizzata);
  //  2) il vecchio documento singolo (`legacyDoc`) → diventa il primo file;
  //  3) niente → un unico file vuoto prodotto da `blankFactory`.
  // `idFactory` e `blankFactory` sono iniettati così il modulo resta puro.
  function migrateToCollection(opts) {
    const o = opts || {};
    const idFactory = o.idFactory || defaultIdFactory;
    const blankFactory = o.blankFactory || (() => ({}));

    const col = o.collection;
    if (col && Array.isArray(col.files) && col.files.length) {
      const files = col.files.map((f) => normalizeFile(f, idFactory));
      let activeId = col.activeId;
      if (!files.some((f) => f.id === activeId)) activeId = files[0].id;
      return { version: COLLECTION_VERSION, activeId, files };
    }

    if (o.legacyDoc && o.legacyDoc.meta) {
      const f = normalizeFile(o.legacyDoc, idFactory);
      return { version: COLLECTION_VERSION, activeId: f.id, files: [f] };
    }

    const blank = normalizeFile(blankFactory(), idFactory);
    return { version: COLLECTION_VERSION, activeId: blank.id, files: [blank] };
  }

  function findFile(collection, id) {
    if (!collection || !Array.isArray(collection.files)) return null;
    return collection.files.find((f) => f.id === id) || null;
  }

  function activeFile(collection) {
    if (!collection || !Array.isArray(collection.files) || !collection.files.length) return null;
    return findFile(collection, collection.activeId) || collection.files[0];
  }

  // Aggiunge un file (già serializzato) e lo rende attivo. Ritorna il file.
  function addFile(collection, file, idFactory) {
    const f = normalizeFile(file, idFactory);
    collection.files.push(f);
    collection.activeId = f.id;
    return f;
  }

  // Sostituisce il contenuto del file `id` con `serialized` (mantiene l'id).
  function replaceFile(collection, id, serialized) {
    const idx = collection.files.findIndex((f) => f.id === id);
    const next = { ...serialized, id };
    if (!next.meta) next.meta = {};
    if (!next.meta.title) next.meta.title = DEFAULT_TITLE;
    if (idx >= 0) collection.files[idx] = next;
    else collection.files.push(next);
    return next;
  }

  // Rimuove il file `id`. Se era attivo, l'attivo passa al vicino (il precedente
  // se esiste, altrimenti il primo). Se la collezione resta VUOTA, `activeId`
  // diventa null: sta al chiamante crearne uno nuovo (invariante "almeno un
  // file"). Ritorna { removed: bool, emptied: bool }.
  function removeFile(collection, id) {
    const idx = collection.files.findIndex((f) => f.id === id);
    if (idx < 0) return { removed: false, emptied: false };
    collection.files.splice(idx, 1);
    if (!collection.files.length) {
      collection.activeId = null;
      return { removed: true, emptied: true };
    }
    if (collection.activeId === id) {
      const neighbor = collection.files[Math.max(0, idx - 1)];
      collection.activeId = neighbor.id;
    }
    return { removed: true, emptied: false };
  }

  function renameFile(collection, id, title) {
    const f = findFile(collection, id);
    if (!f) return null;
    if (!f.meta) f.meta = {};
    const t = (title == null ? '' : String(title)).trim();
    f.meta.title = t || DEFAULT_TITLE;
    return f;
  }

  global.SN_EDITOR_STORE = {
    COLLECTION_VERSION,
    DEFAULT_TITLE,
    migrateToCollection,
    normalizeFile,
    findFile,
    activeFile,
    addFile,
    replaceFile,
    removeFile,
    renameFile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
