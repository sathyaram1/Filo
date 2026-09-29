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
  const ALT = /^(alt|option|opt|opzione|\u2325)$/;
  const SHIFT = /^(shift|maiusc|maiuscolo|maiuscole|\u21e7)$/;

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

    // Alt+freccia: indietro e avanti. Su Mac Opzione+freccia sposta il cursore
    // di una parola dentro OGNI campo di testo: prendersela vorrebbe dire
    // togliere quel movimento in tutta l'app. Lì la convenzione dei browser è
    // Cmd+[ e Cmd+], che non scrivono e non muovono niente.
    if (haAlt && !haCtrl && (tastoFinale === '\u2190' || tastoFinale === '\u2192')) {
      return `Cmd+${tastoFinale === '\u2190' ? '[' : ']'}`;
    }

    // Alt+cifra: salto di scheda. Su Mac Opzione+cifra scrive un simbolo, quindi
    // la forma è Cmd+cifra — quella di ogni browser su Mac. Lo zero fa
    // eccezione: su Mac Cmd+0 è lo zoom al 100%, e la decima scheda si raggiunge
    // con Cmd+9 come "l'ultima" (vedi `indiceSaltoScheda`).
    if (haAlt && !haCtrl && /^[0-9]$/.test(tastoFinale)) {
      return `Cmd+${tastoFinale === '0' ? '9' : tastoFinale}`;
    }

    // Alt+lettera: Spiega, Traduci, Salva, Aiuto. Su Mac prende un Control davanti
    // (e qui "Ctrl" è davvero il tasto Control del Mac, non Cmd): vedi shortcuts.js.
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

    // La cifra si legge dal tasto FISICO (Digit0–9: regge qualunque layout, e
    // su Mac Opzione trasformerebbe comunque il carattere); `key` è il ripiego
    // per gli eventi sintetici dei test.
    const m = /^Digit([0-9])$/.exec(String(ev.code || ''));
    const cifra = m ? m[1] : (/^[0-9]$/.test(String(ev.key || '')) ? String(ev.key) : null);
    if (cifra == null) return null;

    if (suMac(esplicita)) {
      // Lo zero è dello zoom: qui non è un salto.
      if (cifra === '0') return null;
      // Il nove è "l'ultima scheda": con meno di nove schede aperte porta
      // comunque all'ultima, non nel vuoto.
      if (cifra === '9') {
        const n = Number(quante);
        return Number.isFinite(n) && n > 0 ? n - 1 : 8;
      }
      return Number(cifra) - 1;
    }
    return cifra === '0' ? 9 : Number(cifra) - 1;
  }

  // Come si chiama, quel salto, per chi lo legge in un elenco.
  function etichettaSaltoScheda(esplicita) {
    return etichetta('Alt+1', esplicita).replace(/1$/, 'cifra');
  }

  // Cosa fa, quel salto, per chi lo legge in un elenco. Sta accanto al nome e
  // al comportamento perché le tre cose devono cambiare insieme: è dividerle
  // che ha fatto promettere su Mac una decima scheda irraggiungibile.
  function descrizioneSaltoScheda(esplicita) {
    return suMac(esplicita)
      ? 'Vai alla scheda in quella posizione (9 = l’ultima; Cmd+0 è lo zoom al 100%)'
      : 'Vai alla scheda in quella posizione (0 = la decima)';
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

  // Forma confrontabile di un acceleratore: modificatori normalizzati + tasto
  // finale. "Cmd+Shift+Z", "ctrl + shift + z" e "Control+Shift+Z" coincidono
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
  function tastoCanonico(nome) {
    const n = String(nome || '').toLowerCase().replace(/\s+/g, ' ');
    return SINONIMI_TASTO[n] || n;
  }
  function forma(accel) {
    // Un "+" in ultima posizione è il TASTO più, non un separatore: "Ctrl++"
    // si spezzerebbe in ["Ctrl"] e sparirebbe dalla lista.
    const testo = String(accel || '').trim().replace(/\+\s*\+$/, '+Plus');
    const parti = pezzi(testo);
    if (parti.length < 2) return '';
    const finale = parti[parti.length - 1].toLowerCase();
    const mods = parti.slice(0, -1).map((m) => m.toLowerCase());
    const c = mods.some((m) => CTRL.test(m)) ? 'c' : '';
    const a = mods.some((m) => ALT.test(m)) ? 'a' : '';
    const s = mods.some((m) => SHIFT.test(m)) ? 's' : '';
    return `${c}${a}${s}|${tastoCanonico(finale)}`;
  }

  // Scritti in forma canonica (Windows): `riservato` confronta per forma, e
  // Cmd vale Ctrl, quindi valgono anche scritti col tasto del Mac.
  const PRESI_OVUNQUE = [
    // La shell del browser se li prende prima della pagina (src/main/tabs.js).
    'Ctrl+T', 'Ctrl+W', 'Ctrl+L', 'Ctrl+R',
    // Indietro e avanti: Alt+freccia qui, Cmd+[ e Cmd+] su Mac (la riscrittura
    // la fa `etichetta`, e con lei il fatto che su Mac Alt+freccia resti libera
    // per il movimento del cursore).
    'Alt+\u2190', 'Alt+\u2192',
  ];
  const PRESI_SU_MAC = [
    // Le voci della barra dei menu (src/main/menu.js).
    'Ctrl+Z', 'Ctrl+Shift+Z',
    'Ctrl+Plus', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0',
    'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+V', 'Ctrl+A',
    'Ctrl+Q', 'Ctrl+M', 'Ctrl+H', 'Ctrl+Alt+H',
  ];
  // Spiega, Traduci, Salva, Aiuto (src/main/shortcuts.js): con Filo davanti se
  // li prende lui prima della pagina.
  const DI_FILO = ['Alt+E', 'Alt+T', 'Alt+S', 'Alt+H'];

  // Tutte le combinazioni che su questo sistema non raggiungono una pagina,
  // nella forma con cui l'utente le vedrebbe scritte.
  function tastiRiservati(esplicita) {
    const mac = suMac(esplicita);
    const lista = [
      ...PRESI_OVUNQUE,
      ...(mac ? PRESI_SU_MAC : []),
      ...DI_FILO.map((g) => etichetta(g, esplicita)),
      // Il salto di scheda: Alt+cifra qui, Cmd+cifra su Mac.
      ...'0123456789'.split('').map((d) => etichetta(`Alt+${d}`, esplicita)),
    ];
    // Su Mac le voci canoniche vanno mostrate col nome del Mac.
    return [...new Set(lista.map((a) => etichetta(a, esplicita)))];
  }

  // La combinazione arriva mai a una pagina su questo sistema?
  function riservato(accel, esplicita) {
    const f = forma(accel);
    if (!f) return false;
    return tastiRiservati(esplicita).some((a) => forma(a) === f);
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
    return [...t].length === 1 || TASTI_CON_NOME.has(t) || /^f([1-9]|1[0-9]|2[0-4])$/.test(t);
  }

  // Il modificatore scritto, o '' se non è un modificatore che si sa premere.
  function tipoModificatore(nome) {
    const n = String(nome || '').trim().toLowerCase();
    return CTRL.test(n) ? 'ctrl' : ALT.test(n) ? 'alt' : SHIFT.test(n) ? 'shift' : '';
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
    const c = modificatore(ev, 'ctrl') || modificatore(ev, 'meta') ? 'c' : '';
    const a = modificatore(ev, 'alt') ? 'a' : '';
    const s = modificatore(ev, 'shift') ? 's' : '';
    const [mods, tasto] = [f.slice(0, f.indexOf('|')), f.slice(f.indexOf('|') + 1)];
    const premuti = simbolo(tasto) ? `${c}${a}${mods.includes('s') ? 's' : ''}` : `${c}${a}${s}`;
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
      ctrlKey: mods.includes('c'), metaKey: false,
      altKey: mods.includes('a'), shiftKey: mods.includes('s'),
      key: f.slice(f.indexOf('|') + 1), code: '',
    };
  }

  // Combinazioni che il sistema operativo intercetta prima di Filo: il menu
  // Start, il cambio finestra, Spotlight e le istantanee dello schermo su Mac.
  const PRESI_DAL_SISTEMA = {
    win32: ['Ctrl+Escape', 'Ctrl+Shift+Escape', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+Escape', 'Alt+F4'],
    darwin: ['Ctrl+Space', 'Ctrl+Alt+Space', 'Ctrl+Shift+3', 'Ctrl+Shift+4', 'Ctrl+Shift+5'],
    linux: ['Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4'],
  };
  function delSistema(accel, esplicita) {
    const f = forma(accel);
    if (!f) return false;
    // Stamp lo cattura il sistema (istantanea dello schermo) con qualunque modificatore.
    if (f.endsWith('|printscreen')) return true;
    const lista = PRESI_DAL_SISTEMA[piattaforma(esplicita)] || PRESI_DAL_SISTEMA.linux;
    return lista.some((a) => forma(a) === f);
  }

  global.SN_TASTI = {
    piattaforma, suMac, etichetta, frase, acceleratoreElectron,
    indiceSaltoScheda, etichettaSaltoScheda, descrizioneSaltoScheda,
    comandoNavigazione, etichettaIndietro, etichettaAvanti,
    tastiRiservati, riservato,
    tastoRiconosciuto, tipoModificatore, pezzoSconosciuto, combacia, pressioneScritta, delSistema,
    modificatoreCheCambiaSimbolo,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
