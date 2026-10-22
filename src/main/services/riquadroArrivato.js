// Il lato main della regola sui riquadri in arrivo (src/shared/riquadriInArrivo.js, #1429): codice eseguito in un
// riquadro prima del suo primo commit gira nel documento vuoto iniziale e gli toglie il preload di Filo.
// Un riquadro così ha `url` vuoto; quello che la pagina scrive da sé è about:blank e si legge. Sentinella: tests/unit/riquadriInArrivo.test.mjs.

'use strict';

/** Il frame si può leggere ed eseguire: la pagina, o un riquadro che ha già un documento suo. PURA. */
function riquadroArrivato(f) {
  if (!f) return false;
  try {
    if (f.detached) return false;
    return f === f.top || !!f.url;
  } catch (_) { return false; }
}

module.exports = { riquadroArrivato };
