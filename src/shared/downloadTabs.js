// Logica pura: «questa scheda esisteva solo per far partire uno scaricamento?». Due casi: scheda mai riempita, che resta bianca dopo un link di download (#412), e pagina-ponte «il download partirà a breve» che avvia il file da sola (#441).
// Il ponte chiude una pagina CON contenuto, quindi la firma è stretta: nata da link/window.open, senza cronologia indietro, mai toccata dall'utente (click, tasto, scroll, tocco), download partito entro pochi secondi dal caricamento.
// Se manca anche una sola condizione la scheda resta aperta: tenerne una di troppo costa un clic, chiuderne una fa sparire qualcosa che l'utente stava guardando.
(function (global) {
  'use strict';

  // Finestra «il download è partito da solo poco dopo il caricamento»: copre i conti alla rovescia delle pagine-ponte più la risposta del server. Oltre, la pagina è rimasta lì abbastanza da non essere più un ponte.
  const BRIDGE_MAX_AGE_MS = 15000;

  // signals: isInternal (pagina filo://), everNavigated (ha mai committato una pagina nel frame principale), openedByLink, canBack, userInputAt (ultimo input REALE dell'utente, o null), navigatedAt, now (orologio iniettabile per i test).
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
