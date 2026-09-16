// Storico versioni dei file dell'editor: punti di ripristino col contenuto serializzato di quel momento, la sorgente della modifica (`filo` automatica, `manual` dell'utente, `restore` lo stato salvato prima di un ripristino) e un timestamp.
// Lo storico NON sta su localStorage, che va tenuto snello perché è la persistenza calda scritta a ogni battuta: vive sull'archivio file (storage.json), dati freddi scritti di rado e letti solo quando si sfoglia o si ripristina. Essendo solo testo può crescere illimitato; comprimerlo per differenze è l'ottimizzazione futura, e questo modulo è la frontiera unica dove introdurla.
// LOGICA PURA: opera su una mappa `{ [fileId]: { versions: [...] } }` e la ritorna, la persistenza resta in editor.js.

(function (global) {
  'use strict';

  const MAX_LABEL = 200;

  function defaultIdFactory() {
    return 'ver-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function sameContent(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }

  // Le modifiche automatiche di Filo creano sempre un punto di ripristino; quelle manuali no, perché versionare a ogni battuta sarebbe rumore: si salva solo quando il testo è cambiato in modo SIGNIFICATIVO rispetto all'ultimo riferimento.
  // Serve un proxy cheap dell'entità della modifica, non una edit-distance O(n·m).

  // Unica sorgente sia per l'anteprima nello storico sia per la soglia: cammina i nodi ProseMirror con un a-capo ai confini di blocco.
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

  // Si tolgono prefisso e suffisso comuni e si misura la regione centrale diversa: cattura aggiunte, cancellazioni e sostituzioni della stessa lunghezza, restando O(n).
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

  // ~140 caratteri = un paio di frasi: sotto è «ho aggiustato una parola», non un punto a cui l'utente vorrà tornare.
  const MANUAL_SNAPSHOT_MIN_CHARS = 140;

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

  // Dedup: se l'ultima versione ha contenuto identico non se ne crea una nuova, così un'azione che non cambia niente non lascia punti spazzatura. Ritorna { store, version, created }.
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

  // Ordine cronologico, dalla più vecchia.
  function listFor(store, fileId) {
    const s = normalizeStore(store);
    if (!s[fileId] || !Array.isArray(s[fileId].versions)) return [];
    return s[fileId].versions.slice();
  }

  function get(store, fileId, versionId) {
    return listFor(store, fileId).find((v) => v.id === versionId) || null;
  }

  function latest(store, fileId) {
    const list = listFor(store, fileId);
    return list.length ? list[list.length - 1] : null;
  }

  // Una versione è uno snapshot dell'INTERO file, ma ripristinarla in blocco riporterebbe indietro anche cose che l'utente non sta chiedendo di annullare e che il pannello non gli mostra: il nome del documento, la conversazione con Filo, la disposizione dei riquadri. Sarebbe una perdita silenziosa.
  // Confine scelto: dalla versione torna il CORPO — testo e commenti, che sono ancorati al testo e separarli lascerebbe commenti appesi a frasi inesistenti. Restano com'erano adesso nome, metadati e moduli del banco di lavoro coi loro dati.
  function cloneJson(v) {
    try { return v == null ? v : JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }

  function composeRestored(current, versionContent) {
    const cur = current && typeof current === 'object' ? current : {};
    const ver = versionContent && typeof versionContent === 'object' ? versionContent : {};
    const meta = cloneJson(cur.meta) || cloneJson(ver.meta) || {};
    const modules = Array.isArray(cur.modules)
      ? cloneJson(cur.modules)
      : (Array.isArray(ver.modules) ? cloneJson(ver.modules) : []);
    return {
      id: cur.id || ver.id,
      meta,
      content: cloneJson(ver.content) || { type: 'doc', content: [] },
      comments: Array.isArray(ver.comments) ? cloneJson(ver.comments) : [],
      modules,
    };
  }

  function dropFile(store, fileId) {
    const s = normalizeStore(store);
    if (s[fileId]) delete s[fileId];
    return s;
  }

  global.SN_EDITOR_VERSIONS = {
    MAX_LABEL,
    MANUAL_SNAPSHOT_MIN_CHARS,
    record,
    listFor,
    get,
    latest,
    dropFile,
    composeRestored,
    sameContent,
    plainText,
    textChangeSize,
    isSignificantManualChange,
    defaultIdFactory,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
