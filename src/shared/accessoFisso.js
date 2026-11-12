// La password che dice «pagina d'accesso», per la pulizia delle schede (#824.3, #1808): una regola sola per la pagina
// prima dell'invio (content.js) e per quella che risponde (src/main/tabs.js, anche nei riquadri). Non tocca la pagina.
// Sentinella: tests/unit/accessoFisso.test.mjs.

(function (global) {
  'use strict';

  // L'accesso piccolo che il sito mette in ogni pagina (testata, menu, colonna laterale) non è una sessione scaduta.
  const FISSO = 'header,nav,aside,[role=banner],[role=navigation],[role=complementary]';

  // True se `doc` mostra una password fuori dall'accesso fisso e fuori da `escluso` (il modulo appena mandato).
  // Si inietta anche da sola nelle pagine: niente riferimenti fuori dal suo corpo.
  function passwordDiAccesso(doc, escluso, fisso) {
    try {
      return Array.prototype.some.call(doc.querySelectorAll('input[type=password]'), function (e) {
        return e.getClientRects().length > 0 && !e.closest(fisso) && !(escluso && escluso.contains(e));
      });
    } catch (e) { return false; }
  }

  // Da eseguire nella pagina (o nel riquadro) che ha risposto all'invio.
  const CONTROLLA_JS = `(function(){try{return {pw:(${passwordDiAccesso.toString()})(document,null,${JSON.stringify(FISSO)}),`
    + 'dove:location.pathname,titolo:document.title};}catch(e){return {};}})()';

  global.SN_ACCESSO_FISSO = { FISSO, passwordDiAccesso: (doc, escluso) => passwordDiAccesso(doc, escluso, FISSO), CONTROLLA_JS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
