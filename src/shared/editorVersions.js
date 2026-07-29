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

  // ── Snapshot manuali: quanto è cambiato il documento ──────────────────────
  // Le modifiche AUTOMATICHE di Filo creano sempre un punto di ripristino; le
  // modifiche MANUALI dell'utente no (versionare a ogni battuta sarebbe rumore).
  // La politica è: creare uno snapshot 'manual' solo quando il testo è cambiato
  // in modo SIGNIFICATIVO rispetto all'ultimo stato di riferimento. Serve un
  // proxy CHEAP dell'entità della modifica (niente edit-distance O(n·m)): questa
  // logica pura la misura, ed è unit-testabile senza aprire l'editor.

  // Testo semplice dal contenuto di una versione (o dal modello serializzato di
  // un documento): cammina i nodi ProseMirror aggiungendo un a-capo ai confini
  // di blocco. Unica sorgente per l'anteprima nello storico E per la soglia.
  function plainText(content) {
    const pm = content && content.content ? content.content : content;
    if (!pm || typeof pm !== 'object') return '';
    let out = '';
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'text' && typeof n.text === 'string') { out += n.text; return; }
      if (n.type === 'hardBreak') { out += '\n'; return; }
      if (Array.isArray(n.content)) n.content.forEach(walk);
      if (/^(paragraph|heading|blockquote|listItem|codeBlock)$/.test(n.type)) out += '\n';
    };
    walk(pm);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Quanti caratteri sono cambiati fra due testi: si tolgono il prefisso e il
  // suffisso comuni e si misura la regione centrale diversa. Cattura sia le
  // aggiunte/cancellazioni (un blocco scritto o tolto) sia le sostituzioni (un
  // pezzo riscritto della stessa lunghezza) restando O(n).
  function textChangeSize(prevContent, nextContent) {
    const a = plainText(prevContent);
    const b = plainText(nextContent);
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    let p = 0;
    while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let s = 0;
    // Il suffisso comune non deve sovrapporsi al prefisso già contato.
    while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    return Math.max(a.length, b.length) - p - s;
  }

  // Soglia di default (caratteri di testo cambiati) oltre cui una modifica
  // manuale merita un punto di ripristino. ~140 = un paio di frasi: sotto è
  // "ho aggiustato una parola", non un punto a cui l'utente vorrà tornare.
  const MANUAL_SNAPSHOT_MIN_CHARS = 140;

  // La modifica manuale rispetto a `prevContent` è abbastanza grande da salvare?
  function isSignificantManualChange(prevContent, nextContent, minChars) {
    const min = Number.isFinite(minChars) && minChars > 0 ? minChars : MANUAL_SNAPSHOT_MIN_CHARS;
    return textChangeSize(prevContent, nextContent) >= min;
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
