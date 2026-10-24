// Il testo dei file dell'editor per i modelli: il riassunto per file che entra nel contesto di Filo al posto del testo
// intero (#379.5), quando rifarlo, e quanto del documento leggono chat, titolo e riassunto (#1475). Logica pura, niente
// DOM né storage; prove in tests/unit/editorSummary.test.mjs.

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

  // Quanto del documento leggono i modelli dell'Editor (#1475): i 100.000 token del contesto di serie della chat di Filo,
  // che stanno anche in un modello da 128.000 insieme al tetto della risposta. Oltre si taglia, e lo si dice a tutti e due.
  const TESTO_AL_MODELLO_MAX = 350000;

  function testoAlModello(testo, max = TESTO_AL_MODELLO_MAX) {
    const t = String(testo == null ? '' : testo).trim();
    if (t.length <= max) return { testo: t, letti: t.length, totale: t.length, tagliato: false };
    let n = max;
    const ultimo = t.charCodeAt(n - 1);
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) n -= 1;
    return { testo: t.slice(0, n), letti: n, totale: t.length, tagliato: true };
  }

  // Un modello dalla finestra più stretta del tetto rifiuta il documento: si rilegge più corto, misurato sul rifiuto con
  // la regola della chat di Filo. null se non è quel rifiuto, o se quello che resterebbe è troppo poco per servire.
  const RILETTO_MIN = 2000;
  function rilettoDopoRifiuto(testo, letto, rifiuto, caratteri) {
    const FC = global.SN_FILO_CONTESTO;
    const misure = FC && letto && letto.letti ? FC.troppoLungo(rifiuto) : null;
    if (!misure) return null;
    const token = FC.tettoDopoRifiuto({ ...misure, caratteri, caratteriTratto: letto.letti });
    const max = Math.floor((token || 0) * FC.CARATTERI_PER_TOKEN);
    if (max < RILETTO_MIN || max >= letto.letti) return null;
    return testoAlModello(testo, max);
  }

  const numero = (n) => Number(n).toLocaleString('it-IT', { useGrouping: true });

  // Per chi scrive, sotto la risposta o nell'avviso; `perCosa` dice quale lavoro ha letto solo l'inizio.
  function notaTaglio(letto, perCosa = '') {
    if (!letto || !letto.tagliato) return '';
    return `Il documento è lungo: ${perCosa ? `${perCosa} ` : ''}ho letto i primi ${numero(letto.letti)} caratteri su ${numero(letto.totale)}.`;
  }

  // Per il modello, davanti al testo: sa che il resto esiste e non lo inventa.
  function avvisoTaglio(letto) {
    if (!letto || !letto.tagliato) return '';
    return `(Il documento è più lungo: qui ci sono i primi ${numero(letto.letti)} caratteri su ${numero(letto.totale)}. Il resto non lo vedi: se la richiesta lo riguarda, dillo.)`;
  }

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

  // Rende i riassunti in un blocco di testo per il prompt. Ogni riga porta l'id
  // del file (serve a Filo per chiederne il contenuto con LEGGI_FILE). Titoli e
  // riassunti arrivano recintati: un appunto lo può scrivere il modello (#592.4).
  function renderForPrompt(contextFiles) {
    const list = Array.isArray(contextFiles) ? contextFiles : [];
    if (!list.length) return '';
    if (!global.SN_ESTERNO && typeof require === 'function') require('./contenutoEsterno.js');
    const E = global.SN_ESTERNO;
    if (!E) throw new Error('SN_ESTERNO mancante: carica shared/contenutoEsterno.js prima di editorSummary.js');
    return E.imbusta({
      tipo: 'TESTO_SALVATO',
      conIntestazione: true,
      testo: list.map((f) => E.neutralizza(`- [${f.id}] ${f.title}: ${f.summary}`, { unaRiga: true })).join('\n'),
    });
  }

  global.SN_EDITOR_SUMMARY = {
    MIN_WORDS,
    CHANGE_ABS,
    CHANGE_RATIO,
    MAX_SUMMARY,
    TESTO_AL_MODELLO_MAX,
    testoAlModello,
    rilettoDopoRifiuto,
    notaTaglio,
    avvisoTaglio,
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
