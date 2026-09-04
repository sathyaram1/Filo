// Come si CHIAMA una scorciatoia, sulla macchina di chi la sta leggendo.
//
// PERCHÉ ESISTE
//   Filo si scrive su Windows e si scarica anche su Mac. Le funzioni rispondono
//   già a Cmd (nel codice una scorciatoia si legge sempre `ctrlKey || metaKey`):
//   quello che restava sbagliato era il TESTO. Un Mac legge "Ctrl+V" nel menu
//   del tasto destro, "Ctrl+B" sotto il pulsante del grassetto, "Alt+H" alla
//   voce Aiuto — tasti che su quella tastiera o non ci sono o fanno altro.
//
//   Il difetto è tornato a ogni giro da una porta diversa, perché ogni scritta
//   era una stringa a sé. Questa è la porta unica: le etichette non si scrivono
//   più a mano, si chiedono qui. La sentinella `tests/unit/macSupport.test.mjs`
//   diventa rossa se qualcuno ne scrive una nuova a mano.
//
// LE REGOLE, E PERCHÉ SONO QUESTE
//   · Ctrl → Cmd. Su Mac il tasto delle scorciatoie è Cmd, e Filo lo accetta
//     ovunque accetti Ctrl.
//   · Alt+lettera → Ctrl+Alt+lettera. Sono le scorciatoie GLOBALI (Alt+E, T, S,
//     H): su Mac Alt è il tasto Opzione, quello che compone gli accenti, e
//     prendersi Opzione+E toglierebbe la "é" a chi scrive in italiano in
//     qualunque programma. `src/main/shortcuts.js` registra infatti Ctrl+Alt.
//   · Alt+cifra → Cmd+cifra. Sono i salti da una scheda all'altra. Su Mac
//     Opzione+cifra SCRIVE (¡™£¢…), quindi Filo non può prendersela mentre
//     l'utente digita; Cmd+cifra è la forma che usa ogni browser su Mac e non
//     produce testo. `src/main/tabs.js` e `src/renderer/shell.js` ascoltano di
//     conseguenza.
//
// Chi cambia una di queste regole cambia INSIEME la tabella qui sotto e il
// codice che ascolta i tasti: sono due metà della stessa cosa.

(function (global) {
  'use strict';

  // Da dove si sa su che sistema stiamo. Questo file gira in quattro posti
  // diversi (main, preload, pagina interna di Filo, pagina web) e ognuno ha una
  // sola di queste fonti: le proviamo tutte, in ordine di attendibilità.
  function piattaforma(esplicita) {
    if (esplicita) return esplicita;
    // main process, preload e content script (sandbox spento: `process` c'è).
    try {
      if (typeof process !== 'undefined' && process && process.platform) return process.platform;
    } catch (_) {}
    // Pagina interna filo:// → internal-preload.js espone window.filo.sistema.
    try { if (global.filo && global.filo.sistema) return global.filo.sistema; } catch (_) {}
    // Shell della finestra → shell-preload.js espone window.filoShell.sistema.
    try { if (global.filoShell && global.filoShell.sistema) return global.filoShell.sistema; } catch (_) {}
    // Ultima spiaggia: quello che dice il browser.
    try {
      const nav = global.navigator;
      const dichiarata = (nav && nav.userAgentData && nav.userAgentData.platform)
        || (nav && nav.platform) || '';
      if (/mac/i.test(dichiarata)) return 'darwin';
      if (/win/i.test(dichiarata)) return 'win32';
      if (dichiarata) return 'linux';
    } catch (_) {}
    // Windows è il ripiego: è dove sta la stragrande maggioranza degli utenti.
    return 'win32';
  }

  function suMac(esplicita) {
    return piattaforma(esplicita) === 'darwin';
  }

  // "Ctrl+Shift+1" → ["Ctrl", "Shift", "1"]. Il tasto finale può essere un "+"
  // (Ctrl++ non esiste in Filo, ma la spaccatura non deve rovinarlo comunque).
  function pezzi(accel) {
    return String(accel || '').split('+').map((p) => p.trim()).filter(Boolean);
  }

  // L'etichetta da MOSTRARE per un acceleratore scritto in forma Windows.
  // Su Windows e Linux torna identica: la forma canonica è quella.
  function etichetta(accel, esplicita) {
    const testo = String(accel || '');
    if (!testo || !suMac(esplicita)) return testo;

    const parti = pezzi(testo);
    if (!parti.length) return testo;

    const tastoFinale = parti[parti.length - 1];
    const modificatori = parti.slice(0, -1).map((m) => m.toLowerCase());

    // Alt da solo davanti a una cifra: è un salto di scheda → su Mac Cmd+cifra.
    if (modificatori.length === 1 && modificatori[0] === 'alt' && /^[0-9]$/.test(tastoFinale)) {
      return `Cmd+${tastoFinale}`;
    }

    const fuori = [];
    let haCtrl = false;
    let haAlt = false;
    for (const m of modificatori) {
      if (m === 'ctrl' || m === 'control' || m === 'cmd' || m === 'command' || m === 'meta') { haCtrl = true; continue; }
      if (m === 'alt' || m === 'option' || m === 'opt') { haAlt = true; continue; }
      fuori.push(m === 'shift' ? 'Shift' : parti[modificatori.indexOf(m)]);
    }

    // Alt+lettera senza Ctrl: scorciatoia globale → su Mac prende un Ctrl in più.
    if (haAlt && !haCtrl) haCtrl = true;

    const out = [];
    if (haCtrl) out.push('Cmd');
    if (haAlt) out.push('Alt');
    out.push(...fuori);
    out.push(tastoFinale);
    return out.join('+');
  }

  // Comodità per i testi che intrecciano l'etichetta in una frase:
  // `frase('Grassetto', 'Ctrl+B')` → "Grassetto (Ctrl+B)" / "Grassetto (Cmd+B)".
  function frase(testo, accel, esplicita) {
    return `${testo} (${etichetta(accel, esplicita)})`;
  }

  global.SN_TASTI = { piattaforma, suMac, etichetta, frase };
})(typeof globalThis !== 'undefined' ? globalThis : self);
