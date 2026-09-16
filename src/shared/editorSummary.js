// Riassunto per file dell'editor (#379.5): estrarre il testo di un file serializzato, decidere quando rigenerarne il riassunto, e costruire l'elenco {titolo, riassunto} che entra nel contesto di Filo al posto del testo integrale.
// Filo deve poter «vedere» i file senza pagarne il testo intero a ogni risposta: nel contesto va solo il riassunto, e il contenuto completo di un singolo file si chiede on-demand (azione LEGGI_FILE).
// LOGICA PURA sugli oggetti-file serializzati (stesso schema di editorStore.js): la generazione vera vive nel renderer dell'editor, la lettura della collezione in services/editorFiles.js.

(function (global) {
  'use strict';

  // Sotto questa soglia il testo È già la sua sintesi: si usa un estratto grezzo invece di sprecare una chiamata.
  const MIN_WORDS = 60;
  // «Cambiamento significativo»: si rigenera quando le parole differiscono da quelle di allora di almeno ABS parole OPPURE di almeno RATIO in proporzione — il più permissivo dei due, così un file corto che cambia molto e uno lungo che cambia poco sono coperti entrambi senza rigenerare a ogni battitura.
  const CHANGE_ABS = 40;
  const CHANGE_RATIO = 0.4;
  // Taglio difensivo sul riassunto iniettato.
  const MAX_SUMMARY = 400;
  // Ripiego finché non c'è un riassunto.
  const EXCERPT_LEN = 200;

  // Albero PM-like (doc → paragraph/heading/blockquote/list… → text), blocchi separati da newline. Robusto a nodi mancanti o forme inattese.
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

  // Nessun riassunto → non fresco. Riassunto senza firma → fresco: non si rigenera a vuoto qualcosa scritto o mantenuto altrove. Con firma, si confrontano le parole di allora con quelle di adesso.
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

  // Sotto MIN_WORDS non vale la chiamata: ci pensa l'estratto.
  function needsSummary(file, opts) {
    const o = opts || {};
    const minWords = Number.isFinite(o.minWords) ? o.minWords : MIN_WORDS;
    const words = fileWords(file);
    if (words < minWords) return false;
    return !isSummaryFresh(file, words);
  }

  // Firma da salvare insieme al riassunto, per il confronto futuro.
  function makeSig(file) {
    return { words: fileWords(file), at: Date.now() };
  }

  function clip(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n).trim() + '…' : t;
  }

  // Il riassunto AI se c'è, altrimenti un estratto grezzo, altrimenti «(vuoto)».
  function summaryFor(file) {
    const meta = (file && file.meta) || {};
    if (meta.summary && String(meta.summary).trim()) {
      return { text: clip(meta.summary, MAX_SUMMARY), source: 'ai' };
    }
    const excerpt = clip(fileText(file), EXCERPT_LEN);
    if (excerpt) return { text: excerpt, source: 'excerpt' };
    return { text: '(vuoto)', source: 'empty' };
  }

  // È questo che entra nel contesto di Filo: riassunti, non testo integrale.
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

  // Ogni riga porta l'id del file: serve a Filo per chiederne il contenuto con LEGGI_FILE.
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
