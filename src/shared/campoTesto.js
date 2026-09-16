// Che cosa conta come «campo di testo», in un posto solo: se il cursore è in un campo Ctrl/Cmd+Z annulla quello che si sta scrivendo, altrimenti torna alla pagina precedente (#267).
// La domanda arriva dalla pagina (Windows/Linux) e dal processo principale (su Mac la barra dei menu vince sempre sui tasti che la pagina ascolta, #527, src/main/menu.js): il main manda la SORGENTE a valutare dentro la pagina invece di tenersene una copia, che divergerebbe.
// VINCOLO: `campoDiTesto` e `scriveQui` restano autosufficienti — nessun riferimento al resto del file, perché nella pagina esistono solo loro due.

(function (global) {
  'use strict';

  // Gli `input` non testuali (spunte, bottoni, colore…) non contano: lì Ctrl+Z non ha niente da annullare.
  function campoDiTesto(el) {
    if (!el) return false;
    if (el.matches && el.matches('input, textarea')) {
      const tipo = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      const nonTesto = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'color', 'range'];
      if (el.tagName === 'INPUT' && nonTesto.indexOf(tipo) !== -1) return false;
      return !el.disabled && !el.readOnly;
    }
    return !!(el.closest && el.closest('[contenteditable=""], [contenteditable="true"]'));
  }

  // Il fuoco può essere annidato in uno shadow DOM (un componente web che si porta dietro il suo campo): lì `activeElement` è l'ospite, non il campo, quindi si scende.
  function scriveQui(doc) {
    let el = doc && doc.activeElement;
    let giri = 0;
    while (el && el.shadowRoot && el.shadowRoot.activeElement && giri++ < 32) {
      el = el.shadowRoot.activeElement;
    }
    return campoDiTesto(el);
  }

  // La stessa domanda in forma di sorgente da valutare dentro una pagina: così il main la fa senza tenersene una copia.
  function sorgenteScriveQui() {
    return '(() => { const campoDiTesto = ' + campoDiTesto.toString()
      + '; const scriveQui = ' + scriveQui.toString()
      + '; return scriveQui(document); })()';
  }

  global.SN_CAMPO_TESTO = { campoDiTesto, scriveQui, sorgenteScriveQui };
})(typeof globalThis !== 'undefined' ? globalThis : self);
