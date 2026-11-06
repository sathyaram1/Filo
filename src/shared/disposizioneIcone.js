// Dove sta ogni icona: nella barra laterale e nel suo «Altro…» (#871, #1246), nella fila contestuale del tasto destro e
// nel suo «Altro…», una per contesto (#1434). Solo dati e funzioni pure: la scrive il main (una porta sola).
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function (global) {
  'use strict';

  // Le zone della barra. `primary` (la riga del tasto destro di prima) vive solo nei salvati vecchi: migra() la versa
  // nella barra.
  const ZONE = Object.freeze(['bar', 'secondary']);

  // La fila del tasto destro cambia con l'elemento sotto il mouse (#1434): ogni contesto ha le sue azioni, di partenza
  // in fila o nel suo «Altro…». Un'azione di un contesto resta nel suo contesto; un'icona della barra va ovunque, in un
  // posto solo. `su`: come lo dice una frase («la fila del tasto destro sul testo selezionato»). L'ordine è fisso.
  const CONTESTI = Object.freeze({
    scrivibile: Object.freeze({
      su: 'sul testo selezionato mentre scrivi',
      fila: Object.freeze(['bold', 'italic', 'underline', 'link', 'highlight']),
      altro: Object.freeze(['strike', 'clear', 'cut', 'copy', 'search']),
    }),
    campo: Object.freeze({
      su: 'sul testo selezionato in una casella',
      fila: Object.freeze(['cut', 'copy', 'paste']),
      altro: Object.freeze(['search']),
    }),
    testo: Object.freeze({
      su: 'sul testo selezionato',
      fila: Object.freeze(['copy', 'translate', 'search']),
      altro: Object.freeze(['readAloud']),
    }),
    immagine: Object.freeze({
      su: 'su un\'immagine',
      fila: Object.freeze(['save', 'copy', 'ask', 'openTab']),
      altro: Object.freeze(['copyLink', 'search', 'linkCopy']),
    }),
    link: Object.freeze({
      su: 'su un collegamento',
      fila: Object.freeze(['openTab', 'copy']),
      altro: Object.freeze(['saveForLater', 'share']),
    }),
    media: Object.freeze({
      su: 'su un filmato o un audio',
      fila: Object.freeze(['playPause', 'mute', 'save', 'openTab']),
      altro: Object.freeze(['loop', 'pip', 'copyLink', 'linkCopy']),
    }),
    cursore: Object.freeze({
      su: 'in un campo dove scrivi, senza selezione',
      fila: Object.freeze(['paste', 'dictate']),
      altro: Object.freeze([]),
    }),
    pagina: Object.freeze({ su: 'sulla pagina', fila: Object.freeze([]), altro: Object.freeze([]) }),
  });

  // Un'immagine o un filmato dentro un collegamento (un'anteprima) è anche il collegamento: le sue azioni ci sono solo lì.
  const DEL_COLLEGAMENTO = Object.freeze({ openTab: ['openTab', 'menu_open_in_new_tab'], linkCopy: ['copy', 'menu_copy_link'] });
  // Disegno ed etichetta di ogni azione di contesto; chi le esegue sta nel content script (src/content/menuIcons.js).
  const DISEGNI = Object.freeze({
    scrivibile: { bold: ['bold', 'fila_bold'], italic: ['italic', 'fila_italic'], underline: ['underline', 'fila_underline'],
      link: ['link', 'fila_link'], highlight: ['highlight', 'fila_highlight'], strike: ['strike', 'fila_strike'],
      clear: ['eraser', 'fila_clear'], cut: ['cut', 'menu_cut'], copy: ['copy', 'menu_copy'], search: ['search', 'menu_search_text'] },
    campo: { cut: ['cut', 'menu_cut'], copy: ['copy', 'menu_copy'], paste: ['clipboard', 'menu_paste'], search: ['search', 'menu_search_text'] },
    testo: { copy: ['copy', 'menu_copy'], translate: ['translate', 'fila_translate'], search: ['search', 'menu_search_text'],
      readAloud: ['readAloud', 'menu_read_aloud'] },
    immagine: { save: ['download', 'menu_save_image_as'], copy: ['copy', 'menu_copy_image'], ask: ['sparkles', 'fila_ask_image'],
      copyLink: ['link', 'menu_copy_image_link'], search: ['search', 'menu_search_image'], ...DEL_COLLEGAMENTO },
    link: { openTab: ['openTab', 'menu_open_in_new_tab'], copy: ['copy', 'menu_copy_link'],
      saveForLater: ['saveForLater', 'menu_save_link_for_later'], share: ['share', 'menu_share_link'] },
    // Il disegno e il nome di qui valgono per trascinarle e per la chat; aperta sul filmato, l'icona dice il suo stato.
    media: { playPause: ['play', 'fila_media_play'], mute: ['volumeMute', 'menu_media_mute'], save: ['download', 'fila_media_save'],
      loop: ['repeat', 'menu_media_loop'], pip: ['pip', 'menu_media_pip'], copyLink: ['link', 'fila_media_copy_link'],
      ...DEL_COLLEGAMENTO },
    cursore: { paste: ['clipboard', 'menu_paste'], dictate: ['mic', 'menu_dictate'] },
    pagina: {},
  });

  // Le azioni di contesto per id `<contesto>:<azione>`: fuori da ICONE, che è il catalogo della barra (e dei contatori).
  const AZIONI = Object.freeze(Object.fromEntries(Object.entries(DISEGNI).flatMap(([ctx, voci]) => Object.entries(voci)
    .map(([azione, [icona, etichetta]]) => [`${ctx}:${azione}`, Object.freeze({ icona, etichetta, tipo: 'contesto', contesto: ctx, azione })]))));

  const zonaFila = (ctx) => `fila:${ctx}`;
  const zonaAltro = (ctx) => `altro:${ctx}`;
  const ZONE_FILA = Object.freeze(Object.keys(CONTESTI).flatMap((ctx) => [zonaFila(ctx), zonaAltro(ctx)]));
  const TUTTE = Object.freeze([...ZONE, ...ZONE_FILA]);
  // Il contesto di una zona della fila, o '' per quelle della barra.
  function contestoDiZona(z) {
    const m = /^(fila|altro):([a-z]+)$/.exec(String(z || ''));
    return m && Object.prototype.hasOwnProperty.call(CONTESTI, m[2]) ? m[2] : '';
  }

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

  // Le azioni sulla pagina (quelle che stavano nella riga del tasto destro) vengono dopo quelle della finestra; nella
  // fila di partenza ci sono solo le azioni dell'elemento (#1434).
  const DEFAULT = Object.freeze({
    bar: Object.freeze(['help', 'back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab',
      'translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab']),
    secondary: Object.freeze(['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker']),
    ...Object.fromEntries(Object.entries(CONTESTI).flatMap(([ctx, c]) => [
      [zonaFila(ctx), Object.freeze(c.fila.map((a) => `${ctx}:${a}`))],
      [zonaAltro(ctx), Object.freeze(c.altro.map((a) => `${ctx}:${a}`))],
    ])),
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

  const copia = (l) => Object.fromEntries(TUTTE.map((z) => [z, [...(Array.isArray(l[z]) ? l[z] : [])]]));
  const uguali = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  const tiene = (o, id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(o, id);
  // `noto`: un'icona della barra. `esiste`: anche un'azione di contesto della fila.
  const noto = (id) => tiene(ICONE, id);
  const esiste = (id) => noto(id) || tiene(AZIONI, id);
  const descrizione = (id) => (noto(id) ? ICONE[id] : tiene(AZIONI, id) ? AZIONI[id] : null);

  // Dove può stare un'icona: quella della barra ovunque, quella di un contesto solo nella fila e nell'«Altro…» suoi.
  function ammessa(id, zona) {
    if (!TUTTE.includes(zona)) return false;
    if (noto(id)) return true;
    return tiene(AZIONI, id) && contestoDiZona(zona) === AZIONI[id].contesto;
  }

  // Le zone come le dice chi parla con Filo (SPOSTA_ICONA): la barra e il suo «Altro…», la fila del tasto destro
  // («menu» vale «fila») e il suo «Altro…», queste due con il contesto (zonaDaDove).
  const DOVE = Object.freeze({ barra: 'bar', altro: 'secondary', fila: 'fila', menu: 'fila', altro_fila: 'altro' });
  function zonaDaDove(dove, contesto = '') {
    const d = String(dove || '').trim().toLowerCase();
    if (!tiene(DOVE, d)) return '';
    if (d === 'barra' || d === 'altro') return DOVE[d];
    const ctx = String(contesto || '').trim().toLowerCase();
    return tiene(CONTESTI, ctx) ? `${DOVE[d]}:${ctx}` : '';
  }

  // La zona di un'azione SPOSTA_ICONA: senza contesto vale quello dell'azione stessa. Una porta sola per chi la esegue,
  // per la frase di conferma e per la riga nelle attività (#1434.2).
  function zonaDellAzione(a) {
    const id = String((a && (a.icona ?? a.id)) || '').trim();
    const ctx = String((a && a.contesto) || '').trim().toLowerCase() || (tiene(AZIONI, id) ? AZIONI[id].contesto : '');
    return zonaDaDove(a && a.dove, ctx);
  }

  // Il verso opposto: la zona come la scrive il filo, `{ dove, contesto? }`.
  function doveDaZona(z) {
    if (z === 'bar') return { dove: 'barra' };
    if (z === 'secondary') return { dove: 'altro' };
    const ctx = contestoDiZona(z);
    if (!ctx) return { dove: '' };
    return { dove: String(z).startsWith('fila:') ? 'fila' : 'altro_fila', contesto: ctx };
  }

  // Il nome che l'utente legge nel menu, per la chat.
  function nome(id) {
    const d = descrizione(id);
    if (!d) return String(id || '');
    const I = global.SN_I18N;
    const t = I && typeof I.t === 'function' ? I.t(d.etichetta) : '';
    return t && t !== d.etichetta ? t : id;
  }

  // Come una frase dice una zona: «nella barra laterale», «nella fila del tasto destro sul testo selezionato».
  function nomeZona(z) {
    if (z === 'bar') return { nome: 'barra laterale', in: 'nella' };
    if (z === 'secondary') return { nome: '«Altro…» della barra laterale', in: 'in' };
    const ctx = contestoDiZona(z);
    if (!ctx) return { nome: String(z || '?'), in: 'in' };
    const fila = `fila del tasto destro ${CONTESTI[ctx].su}`;
    return z.startsWith('fila:') ? { nome: fila, in: 'nella' } : { nome: `«Altro…» della ${fila}`, in: 'in' };
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
    const pulisci = (arr, zona) => (Array.isArray(arr) ? arr : []).filter((id) => {
      if (!esiste(id) || RITIRATE.includes(id) || visti.has(id) || !ammessa(id, zona)) return false;
      visti.add(id);
      return true;
    });
    // Prima la barra: chi l'ha già se l'è disposta, e una doppia vince sul posto scelto per ultimo.
    const bar = Array.isArray(salvato.bar) ? pulisci(salvato.bar, 'bar') : null;
    const file = Object.fromEntries(ZONE_FILA.map((z) => [z, pulisci(salvato[z], z)]));
    const primary = pulisci(salvato.primary, 'bar');
    let secondary = pulisci(salvato.secondary, 'secondary');
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
    // Le azioni di contesto che il salvato non ha (nate dopo, o prima volta con la fila) vanno al loro posto di partenza.
    for (const z of ZONE_FILA) {
      for (const id of DEFAULT[z]) {
        if (visti.has(id)) continue;
        visti.add(id);
        file[z].push(id);
      }
    }
    const layout = { bar: barra, secondary, ...file };
    const cambiata = Array.isArray(salvato.primary) || TUTTE.some((z) => !uguali(layout[z], salvato[z]));
    return { layout, scrivi: cambiata };
  }

  // Sposta `id` davanti a `beforeId` (null: in fondo) nella zona `target`.
  function applicaPosa(layout, { id, target, beforeId = null } = {}) {
    if (!esiste(id) || !ammessa(id, target)) return null;
    const out = migra(layout).layout;
    // Davanti a sé stessa, nella zona dove già sta: resta dov'è.
    if (beforeId === id && out[target].includes(id)) return out;
    for (const z of TUTTE) out[z] = out[z].filter((x) => x !== id);
    const zona = out[target];
    const i = beforeId ? zona.indexOf(beforeId) : -1;
    if (i >= 0) zona.splice(i, 0, id);
    else zona.push(id);
    return out;
  }

  // ── per il registro dei cambi (#867.1): chi si è spostato, e come rimetterlo ──
  // Dove sta un'icona: la zona, l'icona che le sta dietro nella stessa zona (null: è l'ultima) e il posto, da 1.
  function posizione(layout, id) {
    for (const z of TUTTE) {
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
    const senza = (l, id) => TUTTE.map((z) => l[z].filter((x) => x !== id).join('|')).join('/');
    const cambiata = (id) => {
      const pa = posizione(a, id);
      const pb = posizione(b, id);
      return !!(pa && pb) && (pa.zona !== pb.zona || pa.posto !== pb.posto || pa.davanti !== pb.davanti);
    };
    if (esiste(mossa) && senza(a, mossa) === senza(b, mossa)) return cambiata(mossa) ? [mossa] : [];
    const out = [];
    for (const z of TUTTE) {
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
    if (!esiste(id) || !p || !ammessa(id, p.zona)) return null;
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

  // La fila e l'«Altro…» di un contesto, con le sole icone che la persona vede (`vede(id)`: l'owner, l'Aiuto acceso…).
  function filaDi(layout, ctx, vede = () => true) {
    if (!tiene(CONTESTI, ctx)) return { fila: [], altro: [] };
    const l = migra(layout).layout;
    const ok = (id) => esiste(id) && vede(id);
    return { fila: l[zonaFila(ctx)].filter(ok), altro: l[zonaAltro(ctx)].filter(ok) };
  }

  global.SN_DISPOSIZIONE_ICONE = {
    ZONE, ZONE_FILA, TUTTE, GLOBALI, ICONE, AZIONI, CONTESTI, DEFAULT, RITIRATE, AGGIUNTE, IN_CIMA, DOVE,
    noto, esiste, descrizione, ammessa, nome, nomeZona, zonaDaDove, contestoDiZona, zonaFila, zonaAltro, filaDi,
    valida, migra, applicaPosa, aspettoAiuto, posizione, spostate, posaPer,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
