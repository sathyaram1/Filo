// Appunti nell'editor: la logica con cui Filo, in autonomia, scrive gli appunti
// dentro i FILE dell'editor invece che in un archivio separato.
//
// PERCHÉ ESISTE
//   Prima gli appunti ("prendi nota che…") finivano in un silo a parte, non
//   modificabile né componibile con il resto. Ora Filo li scrive direttamente
//   nell'editor: accoda a un file di appunti "attivo" finché resta sullo stesso
//   argomento, e apre un file NUOVO quando l'argomento cambia (o su richiesta
//   esplicita). Così gli appunti sono testo vero, riordinabile, versionato e
//   ritrovabile insieme a tutto il resto.
//
// LOGICA PURA
//   Nessun DOM, nessuno storage: opera su oggetti (collezione dell'editor +
//   storico versioni + un "puntatore" all'appunto attivo) e li ritorna. La
//   persistenza vera vive nel main (services/editorFiles.js) e nel renderer
//   dell'editor. Riusa SN_EDITOR_STORE (collezione) e SN_EDITOR_VERSIONS
//   (punti di ripristino) — vedi editorStore.js / editorVersions.js. Così tutto
//   è unit-testabile senza aprire Electron (tests/unit/editorNotes.test.mjs).

(function (global) {
  'use strict';

  const DEFAULT_TITLE = 'Appunti';
  const MAX_TITLE = 80;

  function store() { return global.SN_EDITOR_STORE; }
  function vers() { return global.SN_EDITOR_VERSIONS; }

  function defaultFileId() {
    return 'file-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Normalizza un argomento per confrontarlo (minuscole, spazi compattati).
  function normTopic(t) {
    return String(t == null ? '' : t).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function capFirst(s) {
    const t = String(s == null ? '' : s).trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  // Titolo del file di appunti a partire dall'argomento (o un default).
  function titleFor(topic) {
    const t = String(topic == null ? '' : topic).trim();
    return t ? capFirst(t).slice(0, MAX_TITLE) : DEFAULT_TITLE;
  }

  function isEmptyPara(node) {
    return node && node.type === 'paragraph'
      && (!Array.isArray(node.content) || node.content.length === 0);
  }

  // Testo (anche multi-riga) → nodi paragrafo nel formato dell'editor (ProseMirror
  // leggero: { type:'doc', content:[ {type:'paragraph', content:[{type:'text'}]} ] }).
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

  // File di appunti vuoto, serializzato (stesso schema dei file dell'editor).
  // `meta.created/modified` sono ISO come nel resto dell'editor (blankDoc), così
  // il confronto "chi è più fresco" in fase di merge resta omogeneo.
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

  // Accoda `paras` al content di un file serializzato. Se il file è "vuoto" (un
  // solo paragrafo senza testo, com'è un file appena creato) i paragrafi
  // rimpiazzano quel vuoto, così non resta una riga bianca iniziale.
  function appendToContent(content, paras) {
    const base = (content && content.type === 'doc' && Array.isArray(content.content))
      ? content.content.slice() : [];
    const cleaned = (base.length === 1 && isEmptyPara(base[0])) ? [] : base;
    return { type: 'doc', content: cleaned.concat(paras) };
  }

  // Scrive un appunto nella collezione dell'editor.
  //
  // opts:
  //   - collection : collezione v2 (SN_EDITOR_STORE) — obbligatoria.
  //   - versions   : storico versioni (SN_EDITOR_VERSIONS), default {}.
  //   - pointer    : { fileId, topic } — il file di appunti "attivo" e l'ultimo
  //                  argomento su cui Filo stava scrivendo. Default {}.
  //   - text       : il testo dell'appunto (obbligatorio, altrimenti no-op).
  //   - topic      : l'argomento dell'appunto (facoltativo).
  //   - forceNew   : true → apri comunque un file nuovo ("apri un nuovo appunto").
  //   - ids        : { file, ver } factory di id (per test deterministici).
  //   - now        : timestamp (per test).
  //
  // Regola: accoda al file `pointer.fileId` finché l'argomento resta lo stesso;
  // apre un file nuovo se `forceNew`, se il puntatore è assente/sparito, o se
  // l'argomento è cambiato. Ogni scrittura registra punti di ripristino PRIMA e
  // DOPO (il "prima" fa dedup con il "dopo" precedente: la modifica di Filo è
  // sempre reversibile). Ritorna:
  //   { collection, versions, pointer, fileId, createdFile, title, wrote }
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

    // Punto di ripristino PRIMA (stato attuale del file). Dedup automatico: per
    // un append consecutivo coincide col "dopo" precedente → non ne crea uno
    // spazzatura. Per un file nuovo cattura lo stato vuoto (ripristinabile).
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

    // Punto di ripristino DOPO (stato con l'appunto): è questo che rende la
    // scrittura reversibile e alimenta lo storico del file.
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

  // Intestazione di un appunto migrato: la data e l'argomento che il vecchio
  // archivio mostrava accanto al testo. Senza, migrando si perderebbe il QUANDO
  // e il DI-COSA di ogni nota — informazione che l'utente aveva sotto gli occhi.
  // Ritorna '' se non c'è né l'una né l'altro (niente righe vuote decorative).
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

  // MIGRAZIONE: dai vecchi appunti dell'archivio a un unico file "Appunti".
  // `notes` è la lista dell'archivio (ordine più-recente-prima, come lo storage):
  // la invertiamo per avere l'ordine cronologico nel file. Ogni appunto diventa
  // una riga con data e argomento seguita dal suo testo, così nulla di ciò che
  // l'archivio mostrava va perso. Ritorna il file serializzato pronto per essere
  // aggiunto alla collezione (o null se vuota).
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
