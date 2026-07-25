// Storico versioni dei file dell'editor: ogni file può avere una lista di
// "punti di ripristino" (versioni), ciascuno con il contenuto serializzato in
// quel momento, la sorgente della modifica (`filo` per le modifiche automatiche
// dell'AI, `manual` per quelle dell'utente, `restore` per lo stato salvato prima
// di un ripristino) e un timestamp.
//
// SCELTA DI STORAGE (vedi anche il commento in editor.js):
//   Lo storico NON vive su localStorage — che si satura in fretta e va tenuto
//   snello perché è la persistenza "calda" scritta a ogni battuta. Vive
//   sull'ARCHIVIO FILE dell'app (storage.json, via chrome.storage.local): dati
//   "freddi", scritti di rado (solo a ogni modifica automatica di Filo o a uno
//   snapshot manuale) e letti solo quando si sfoglia/ripristina. Sono solo
//   testo, quindi lo storico può crescere ILLIMITATO nel tempo restando
//   sostenibile. Ottimizzazione futura (feedback fratello): comprimere per
//   differenze invece di tenere lo snapshot intero; questo modulo è già la
//   frontiera unica dove introdurla senza toccare i chiamanti.
//
// Questo modulo è LOGICA PURA (nessun DOM, nessun storage): opera su una mappa
// `{ [fileId]: { versions: [...] } }` e la ritorna. La persistenza vera resta in
// editor.js. Così le operazioni sullo storico sono unit-testabili senza aprire
// Electron (vedi tests/unit/editorVersions.test.mjs).

(function (global) {
  'use strict';

  const MAX_LABEL = 200;

  function defaultIdFactory() {
    return 'ver-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Confronto di contenuto per il dedup di versioni consecutive identiche.
  function sameContent(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }

  function normalizeStore(store) {
    return store && typeof store === 'object' ? store : {};
  }

  function ensureFile(store, fileId) {
    const s = normalizeStore(store);
    if (!s[fileId] || !Array.isArray(s[fileId].versions)) s[fileId] = { versions: [] };
    return s;
  }

  // Registra una versione per `fileId`. Dedup: se l'ULTIMA versione ha contenuto
  // identico non ne crea una nuova (evita punti di ripristino spazzatura quando
  // un'azione non cambia nulla). Ritorna `{ store, version, created }`.
  function record(store, fileId, entry, idFactory) {
    const mkId = idFactory || defaultIdFactory;
    const s = ensureFile(store, fileId);
    const list = s[fileId].versions;
    const e = entry || {};
    const content = e.content;
    const last = list[list.length - 1];
    if (last && sameContent(last.content, content)) {
      return { store: s, version: last, created: false };
    }
    const version = {
      id: mkId(),
      ts: Number.isFinite(e.ts) ? e.ts : Date.now(),
      source: e.source === 'filo' || e.source === 'restore' ? e.source : 'manual',
      label: e.label ? String(e.label).slice(0, MAX_LABEL) : '',
      content,
    };
    list.push(version);
    return { store: s, version, created: true };
  }

  // Lista delle versioni di un file, in ordine cronologico (dalla più vecchia).
  function listFor(store, fileId) {
    const s = normalizeStore(store);
    if (!s[fileId] || !Array.isArray(s[fileId].versions)) return [];
    return s[fileId].versions.slice();
  }

  function get(store, fileId, versionId) {
    return listFor(store, fileId).find((v) => v.id === versionId) || null;
  }

  // L'ultima versione registrata per un file (la più recente), o null.
  function latest(store, fileId) {
    const list = listFor(store, fileId);
    return list.length ? list[list.length - 1] : null;
  }

  // Housekeeping: rimuove lo storico di un file cancellato.
  function dropFile(store, fileId) {
    const s = normalizeStore(store);
    if (s[fileId]) delete s[fileId];
    return s;
  }

  global.SN_EDITOR_VERSIONS = {
    MAX_LABEL,
    record,
    listFor,
    get,
    latest,
    dropFile,
    sameContent,
    defaultIdFactory,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
