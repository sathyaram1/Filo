// Che cosa conta come «campo di testo», in un posto solo: lì Ctrl/Cmd+Z annulla quello che
// si scrive, altrimenti torna alla pagina precedente (#267). Il main manda la SORGENTE da
// valutare nella pagina, mai una copia. `campoDiTesto` e `scriveQui` sono autosufficienti.

(function (global) {
  'use strict';

  // Gli `input` non testuali (spunte, bottoni, colore…) non contano: lì Ctrl+Z non ha
  // niente da annullare.
  function campoDiTesto(el) {
    if (!el) return false;
    // Un riquadro chiuso di Filo (data-sn-riquadro) non mostra a chi guarda da fuori il campo che ha il fuoco: se il
    // fuoco è lì dentro, si sta scrivendo (#1071).
    if (el.matches && el.matches('[data-sn-riquadro]:focus-within')) return true;
    if (el.matches && el.matches('input, textarea')) {
      const tipo = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      const nonTesto = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'color', 'range'];
      if (el.tagName === 'INPUT' && nonTesto.indexOf(tipo) !== -1) return false;
      return !el.disabled && !el.readOnly;
    }
    // `isContentEditable` conta anche plaintext-only ed eredità; il selettore regge un elemento staccato.
    if (el.isContentEditable) return true;
    return !!(el.closest && el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
  }

  // L'utente sta scrivendo in QUESTO documento? Il fuoco può essere annidato in
  // uno shadow DOM o in un riquadro (gli editor di documenti ricevono i tasti in
  // un iframe): si scende fino al campo. Torna null se il fuoco è in un riquadro
  // d'altra origine, che da qui non si vede: la domanda va fatta a lui.
  function scriveQui(doc) {
    let el = doc && doc.activeElement;
    let giri = 0;
    while (el && giri++ < 32) {
      if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
      if (/^i?frame$/i.test(el.tagName || '')) {
        // Da un riquadro in arrivo non si legge: toccato perderebbe il suo Filo (#1560), e la domanda va fatta a lui.
        const R = typeof globalThis !== 'undefined' ? globalThis.SN_RIQUADRI_IN_ARRIVO : null;
        let dentro = null;
        if (!R || !R.inArrivo(el)) { try { dentro = el.contentDocument; } catch (_) { dentro = null; } }
        if (!dentro) return null;
        el = dentro.activeElement;
        continue;
      }
      break;
    }
    if (campoDiTesto(el)) return true;
    // Resta il campo dentro un'ombra chiusa (#685.1): da fuori la selezione scrivibile punta
    // ESATTAMENTE alla posizione dell'ospite a fuoco. Una selezione altrove è di un campo che la
    // pagina ha lasciato (fuoco passato a un contenitore, al body…): lì non si scrive più.
    if (!el) return false;
    try {
      const d = el.ownerDocument || doc;
      if (el === d.body || el === d.documentElement || !el.parentNode) return false;
      if (!d.queryCommandEnabled('insertText')) return false;
      const radice = el.getRootNode ? el.getRootNode() : d;
      const s = (radice && radice !== d && typeof radice.getSelection === 'function') ? radice.getSelection() : d.getSelection();
      if (!s) return false;
      const i = Array.prototype.indexOf.call(el.parentNode.childNodes, el);
      return (s.anchorNode === el.parentNode && s.anchorOffset === i)
        || (s.focusNode === el.parentNode && s.focusOffset === i);
    } catch (_) { return false; }
  }

  // La stessa domanda come sorgente da valutare dentro una pagina: così il main la fa
  // senza tenersene una copia.
  function sorgenteScriveQui() {
    return '(() => { const campoDiTesto = ' + campoDiTesto.toString()
      + '; const scriveQui = ' + scriveQui.toString()
      + '; return scriveQui(document); })()';
  }

  global.SN_CAMPO_TESTO = { campoDiTesto, scriveQui, sorgenteScriveQui };
})(typeof globalThis !== 'undefined' ? globalThis : self);
