// Una casella di ricerca, non una bozza: per la pulizia delle schede non va protetta (#824). Il nome del campo da solo
// non basta: un'area a più righe o un testo lungo sono un messaggio qualunque sia il nome, e nel dubbio è un messaggio.
// La usa src/content/content.js; sentinella: tests/unit/ricercaCampo.test.mjs.

(function (global) {
  'use strict';

  // Oltre, quello che si scrive è un messaggio anche in una casella col nome da ricerca.
  const TESTO_LUNGO = 100;
  const NOMI = /^(q|s|k|query|search|search_query|keywords?|field-keywords)$/i;
  // Parola intera: «research» non è «search», «cercasi» non è «cerca».
  const PAROLE = /(?:^|[^\p{L}\p{N}])(search|cerca|ricerca|busca|buscar|recherche|rechercher|suche|suchen)(?=[^\p{L}\p{N}]|$)/iu;

  // `tratti`: { tag, tipo, nome, ruolo, inRicerca, etichetta, righe, lunghezza }; righe 0 = non misurabile.
  function eRicerca(tratti) {
    const t = tratti || {};
    const tag = String(t.tag || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    if (/^searchbox$/i.test(String(t.ruolo || '')) || t.inRicerca) return true;
    if (tag === 'INPUT' && String(t.tipo || '').toLowerCase() === 'search') return true;
    if (Number(t.lunghezza) > TESTO_LUNGO) return false;
    if (tag === 'TEXTAREA') return Number(t.righe) === 1 && NOMI.test(String(t.nome || ''));
    return NOMI.test(String(t.nome || '')) || PAROLE.test(String(t.etichetta || ''));
  }

  // Le righe che l'area mostra, non l'attributo: una textarea senza «rows» ne ha due, quella dei motori di ricerca una.
  function righeDi(el) {
    try {
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      const riga = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.2;
      const alto = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      if (alto > 0) return Math.max(1, Math.round(alto / riga));
    } catch (_) {}
    return Number(el.rows) || 2;
  }

  function trattiDi(el) {
    if (!el || !el.tagName) return {};
    const tag = el.tagName.toUpperCase();
    let inRicerca = false;
    try { inRicerca = !!el.closest('[role="search" i]'); } catch (_) {}
    return {
      tag,
      tipo: el.type || '',
      nome: el.name || '',
      ruolo: (el.getAttribute && el.getAttribute('role')) || '',
      inRicerca,
      etichetta: `${(el.getAttribute && el.getAttribute('aria-label')) || ''} ${el.placeholder || ''}`,
      // Misurare costa un calcolo della pagina a ogni tasto: serve solo a un'area col nome da ricerca.
      righe: tag !== 'TEXTAREA' ? 1 : (NOMI.test(el.name || '') ? righeDi(el) : 0),
      lunghezza: String(el.value || '').trim().length,
    };
  }

  global.SN_RICERCA_CAMPO = { eRicerca, trattiDi, TESTO_LUNGO };
})(typeof globalThis !== 'undefined' ? globalThis : this);
