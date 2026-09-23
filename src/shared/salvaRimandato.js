// Salvataggio ritardato di una pagina, con le sue due regole.
// Non deve: decidere COSA salvare, né disegnare la conferma.
// Regole: tests/unit/salvaRimandato.test.mjs.

(function (global) {
  'use strict';

  const ATTESA_MS = 400;

  const inAscolto = [];

  function crea(opzioni) {
    const o = opzioni || {};
    const attesa = typeof o.attesaMs === 'number' ? o.attesaMs : ATTESA_MS;
    let timer = null;
    let sporco = false;

    function spegniConferma() {
      if (typeof o.spegniConferma !== 'function') return;
      try { o.spegniConferma(); } catch (_) {}
    }

    // Toccato e non ancora partito. Un campo ancora sotto il cursore è già una
    // modifica: senza questo, nessuna uscita lo salverebbe mai.
    function modificato() {
      sporco = true;
      spegniConferma();
    }

    function programma() {
      modificato();
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; sporco = false; o.salva(); }, attesa);
    }

    function subito() {
      if (timer == null && !sporco) return false;
      clearTimeout(timer);
      timer = null;
      sporco = false;
      o.salva();
      return true;
    }

    const api = { modificato, programma, subito, inAttesa: () => timer != null || sporco };
    inAscolto.push(api);
    return api;
  }

  function salvaTuttoSubito() {
    let salvati = 0;
    for (const r of inAscolto.slice()) {
      try { if (r.subito()) salvati += 1; } catch (_) {}
    }
    return salvati;
  }

  // Le uscite di una pagina: il cambio scheda arriva come visibilitychange, e
  // tutte le altre (ricaricamento, chiusura, uscita da Filo) come pagehide.
  if (global.addEventListener && global.document) {
    global.addEventListener('pagehide', salvaTuttoSubito);
    global.addEventListener('beforeunload', salvaTuttoSubito);
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.visibilityState === 'hidden') salvaTuttoSubito();
    });
  }

  global.SN_SALVA = { crea, salvaTuttoSubito, ATTESA_MS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
