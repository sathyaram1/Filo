// Riassunto per file dell'editor (#379.5): logica pura per (a) estrarre il testo
// di un file serializzato, (b) decidere QUANDO (ri)generare il suo riassunto, e
// (c) costruire l'elenco {titolo, riassunto} di tutti i file che entra nel
// contesto di Filo al posto del testo integrale.
//
// PERCHÉ ESISTE
//   Filo deve poter "vedere" i file dell'editor senza pagarne il testo intero a
//   ogni risposta. Ogni file porta un riassunto di un paio di righe (generato
//   dall'AV, mantenuto aggiornato quando il file cambia in modo significativo);
//   nel contesto entra SOLO il riassunto di ogni file, e Filo — se serve — chiede
//   il contenuto completo di un singolo file on-demand (azione LEGGI_FILE).
//
// LOGICA PURA
//   Nessun DOM, nessuno storage: opera sugli oggetti-file serializzati
//   (meta/content, lo stesso schema di editorStore.js) e ritorna valori. Così è
//   unit-testabile senza aprire Electron (vedi tests/unit/editorSummary.test.mjs).
//   La generazione vera (chiamata AI) vive nel renderer dell'editor; la lettura
//   della collezione dal main vive in services/editorFiles.js.

(function (global) {
  'use strict';

  // Soglia minima di parole prima di generare un riassunto AI: sotto questa il
  // testo È già la sua sintesi, quindi buildContextFiles usa un estratto grezzo
  // (nessuna chiamata sprecata su file cortissimi).
  const MIN_WORDS = 60;
  // "Cambiamento significativo": rigenera quando le parole differiscono dallo
  // stato di quando fu generato il riassunto di almeno ABS parole OPPURE almeno
  // RATIO in proporzione (il più permissivo dei due), così un file corto che
  // cambia molto e uno lungo che cambia poco sono entrambi coperti senza
  // rigenerare a ogni battitura.
  const CHANGE_ABS = 40;
  const CHANGE_RATIO = 0.4;
  // Lunghezza massima del riassunto che iniettiamo per file (taglio difensivo).
  const MAX_SUMMARY = 400;
  // Lunghezza dell'estratto grezzo usato come ripiego finché non c'è un riassunto.
  const EXCERPT_LEN = 200;

  // Estrae il testo semplice da un content serializzato dell'editor (albero
  // PM-like: doc → paragraph/heading/blockquote/list… → text). I blocchi sono
  // separati da newline. Robusto a nodi mancanti o forme inattese.
  function plainText(content) {
    const root = content && content.content ? content : (content && content.meta ? content.content : content);
    if (!root || !Array.isArray(root.content)) return '';
    const BLOCK = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'bulletList', 'orderedList', 'codeBlock']);
    let out = '';
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.text === 'string') { out += node.text; return; }
      if (Array.isArray(node.content)) {
        node.content.forEach(walk);
      }
      if (BLOCK.has(node.type) && !out.endsWith('\n')) out += '\n';
    };
    if (Array.isArray(root.content)) root.content.forEach(walk);
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  // Testo semplice di un FILE serializzato (comodo per il main).
  function fileText(file) {
    if (!file) return '';
    return plainText(file.content);
  }

  function countWords(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  function fileWords(file) {
    return countWords(fileText(file));
  }

  // Il riassunto memorizzato è "fresco" rispetto al contenuto attuale?
  //  - nessun riassunto → non fresco.
  //  - c'è un riassunto ma manca la firma → consideralo fresco (non rigenerare a
  //    vuoto un riassunto scritto/mantenuto altrove).
  //  - c'è firma → confronta le parole di allora con quelle di adesso.
  function isSummaryFresh(file, currentWords) {
    const meta = (file && file.meta) || {};
    if (!meta.summary) return false;
    const sig = meta.summarySig;
    if (sig == null || typeof sig.words !== 'number') return true;
    const now = Number.isFinite(currentWords) ? currentWords : fileWords(file);
    const delta = Math.abs(now - sig.words);
    const threshold = Math.max(CHANGE_ABS, Math.round(CHANGE_RATIO * sig.words));
    return delta < threshold;
  }

  // Va (ri)generato ORA il riassunto AI del file?
  //   true se il file ha abbastanza testo (≥ MIN_WORDS) e il riassunto manca o
  //   è stantìo. Sotto MIN_WORDS non vale la chiamata (ci pensa l'estratto).
  function needsSummary(file, opts) {
    const o = opts || {};
    const minWords = Number.isFinite(o.minWords) ? o.minWords : MIN_WORDS;
    const words = fileWords(file);
    if (words < minWords) return false;
    return !isSummaryFresh(file, words);
  }

  // Firma da salvare quando si genera un riassunto (per il confronto futuro).
  function makeSig(file) {
    return { words: fileWords(file), at: Date.now() };
  }

  function clip(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n).trim() + '…' : t;
  }

  // Un "riassunto per il contesto" per un singolo file: il riassunto AI se c'è,
  // altrimenti un estratto grezzo del testo (ripiego), altrimenti "(vuoto)".
  function summaryFor(file) {
    const meta = (file && file.meta) || {};
    if (meta.summary && String(meta.summary).trim()) {
      return { text: clip(meta.summary, MAX_SUMMARY), source: 'ai' };
    }
    const excerpt = clip(fileText(file), EXCERPT_LEN);
    if (excerpt) return { text: excerpt, source: 'excerpt' };
    return { text: '(vuoto)', source: 'empty' };
  }

  // Elenco {id, title, summary, source} di TUTTI i file di una collezione: è ciò
  // che entra nel contesto di Filo (riassunti, non testo integrale).
  function buildContextFiles(collection) {
    const files = (collection && Array.isArray(collection.files)) ? collection.files : [];
    return files.map((f) => {
      const meta = (f && f.meta) || {};
      const s = summaryFor(f);
      return {
        id: f && f.id,
        title: (meta.title && String(meta.title).trim()) || 'Documento senza titolo',
        summary: s.text,
        source: s.source,
      };
    });
  }

  // Rende i riassunti in un blocco di testo per il prompt. Ogni riga porta l'id
  // del file (serve a Filo per chiederne il contenuto con LEGGI_FILE).
  function renderForPrompt(contextFiles) {
    const list = Array.isArray(contextFiles) ? contextFiles : [];
    if (!list.length) return '';
    return list
      .map((f) => `- [${f.id}] ${f.title}: ${f.summary}`)
      .join('\n');
  }

  global.SN_EDITOR_SUMMARY = {
    MIN_WORDS,
    CHANGE_ABS,
    CHANGE_RATIO,
    MAX_SUMMARY,
    plainText,
    fileText,
    countWords,
    fileWords,
    isSummaryFresh,
    needsSummary,
    makeSig,
    summaryFor,
    buildContextFiles,
    renderForPrompt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
