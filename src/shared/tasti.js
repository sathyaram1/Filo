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
//   · Su Mac lo ZERO non salta a nessuna scheda: Cmd+0 riporta la pagina al
//     100%, e quel tasto se lo prende la barra dei menu prima di chiunque
//     altro. Al posto suo Cmd+9 porta all'ULTIMA scheda — la forma di ogni
//     browser su Mac. Su Windows e Linux zoom (Ctrl) e schede (Alt) stanno su
//     tasti diversi e non si toccano: lì Alt+0 resta la decima scheda.
//
// Chi cambia una di queste regole cambia INSIEME la tabella qui sotto e il
// codice che ascolta i tasti: sono due metà della stessa cosa.
//
// QUELLO CHE UNA PAGINA NON PUÒ AVERE
//   `riservato()` dice se una combinazione arriva mai a una pagina. Serve a chi
//   fa scegliere una scorciatoia all'utente (le scorciatoie dei moduli
//   dell'Editor): senza, la scorciatoia si salva, sembra valida e non parte mai
//   — su Mac perché la barra dei menu la intercetta prima, ovunque perché è un
//   tasto che Filo si tiene per sé.

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

  const CTRL = /^(ctrl|control|cmd|command|meta)$/;
  const ALT = /^(alt|option|opt)$/;

  // L'etichetta da MOSTRARE per un acceleratore scritto in forma Windows.
  // Su Windows e Linux torna identica: la forma canonica è quella.
  function etichetta(accel, esplicita) {
    const testo = String(accel || '');
    if (!testo || !suMac(esplicita)) return testo;

    const parti = pezzi(testo);
    // Il nome del modificatore da solo ("Ctrl", in una frase che lo cita).
    if (parti.length === 1) return CTRL.test(parti[0].toLowerCase()) ? 'Cmd' : testo;

    const tastoFinale = parti[parti.length - 1];
    const modificatori = parti.slice(0, -1);
    const haCtrl = modificatori.some((m) => CTRL.test(m.toLowerCase()));
    const haAlt = modificatori.some((m) => ALT.test(m.toLowerCase()));
    const altri = modificatori.filter((m) => !CTRL.test(m.toLowerCase()) && !ALT.test(m.toLowerCase()));

    // Alt+cifra: salto di scheda. Su Mac Opzione+cifra scrive un simbolo, quindi
    // la forma è Cmd+cifra — quella di ogni browser su Mac.
    if (haAlt && !haCtrl && /^[0-9]$/.test(tastoFinale)) return `Cmd+${tastoFinale}`;

    // Alt+lettera: scorciatoia GLOBALE. Su Mac prende un Control davanti (e qui
    // "Ctrl" è davvero il tasto Control del Mac, non Cmd): vedi shortcuts.js.
    if (haAlt && !haCtrl) return ['Ctrl', 'Alt', ...altri, tastoFinale].join('+');

    // Tutto il resto passa da Ctrl, e su Mac Ctrl si preme Cmd.
    const out = [];
    if (haCtrl) out.push('Cmd');
    if (haAlt) out.push('Alt');
    out.push(...altri, tastoFinale);
    return out.join('+');
  }

  // Comodità per i testi che intrecciano l'etichetta in una frase:
  // `frase('Grassetto', 'Ctrl+B')` → "Grassetto (Ctrl+B)" / "Grassetto (Cmd+B)".
  function frase(testo, accel, esplicita) {
    return `${testo} (${etichetta(accel, esplicita)})`;
  }

  // ── Il salto da una scheda all'altra ───────────────────────────────────────
  // Sta qui, accanto al suo nome, perché nome e comportamento devono cambiare
  // INSIEME: erano due posti diversi, e su Mac dicevano due cose diverse.
  //
  // Su Windows e Linux: Alt+cifra. Alt perché non ruba il Ctrl+cifra del
  // browser e perché mentre si scrive non produce testo.
  // Su Mac: Cmd+cifra. Lì Opzione+cifra SCRIVE (¡™£¢∞…), e Filo prendendosela
  // impediva di digitare quei simboli in qualunque pagina finché c'erano
  // schede aperte. Cmd+cifra è la forma di ogni browser su Mac e non scrive.
  //
  // L'evento arriva in due forme: quello del DOM (altKey/ctrlKey/metaKey) e
  // quello di `before-input-event` del main (alt/control/meta). Le leggiamo
  // entrambe. Torna l'INDICE della scheda (0-based, 0 → la decima), o null.
  function indiceSaltoScheda(ev, esplicita) {
    if (!ev) return null;
    // I due nomi con cui ogni modificatore può arrivare: quello del DOM e
    // quello del main. Nessuno dei due è presente in entrambe le forme, quindi
    // basta chiedere tutti e due.
    const NOMI = {
      alt: ['altKey', 'alt'],
      ctrl: ['ctrlKey', 'control'], meta: ['metaKey', 'meta'],
      shift: ['shiftKey', 'shift'],
    };
    const premuto = (quale) => NOMI[quale].some((nome) => !!ev[nome]);
    const alt = premuto('alt');
    const ctrl = premuto('ctrl');
    const meta = premuto('meta');
    if (premuto('shift')) return null;

    const giusto = suMac(esplicita)
      ? (meta && !ctrl && !alt)
      : (alt && !ctrl && !meta);
    if (!giusto) return null;

    // La cifra si legge dal tasto FISICO (Digit0–9: regge qualunque layout, e
    // su Mac Opzione trasformerebbe comunque il carattere); `key` è il ripiego
    // per gli eventi sintetici dei test.
    const m = /^Digit([0-9])$/.exec(String(ev.code || ''));
    const cifra = m ? m[1] : (/^[0-9]$/.test(String(ev.key || '')) ? String(ev.key) : null);
    if (cifra == null) return null;
    return cifra === '0' ? 9 : Number(cifra) - 1;
  }

  // Come si chiama, quel salto, per chi lo legge in un elenco.
  function etichettaSaltoScheda(esplicita) {
    return etichetta('Alt+1', esplicita).replace(/1$/, 'cifra');
  }

  global.SN_TASTI = { piattaforma, suMac, etichetta, frase, indiceSaltoScheda, etichettaSaltoScheda };
})(typeof globalThis !== 'undefined' ? globalThis : self);
