// Filo scrive gli appunti dentro i FILE dell'editor, non in un archivio separato:
// sono testo vero, riordinabile, versionato e ritrovabile col resto.
// LOGICA PURA: la persistenza sta nel main (services/editorFiles.js) e nel renderer.

(function (global) {
  'use strict';

  const DEFAULT_TITLE = 'Appunti';
  const MAX_TITLE = 80;

  function store() { return global.SN_EDITOR_STORE; }
  function vers() { return global.SN_EDITOR_VERSIONS; }

  function defaultFileId() {
    return 'file-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function normTopic(t) {
    return String(t == null ? '' : t).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function capFirst(s) {
    const t = String(s == null ? '' : s).trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  function titleFor(topic) {
    const t = String(topic == null ? '' : topic).trim();
    return t ? capFirst(t).slice(0, MAX_TITLE) : DEFAULT_TITLE;
  }

  function isEmptyPara(node) {
    return node && node.type === 'paragraph'
      && (!Array.isArray(node.content) || node.content.length === 0);
  }

  // Testo multi-riga → paragrafi nel formato dell'editor (ProseMirror leggero).
  function textToParagraphs(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const paras = lines.map((ln) => {
      const t = ln.trim();
      return t
        ? { type: 'paragraph', content: [{ type: 'text', text: t }] }
        : { type: 'paragraph', content: [] };
    });
    return paras.length ? paras : [{ type: 'paragraph', content: [] }];
  }

  // Date in ISO come nel resto dell'editor: il confronto «chi è più fresco» resta omogeneo.
  function blankNotesFile(id, title, now) {
    const iso = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
    return {
      id: id || defaultFileId(),
      meta: { title: title || DEFAULT_TITLE, created: iso, modified: iso, version: 1 },
      content: { type: 'doc', content: [] },
      comments: [],
      modules: [],
    };
  }

  function clone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (_) { return x; }
  }

  // Su un file vuoto i paragrafi rimpiazzano il vuoto: niente riga bianca in testa.
  function appendToContent(content, paras) {
    const base = (content && content.type === 'doc' && Array.isArray(content.content))
      ? content.content.slice() : [];
    const cleaned = (base.length === 1 && isEmptyPara(base[0])) ? [] : base;
    return { type: 'doc', content: cleaned.concat(paras) };
  }

  // Accoda a `pointer.fileId` finché l'argomento è lo stesso; se cambia apre un file nuovo.
  // Ogni scrittura registra un punto di ripristino PRIMA e DOPO: Filo è sempre reversibile.
  function writeNote(opts) {
    const o = opts || {};
    const collection = o.collection;
    let versions = o.versions || {};
    const pointer = o.pointer || {};
    const text = String(o.text == null ? '' : o.text);
    const topic = String(o.topic == null ? '' : o.topic).trim();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const mkFileId = (o.ids && o.ids.file) || defaultFileId;
    const mkVerId = (o.ids && o.ids.ver) || undefined;
    const STORE = store();
    const VERS = vers();

    if (!collection || !STORE || !text.trim()) {
      return { collection, versions, pointer, fileId: null, createdFile: false, title: '', wrote: false };
    }

    const existing = pointer.fileId ? STORE.findFile(collection, pointer.fileId) : null;
    const topicChanged = !!topic && normTopic(topic) !== normTopic(pointer.topic || '');
    let target;
    let createdFile = false;
    if (o.forceNew || !existing || topicChanged) {
      target = STORE.addFile(collection, blankNotesFile(mkFileId(), titleFor(topic), now), mkFileId);
      createdFile = true;
    } else {
      target = existing;
    }

    // In append il «prima» coincide col «dopo» precedente: il dedup evita punti spazzatura.
    // Su un file nuovo cattura lo stato vuoto, ripristinabile.
    if (VERS) {
      const pre = VERS.record(versions, target.id, {
        content: clone(target),
        source: 'filo',
        label: 'Prima dell’appunto',
        ts: now,
      }, mkVerId);
      versions = pre.store;
    }

    const paras = textToParagraphs(text);
    const updated = {
      ...target,
      content: appendToContent(target.content, paras),
      meta: { ...(target.meta || {}), modified: new Date(now).toISOString() },
    };
    STORE.replaceFile(collection, target.id, updated);
    collection.activeId = target.id;

    // È il punto «dopo» ad alimentare lo storico del file.
    if (VERS) {
      const post = VERS.record(versions, target.id, {
        content: clone(STORE.findFile(collection, target.id)),
        source: 'filo',
        label: 'Appunto di Filo',
        ts: now,
      }, mkVerId);
      versions = post.store;
    }

    return {
      collection,
      versions,
      pointer: { fileId: target.id, topic: topic || pointer.topic || '' },
      fileId: target.id,
      createdFile,
      title: (updated.meta && updated.meta.title) || DEFAULT_TITLE,
      wrote: true,
    };
  }

  // Data e argomento: migrando senza, di ogni nota si perderebbe il QUANDO e il DI-COSA.
  // Torna '' se mancano entrambi: niente righe vuote decorative.
  function noteHeadline(note) {
    const parts = [];
    const ts = note && note.ts;
    if (ts) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) {
        parts.push(d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }));
      }
    }
    const ctx = String((note && note.context) || '').trim();
    if (ctx) parts.push(ctx);
    return parts.join(' · ');
  }

  // MIGRAZIONE a un unico file «Appunti»: `notes` arriva col più recente per primo,
  // e si inverte per l'ordine cronologico. Null se la lista è vuota.
  function buildNotesFile(notes, opts) {
    const o = opts || {};
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const id = (o.id) || defaultFileId();
    const list = Array.isArray(notes) ? notes.slice().reverse() : [];
    if (!list.length) return null;
    const content = [];
    for (const n of list) {
      const head = noteHeadline(n);
      if (head) content.push({ type: 'paragraph', content: [{ type: 'text', text: head }] });
      const t = n && (n.text != null ? n.text : '');
      for (const p of textToParagraphs(t)) content.push(p);
    }
    const file = blankNotesFile(id, DEFAULT_TITLE, now);
    file.content = { type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] };
    return file;
  }

  global.SN_EDITOR_NOTES = {
    DEFAULT_TITLE,
    MAX_TITLE,
    normTopic,
    titleFor,
    textToParagraphs,
    blankNotesFile,
    appendToContent,
    writeNote,
    buildNotesFile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
