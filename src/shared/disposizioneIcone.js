// Dove sta ogni icona globale: riga del tasto destro, «Altro…» o barra laterale (#871).
// Solo dati e funzioni pure: la scrive il main (una porta sola), la leggono menu e barra.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function (global) {
  'use strict';

  const ZONE = Object.freeze(['primary', 'secondary', 'bar']);

  // Della finestra e del sistema, non dell'elemento: stanno nella barra, non in «Altro…».
  const GLOBALI = Object.freeze(['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']);

  // `tipo`: chi esegue. 'finestra' la fa il main, 'pagina' il content script della scheda, 'aiuto' il pannello
  // Aiuto della scheda, con l'aspetto che dice cosa farà il clic (aspettoAiuto).
  // Le etichette sono quelle del menu (menuIcons.js): la sentinella le tiene uguali.
  const ICONE = Object.freeze({
    help: { icona: 'help', etichetta: 'menu_help', tipo: 'aiuto' },
    translate: { icona: 'translate', etichetta: 'menu_global_translate', tipo: 'pagina' },
    screenshot: { icona: 'screenshot', etichetta: 'menu_screenshot', tipo: 'pagina' },
    screenshotCrop: { icona: 'screenshotCrop', etichetta: 'menu_screenshot_crop', tipo: 'pagina' },
    transcribe: { icona: 'transcribe', etichetta: 'menu_transcribe', tipo: 'pagina' },
    share: { icona: 'share', etichetta: 'menu_share', tipo: 'pagina' },
    saveForLater: { icona: 'saveForLater', etichetta: 'menu_save_for_later', tipo: 'pagina' },
    qrCode: { icona: 'qrCode', etichetta: 'menu_qr_code', tipo: 'pagina' },
    colorPicker: { icona: 'colorPicker', etichetta: 'menu_color_picker', tipo: 'pagina' },
    fullscreen: { icona: 'zoom', etichetta: 'menu_fullscreen', tipo: 'finestra' },
    back: { icona: 'back', etichetta: 'menu_back', tipo: 'finestra' },
    forward: { icona: 'forward', etichetta: 'menu_forward', tipo: 'finestra' },
    reload: { icona: 'reload', etichetta: 'menu_reload', tipo: 'finestra' },
    closeTab: { icona: 'close', etichetta: 'menu_close_tab', tipo: 'finestra' },
    newTab: { icona: 'filoLogo', etichetta: 'menu_new_tab', tipo: 'finestra' },
    incognito: { icona: 'incognito', etichetta: 'menu_incognito', tipo: 'finestra' },
    openOptions: { icona: 'options', etichetta: 'menu_open_options', tipo: 'finestra' },
    home: { icona: 'home', etichetta: 'menu_open_home', tipo: 'finestra' },
    editorApp: { icona: 'editor', etichetta: 'menu_open_editor', tipo: 'finestra' },
    feedbackApp: { icona: 'feedback', etichetta: 'menu_open_feedback', tipo: 'finestra', soloOwner: true },
  });

  const DEFAULT = Object.freeze({
    primary: Object.freeze(['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab']),
    secondary: Object.freeze(['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker']),
    bar: Object.freeze(['help', 'back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']),
  });

  const MAX_PRIMARY = 6;

  // Ritirate dal registro: restando nel salvato farebbero bottoni fantasma.
  const RITIRATE = Object.freeze(['openForLater']);

  // Il default di prima dei sei posti: trovato identico, non era mai stato toccato.
  const DEFAULT_ANTICO = Object.freeze({
    primary: ['translate', 'screenshot', 'share', 'saveForLater'],
    secondary: ['openForLater', 'fullscreen', 'back', 'forward', 'reload'],
  });

  // Nate dopo che qualcuno si era già salvato la disposizione: senza, non le vedrebbe mai.
  const AGGIUNTE = Object.freeze(['incognito', 'qrCode', 'colorPicker', 'closeTab', 'screenshotCrop', 'transcribe', 'newTab', 'openOptions', 'home', 'editorApp', 'feedbackApp', 'help']);
  // Fra le aggiunte, quelle che arrivano in cima alla barra invece che in fondo.
  const IN_CIMA = Object.freeze(['help']);

  const copia = (l) => ({ primary: [...l.primary], secondary: [...l.secondary], bar: [...l.bar] });
  const uguali = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  const noto = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ICONE, id);

  // Le zone come le dice chi parla con Filo (SPOSTA_ICONA): la barra, la riga del tasto destro, «Altro…».
  const DOVE = Object.freeze({ barra: 'bar', menu: 'primary', altro: 'secondary' });

  // Il nome che l'utente legge nel menu, per la chat.
  function nome(id) {
    if (!noto(id)) return String(id || '');
    const I = global.SN_I18N;
    const t = I && typeof I.t === 'function' ? I.t(ICONE[id].etichetta) : '';
    return t && t !== ICONE[id].etichetta ? t : id;
  }

  function valida(v) {
    return !!(v && typeof v === 'object' && Array.isArray(v.primary) && Array.isArray(v.secondary));
  }

  // Disposizione salvata → disposizione da usare, e se va riscritta. `qrPromosso` è il segno
  // della promozione una tantum del QR nella riga: senza, il QR sale una volta sola.
  function migra(salvato, { qrPromosso = false } = {}) {
    if (!valida(salvato)) return { layout: copia(DEFAULT), scrivi: false, segnaQr: !qrPromosso };
    if (uguali(salvato.primary, DEFAULT_ANTICO.primary) && uguali(salvato.secondary, DEFAULT_ANTICO.secondary) && !Array.isArray(salvato.bar)) {
      return { layout: copia(DEFAULT), scrivi: true, segnaQr: true };
    }
    const visti = new Set();
    const pulisci = (arr) => (Array.isArray(arr) ? arr : []).filter((id) => {
      if (!noto(id) || RITIRATE.includes(id) || visti.has(id)) return false;
      visti.add(id);
      return true;
    });
    // Prima la barra: chi l'ha già se l'è disposta, e una doppia vince sul posto scelto per ultimo.
    const bar = Array.isArray(salvato.bar) ? pulisci(salvato.bar) : null;
    const primary = pulisci(salvato.primary);
    let secondary = pulisci(salvato.secondary);
    let barra = bar;
    if (!barra) {
      // Prima volta con la barra: le globali rimaste in «Altro…» ci vanno, quelle che
      // l'utente aveva portato nella riga restano dov'erano.
      barra = DEFAULT.bar.filter((id) => secondary.includes(id));
      secondary = secondary.filter((id) => !barra.includes(id));
    }
    for (const id of AGGIUNTE) {
      if (visti.has(id)) continue;
      visti.add(id);
      if (IN_CIMA.includes(id)) barra.unshift(id);
      else if (GLOBALI.includes(id)) barra.push(id);
      else secondary.unshift(id);
    }
    const layout = { primary, secondary, bar: barra };
    if (!qrPromosso && !layout.primary.includes('qrCode') && layout.secondary.includes('qrCode')
        && layout.primary.length < MAX_PRIMARY) {
      layout.primary.push('qrCode');
      layout.secondary = layout.secondary.filter((id) => id !== 'qrCode');
    }
    const cambiata = !uguali(layout.primary, salvato.primary) || !uguali(layout.secondary, salvato.secondary)
      || !uguali(layout.bar, salvato.bar);
    return { layout, scrivi: cambiata || !qrPromosso, segnaQr: true };
  }

  // Sposta `id` davanti a `beforeId` (null: in fondo) nella zona `target`. La riga ha un
  // tetto: chi trabocca scende in cima ad «Altro…».
  function applicaPosa(layout, { id, target, beforeId = null } = {}) {
    if (!noto(id) || !ZONE.includes(target)) return null;
    const out = copia(valida(layout) ? { ...layout, bar: Array.isArray(layout.bar) ? layout.bar : [] } : DEFAULT);
    for (const z of ZONE) out[z] = out[z].filter((x) => x !== id);
    const zona = out[target];
    const i = beforeId ? zona.indexOf(beforeId) : -1;
    if (i >= 0) zona.splice(i, 0, id);
    else zona.push(id);
    while (out.primary.length > MAX_PRIMARY) {
      const fuori = out.primary.pop();
      if (fuori && !out.secondary.includes(fuori)) out.secondary.unshift(fuori);
    }
    return out;
  }

  // L'icona Aiuto dice cosa farà il clic (#1432): chiuso o ridotto apre, aperto detta, mentre detta ferma (anche
  // ridotto). Il clic lo decide la stessa funzione (Sidebar.passo). Le etichette sono chiavi i18n.
  const VOCE_IN_CORSO = Object.freeze({ avvio: 'voce_ferma', ascolta: 'voce_ferma', trascrive: 'voce_trascrivo', attesa: 'voce_annulla_invio' });
  function aspettoAiuto({ pannello = 'chiuso', voce = 'pronto', risposta = false } = {}) {
    const inCorso = Object.prototype.hasOwnProperty.call(VOCE_IN_CORSO, voce) ? VOCE_IN_CORSO[voce] : '';
    if (pannello !== 'chiuso' && inCorso) return { icona: 'mic', etichetta: inCorso, ascolta: voce !== 'attesa' };
    if (pannello === 'aperto') return { icona: 'mic', etichetta: 'voce_parla', ascolta: false };
    return { icona: 'help', etichetta: risposta ? 'aiuto_leggi_risposta' : 'menu_help', ascolta: false };
  }

  global.SN_DISPOSIZIONE_ICONE = {
    ZONE, GLOBALI, ICONE, DEFAULT, MAX_PRIMARY, RITIRATE, AGGIUNTE, IN_CIMA, DOVE,
    noto, nome, valida, migra, applicaPosa, aspettoAiuto,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
