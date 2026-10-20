// «Questa scheda esisteva solo per far partire uno scaricamento?». Logica pura.
// Due casi: scheda mai riempita (#412) e pagina-ponte che avvia il file da sola (#441).
// Se manca una sola condizione la scheda resta aperta: chiuderla fa sparire qualcosa.
(function (global) {
  'use strict';

  // Copre il conto alla rovescia di una pagina-ponte più la risposta del server.
  // Oltre, la pagina è rimasta lì abbastanza da non essere più un ponte.
  const BRIDGE_MAX_AGE_MS = 15000;

  // `userInputAt` è l'ultimo input REALE dell'utente, o null; `now` è iniettabile nei test.
  // Ritorna { close, reason: 'blank' | 'bridge' | null }.
  function decideCloseOnDownload(signals, opts) {
    const s = signals || {};
    const maxAge = Number((opts && opts.bridgeMaxAgeMs) || BRIDGE_MAX_AGE_MS);
    const keep = { close: false, reason: null };

    if (s.isInternal) return keep;
    // #412 — contenitore mai riempito: nessun contenuto da perdere.
    if (!s.everNavigated) return { close: true, reason: 'blank' };

    // #441 — pagina-ponte. Tutte le condizioni devono valere insieme.
    if (!s.openedByLink) return keep;   // l'utente è arrivato qui da sé
    if (s.canBack) return keep;         // ci ha navigato dentro: non è un ponte
    if (s.userInputAt) return keep;     // l'ha toccata: gliela lasciamo
    const navAt = Number(s.navigatedAt) || 0;
    if (!navAt) return keep;
    const now = Number(s.now) || Date.now();
    if (now - navAt > maxAge) return keep; // sta lì da un pezzo: non è un ponte
    return { close: true, reason: 'bridge' };
  }

  global.SN_DOWNLOAD_TABS = { decideCloseOnDownload, BRIDGE_MAX_AGE_MS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
