// Traduzione dell'intera pagina (voce globale del menu) + ripristino del
// testo originale. Lo stato "sta traducendo / ha una traduzione attiva" vive
// qui; il menu lo legge via hasTranslation() per decidere icona ed etichetta.
// Estratto da content.js — viene caricato prima di lui dai preload.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Extract = global.SN_EXTRACT;

  let pageTranslating = false;
  let pageHasTranslation = false;

  async function translatePage() {
    if (pageTranslating) {
      Popup.showToast(I18n.t('toast_translating_page'));
      return;
    }
    pageTranslating = true;
    Popup.showToast(I18n.t('toast_translating_page'), { duration: 1800 });

    const nodes = Extract.extractMainTextNodes();
    if (!nodes.length) { pageTranslating = false; return; }

    // Per ogni nodo: trasforma i figli (link, img, span, …) in placeholder [[Lk]],
    // così l'AI traduce solo il testo e i link restano cliccabili.
    for (const n of nodes) {
      const { templated, refs } = templateizeBlock(n.el);
      n.templated = templated;
      n.refs = refs;
    }

    // Chunking: aggrega nodi fino a ~3000 caratteri per chunk.
    const CHUNK_SIZE = 3000;
    const chunks = [];
    let cur = { nodes: [], length: 0 };
    for (const n of nodes) {
      const len = (n.templated || '').length + 2;
      if (cur.length + len > CHUNK_SIZE && cur.nodes.length) {
        chunks.push(cur);
        cur = { nodes: [], length: 0 };
      }
      cur.nodes.push(n);
      cur.length += len;
    }
    if (cur.nodes.length) chunks.push(cur);

    const SEPARATOR = '\n@@@SN_SEP@@@\n';
    let translatedAny = false;
    try {
      for (const c of chunks) {
        const joined = c.nodes.map((n) => n.templated).join(SEPARATOR);
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.TRANSLATE_PAGE,
          payload: { chunk: joined },
        });
        if (!res?.ok) {
          Popup.showToast(res?.error || I18n.t('err_provider_failed'));
          break;
        }
        const parts = (res.text || '').split(/\n?@@@SN_SEP@@@\n?/);
        for (let i = 0; i < c.nodes.length; i++) {
          const part = parts[i];
          if (typeof part === 'string' && part.trim()) {
            try {
              const el = c.nodes[i].el;
              if (el.dataset.snTranslated) continue;
              const refs = c.nodes[i].refs || [];
              el.dataset.snOriginalHtml = el.innerHTML;
              el.dataset.snTranslated = '1';
              // Escape del testo dell'AI (no XSS), poi reinserimento dei placeholder
              // come HTML originale (gli outerHTML provengono dalla pagina stessa).
              const safe = escapeHtmlForTranslation(part.trim());
              const html = safe.replace(/\[\[L(\d+)\]\]/g, (_, k) => refs[Number(k)] || '');
              el.innerHTML = html;
              translatedAny = true;
            } catch (_) {}
          }
        }
      }
      if (translatedAny) {
        pageHasTranslation = true;
        Popup.showToast(I18n.t('toast_page_translated'));
      }
    } finally {
      pageTranslating = false;
    }
  }

  // Trasforma i figli del blocco in segnaposto [[Lk]] preservandoli per il rimontaggio.
  // Restituisce { templated: stringa con segnaposto, refs: array di outerHTML }.
  function templateizeBlock(el) {
    const refs = [];
    let out = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const idx = refs.length;
        refs.push(child.outerHTML);
        out += `[[L${idx}]]`;
      }
    }
    return { templated: out.replace(/\s+/g, ' ').trim(), refs };
  }

  function escapeHtmlForTranslation(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Ripristina il testo originale annullando la traduzione di pagina.
  function restoreOriginal() {
    document.querySelectorAll('[data-sn-translated="1"]').forEach((el) => {
      if (el.dataset.snOriginalHtml !== undefined) {
        el.innerHTML = el.dataset.snOriginalHtml;
        delete el.dataset.snOriginalHtml;
      } else if (el.dataset.snOriginal !== undefined) {
        el.textContent = el.dataset.snOriginal;
        delete el.dataset.snOriginal;
      }
      delete el.dataset.snTranslated;
    });
    // Rimuovi eventuali note di traduzione (vecchio formato, retrocompatibilità)
    document.querySelectorAll('[data-sn-translation="1"]').forEach((n) => n.remove());
    pageHasTranslation = false;
    Popup.showToast(I18n.t('toast_original_restored'));
  }

  function hasTranslation() { return pageHasTranslation; }

  global.SN_TRANSLATE_PAGE = { translatePage, restoreOriginal, hasTranslation };
})(typeof globalThis !== 'undefined' ? globalThis : self);
