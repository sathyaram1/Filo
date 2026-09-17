// Riassunto per file dell'editor (#379.5): estrazione del testo, quando rigenerare,
// e l'elenco {titolo, riassunto} che entra nel contesto di Filo al posto del testo.
// Filo vede i file senza pagarne il testo intero: il contenuto si chiede con LEGGI_FILE.

(function (global) {
  'use strict';

  // Sotto questa soglia il testo È già la sua sintesi: basta un estratto, niente chiamata.
  const MIN_WORDS = 60;
  // Si rigenera quando le parole differiscono di almeno ABS OPPURE di almeno RATIO:
  // il più permissivo dei due copre sia un file corto sia uno lungo, senza rigenerare sempre.
  const CHANGE_ABS = 40;
  const CHANGE_RATIO = 0.4;
  // Taglio difensivo sul riassunto iniettato.
  const MAX_SUMMARY = 400;
  // Ripiego finché non c'è un riassunto.
  const EXCERPT_LEN = 200;

  // Albero PM-like (doc → paragraph/heading/list… → text), blocchi separati da newline.
  // Robusto a nodi mancanti o forme inattese.
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

  // Nessun riassunto → non fresco.
  // Riassunto senza firma → fresco: non si rigenera ciò che è mantenuto altrove.
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
