// Logica pura: "questa scheda esisteva solo per far partire uno scaricamento?"
//
// Due casi, stesso attrito per l'utente (una scheda in più da chiudere a mano
// dopo che il file è già partito):
//
//  1) #412 — scheda VUOTA: un link "Scarica" con target=_blank verso una
//     risposta servita come allegato non committa MAI una pagina: la scheda
//     resta bianca, titolo "Nuova scheda". Non c'è niente da perdere: si chiude.
//
//  2) #441 — scheda PONTE: il sito apre una pagina intermedia ("Grazie, il
//     download partirà a breve…") che dopo un attimo avvia il file da sola. La
//     pagina ha contenuto vero — quindi la regola del #412 non la tocca — ma è
//     usa e getta: dice solo che il file sta per partire, e quando parte non
//     serve più.
//
// Il caso 2 chiude una pagina CON contenuto, quindi la firma dev'essere stretta:
// la scheda dev'essere nata da un link/window.open (mai una che l'utente ha
// aperto e indirizzato lui), non deve avere cronologia indietro (nessuna
// navigazione fatta dentro), l'utente non deve averla MAI toccata (nessun
// click, tasto, scroll o tocco) e lo scaricamento deve partire entro pochi
// secondi dal caricamento della pagina. Se anche uno solo di questi manca, la
// scheda resta aperta: sbagliare tenendo una scheda costa un clic, sbagliare
// chiudendola fa sparire qualcosa che l'utente stava guardando.
(function (global) {
  'use strict';

  // Finestra "il download è partito da solo poco dopo il caricamento".
  // Copre i conti alla rovescia tipici delle pagine-ponte ("il download partirà
  // fra 10 secondi") più il tempo di risposta del server; oltre, la pagina è
  // rimasta lì abbastanza da non essere più un semplice ponte.
  const BRIDGE_MAX_AGE_MS = 15000;

  // signals:
  //   isInternal     bool   — pagina interna di Filo (filo://)
  //   everNavigated  bool   — ha mai committato una pagina nel frame principale
  //   openedByLink   bool   — nata da target=_blank / window.open
  //   canBack        bool   — ha cronologia indietro dentro la scheda
  //   userInputAt    number|null — ultimo input REALE dell'utente in questa scheda
  //   navigatedAt    number|null — commit dell'ultima pagina
  //   now            number — orologio (iniettabile per i test)
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
