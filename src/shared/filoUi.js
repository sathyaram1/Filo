// Marchio sui pezzi di UI che Filo attacca al DOM di un sito, così chi cammina sulla pagina (la traduzione) li salta.
// Dal NOME non si indovina: i portali ServiceNow chiamano `sn-*` ogni loro pezzo e «filo» è una parola comune — interi
// riquadri restavano non tradotti sotto l'avviso che dichiarava la pagina tradotta (#407). Chi aggiunge UI a una pagina
// web marca la RADICE del pezzo, subito, nella stessa funzione che la crea.

(function (global) {
  'use strict';

  // `data-sn-ui` è un attributo, non una classe: le classi le tocca anche il sito (un
  // framework che rifà l'elenco cancellerebbe il marchio) e un `data-` non entra in nessun stile.
  const ATTR = 'data-sn-ui';
  const SELECTOR = '[' + ATTR + ']';

  // Le radici disegnate da noi, in ordine di nascita. Non è una WeakSet perché va PERCORSA.
  // L'attributo risponde a «questo pezzo lo salto?» e se lo può scrivere anche il sito; a
  // «l'ho disegnato IO?» risponde solo questo elenco, che vive nel mondo isolato dei content
  // script — un sito che si marcava un elemento invisibile e se lo toglieva a ogni Esc teneva
  // l'utente nello schermo intero a tempo indeterminato (#514).
  const nostre = new Set();
  // Tetto di sicurezza: `mark()` arriva anche prima che l'elemento sia attaccato, quindi qui
  // non si può guardare `isConnected`. Si buttano le più vecchie, che è la direzione sicura:
  // una radice dimenticata vale «non è successo niente», mai «è successo qualcosa».
  const TETTO = 256;

  // Serve a chi deve preparare qualcosa PRIMA che l'utente prema un tasto: sopra lo schermo
  // pieno di un sito l'Esc va chiesto al browser mentre un nostro riquadro è aperto, o quel
  // tasto non arriva mai al documento (#514).
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

  // Non si pota qui: `mark()` può arrivare un istante prima dell'inserimento e una potatura
  // in mezzo butterebbe un riquadro che stava per nascere; l'elenco lo tiene corto `mark()`.
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
  // `closest` si ferma al confine del componente isolato, ed è quello che vogliamo: dentro
  // lo shadow di un riquadro di Filo la radice marcata è l'host.
  function inside(el) {
    try {
      if (is(el)) return true;
      return !!(el && el.closest && el.closest(SELECTOR));
    } catch (_) { return false; }
  }

  global.SN_FILO_UI = { ATTR, SELECTOR, mark, is, inside, aperti, onMark };
})(typeof globalThis !== 'undefined' ? globalThis : self);
