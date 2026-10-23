// Dove sta ogni icona: nella barra laterale o nel suo «Altro…» (#871, #1246: la riga del tasto destro non c'è più).
// Solo dati e funzioni pure: la scrive il main (una porta sola), la legge la barra.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function (global) {
  'use strict';

  // `primary` (la riga del tasto destro) vive solo nei salvati di prima: migra() la versa nella barra.
  const ZONE = Object.freeze(['bar', 'secondary']);

  // Della finestra e del sistema, non dell'elemento: stanno nella barra, non in «Altro…».
  const GLOBALI = Object.freeze(['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']);

  // `tipo`: chi esegue. 'finestra' la fa il main, 'pagina' il content script della scheda, 'aiuto' il pannello
  // Aiuto della scheda, con l'aspetto che dice cosa farà il clic (aspettoAiuto).
  // Le etichette sono quelle del registro della pagina (menuIcons.js): la sentinella le tiene uguali.
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
    openOptions: { icona: 'models', etichetta: 'menu_open_options', tipo: 'finestra' },
    home: { icona: 'home', etichetta: 'menu_open_home', tipo: 'finestra' },
    editorApp: { icona: 'editor', etichetta: 'menu_open_editor', tipo: 'finestra' },
    feedbackApp: { icona: 'feedback', etichetta: 'menu_open_feedback', tipo: 'finestra', soloOwner: true },
  });

  // Le azioni sulla pagina (quelle che stavano nella riga del tasto destro) vengono dopo quelle della finestra.
  const DEFAULT = Object.freeze({
    bar: Object.freeze(['help', 'back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab',
      'translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab']),
    secondary: Object.freeze(['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker']),
  });

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

  const copia = (l) => ({ bar: [...l.bar], secondary: [...l.secondary] });
  const uguali = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  const noto = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ICONE, id);

  // Le zone come le dice chi parla con Filo (SPOSTA_ICONA): la barra e il suo «Altro…».
  const DOVE = Object.freeze({ barra: 'bar', altro: 'secondary' });

  // Il nome che l'utente legge nel menu, per la chat.
  function nome(id) {
    if (!noto(id)) return String(id || '');
    const I = global.SN_I18N;
    const t = I && typeof I.t === 'function' ? I.t(ICONE[id].etichetta) : '';
    return t && t !== ICONE[id].etichetta ? t : id;
  }

  function valida(v) {
    return !!(v && typeof v === 'object' && Array.isArray(v.secondary) && (Array.isArray(v.bar) || Array.isArray(v.primary)));
  }

  // Disposizione salvata → disposizione da usare, e se va riscritta. La riga del tasto destro di prima finisce in
  // fondo alla barra, nel suo ordine (#1246): chi l'aveva disposta ritrova le stesse icone, una sotto l'altra.
  function migra(salvato) {
    if (!valida(salvato)) return { layout: copia(DEFAULT), scrivi: false };
    if (uguali(salvato.primary, DEFAULT_ANTICO.primary) && uguali(salvato.secondary, DEFAULT_ANTICO.secondary) && !Array.isArray(salvato.bar)) {
      return { layout: copia(DEFAULT), scrivi: true };
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
      // Prima volta con la barra: le globali rimaste in «Altro…» ci vanno.
      barra = [...IN_CIMA, ...GLOBALI].filter((id) => secondary.includes(id));
      secondary = secondary.filter((id) => !barra.includes(id));
    }
    barra.push(...primary);
    for (const id of AGGIUNTE) {
      if (visti.has(id)) continue;
      visti.add(id);
      if (IN_CIMA.includes(id)) barra.unshift(id);
      else if (GLOBALI.includes(id)) barra.push(id);
      else secondary.unshift(id);
    }
    const layout = { bar: barra, secondary };
    const cambiata = Array.isArray(salvato.primary) || !uguali(layout.secondary, salvato.secondary) || !uguali(layout.bar, salvato.bar);
    return { layout, scrivi: cambiata };
  }

  // Sposta `id` davanti a `beforeId` (null: in fondo) nella zona `target`.
  function applicaPosa(layout, { id, target, beforeId = null } = {}) {
    if (!noto(id) || !ZONE.includes(target)) return null;
    const out = migra(layout).layout;
    // Davanti a sé stessa, nella zona dove già sta: resta dov'è.
    if (beforeId === id && out[target].includes(id)) return out;
    for (const z of ZONE) out[z] = out[z].filter((x) => x !== id);
    const zona = out[target];
    const i = beforeId ? zona.indexOf(beforeId) : -1;
    if (i >= 0) zona.splice(i, 0, id);
    else zona.push(id);
    return out;
  }

  // ── per il registro dei cambi (#867.1): chi si è spostato, e come rimetterlo ──
  // Dove sta un'icona: la zona, l'icona che le sta dietro nella stessa zona (null: è l'ultima) e il posto, da 1.
  function posizione(layout, id) {
    for (const z of ZONE) {
      const arr = layout && Array.isArray(layout[z]) ? layout[z] : [];
      const i = arr.indexOf(id);
      if (i >= 0) return { zona: z, davanti: arr[i + 1] || null, posto: i + 1 };
    }
    return null;
  }

  function sottosequenza(a, b) {
    const m = a.map(() => b.map(() => 0));
    const v = (i, j) => (i >= 0 && j >= 0 ? m[i][j] : 0);
    a.forEach((x, i) => b.forEach((y, j) => { m[i][j] = x === y ? v(i - 1, j - 1) + 1 : Math.max(v(i - 1, j), v(i, j - 1)); }));
    const ferme = new Set();
    for (let i = a.length - 1, j = b.length - 1; i >= 0 && j >= 0;) {
      if (a[i] === b[j]) { ferme.add(a[i]); i--; j--; } else if (v(i - 1, j) >= v(i, j - 1)) i--; else j--;
    }
    return ferme;
  }

  // Le icone che una scrittura ha spostato. `mossa` è quella che chi scrive dice di aver mosso: se basta lei a spiegare
  // il cambio è lei, perché fra due vicine scambiate il confronto da solo non sa quale sia partita.
  function spostate(prima, dopo, { mossa = null } = {}) {
    const a = migra(prima).layout;
    const b = migra(dopo).layout;
    const senza = (l, id) => ZONE.map((z) => l[z].filter((x) => x !== id).join('|')).join('/');
    const cambiata = (id) => {
      const pa = posizione(a, id);
      const pb = posizione(b, id);
      return !!(pa && pb) && (pa.zona !== pb.zona || pa.posto !== pb.posto || pa.davanti !== pb.davanti);
    };
    if (noto(mossa) && senza(a, mossa) === senza(b, mossa)) return cambiata(mossa) ? [mossa] : [];
    const out = [];
    for (const z of ZONE) {
      const comuni = (l) => l[z].filter((id) => posizione(a, id)?.zona === z && posizione(b, id)?.zona === z);
      const ferme = sottosequenza(comuni(a), comuni(b));
      for (const id of b[z]) {
        const pa = posizione(a, id);
        if (pa && (pa.zona !== z || !ferme.has(id))) out.push(id);
      }
    }
    return out;
  }

  // La posa che rimette `id` nella posizione `p` sulla disposizione di adesso: davanti alla stessa icona se sta
  // ancora in quella zona, se no allo stesso posto.
  function posaPer(layout, id, p) {
    if (!noto(id) || !p || !ZONE.includes(p.zona)) return null;
    const zona = migra(layout).layout[p.zona].filter((x) => x !== id);
    let beforeId = p.davanti && zona.includes(p.davanti) ? p.davanti : null;
    if (!beforeId && p.davanti && Number.isFinite(p.posto)) beforeId = zona[Math.max(0, p.posto - 1)] || null;
    return { id, target: p.zona, beforeId };
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
    ZONE, GLOBALI, ICONE, DEFAULT, RITIRATE, AGGIUNTE, IN_CIMA, DOVE,
    noto, nome, valida, migra, applicaPosa, aspettoAiuto, posizione, spostate, posaPer,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
