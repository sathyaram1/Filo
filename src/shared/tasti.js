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
//   · Alt+lettera → Ctrl+Alt+lettera. Sono Spiega, Traduci, Salva e Aiuto
//     (Alt+E, T, S, H): su Mac Alt è il tasto Opzione, quello che compone gli
//     accenti, e prendersi Opzione+E toglierebbe la "é" a chi scrive in una
//     pagina. `src/main/shortcuts.js` ascolta infatti Ctrl+Alt.
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
//   fa scegliere una scorciatoia all'utente (i moduli dell'Editor, le quattro
//   azioni di Filo): senza, la scorciatoia si salva, sembra valida e non parte mai
//   — su Mac perché la barra dei menu la intercetta prima, ovunque perché è un
//   tasto che Filo si tiene per sé.

(function (global) {
  'use strict';

  // Questo file gira in quattro posti (main, preload, pagina interna, pagina web) e ognuno ha
  // una sola di queste fonti: si provano tutte, in ordine di attendibilità.
  function piattaforma(esplicita) {
    if (esplicita) return esplicita;
    // main process, preload e content script (sandbox spento: `process` c'è).
    try {
      if (typeof process !== 'undefined' && process && process.platform) return process.platform;
    } catch (_) {}
    try { if (global.filo && global.filo.sistema) return global.filo.sistema; } catch (_) {}
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
  // Senza nessun «+» si separa anche col trattino o con lo spazio («Ctrl-S», «Ctrl Shift 2»):
  // si staccano i modificatori in testa e il resto è il tasto («Ctrl Freccia giù», «Ctrl--»).
  function pezzi(accel) {
    const testo = String(accel || '').trim();
    if (testo.includes('+')) return testo.split('+').map((p) => p.trim()).filter(Boolean);
    const parti = [];
    let resto = testo;
    let m;
    while ((m = /^([^\s-]+)(\s*-\s*|\s+)/.exec(resto)) && tipoModificatore(m[1])) {
      parti.push(m[1]);
      resto = resto.slice(m[0].length);
    }
    if (resto.trim()) parti.push(resto.trim());
    return parti;
  }

  // Anche i nomi italiani e i simboli del Mac: un modificatore che non si
  // riconosce sparirebbe dalla forma e la scorciatoia scatterebbe senza (#545.1).
  const CTRL = /^(ctrl|control|controllo|cmd|command|comando|meta|\u2318|\u2303)$/;
  // Scritti INSIEME sono due tasti, Control e Cmd del Mac: Ctrl+Cmd+F non è Cmd+F.
  const CONTROL = /^(ctrl|control|controllo|\u2303)$/;
  const COMANDO = /^(cmd|command|comando|meta|\u2318)$/;
  function conControlECmd(modificatori) {
    const m = modificatori.map((x) => String(x).toLowerCase());
    return m.some((x) => CONTROL.test(x)) && m.some((x) => COMANDO.test(x));
  }
  const ALT = /^(alt|option|opt|opzione|\u2325)$/;
  const SHIFT = /^(shift|maiusc|maiuscolo|maiuscole|\u21e7)$/;

  // Su Windows e Linux torna identica: la forma canonica è quella.
  function etichetta(accel, esplicita) { return nomeSulMac(accel, esplicita, false); }

  // Il nome di una combinazione scritta dall'utente: su Mac Ctrl diventa Cmd e basta. Le riscritture
  // di Alt qui sotto valgono per i tasti di Filo, e ripetere Alt+1 come «Cmd+1» nominava un altro tasto (#545).
  function etichettaScritta(accel, esplicita) { return nomeSulMac(accel, esplicita, true); }

  function nomeSulMac(accel, esplicita, scritta) {
    const testo = String(accel || '');
    if (!testo || !suMac(esplicita)) return testo;

    const parti = pezzi(testo);
    // Il nome del modificatore da solo, per una frase che lo cita.
    if (parti.length === 1) return CTRL.test(parti[0].toLowerCase()) ? 'Cmd' : testo;

    const tastoFinale = parti[parti.length - 1];
    const modificatori = parti.slice(0, -1);
    const haCtrl = modificatori.some((m) => CTRL.test(m.toLowerCase()));
    const haAlt = modificatori.some((m) => ALT.test(m.toLowerCase()));
    const altri = modificatori.filter((m) => !CTRL.test(m.toLowerCase()) && !ALT.test(m.toLowerCase()));

    // Alt+freccia: indietro e avanti. Su Mac Opzione+freccia sposta il cursore
    // di una parola dentro OGNI campo di testo: prendersela vorrebbe dire
    // togliere quel movimento in tutta l'app. Lì la convenzione dei browser è
    // Cmd+[ e Cmd+], che non scrivono e non muovono niente.
    if (!scritta && haAlt && !haCtrl && (tastoFinale === '\u2190' || tastoFinale === '\u2192')) {
      return `Cmd+${tastoFinale === '\u2190' ? '[' : ']'}`;
    }

    // Alt+cifra: salto di scheda. Su Mac Opzione+cifra scrive un simbolo, quindi
    // la forma è Cmd+cifra — quella di ogni browser su Mac. Lo zero fa
    // eccezione: su Mac Cmd+0 è lo zoom al 100%, e la decima scheda si raggiunge
    // con Cmd+9 come "l'ultima" (vedi `indiceSaltoScheda`).
    if (!scritta && haAlt && !haCtrl && /^[0-9]$/.test(tastoFinale)) {
      return `Cmd+${tastoFinale === '0' ? '9' : tastoFinale}`;
    }

    // Alt+lettera: Spiega, Traduci, Salva, Aiuto. Su Mac prende un Control davanti
    // (e qui "Ctrl" è davvero il tasto Control del Mac, non Cmd): vedi shortcuts.js.
    if (!scritta && haAlt && !haCtrl) return ['Ctrl', 'Alt', ...altri, tastoFinale].join('+');

    // Tutto il resto passa da Ctrl, e su Mac Ctrl si preme Cmd.
    const out = [];
    if (conControlECmd(modificatori)) out.push('Ctrl', 'Cmd');
    else if (haCtrl) out.push('Cmd');
    if (haAlt) out.push('Alt');
    out.push(...altri, tastoFinale);
    return out.join('+');
  }

  // `frase('Grassetto', 'Ctrl+B')` → «Grassetto (Ctrl+B)» / «Grassetto (Cmd+B)».
  function frase(testo, accel, esplicita) {
    return `${testo} (${etichetta(accel, esplicita)})`;
  }

  // Un modificatore arriva con due nomi diversi a seconda di chi porta
  // l'evento: quello del DOM (altKey) e quello di `before-input-event` del main
  // (alt). Nessuna delle due forme li ha entrambi, quindi si chiedono tutti e
  // due.
  const NOMI_MODIFICATORI = {
    alt: ['altKey', 'alt'],
    ctrl: ['ctrlKey', 'control'], meta: ['metaKey', 'meta'],
    shift: ['shiftKey', 'shift'],
  };
  function modificatore(ev, quale) {
    return NOMI_MODIFICATORI[quale].some((nome) => !!ev[nome]);
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
  // LO ZERO, SU MAC, NON È UNA SCHEDA. Cmd+0 riporta la pagina al 100%, e la
  // barra dei menu (src/main/menu.js) se lo prende prima di chiunque altro:
  // promettere lì la decima scheda significava promettere una cosa che non
  // succede mai. Al posto suo Cmd+9 porta all'ULTIMA scheda aperta, come in
  // ogni browser su Mac. Su Windows e Linux nulla cambia: lo zoom sta su Ctrl,
  // il salto su Alt, e Alt+0 resta la decima scheda.
  //
  // L'evento arriva in due forme: quello del DOM (altKey/ctrlKey/metaKey) e
  // quello di `before-input-event` del main (alt/control/meta). Le leggiamo
  // entrambe. Torna l'INDICE della scheda (0-based) o null. `quante` è il
  // numero di schede aperte, e serve solo su Mac per sapere qual è l'ultima:
  // chi non lo passa ottiene la nona (il comportamento di prima).
  function indiceSaltoScheda(ev, esplicita, quante) {
    if (!ev) return null;
    const premuto = (quale) => modificatore(ev, quale);
    const alt = premuto('alt');
    const ctrl = premuto('ctrl');
    const meta = premuto('meta');
    if (premuto('shift')) return null;

    const giusto = suMac(esplicita)
      ? (meta && !ctrl && !alt)
      : (alt && !ctrl && !meta);
    if (!giusto) return null;

    // La cifra si legge dal tasto FISICO (Digit0–9: regge qualunque layout, e su Mac Opzione
    // trasformerebbe il carattere); `key` è il ripiego per gli eventi sintetici dei test.
    const m = /^Digit([0-9])$/.exec(String(ev.code || ''));
    const cifra = m ? m[1] : (/^[0-9]$/.test(String(ev.key || '')) ? String(ev.key) : null);
    if (cifra == null) return null;

    if (suMac(esplicita)) {
      // Lo zero è dello zoom: qui non è un salto.
      if (cifra === '0') return null;
      // Il nove è «l'ultima scheda»: con meno di nove schede aperte porta comunque all'ultima,
      // non nel vuoto.
      if (cifra === '9') {
        const n = Number(quante);
        return Number.isFinite(n) && n > 0 ? n - 1 : 8;
      }
      return Number(cifra) - 1;
    }
    return cifra === '0' ? 9 : Number(cifra) - 1;
  }

  function etichettaSaltoScheda(esplicita) {
    return etichetta('Alt+1', esplicita).replace(/1$/, 'cifra');
  }

  function descrizioneSaltoScheda(esplicita) {
    return suMac(esplicita)
      ? 'Vai alla scheda in quella posizione (9 = l’ultima; Cmd+0 è lo zoom al 100%)'
      : 'Vai alla scheda in quella posizione (0 = la decima)';
  }

  // ── La scheda dopo e quella prima ──────────────────────────────────────────
  // Ctrl+Tab e Ctrl+Shift+Tab di ogni browser, su Mac col Control vero (Cmd+Tab è il cambio di app del
  // sistema): l'etichetta resta «Ctrl+Tab» anche lì. Gira in tondo. Torna l'indice (0-based) o null.
  function indiceSchedaVicina(ev, attiva, quante) {
    if (!ev || !(String(ev.code || '') === 'Tab' || String(ev.key || '') === 'Tab')) return null;
    if (!modificatore(ev, 'ctrl') || modificatore(ev, 'alt') || modificatore(ev, 'meta')) return null;
    const n = Number(quante);
    if (!Number.isInteger(n) || n < 1) return null;
    const indietro = modificatore(ev, 'shift');
    const i = Number(attiva);
    if (!Number.isInteger(i) || i < 0 || i >= n) return indietro ? n - 1 : 0;
    return (i + (indietro ? n - 1 : 1)) % n;
  }

  function etichettaSchedaVicina(verso) {
    return verso === 'prima' ? 'Ctrl+Shift+Tab' : 'Ctrl+Tab';
  }

  // ── Indietro e avanti ──────────────────────────────────────────────────────
  // Chi arriva da un browser qualunque prova Alt+freccia e i due tasti laterali
  // del mouse. Nome e comportamento stanno qui insieme per lo stesso motivo del
  // salto di scheda: su Mac la combinazione è un'ALTRA (Cmd+[ e Cmd+]), perché
  // Opzione+freccia lì sposta il cursore di una parola in ogni campo di testo.
  //
  // L'evento arriva sia dal DOM sia da `before-input-event` del main. Torna
  // 'indietro', 'avanti' o null.
  function comandoNavigazione(ev, esplicita) {
    if (!ev) return null;
    if (modificatore(ev, 'shift')) return null;
    const alt = modificatore(ev, 'alt');
    const ctrl = modificatore(ev, 'ctrl');
    const meta = modificatore(ev, 'meta');
    // Il tasto si legge prima dal codice FISICO (regge qualunque layout e su
    // Mac Opzione trasformerebbe comunque il carattere); `key` è il ripiego per
    // gli eventi sintetici dei test.
    const code = String(ev.code || '');
    const key = String(ev.key || '');

    if (suMac(esplicita)) {
      if (!(meta && !ctrl && !alt)) return null;
      if (code === 'BracketLeft' || key === '[') return 'indietro';
      if (code === 'BracketRight' || key === ']') return 'avanti';
      return null;
    }
    if (!(alt && !ctrl && !meta)) return null;
    if (code === 'ArrowLeft' || key === 'ArrowLeft') return 'indietro';
    if (code === 'ArrowRight' || key === 'ArrowRight') return 'avanti';
    return null;
  }

  // L'altra metà della convenzione del Mac: Cmd+freccia. Dentro un campo di
  // testo quel tasto porta il cursore a inizio o fine riga, quindi naviga solo
  // se la pagina non l'ha usata e non ci si scrive: lo dice la pagina stessa
  // (src/preload/cmd-freccia.js). Per questo è una funzione a parte e l'etichetta resta Cmd+[.
  function comandoNavigazioneFuoriDalCampo(ev, esplicita) {
    if (!ev || !suMac(esplicita)) return null;
    if (modificatore(ev, 'shift')) return null;
    if (!(modificatore(ev, 'meta') && !modificatore(ev, 'ctrl') && !modificatore(ev, 'alt'))) return null;
    const code = String(ev.code || '');
    const key = String(ev.key || '');
    if (code === 'ArrowLeft' || key === 'ArrowLeft') return 'indietro';
    if (code === 'ArrowRight' || key === 'ArrowRight') return 'avanti';
    return null;
  }

  // ── La barra laterale ─────────────────────────────────────────────────────
  // Ctrl+Shift+B (Cmd+Shift+B su Mac), non Ctrl+B: quello è il grassetto di ogni
  // editor, Filo compreso. Tasto fisico prima del carattere, come sopra.
  const ACCEL_BARRA = 'Ctrl+Shift+B';
  function comandoBarra(ev) {
    if (!ev || modificatore(ev, 'alt') || !modificatore(ev, 'shift')) return false;
    if (!(modificatore(ev, 'ctrl') || modificatore(ev, 'meta'))) return false;
    const code = String(ev.code || '');
    if (code) return code === 'KeyB';
    return String(ev.key || '').toLowerCase() === 'b';
  }
  function etichettaBarra(esplicita) { return etichetta(ACCEL_BARRA, esplicita); }

  // ── Il pannello di destra delle app di Filo (#1433) ───────────────────────
  // Ctrl+\ era già il tasto che nell'Editor mostrava e nascondeva gli strumenti: ora li apre dal bordo destro in
  // ogni app di Filo che ha il pannello. Sui siti non è preso. Il tasto fisico cambia con la tastiera: vale il carattere.
  const ACCEL_PANNELLO = 'Ctrl+\\';
  function comandoPannello(ev) {
    if (!ev || modificatore(ev, 'alt') || modificatore(ev, 'shift')) return false;
    if (!(modificatore(ev, 'ctrl') || modificatore(ev, 'meta'))) return false;
    const key = String(ev.key || '');
    if (key) return key === '\\';
    return String(ev.code || '') === 'Backslash';
  }
  function etichettaPannello(esplicita) { return etichetta(ACCEL_PANNELLO, esplicita); }

  // ── Lo schermo intero ─────────────────────────────────────────────────────
  // Il tasto abituale di ogni sistema, quindi un tasto DIVERSO e non una riscrittura: F11 su Windows e
  // Linux, Control+Cmd+F su Mac (lì F11 è del sistema e Cmd+F è la ricerca). Valido anche come acceleratore.
  function etichettaSchermoIntero(esplicita) { return suMac(esplicita) ? 'Ctrl+Cmd+F' : 'F11'; }
  function comandoSchermoIntero(ev, esplicita) {
    if (!ev || modificatore(ev, 'alt') || modificatore(ev, 'shift')) return false;
    const [ctrl, meta] = [modificatore(ev, 'ctrl'), modificatore(ev, 'meta')];
    const code = String(ev.code || '');
    const key = String(ev.key || '');
    if (suMac(esplicita)) return ctrl && meta && (code ? code === 'KeyF' : key.toLowerCase() === 'f');
    return !ctrl && !meta && (code === 'F11' || key === 'F11');
  }

  function etichettaIndietro(esplicita) { return etichetta('Alt+\u2190', esplicita); }
  function etichettaAvanti(esplicita) { return etichetta('Alt+\u2192', esplicita); }

  // La stessa scorciatoia nella forma che Electron capisce: nella barra dei
  // menu le frecce hanno un nome, non un simbolo. È l'unico posto che la chiede.
  function acceleratoreElectron(accel, esplicita) {
    return etichetta(accel, esplicita).replace(/\u2190/g, 'Left').replace(/\u2192/g, 'Right');
  }

  // ── I tasti che a una pagina non arrivano mai ─────────────────────────────
  //
  // Chi fa scegliere una scorciatoia all'utente (le scorciatoie dei moduli
  // dell'Editor) deve poter rifiutare in faccia una combinazione che Filo si
  // prende prima: altrimenti si salva, sembra valida e poi non parte, e
  // l'utente non ha modo di capire perché.
  //
  // Su Mac la lista è più lunga perché la barra dei menu dell'applicazione vede
  // i tasti PRIMA di qualunque pagina, e ce n'è sempre una. Le voci qui sotto
  // sono le stesse di `src/main/menu.js`: una sentinella negli unit test
  // confronta le due liste e diventa rossa se divergono.

  // Forma confrontabile: «Cmd+Shift+Z», «ctrl + shift + z» e «Control+Shift+Z» coincidono
  // (Cmd e Ctrl sono lo stesso tasto logico nelle scorciatoie di Filo).
  const SINONIMI_TASTO = {
    '=': '+', plus: '+', minus: '-', esc: 'escape',
    // Le frecce arrivano con tre nomi diversi a seconda di chi le scrive
    // (simbolo nei testi, `Left`/`Right` in un acceleratore di Electron,
    // `ArrowLeft`/`ArrowRight` in un evento del DOM): una forma sola.
    left: '\u2190', arrowleft: '\u2190', right: '\u2192', arrowright: '\u2192',
    up: '\u2191', arrowup: '\u2191', down: '\u2193', arrowdown: '\u2193',
    // Un tasto speciale si scrive col nome che viene in mente (anche in
    // italiano) e il DOM lo chiama in un altro modo (" " per lo spazio): #545.1.
    ' ': 'space', spacebar: 'space', spazio: 'space', barra: 'space',
    return: 'enter', invio: 'enter', escape: 'escape',
    del: 'delete', canc: 'delete', cancella: 'delete', ins: 'insert',
    pgup: 'pageup', pagesu: 'pageup', pgdn: 'pagedown', pagegi\u00f9: 'pagedown',
    fine: 'end', inizio: 'home', indietro: 'backspace', bksp: 'backspace',
    'freccia su': '\u2191', 'freccia gi\u00f9': '\u2193', 'freccia giu': '\u2193',
    'freccia sinistra': '\u2190', 'freccia destra': '\u2192',
    su: '\u2191', 'gi\u00f9': '\u2193', giu: '\u2193', sinistra: '\u2190', destra: '\u2192',
    'barra spaziatrice': 'space', spaziatrice: 'space',
    'pag su': 'pageup', pagsu: 'pageup', pgsu: 'pageup', 'pag. su': 'pageup',
    'pag gi\u00f9': 'pagedown', 'pag giu': 'pagedown', 'paggi\u00f9': 'pagedown', paggiu: 'pagedown',
    'pg gi\u00f9': 'pagedown', 'pggi\u00f9': 'pagedown', pggiu: 'pagedown', 'pag. gi\u00f9': 'pagedown',
    pausa: 'pause', interr: 'pause', menu: 'contextmenu',
    stamp: 'printscreen', 'stamp r sist': 'printscreen', prtsc: 'printscreen', print: 'printscreen',
  };
  const TASTI_CON_NOME = new Set([
    'space', 'enter', 'escape', 'tab', 'backspace', 'delete', 'insert',
    'home', 'end', 'pageup', 'pagedown', 'contextmenu', 'pause', 'printscreen',
  ]);
  const TASTO_FUNZIONE = /^f([1-9]|1[0-9]|2[0-4])$/;
  function tastoCanonico(nome) {
    const n = String(nome || '').toLowerCase().replace(/\s+/g, ' ');
    return SINONIMI_TASTO[n] || n;
  }
  function forma(accel) {
    // Un «+» in ultima posizione è il TASTO più, non un separatore: «Ctrl++» si spezzerebbe
    // in [«Ctrl»] e sparirebbe dalla lista.
    const testo = String(accel || '').trim().replace(/\+\s*\+$/, '+Plus');
    const parti = pezzi(testo);
    // Un tasto funzione da solo è una combinazione intera: F11 è lo schermo intero.
    if (parti.length === 1 && TASTO_FUNZIONE.test(parti[0].toLowerCase())) return `|${parti[0].toLowerCase()}`;
    if (parti.length < 2) return '';
    const finale = parti[parti.length - 1].toLowerCase();
    const mods = parti.slice(0, -1).map((m) => m.toLowerCase());
    const c = mods.some((m) => CTRL.test(m)) ? 'c' : '';
    const m = conControlECmd(mods) ? 'm' : '';
    const a = mods.some((x) => ALT.test(x)) ? 'a' : '';
    const s = mods.some((x) => SHIFT.test(x)) ? 's' : '';
    return `${c}${m}${a}${s}|${tastoCanonico(finale)}`;
  }

  // Scritti in forma canonica (Windows): `riservato` confronta per forma, e
  // Cmd vale Ctrl, quindi valgono anche scritti col tasto del Mac. Accanto a
  // ognuno quello che fa: lo legge chi si vede rifiutare la combinazione.
  const PRESI_OVUNQUE = [
    // La shell del browser se li prende prima della pagina, con Shift o senza (src/main/tabs.js, #545.5).
    ['Ctrl+T', 'apre una scheda nuova'], ['Ctrl+Shift+T', 'riapre l\'ultima scheda chiusa'],
    ['Ctrl+W', 'chiude la scheda'], ['Ctrl+Shift+W', 'chiude la scheda'],
    ['Ctrl+L', 'porta alla home per scrivere un indirizzo'], ['Ctrl+Shift+L', 'porta alla home per scrivere un indirizzo'],
    ['Ctrl+R', 'ricarica la pagina'], ['Ctrl+Shift+R', 'ricarica la pagina'],
    // Indietro e avanti: Alt+freccia qui, Cmd+[ e Cmd+] su Mac (la riscrittura
    // la fa `etichetta`, e con lei il fatto che su Mac Alt+freccia resti libera
    // per il movimento del cursore).
    ['Alt+\u2190', 'torna alla pagina precedente'], ['Alt+\u2192', 'va alla pagina successiva'],
    // La barra laterale (src/main/barraLaterale.js), da qualunque vista abbia il fuoco.
    [ACCEL_BARRA, 'apre e chiude la barra laterale'],
  ];
  const PRESI_SU_MAC = [
    // Le voci della barra dei menu (src/main/menu.js), anche col tasto che un role di Electron
    // si porta da sé: su Mac «Incolla senza formato» è Cmd+Alt+Shift+V, il menu Aiuto Cmd+?.
    ['Ctrl+Z', 'annulla'], ['Ctrl+Shift+Z', 'ripete'],
    ['Ctrl+Plus', 'ingrandisce la pagina'], ['Ctrl+=', 'ingrandisce la pagina'],
    ['Ctrl+-', 'rimpicciolisce la pagina'], ['Ctrl+0', 'riporta la pagina al 100%'],
    ['Ctrl+X', 'taglia'], ['Ctrl+C', 'copia'], ['Ctrl+V', 'incolla'],
    ['Ctrl+Alt+Shift+V', 'incolla senza formato'], ['Ctrl+A', 'seleziona tutto'],
    ['Ctrl+Q', 'chiude Filo'], ['Ctrl+M', 'riduce a icona la finestra'], ['Ctrl+H', 'nasconde Filo'],
    ['Ctrl+Alt+H', 'nasconde le altre app'], ['Ctrl+?', 'apre il menu Aiuto'],
    // Cmd+freccia: indietro e avanti fuori dai campi di testo (`comandoNavigazioneFuoriDalCampo`).
    ['Ctrl+\u2190', 'torna alla pagina precedente'], ['Ctrl+\u2192', 'va alla pagina successiva'],
  ];

  // Le combinazioni che su questo sistema non raggiungono una pagina, nella forma
  // con cui l'utente le vedrebbe scritte, con quello che fanno. `senzaFilo`: senza
  // le quattro azioni di Filo, che chi ne sceglie una confronta da sé.
  function presi(esplicita, { senzaFilo = false } = {}) {
    const lista = [
      ...PRESI_OVUNQUE,
      ...(suMac(esplicita) ? PRESI_SU_MAC : []),
      // Il salto di scheda: Alt+cifra qui, Cmd+cifra su Mac.
      ...'0123456789'.split('').map((d) => [`Alt+${d}`, 'porta alla scheda in quella posizione']),
    ].map(([a, cosa]) => [etichetta(a, esplicita), cosa]);
    lista.push([etichettaSchermoIntero(esplicita), 'mette e toglie lo schermo intero']);
    lista.push([etichettaSchedaVicina('dopo'), 'porta alla scheda successiva']);
    lista.push([etichettaSchedaVicina('prima'), 'porta alla scheda precedente']);
    if (!senzaFilo) {
      for (const a of AZIONI_FILO) lista.push([etichettaFilo(scorciatoiaFilo(a.id), esplicita), `«${a.nome}»`]);
    }
    return lista;
  }

  function tastiRiservati(esplicita) {
    return [...new Set(presi(esplicita).map(([a]) => a))];
  }

  // Quello che fa la combinazione che Filo si prende prima della pagina, o ''.
  function chiLaPrende(accel, esplicita, opzioni) {
    const f = forma(accel);
    if (!f) return '';
    const preso = presi(esplicita, opzioni).find(([a]) => forma(a) === f);
    return preso ? preso[1] : '';
  }

  function riservato(accel, esplicita) {
    return !!chiLaPrende(accel, esplicita);
  }

  // ── Una scorciatoia scelta dall'utente ─────────────────────────────────────
  // Il nome scritto e il tasto premuto passano dalla STESSA `forma`: erano due
  // parser diversi, e ogni nome che il secondo non conosceva (Space, Up,
  // Control…) si salvava senza avvisi e non scattava mai (#545.1).

  // Il tasto finale scritto è uno che sappiamo riconoscere alla pressione?
  function tastoRiconosciuto(accel) {
    const f = forma(accel);
    if (!f) return false;
    const t = f.slice(f.indexOf('|') + 1);
    return [...t].length === 1 || TASTI_CON_NOME.has(t) || TASTO_FUNZIONE.test(t);
  }

  // Il modificatore scritto, o '' se non è un modificatore che si sa premere.
  function tipoModificatore(nome) {
    const n = String(nome || '').trim().toLowerCase();
    return CTRL.test(n) ? 'ctrl' : ALT.test(n) ? 'alt' : SHIFT.test(n) ? 'shift' : '';
  }

  // Solo modificatori, senza il tasto da premere con loro («Ctrl», «Ctrl+», «Ctrl-», «Ctrl+Shift»).
  function soloModificatori(accel) {
    const parti = pezzi(String(accel || '').trim().replace(/\+\s*\+$/, '+Plus'));
    return parti.length > 0 && parti.every((p) => tipoModificatore(p));
  }

  // Il primo pezzo scritto che alla pressione non si riconoscerebbe, o null:
  // un modificatore ignorato farebbe scattare la combinazione sbagliata.
  function pezzoSconosciuto(accel) {
    const testo = String(accel || '').trim().replace(/\+\s*\+$/, '+Plus');
    const parti = pezzi(testo);
    if (parti.length < 2) return null;
    const ignoto = parti.slice(0, -1).find((m) => !tipoModificatore(m));
    if (ignoto) return { nome: ignoto, modificatore: true };
    return tastoRiconosciuto(testo) ? null : { nome: parti[parti.length - 1], modificatore: false };
  }

  // I nomi con cui può presentarsi il tasto premuto. `code` è il tasto FISICO
  // (Shift+1 resta "1" anche se `key` dice "!"), `key` copre tutto il resto.
  function tastiDaEvento(ev) {
    const out = new Set();
    if (ev.key) out.add(tastoCanonico(ev.key));
    const code = String(ev.code || '');
    let m;
    if ((m = /^(?:Digit|Numpad)(\d)$/.exec(code))) out.add(m[1]);
    else if ((m = /^Key([A-Z])$/.exec(code))) out.add(m[1].toLowerCase());
    else if (code === 'Space') out.add('space');
    return out;
  }

  // Un simbolo (non lettera, cifra, freccia o tasto con nome) con Shift diventa un
  // altro simbolo, diverso per ogni tastiera: di lui conta il carattere, non Shift.
  function simbolo(tasto) {
    return [...tasto].length === 1 && !/^[a-z0-9←-↓]$/.test(tasto);
  }

  // Il tasto premuto è quella scorciatoia? Cmd vale quanto Ctrl.
  function combacia(ev, accel) {
    const f = forma(accel);
    if (!ev || !f) return false;
    const [ctrl, meta] = [modificatore(ev, 'ctrl'), modificatore(ev, 'meta')];
    const c = ctrl || meta ? 'c' : '';
    const m = ctrl && meta ? 'm' : '';
    const a = modificatore(ev, 'alt') ? 'a' : '';
    const s = modificatore(ev, 'shift') ? 's' : '';
    const [mods, tasto] = [f.slice(0, f.indexOf('|')), f.slice(f.indexOf('|') + 1)];
    const premuti = simbolo(tasto) ? `${c}${m}${a}${mods.includes('s') ? 's' : ''}` : `${c}${m}${a}${s}`;
    return mods === premuti && tastiDaEvento(ev).has(tasto);
  }

  // Il modificatore scritto che alla pressione cambia il simbolo (o ''): Shift
  // ovunque, Alt su Mac, Ctrl+Alt (AltGr) su Windows. Il nome scritto non
  // combacerebbe mai col carattere che arriva.
  function modificatoreCheCambiaSimbolo(accel, esplicita) {
    const f = forma(accel);
    if (!f || !simbolo(f.slice(f.indexOf('|') + 1))) return '';
    const mods = f.slice(0, f.indexOf('|'));
    const p = piattaforma(esplicita);
    if (mods.includes('s')) return 'Shift';
    if (p === 'darwin' && mods.includes('a')) return 'Alt';
    if (p === 'win32' && mods.includes('c') && mods.includes('a')) return 'Ctrl+Alt';
    return '';
  }

  // La pressione che una scorciatoia SCRITTA descrive (o null), letta con le
  // regole di `combacia`: chi ascolta i tasti la usa per dire se la prenderebbe.
  function pressioneScritta(accel) {
    const f = forma(accel);
    if (!f) return null;
    const mods = f.slice(0, f.indexOf('|'));
    return {
      ctrlKey: mods.includes('c'), metaKey: mods.includes('m'),
      altKey: mods.includes('a'), shiftKey: mods.includes('s'),
      key: f.slice(f.indexOf('|') + 1), code: '',
    };
  }

  // Combinazioni che il sistema operativo intercetta prima di Filo: il menu Start, il cambio
  // finestra o app, Spotlight, le istantanee dello schermo, l'uscita forzata, la sessione.
  const PRESI_DAL_SISTEMA = {
    win32: ['Ctrl+Escape', 'Ctrl+Shift+Escape', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+Escape', 'Alt+F4',
      'Ctrl+Alt+Delete'],
    darwin: ['Ctrl+Space', 'Ctrl+Alt+Space', 'Ctrl+Shift+3', 'Ctrl+Shift+4', 'Ctrl+Shift+5',
      'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+Alt+Escape', 'Ctrl+Shift+Q'],
    linux: ['Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4', 'Ctrl+Alt+Delete'],
  };
  function delSistema(accel, esplicita) {
    const f = forma(accel);
    if (!f) return false;
    // Stamp lo cattura il sistema (istantanea dello schermo) con qualunque modificatore.
    if (f.endsWith('|printscreen')) return true;
    const lista = PRESI_DAL_SISTEMA[piattaforma(esplicita)] || PRESI_DAL_SISTEMA.linux;
    return lista.some((a) => forma(a) === f);
  }

  // ── Una scorciatoia scelta dall'utente: perché non partirebbe ─────────────
  // La regola comune a chi fa scegliere un tasto (i moduli dell'Editor, le quattro
  // azioni di Filo): chi la usa aggiunge solo i tasti suoi. Torna { tipo, … } o null.
  function rifiutoDiForma(testo, esplicita) {
    const ignoto = pezzoSconosciuto(testo);
    if (ignoto && ignoto.modificatore) return { tipo: 'modificatore', nome: ignoto.nome };
    const conReale = testo.split(/[+\s-]+/).some((p) => ['ctrl', 'alt'].includes(tipoModificatore(p)));
    if (conReale && soloModificatori(testo)) {
      return { tipo: 'senzaTasto', nome: etichettaScritta(testo.replace(/[+\s-]+$/, ''), esplicita) };
    }
    // Senza Ctrl/Cmd/Alt la lettera scatterebbe mentre si scrive (Shift da solo scrive la maiuscola).
    const p = pressioneScritta(testo);
    if (!p || !(p.ctrlKey || p.metaKey || p.altKey) || tipoModificatore(p.key)) return { tipo: 'senzaModificatore' };
    if (ignoto) return { tipo: 'tasto', nome: ignoto.nome };
    return null;
  }

  // Tasti che Filo ascolta nelle chat di ogni pagina, sue o no: arrivano alla pagina, ma una scorciatoia lì sopra ne perde una delle due.
  const USATI_NELLE_CHAT = [['Ctrl+Shift+Spazio', 'apre il microfono delle chat']];

  function rifiutoScritta(sc, esplicita, opzioni) {
    const testo = String(sc == null ? '' : sc).trim();
    if (!testo) return null;
    const r = rifiutoDiForma(testo, esplicita);
    if (r) return r;
    const nome = etichettaScritta(testo, esplicita);
    if (delSistema(testo, esplicita)) return { tipo: 'sistema', nome };
    const f = forma(testo);
    const cosa = chiLaPrende(testo, esplicita, opzioni) || (USATI_NELLE_CHAT.find(([x]) => forma(x) === f) || [])[1];
    if (cosa) return { tipo: 'presa', nome, cosa };
    // Dopo i tasti presi: la pressione che il nome descrive non è quella vera.
    const cambia = modificatoreCheCambiaSimbolo(testo, esplicita);
    if (cambia) return { tipo: 'simbolo', nome, modificatore: cambia };
    // AltGr su Windows è Ctrl+Alt: con la E scrive €, con la Q @ su molte tastiere.
    const mods = f.slice(0, f.indexOf('|'));
    if (piattaforma(esplicita) === 'win32' && mods.includes('c') && mods.includes('a') && [...f.slice(f.indexOf('|') + 1)].length === 1) {
      return { tipo: 'altgr', nome };
    }
    return null;
  }

  // ── Le quattro azioni di Filo ─────────────────────────────────────────────
  // Spiega, Traduci, Salva per dopo e Aiuto: di serie Alt+lettera, e l'utente le
  // cambia (settings.scorciatoie, #842). Le ascolta src/main/shortcuts.js; ogni
  // contesto che legge le impostazioni passa la scelta a `usaScorciatoieFilo`.
  // Regole: tests/unit/scorciatoieFilo.test.mjs.
  const AZIONI_FILO = Object.freeze([
    Object.freeze({ id: 'explain-selection', nome: 'Spiega', serie: 'Alt+E' }),
    Object.freeze({ id: 'translate-selection', nome: 'Traduci', serie: 'Alt+T' }),
    Object.freeze({ id: 'save-for-later', nome: 'Salva per dopo', serie: 'Alt+S' }),
    Object.freeze({ id: 'open-help-sidebar', nome: 'Aiuto', serie: 'Alt+H' }),
  ]);

  // Tasti che Filo usa dentro le sue pagine e in ogni campo di testo: arrivano alla
  // pagina (non sono `riservato`), ma un'azione di Filo li prenderebbe prima di lei, ovunque.
  const USATI_NELLE_PAGINE = [
    ['Ctrl+Z', 'annulla'], ['Ctrl+Y', 'ripete'], ['Ctrl+Shift+Z', 'ripete'],
    ['Ctrl+X', 'taglia'], ['Ctrl+C', 'copia'], ['Ctrl+V', 'incolla'],
    ['Ctrl+Shift+V', 'incolla senza formattazione'], ['Ctrl+A', 'seleziona tutto'],
    ['Ctrl+B', 'mette il grassetto'], ['Ctrl+I', 'mette il corsivo'], ['Ctrl+U', 'sottolinea'],
    ['Ctrl+S', 'salva il documento nell\'Editor'], ['Ctrl+F', 'porta alla ricerca dell\'Editor'],
    [ACCEL_PANNELLO, 'apre e chiude il pannello degli strumenti nelle app di Filo'],
    ['Ctrl+Plus', 'ingrandisce la pagina'], ['Ctrl+-', 'rimpicciolisce la pagina'],
    ['Ctrl+_', 'rimpicciolisce la pagina'], ['Ctrl+0', 'riporta la pagina al 100%'],
  ];

  // I nomi con cui Filo SALVA un tasto: italiani, e riletti da `forma` come gli altri.
  const NOMI_TASTO = {
    space: 'Spazio', enter: 'Invio', escape: 'Esc', tab: 'Tab', backspace: 'Backspace', delete: 'Canc',
    insert: 'Ins', home: 'Inizio', end: 'Fine', pageup: 'PagSu', pagedown: 'PagGi\u00f9',
    contextmenu: 'Menu', pause: 'Pausa', printscreen: 'Stamp', '+': 'Plus',
  };
  function daForma(f) {
    if (!f) return '';
    const mods = f.slice(0, f.indexOf('|'));
    const t = f.slice(f.indexOf('|') + 1);
    const nome = NOMI_TASTO[t] || (/^[a-z]$|^f\d+$/.test(t) ? t.toUpperCase() : t);
    return [mods.includes('c') && 'Ctrl', mods.includes('a') && 'Alt', mods.includes('s') && 'Shift', nome]
      .filter(Boolean).join('+');
  }

  let sceltaFilo = {};

  // La scelta salvata (settings.scorciatoie): una voce vuota o illeggibile vale il tasto di serie.
  function usaScorciatoieFilo(mappa) {
    const nuova = {};
    for (const a of AZIONI_FILO) {
      const v = mappa && typeof mappa === 'object' ? mappa[a.id] : null;
      if (typeof v !== 'string' || v.length > 80 || !tastoRiconosciuto(v) || rifiutoDiForma(v.trim())) continue;
      nuova[a.id] = daForma(forma(v));
    }
    sceltaFilo = nuova;
  }

  function scorciatoiaFilo(id) {
    const a = AZIONI_FILO.find((x) => x.id === id);
    return a ? (sceltaFilo[id] || a.serie) : '';
  }

  // Il nome di una scorciatoia di Filo sulla tastiera di chi legge: i tasti che
  // `combaciaFilo` aspetta. Su Mac Ctrl si preme Cmd, e Alt senza Ctrl prende il
  // Control davanti (Opzione da sola scrive gli accenti).
  function etichettaFilo(accel, esplicita) {
    const f = forma(accel);
    if (!f) return String(accel || '');
    const testo = daForma(f);
    if (!suMac(esplicita)) return testo;
    const mods = f.slice(0, f.indexOf('|'));
    if (mods.includes('a') && !mods.includes('c')) return `Ctrl+${testo}`;
    return testo.replace(/^Ctrl\+/, 'Cmd+');
  }

  // Le quattro come le mostra chi le elenca: { id, nome, serie, accel, etichetta, diSerie }.
  function scorciatoieFilo(esplicita) {
    return AZIONI_FILO.map((a) => {
      const accel = scorciatoiaFilo(a.id);
      return { id: a.id, nome: a.nome, serie: a.serie, accel, etichetta: etichettaFilo(accel, esplicita), diSerie: forma(accel) === forma(a.serie) };
    });
  }

  // Quello che si scrive in settings.scorciatoie: '' per il tasto di serie.
  function valoreDaSalvare(id, accel) {
    const a = AZIONI_FILO.find((x) => x.id === id);
    if (!a) return '';
    const f = forma(accel);
    return !f || f === forma(a.serie) ? '' : daForma(f);
  }

  // Il tasto premuto con il nome che `forma` gli dà: lo stesso per chi registra e chi
  // ascolta. Cifre e lettere dal tasto fisico quando il carattere non dice niente
  // (Shift+1 è «!», Opzione compone, una tastiera non latina scrive altro).
  function tastoDaPressione(ev) {
    const key = String(ev.key || '');
    const code = String(ev.code || '');
    let m;
    if ((m = /^(?:Digit|Numpad)(\d)$/.exec(code))) return m[1];
    if (key.length === 1 && key > ' ' && key < '\u007f') return tastoCanonico(key.toLowerCase());
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1].toLowerCase();
    if (code === 'Space' || key === ' ') return 'space';
    if ([...key].length === 1 && key > '\u00a0') return key.toLowerCase();
    const t = tastoCanonico(key);
    return TASTI_CON_NOME.has(t) || TASTO_FUNZIONE.test(t) || /^[\u2190-\u2193]$/.test(t) ? t : '';
  }

  const SOLO_MODIFICATORI = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'CapsLock']);

  // La combinazione premuta (evento del DOM) nella forma che Filo salva: { accel },
  // { attesa } finché sono premuti solo modificatori, { rifiuto } se Filo non la
  // riconoscerebbe alla pressione.
  function scorciatoiaDaEvento(ev, esplicita) {
    if (!ev) return null;
    if (SOLO_MODIFICATORI.has(String(ev.key || ''))) return { attesa: true };
    const tasto = tastoDaPressione(ev);
    if (!tasto) return { rifiuto: { tipo: 'tasto', nome: String(ev.key || ev.code || '?').slice(0, 20) } };
    const [ctrl, meta, alt] = [!!ev.ctrlKey, !!ev.metaKey, !!ev.altKey];
    let c;
    if (suMac(esplicita)) {
      if (ctrl && meta) return { rifiuto: { tipo: 'macDue' } };
      if (ctrl && !alt) return { rifiuto: { tipo: 'macControl' } };
      if (alt && !ctrl && !meta) return { rifiuto: { tipo: 'macOpzione' } };
      c = meta;
    } else {
      if (meta) return { rifiuto: { tipo: 'win' } };
      c = ctrl;
    }
    // Un simbolo si salva col carattere che esce: lo Shift che l'ha fatto è già lì dentro.
    const s = !!ev.shiftKey && !simbolo(tasto);
    return { accel: daForma(`${c ? 'c' : ''}${alt ? 'a' : ''}${s ? 's' : ''}|${tasto}`) };
  }

  // Una combinazione detta a parole («Ctrl+Maiusc+Y») nella forma che Filo salva:
  // { accel } o { rifiuto }. Su Mac «Ctrl» insieme ad Alt è il tasto Control, il
  // nome che `etichettaFilo` dà alla forma di serie; da solo vale Cmd, come ovunque.
  function scorciatoiaDaScritta(scritta, esplicita) {
    const testo = String(scritta == null ? '' : scritta).trim().replace(/\+\s*\+$/, '+Plus');
    if (!testo) return null;
    if (testo.length > 80) return { rifiuto: { tipo: 'tasto', nome: `${testo.slice(0, 20)}…` } };
    const r = rifiutoDiForma(testo, esplicita);
    if (r) return { rifiuto: r };
    const f = forma(testo);
    const mods = pezzi(testo).slice(0, -1).map((m) => m.toLowerCase());
    const cmd = mods.some((m) => COMANDO.test(m));
    const control = mods.some((m) => CONTROL.test(m));
    if (suMac(esplicita) && control && !cmd && f.slice(0, f.indexOf('|')).includes('a')) return { accel: daForma(f.replace(/^c/, '')) };
    return { accel: daForma(f) };
  }

  // Perché `accel` (nella forma salvata) non può diventare la scorciatoia
  // dell'azione `id`, o null. `altre`: le scorciatoie delle altre azioni da
  // confrontare (id → combinazione), se non sono quelle in uso.
  function rifiutoScorciatoiaFilo(id, accel, esplicita, altre) {
    const r = rifiutoScritta(accel, esplicita, { senzaFilo: true });
    if (r) return { ...r, nome: etichettaFilo(accel, esplicita) };
    const f = forma(accel);
    const nome = etichettaFilo(accel, esplicita);
    const di = (x) => (altre && typeof altre[x] === 'string' ? altre[x] : scorciatoiaFilo(x));
    const altra = AZIONI_FILO.find((a) => a.id !== id && forma(di(a.id)) === f);
    if (altra) return { tipo: 'filo', nome, azione: altra.nome };
    const usata = [...USATI_NELLE_PAGINE, ...moduliPresi].find(([x]) => forma(x) === f);
    if (usata) return { tipo: 'presa', nome, cosa: usata[1] };
    return null;
  }

  // Le combinazioni date agli elementi dei pannelli delle app (#1433): le quattro le prenderebbero prima dell'elemento.
  // Chi controlla una delle quattro passa qui i pannelli salvati (sn_pannelli_app) e i loro cambi.
  let moduliPresi = [];
  function usaScorciatoiePannelli(pannelli) {
    const lista = [];
    const P = global.SN_PANNELLI_APP;
    const tutti = pannelli && typeof pannelli === 'object' ? pannelli : {};
    for (const app of Object.keys(tutti)) {
      if (!P || !P.catalogo(app)) continue;
      for (const e of P.scorciatoie(app, tutti[app])) {
        if (!forma(e.shortcut)) continue;
        lista.push([e.shortcut, `la usa «${e.nome}» nel pannello dell'${P.catalogo(app).nome}`]);
      }
    }
    moduliPresi = lista;
  }

  // La frase che l'utente legge per un rifiuto di `rifiutoScorciatoiaFilo` o di `scorciatoiaDa*`.
  function testoRifiutoFilo(r, esplicita) {
    if (!r) return '';
    const ctrl = etichetta('Ctrl', esplicita);
    const altra = 'scegline un\'altra';
    switch (r.tipo) {
      case 'modificatore': return `Non riconosco «${r.nome}» come tasto da tenere premuto: usa ${ctrl}, Alt o Shift.`;
      case 'senzaTasto': return `Manca il tasto da premere insieme a ${r.nome}.`;
      case 'senzaModificatore': return `Tieni premuto anche ${ctrl} o Alt, così il tasto non scatta mentre scrivi.`;
      case 'tasto': return `Non riconosco il tasto «${r.nome}»: usa una lettera, una cifra o un tasto come Spazio, Invio, F1.`;
      case 'sistema': return `${r.nome} se la prende il sistema operativo: ${altra}.`;
      case 'presa': return `${r.nome} è già in uso (${r.cosa}): ${altra}.`;
      case 'simbolo': return r.modificatore === 'Shift'
        ? `Con Shift quel simbolo diventa un altro, quindi ${r.nome} non partirebbe mai: ${altra}.`
        : `Con ${r.modificatore === 'Alt' ? 'Opzione' : etichetta(r.modificatore, esplicita)} quel simbolo diventa un altro, quindi ${r.nome} non partirebbe mai: ${altra}.`;
      case 'altgr': return `${r.nome} su Windows è anche AltGr, che scrive caratteri come € e @: ${altra}.`;
      case 'filo': return `${r.nome} è già la scorciatoia di «${r.azione}»: ${altra}.`;
      case 'macControl': return 'Su Mac le scorciatoie si fanno con Cmd, oppure con Control e Opzione insieme.';
      case 'macOpzione': return 'Su Mac Opzione da sola scrive un carattere: tieni premuto anche Cmd o Control.';
      case 'macDue': return 'Cmd e Control insieme non li uso: tienine premuto uno solo.';
      case 'win': return 'Il tasto Windows lo usa il sistema: usa Ctrl o Alt.';
      default: return `Questa combinazione non va bene: ${altra}.`;
    }
  }

  // Il tasto premuto (evento del DOM o di before-input-event) è quella scorciatoia
  // di Filo? Modificatori esatti: AltGr su Windows è Ctrl+Alt, Alt+Shift è un'altra
  // combinazione, e su Mac valgono i tasti che dice `etichettaFilo`.
  function combaciaFilo(ev, accel, esplicita) {
    const f = forma(accel);
    if (!ev || !f) return false;
    const mods = f.slice(0, f.indexOf('|'));
    const tasto = f.slice(f.indexOf('|') + 1);
    const c = mods.includes('c');
    const a = mods.includes('a');
    const s = mods.includes('s');
    const mac = suMac(esplicita);
    const vuole = { ctrl: mac ? a && !c : c, alt: a, meta: mac ? c : false };
    if (['ctrl', 'alt', 'meta'].some((q) => modificatore(ev, q) !== vuole[q])) return false;
    if (simbolo(tasto) ? s && !modificatore(ev, 'shift') : modificatore(ev, 'shift') !== s) return false;
    return tastoDaPressione(ev) === tasto;
  }

  function azioneFiloDaTasto(ev, esplicita) {
    const a = AZIONI_FILO.find((x) => combaciaFilo(ev, scorciatoiaFilo(x.id), esplicita));
    return a ? a.id : null;
  }

  // ── Il tasto fisico: le scorciatoie dei moduli dell'Editor (#893) ─────────
  // Si salva il TASTO ('cs|Digit1': modificatori come in `forma`, più il codice del DOM), non il carattere: Ctrl+! e
  // Ctrl+Shift+1 sono un tasto solo, AltGr è Ctrl+Alt. `layout` (codice → carattere) viene da navigator.keyboard.getLayoutMap.
  // Regole: tests/unit/tastoFisico.test.mjs.
  const CODICI_NOMINATI = {
    Space: 'space', Enter: 'enter', Escape: 'escape', Tab: 'tab', Backspace: 'backspace', Delete: 'delete',
    Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ContextMenu: 'contextmenu',
    Pause: 'pause', PrintScreen: 'printscreen',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  };
  // I tasti che scrivono: cosa scrivono lo dice la tastiera di chi preme.
  const CODICI_SCRITTI = /^(Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/;
  const TASTIERINO = { NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.' };
  const TASTO_SALVATO = /^(c?m?a?s?)\|([A-Za-z0-9]{1,20})$/;

  // Il codice del tasto premuto, o '' se non è un tasto da scorciatoia. Le cifre del tastierino valgono la fila in
  // alto, come prima che si salvasse il tasto: una scorciatoia scritta «Ctrl+Shift+1» partiva da tutte e due.
  function codiceTasto(ev) {
    const c = String((ev && ev.code) || '');
    const m = /^Numpad([0-9])$/.exec(c);
    if (m) return `Digit${m[1]}`;
    if (c === 'NumpadEnter') return 'Enter';
    return CODICI_SCRITTI.test(c) || CODICI_NOMINATI[c] || TASTIERINO[c] || TASTO_FUNZIONE.test(c.toLowerCase()) ? c : '';
  }

  function leggiTasto(tasto) {
    const m = TASTO_SALVATO.exec(String(tasto || ''));
    if (!m || (m[1].includes('m') && !m[1].includes('c')) || !/[ca]/.test(m[1]) || codiceTasto({ code: m[2] }) !== m[2]) return null;
    return { mod: m[1], code: m[2] };
  }
  function tastoValido(tasto) { return !!leggiTasto(tasto); }

  // Il carattere che il tasto scrive senza modificatori su questa tastiera ('' se non si sa).
  function carattereDelTasto(code, layout) {
    if (!layout || !code) return '';
    const v = typeof layout.get === 'function' ? layout.get(code) : layout[code];
    return typeof v === 'string' && [...v].length === 1 ? v.toLowerCase() : '';
  }
  function codiceDelCarattere(car, layout) {
    if (!layout || !car) return '';
    const voci = typeof layout.entries === 'function' ? [...layout.entries()] : Object.entries(layout);
    const voce = voci.find(([c, v]) => CODICI_SCRITTI.test(c) && typeof v === 'string' && v.toLowerCase() === car);
    return voce ? voce[0] : '';
  }

  function modificatoriDi(ev) {
    const [ctrl, meta] = [modificatore(ev, 'ctrl'), modificatore(ev, 'meta')];
    return `${ctrl || meta ? 'c' : ''}${ctrl && meta ? 'm' : ''}${modificatore(ev, 'alt') ? 'a' : ''}${modificatore(ev, 'shift') ? 's' : ''}`;
  }

  // Il nome del tasto nella forma che `forma` rilegge. `base`: il carattere visto premendolo senza Shift né Alt,
  // per quando la tastiera non si sa; senza nessuno dei due un simbolo resta col nome del suo codice.
  function nomeDelCodice(code, layout, base) {
    let m;
    if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
    if (CODICI_NOMINATI[code]) return NOMI_TASTO[CODICI_NOMINATI[code]] || CODICI_NOMINATI[code];
    if (TASTO_FUNZIONE.test(code.toLowerCase())) return code.toUpperCase();
    const scritto = TASTIERINO[code] || carattereDelTasto(code, layout) || (base && [...base].length === 1 ? base.toLowerCase() : '');
    if ((m = /^Key([A-Z])$/.exec(code))) return /^[a-z]$/.test(scritto) ? scritto.toUpperCase() : m[1];
    if (!scritto) return code;
    return scritto === '+' ? 'Plus' : scritto;
  }

  // Il nome di un tasto salvato, in forma Windows ('Ctrl+Shift+1'): a chi legge lo si mostra con `etichettaScritta`.
  function nomeTastoFisico(tasto, layout, base) {
    const t = leggiTasto(tasto);
    if (!t) return '';
    const mod = t.mod;
    return [mod.includes('c') && 'Ctrl', mod.includes('m') && 'Cmd', mod.includes('a') && 'Alt', mod.includes('s') && 'Shift',
      nomeDelCodice(t.code, layout, base)].filter(Boolean).join('+');
  }

  // Il tasto premuto (evento del DOM) nella forma salvata: { tasto, nome, car }, { attesa } finché sono premuti solo
  // modificatori, { rifiuto } se non si può usare. `car` è il carattere uscito: serve ai confronti coi tasti scritti.
  function tastoFisicoDaEvento(ev, layout, esplicita) {
    if (!ev) return null;
    const key = String(ev.key || '');
    if (SOLO_MODIFICATORI.has(key)) return { attesa: true };
    const code = codiceTasto(ev);
    if (!code) return { rifiuto: { tipo: 'tasto', nome: (key || String(ev.code || '') || '?').slice(0, 20) } };
    const [ctrl, meta, alt] = [!!ev.ctrlKey, !!ev.metaKey, !!ev.altKey];
    // Su Mac Control da solo, per `combacia`, è Cmd: salvato col nome di Cmd, non sarebbe il tasto premuto.
    if (suMac(esplicita) ? ctrl && !meta : meta) return { rifiuto: { tipo: suMac(esplicita) ? 'macControl' : 'win' } };
    if (!ctrl && !meta && !alt) return { rifiuto: { tipo: 'senzaModificatore' } };
    const tasto = `${modificatoriDi(ev)}|${code}`;
    const scritto = [...key].length === 1 ? key : '';
    const base = scritto && !ev.shiftKey && !alt ? scritto : '';
    // Sul tastierino il carattere non è quello della fila in alto (sulla francese il 6 lì è «-»).
    const car = code === String(ev.code || '') ? scritto : '';
    return { tasto, nome: nomeTastoFisico(tasto, layout, base), car };
  }

  // Una combinazione scritta («Ctrl+Shift+1») nella forma salvata: { tasto, nome }, { rifiuto }, o null se senza
  // la tastiera non si sa quale tasto scrive quel carattere. Un simbolo che non ha un tasto suo («!») va premuto.
  function tastoFisicoDaScritta(scritta, layout, esplicita) {
    const testo = String(scritta == null ? '' : scritta).trim().replace(/\+\s*\+$/, '+Plus');
    if (!testo) return null;
    if (testo.length > 80) return { rifiuto: { tipo: 'tasto', nome: `${testo.slice(0, 20)}…` } };
    const r = rifiutoDiForma(testo, esplicita);
    if (r) return { rifiuto: r };
    const f = forma(testo);
    const mod = f.slice(0, f.indexOf('|'));
    const k = f.slice(f.indexOf('|') + 1);
    let code = '';
    // La fila delle cifre è la stessa su ogni tastiera, anche dove la cifra si scrive con Shift (la francese).
    if (/^[0-9]$/.test(k)) code = `Digit${k}`;
    else if (TASTO_FUNZIONE.test(k)) code = k.toUpperCase();
    else code = Object.keys(CODICI_NOMINATI).find((c) => CODICI_NOMINATI[c] === k) || '';
    if (!code) {
      if (!layout) return null;
      const parti = pezzi(testo);
      const ultimo = parti[parti.length - 1];
      // «=» resta «=»: per `forma` è un sinonimo del più, ma è un altro tasto.
      const car = [...ultimo].length === 1 ? ultimo.toLowerCase() : k;
      code = codiceDelCarattere(car, layout);
      if (!code) return { rifiuto: { tipo: 'senzaTastoProprio', nome: car } };
      // Con Shift quel tasto scrive un altro simbolo, che la tastiera non dice: solo premendolo si sa quale (e se è dello zoom).
      if (mod.includes('s') && !/^Key/.test(code)) return { rifiuto: { tipo: 'simbolo', nome: etichettaScritta(testo, esplicita), modificatore: 'Shift' } };
    }
    const tasto = `${mod}|${code}`;
    return { tasto, nome: nomeTastoFisico(tasto, layout) };
  }

  // Il tasto premuto è quel tasto salvato? Cmd vale quanto Ctrl, come in `combacia`.
  function combaciaFisico(ev, tasto) {
    const t = leggiTasto(tasto);
    return !!(ev && t) && codiceTasto(ev) === t.code && modificatoriDi(ev) === t.mod;
  }

  // La pressione di quel tasto su questa tastiera, con il key e il code che vede chi ascolta: così i controlli di sempre
  // dicono se la prenderebbero. Un tasto di Filo si confronta col tasto che lo produce. `car`: il carattere visto premendolo.
  function keyDelCodice(code, layout) {
    let m;
    if ((m = /^Digit([0-9])$/.exec(code))) return carattereDelTasto(code, layout) || m[1];
    if ((m = /^Key([A-Z])$/.exec(code))) return carattereDelTasto(code, layout) || m[1].toLowerCase();
    if (CODICI_NOMINATI[code]) return code === 'Space' ? ' ' : code;
    if (TASTO_FUNZIONE.test(code.toLowerCase())) return code;
    return TASTIERINO[code] || carattereDelTasto(code, layout);
  }
  function pressioneFisica(tasto, layout, esplicita, car) {
    const t = leggiTasto(tasto);
    if (!t) return null;
    // Con Shift una cifra o un simbolo scrivono un carattere che la tastiera non dice: meglio nessuno che quello senza Shift
    // (Ctrl+Shift+0 non è lo zoom, Ctrl+Shift+\ non è la barra laterale). Le cifre restano riconoscibili dal codice.
    const ignoto = t.mod.includes('s') && CODICI_SCRITTI.test(t.code) && !/^Key/.test(t.code);
    const key = car && [...car].length === 1 ? car : ignoto ? '' : keyDelCodice(t.code, layout);
    const [c, cm, mac] = [t.mod.includes('c'), t.mod.includes('m'), suMac(esplicita)];
    return {
      ctrlKey: cm || (c && !mac), metaKey: cm || (c && mac),
      altKey: t.mod.includes('a'), shiftKey: t.mod.includes('s'), key, code: t.code,
    };
  }

  // Come `combacia`, ma il tasto si legge come lo leggono i controlli del main: il carattere uscito e la cifra della fila
  // (il salto di scheda); la lettera del codice solo se il carattere non è latino (sulla AZERTY KeyQ scrive «a», non «q»).
  function premutoCome(ev, accel) {
    const f = forma(accel);
    if (!ev || !f) return false;
    const [mods, nome] = [f.slice(0, f.indexOf('|')), f.slice(f.indexOf('|') + 1)];
    const premuti = modificatoriDi(ev);
    if (simbolo(nome) ? premuti.replace('s', '') !== mods.replace('s', '') : premuti !== mods) return false;
    const key = String(ev.key || '');
    const code = String(ev.code || '');
    const k = tastoCanonico([...key].length === 1 ? key.toLowerCase() : key);
    if (k === nome) return true;
    let m;
    if ((m = /^(?:Digit|Numpad)(\d)$/.exec(code))) return m[1] === nome;
    if ((m = /^Key([A-Z])$/.exec(code))) return !/^[a-z]$/.test(k) && m[1].toLowerCase() === nome;
    return false;
  }

  // Perché un tasto salvato non arriverebbe mai a una pagina (il sistema, Filo, le chat), o null. `extra.nome`: come
  // chiamarlo nel rifiuto; `extra.car`: il carattere visto premendolo.
  function rifiutoFisico(tasto, layout, esplicita, extra) {
    const { car, nome: dato } = extra || {};
    const ev = pressioneFisica(tasto, layout, esplicita, car);
    if (!ev) return null;
    const nome = dato || etichettaScritta(nomeTastoFisico(tasto, layout), esplicita);
    const sistema = PRESI_DAL_SISTEMA[piattaforma(esplicita)] || PRESI_DAL_SISTEMA.linux;
    if (ev.code === 'PrintScreen' || sistema.some((a) => premutoCome(ev, a))) return { tipo: 'sistema', nome };
    const preso = [...presi(esplicita), ...USATI_NELLE_CHAT].find(([a]) => premutoCome(ev, a));
    return preso ? { tipo: 'presa', nome, cosa: preso[1] } : null;
  }

  global.SN_TASTI = {
    piattaforma, suMac, etichetta, etichettaScritta, frase, acceleratoreElectron,
    indiceSaltoScheda, etichettaSaltoScheda, descrizioneSaltoScheda, indiceSchedaVicina, etichettaSchedaVicina,
    comandoNavigazione, comandoNavigazioneFuoriDalCampo, etichettaIndietro, etichettaAvanti,
    comandoBarra, etichettaBarra, ACCEL_BARRA, comandoPannello, etichettaPannello, ACCEL_PANNELLO, comandoSchermoIntero, etichettaSchermoIntero,
    tastiRiservati, riservato,
    tastoRiconosciuto, tipoModificatore, pezzoSconosciuto, soloModificatori, combacia, pressioneScritta, delSistema,
    modificatoreCheCambiaSimbolo, chiLaPrende, rifiutoScritta,
    AZIONI_FILO, usaScorciatoieFilo, usaScorciatoiePannelli, scorciatoiaFilo, scorciatoieFilo, etichettaFilo, valoreDaSalvare,
    scorciatoiaDaEvento, scorciatoiaDaScritta, rifiutoScorciatoiaFilo, testoRifiutoFilo, combaciaFilo, azioneFiloDaTasto,
    tastoValido, tastoFisicoDaEvento, tastoFisicoDaScritta, nomeTastoFisico, combaciaFisico, pressioneFisica, rifiutoFisico,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
