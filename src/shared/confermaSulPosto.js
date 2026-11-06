// La conferma sul posto («Confermi?» sullo stesso tasto): il tasto armato tiene la scatola che aveva, così il secondo
// clic cade sullo stesso tasto e non sul vicino scivolato al suo posto. Non tiene stato né timer: li tiene chi la usa.
// Regole: patterns/una-conferma-sul-posto-tiene-ferma-la-sua-scatola.md; sentinella tests/unit/confermaSulPosto.test.mjs.

(function (global) {
  'use strict';

  // Le misure si prendono vere, prima di cambiare la scritta: valgono con qualunque font o zoom scelto dall'utente.
  function arma(btn, etichetta) {
    if (!btn) return;
    const scatola = btn.getBoundingClientRect();
    btn.style.minWidth = scatola.width + 'px';
    btn.style.maxWidth = scatola.width + 'px';
    btn.style.minHeight = scatola.height + 'px';
    btn.textContent = etichetta;
  }

  function disarma(btn, etichetta) {
    if (!btn) return;
    btn.style.minWidth = '';
    btn.style.maxWidth = '';
    btn.style.minHeight = '';
    if (etichetta != null) btn.textContent = etichetta;
  }

  global.SN_CONFERMA_SUL_POSTO = { arma, disarma };
})(typeof globalThis !== 'undefined' ? globalThis : self);
