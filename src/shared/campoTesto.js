// Che cosa conta come "campo di testo", per Filo. Una regola, un posto.
//
// PERCHÉ ESISTE
//   Ctrl/Cmd+Z ha due significati e a separarli è una domanda sola: il cursore
//   sta dentro un campo di testo? Se sì la combinazione ANNULLA quello che si
//   sta scrivendo — il significato universale, e nessuno deve perdere una riga
//   appena battuta. Se no, torna alla pagina precedente (#267).
//
//   La domanda arriva da due strade diverse. Dalla PAGINA, quando è la pagina a
//   ricevere il tasto: Windows e Linux, dove la barra dei menu non è attaccata
//   a niente. Dal PROCESSO PRINCIPALE, quando a riceverlo è la barra dei menu:
//   su Mac quella barra è dell'applicazione, vince sempre sui tasti che la
//   pagina ascolta, e l'unico modo di non fargli fare la cosa sbagliata è
//   fargli fare quella giusta (#527, src/main/menu.js).
//
//   Due copie della stessa regola avrebbero cominciato a divergere il giorno
//   dopo. Qui ce n'è una: la pagina la chiama, il main ne manda la SORGENTE a
//   valutare dentro la pagina (`sorgenteScriveQui()`).
//
// VINCOLO
//   `campoDiTesto` e `scriveQui` devono restare AUTOSUFFICIENTI: niente
//   riferimenti a variabili di questo file: quando il main le spedisce come
//   testo, nella pagina esistono solo loro due.

(function (global) {
  'use strict';

  // Un elemento in cui si scrive. Gli `input` non testuali (spunte, bottoni,
  // colore…) non contano: lì Ctrl+Z non ha niente da annullare.
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

  // L'utente sta scrivendo in QUESTO documento? Il fuoco può essere annidato
  // dentro uno shadow DOM (un componente web che si porta dietro il suo campo):
  // `activeElement` lì fuori è l'ospite, non il campo, quindi si scende.
  function scriveQui(doc) {
    let el = doc && doc.activeElement;
    let giri = 0;
    while (el && el.shadowRoot && el.shadowRoot.activeElement && giri++ < 32) {
      el = el.shadowRoot.activeElement;
    }
    return campoDiTesto(el);
  }

  // La stessa domanda, in forma di sorgente da valutare dentro una pagina:
  // è così che il processo principale la fa senza tenersene una copia.
  function sorgenteScriveQui() {
    return '(() => { const campoDiTesto = ' + campoDiTesto.toString()
      + '; const scriveQui = ' + scriveQui.toString()
      + '; return scriveQui(document); })()';
  }

  global.SN_CAMPO_TESTO = { campoDiTesto, scriveQui, sorgenteScriveQui };
})(typeof globalThis !== 'undefined' ? globalThis : self);
