// Come si CHIAMA una scorciatoia sulla macchina di chi la legge: le etichette non si
// scrivono a mano, si chiedono qui. Le regole di conversione stanno in CLAUDE.md § Mac.
// `riservato()` dice se una combinazione arriva mai a una pagina, prima di farla scegliere.

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

  // Il tasto finale può essere un «+»: la spaccatura non deve rovinarlo.
  function pezzi(accel) {
    return String(accel || '').split('+').map((p) => p.trim()).filter(Boolean);
  }

  const CTRL = /^(ctrl|control|cmd|command|meta)$/;
  const ALT = /^(alt|option|opt)$/;

  // Su Windows e Linux torna identica: la forma canonica è quella.
  function etichetta(accel, esplicita) {
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

    // Alt+cifra è il salto di scheda, su Mac Cmd+cifra; lo zero fa eccezione (CLAUDE.md § Mac
    // e `indiceSaltoScheda`).
    if (haAlt && !haCtrl && /^[0-9]$/.test(tastoFinale)) {
      return `Cmd+${tastoFinale === '0' ? '9' : tastoFinale}`;
    }

    // Su Mac la globale prende un Control davanti, e qui «Ctrl» è davvero il tasto Control
    // del Mac, non Cmd: vedi shortcuts.js.
    if (haAlt && !haCtrl) return ['Ctrl', 'Alt', ...altri, tastoFinale].join('+');

    // Tutto il resto passa da Ctrl, e su Mac Ctrl si preme Cmd.
    const out = [];
    if (haCtrl) out.push('Cmd');
    if (haAlt) out.push('Alt');
    out.push(...altri, tastoFinale);
    return out.join('+');
  }

  // `frase('Grassetto', 'Ctrl+B')` → «Grassetto (Ctrl+B)» / «Grassetto (Cmd+B)».
  function frase(testo, accel, esplicita) {
    return `${testo} (${etichetta(accel, esplicita)})`;
  }

  // Nome e comportamento del salto fra schede stanno insieme perché devono cambiare insieme.
  // Regole in CLAUDE.md § Mac. Torna l'indice 0-based o null; `quante` serve solo su Mac.
  function indiceSaltoScheda(ev, esplicita, quante) {
    if (!ev) return null;
    // I due nomi con cui può arrivare ogni modificatore (DOM e main): nessuno dei due è
    // presente in entrambe le forme, quindi si chiedono tutti e due.
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

  // I tasti che a una pagina non arrivano mai: senza questa lista chi fa scegliere una
  // scorciatoia ne salva una che sembra valida e non parte. Le voci sono quelle di menu.js.

  // Forma confrontabile: «Cmd+Shift+Z», «ctrl + shift + z» e «Control+Shift+Z» coincidono
  // (Cmd e Ctrl sono lo stesso tasto logico nelle scorciatoie di Filo).
  const SINONIMI_TASTO = { '=': '+', plus: '+', minus: '-', esc: 'escape' };
  function forma(accel) {
    // Un «+» in ultima posizione è il TASTO più, non un separatore: «Ctrl++» si spezzerebbe
    // in [«Ctrl»] e sparirebbe dalla lista.
    const testo = String(accel || '').trim().replace(/\+\s*\+$/, '+Plus');
    const parti = pezzi(testo);
    if (parti.length < 2) return '';
    const finale = parti[parti.length - 1].toLowerCase();
    const mods = parti.slice(0, -1).map((m) => m.toLowerCase());
    const c = mods.some((m) => CTRL.test(m)) ? 'c' : '';
    const a = mods.some((m) => ALT.test(m)) ? 'a' : '';
    const s = mods.some((m) => m === 'shift') ? 's' : '';
    return `${c}${a}${s}|${SINONIMI_TASTO[finale] || finale}`;
  }

  // In forma canonica (Windows): `riservato` confronta per forma e Cmd vale Ctrl, quindi
  // valgono anche scritte col tasto del Mac.
  const PRESI_OVUNQUE = [
    // La shell del browser se li prende prima della pagina (src/main/tabs.js).
    'Ctrl+T', 'Ctrl+W', 'Ctrl+L', 'Ctrl+R',
  ];
  const PRESI_SU_MAC = [
    // Le voci della barra dei menu (src/main/menu.js).
    'Ctrl+Z', 'Ctrl+Shift+Z',
    'Ctrl+Plus', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0',
    'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+V', 'Ctrl+A',
    'Ctrl+Q', 'Ctrl+M', 'Ctrl+H', 'Ctrl+Alt+H',
  ];
  // Le scorciatoie globali (src/main/shortcuts.js): registrate a livello di sistema, non
  // arrivano a nessuna pagina.
  const GLOBALI = ['Alt+E', 'Alt+T', 'Alt+S', 'Alt+H'];

  // Nella forma con cui l'utente le vedrebbe scritte.
  function tastiRiservati(esplicita) {
    const mac = suMac(esplicita);
    const lista = [
      ...PRESI_OVUNQUE,
      ...(mac ? PRESI_SU_MAC : []),
      ...GLOBALI.map((g) => etichetta(g, esplicita)),
      // Il salto di scheda: Alt+cifra qui, Cmd+cifra su Mac.
      ...'0123456789'.split('').map((d) => etichetta(`Alt+${d}`, esplicita)),
    ];
    // Su Mac le voci canoniche vanno mostrate col nome del Mac.
    return [...new Set(lista.map((a) => etichetta(a, esplicita)))];
  }

  function riservato(accel, esplicita) {
    const f = forma(accel);
    if (!f) return false;
    return tastiRiservati(esplicita).some((a) => forma(a) === f);
  }

  global.SN_TASTI = {
    piattaforma, suMac, etichetta, frase,
    indiceSaltoScheda, etichettaSaltoScheda, descrizioneSaltoScheda,
    tastiRiservati, riservato,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
