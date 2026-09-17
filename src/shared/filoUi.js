// Marchio sui pezzi di UI che Filo attacca al DOM di un sito, così la traduzione li salta.
// Dal NOME non si indovina: «filo» è comune e i portali chiamano `sn-*` ogni pezzo (#407).
// Chi aggiunge UI a una pagina marca la RADICE subito, nella funzione che la crea.

(function (global) {
  'use strict';

  // Un attributo, non una classe: le classi le tocca anche il sito e un framework
  // che rifà l'elenco cancellerebbe il marchio.
  const ATTR = 'data-sn-ui';
  const SELECTOR = '[' + ATTR + ']';

  // L'attributo risponde a «questo pezzo lo salto?» e se lo può scrivere anche il sito;
  // a «l'ho disegnato IO?» risponde solo questo elenco, nel mondo isolato (#514).
  const nostre = new Set();
  // `mark()` arriva anche prima che l'elemento sia attaccato: qui `isConnected` non si guarda.
  // Si buttano le più vecchie: una radice dimenticata vale «non è successo niente».
  const TETTO = 256;

  // Serve a chi deve preparare qualcosa PRIMA che l'utente prema un tasto: sopra lo schermo
  // pieno di un sito l'Esc va chiesto al browser, o non arriva mai al documento (#514).
  const osservatori = new Set();
  function onMark(fn) {
    if (typeof fn !== 'function') return () => {};
    osservatori.add(fn);
    return () => osservatori.delete(fn);
  }

  function mark(el) {
    try { if (el && el.setAttribute) el.setAttribute(ATTR, '1'); } catch (_) {}
    try {
      if (el) {
        nostre.add(el);
        while (nostre.size > TETTO) nostre.delete(nostre.values().next().value);
      }
    } catch (_) {}
    for (const fn of osservatori) { try { fn(el); } catch (_) {} }
    return el;
  }

  // Non si pota qui: una potatura in mezzo butterebbe un riquadro che stava per nascere.
  // L'elenco lo tiene corto `mark()`.
  function aperti() {
    const vive = [];
    try {
      for (const el of nostre) if (el && el.isConnected) vive.push(el);
    } catch (_) {}
    return vive;
  }

  function is(el) {
    try { return !!(el && el.getAttribute && el.getAttribute(ATTR) !== null); } catch (_) { return false; }
  }

  // Anche gli antenati: un nodo in fondo a un nostro popup è nostro quanto il popup.
  // `closest` si ferma al confine dello shadow, dove la radice marcata è l'host.
  function inside(el) {
    try {
      if (is(el)) return true;
      return !!(el && el.closest && el.closest(SELECTOR));
    } catch (_) { return false; }
  }

  global.SN_FILO_UI = { ATTR, SELECTOR, mark, is, inside, aperti, onMark };
})(typeof globalThis !== 'undefined' ? globalThis : self);
