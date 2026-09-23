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

    // Un controllo che non si scrive (interruttore, menu) salva senza pausa, ma
    // passa di qui perché conferma e uscite restino una regola sola.
    function adesso() { modificato(); return subito(); }

    const api = { modificato, programma, subito, adesso, inAttesa: () => timer != null || sporco };
    inAscolto.push(api);
    return api;
  }

  // Un campo che si conferma quando il cursore ne esce (una rinomina, la riga di
  // un elenco) va confermato anche se la pagina sparisce prima: chi scrive
  // registra qui la conferma, e le uscite la fanno partire come un salvataggio.
  function campoAlVolo() {
    let conferma = null;
    const r = crea({ salva: () => { const f = conferma; conferma = null; if (f) f(); } });
    return {
      scrivendo(fn) { conferma = fn; r.modificato(); },
      confermato() { conferma = null; r.subito(); },
    };
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
