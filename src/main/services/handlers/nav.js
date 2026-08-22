// Handler di dominio: navigazione, apertura/chiusura tab, fullscreen e
// comandi shell. Ogni handler è registrato nel registro centrale di
// handlers.js e riceve (msg, sender, origin), ritornando l'oggetto risposta.

const { app } = require('electron');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;

  // SICUREZZA (#250): confine d'origine sui comandi distruttivi. Il canale
  // 'filo:message' è raggiungibile sia dalle pagine interne filo:// sia dai
  // content script delle pagine web esterne. Oggi contextIsolation impedisce
  // alla pagina esterna di chiamarli, ma far poggiare TUTTA la barriera sul
  // solo isolamento è fragile: chiudere tutte le schede o l'intera app non è
  // mai un'operazione legittima per una pagina web. Difesa in profondità come
  // già fatto su _storage:clear / RESET_SETTINGS / EXPORT_DATA.
  const isFilo = (origin) => String(origin || '').startsWith('filo://');

  on(MSG.OPEN_HOME, async (msg, sender) => {
    const win = winOf(sender);
    // #252: la conferma cliccabile di "Salva per dopo" apre la lista chiedendo
    // di evidenziare la scheda appena salvata (?highlight=<id>), così chi la
    // apre la prima volta vede subito dove è finita.
    let url = 'filo://home/home.html';
    if (msg && msg.highlight) url += `?highlight=${encodeURIComponent(String(msg.highlight))}`;
    if (win?._filoTabs) win._filoTabs.openTab(url);
    return { ok: true };
  });

  // Home vera di Filo (la newtab/dashboard): naviga la scheda CORRENTE, come il
  // tasto home della barra. Distinto da OPEN_NEW_TAB (che apre una scheda nuova)
  // e da OPEN_HOME (che apre la pagina "Aperti per dopo"). Se manca l'id della
  // scheda mittente (flussi senza tab) ripieghiamo sull'apertura di una nuova.
  on(MSG.GO_HOME, async (msg, sender) => {
    const win = winOf(sender);
    if (!win?._filoTabs) return { ok: true };
    if (sender?.tab?.id) win._filoTabs.navigate(sender.tab.id, 'filo://newtab/');
    else win._filoTabs.openTab('filo://newtab/');
    return { ok: true };
  });

  on(MSG.OPEN_HISTORY, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.openTab('filo://history/history.html');
    return { ok: true };
  });

  on(MSG.OPEN_OPTIONS, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.openTab('filo://options/options.html');
    return { ok: true };
  });

  on(MSG.OPEN_SPELLCHECK_PAGE, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.openTab('filo://spellcheck/spellcheck.html');
    return { ok: true };
  });

  on(MSG.CLOSE_TAB, async (msg, sender) => {
    if (sender?.tab?.id) {
      const win = winOf(sender);
      win?._filoTabs?.closeTab(sender.tab.id);
    }
    return { ok: true };
  });

  on(MSG.CLOSE_ALL_TABS, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const win = winOf(sender);
    win?._filoTabs?.closeAllTabs();
    return { ok: true };
  });

  on(MSG.OPEN_URL, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs && msg.url) win._filoTabs.openTab(msg.url);
    return { ok: true };
  });

  on(MSG.QUIT_APP, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    app.quit();
    return { ok: true };
  });

  on(MSG.NAV_BACK, async (msg, sender) => {
    if (sender?.tab?.id) {
      const win = winOf(sender);
      win?._filoTabs?.goBack(sender.tab.id);
    }
    return { ok: true };
  });

  on(MSG.NAV_FORWARD, async (msg, sender) => {
    if (sender?.tab?.id) {
      const win = winOf(sender);
      win?._filoTabs?.goForward(sender.tab.id);
    }
    return { ok: true };
  });

  on(MSG.NAV_RELOAD, async (msg, sender) => {
    if (sender?.tab?.id) {
      const win = winOf(sender);
      win?._filoTabs?.reload(sender.tab.id);
    }
    return { ok: true };
  });

  on(MSG.NAV_STATE, async (msg, sender) => {
    if (!sender?.tab?.id) return { ok: false, canBack: false, canFwd: false };
    const win = winOf(sender);
    const tab = win?._filoTabs?.tabs?.find((t) => t.id === sender.tab.id);
    const wc = tab?.view?.webContents;
    if (!wc) return { ok: false, canBack: false, canFwd: false };
    const canBack = wc.navigationHistory?.canGoBack?.() ?? wc.canGoBack?.() ?? false;
    const canFwd = wc.navigationHistory?.canGoForward?.() ?? wc.canGoForward?.() ?? false;
    return { ok: true, canBack: !!canBack, canFwd: !!canFwd };
  });

  on(MSG.TOGGLE_FULLSCREEN, async (msg, sender) => {
    // Il `document.requestFullscreen()` dal renderer di una WebContentsView
    // non porta la BrowserWindow a tutto schermo: la WebContentsView resta
    // confinata al suo bounds attuale. Per andare davvero in fullscreen OS
    // dobbiamo agire sulla BrowserWindow (feedback alpha).
    const win = winOf(sender);
    if (win?._filoTabs) {
      // Non basta il fullscreen OS: la view resta confinata sotto la barra
      // (tab + indirizzo). Per nascondere davvero la barra la view attiva deve
      // coprire l'intera finestra. Esc esce (gestito in tabs.js).
      win._filoTabs.toggleContentFullscreen();
    } else if (win) {
      win.setFullScreen(!win.isFullScreen());
    }
    return { ok: true };
  });

  on(MSG.EXIT_FULLSCREEN, async (msg, sender) => {
    // Uscita idempotente dalla modalità contenuto a tutto schermo (Esc dalla
    // pagina). Idempotente così convive col fallback before-input-event.
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.setContentFullscreen(false);
    return { ok: true };
  });

  on(MSG.OPEN_NEW_TAB, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.openTab(msg.url || 'filo://newtab/');
    return { ok: true };
  });

  on(MSG.SHELL_ACTION, async (msg, sender) => {
    // L'agente "Aiuto" aziona i comandi rapidi della barra di Filo (le icone
    // in alto). "close" è ESCLUSO di proposito: l'AI non chiude finestra né
    // schede. Inoltriamo alla shell, che clicca il bottone reale, così si
    // riusa tutto il comportamento esistente (menu ancorati, toggle finestra…).
    const allowed = ['home', 'settings', 'apps', 'account', 'fullscreen', 'minimize'];
    const command = String(msg.command || '').trim().toLowerCase();
    if (!allowed.includes(command)) {
      return { ok: false, error: `comando shell non consentito: "${command}"` };
    }
    const win = winOf(sender);
    if (!win) return { ok: false, error: 'nessuna finestra' };
    try { win.webContents.send('shell:trigger-button', { command }); }
    catch (_) { return { ok: false, error: 'invio alla shell fallito' }; }
    return { ok: true };
  });

  on(MSG.OPEN_INCOGNITO, async () => {
    // Apre una NUOVA finestra incognito: sessione web effimera (cookie/cache
    // in RAM) + storage filo:// instradato sull'overlay in memoria. Come in
    // Chrome, apriamo sempre una finestra nuova anche se il mittente è già
    // incognito. Lazy require di window.js per evitare cicli al boot.
    try {
      const { createIncognitoWindow } = require('../../window');
      createIncognitoWindow();
      return { ok: true };
    } catch (e) {
      console.error('[Filo] open-incognito', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  // #405 — ponte fra un riquadro incorporato e la pagina che lo ospite.
  // Un iframe non può parlare con il frame che lo contiene (origini diverse,
  // e gli eventi non attraversano il confine): passa da qui. Due usi:
  //   - RUN_IN_TOP_FRAME: azione di pagina (traduci, condividi, salva, QR,
  //     screenshot…) scelta dal menu aperto dentro il riquadro → va eseguita
  //     dal frame principale, che è l'unico a conoscere la pagina intera;
  //   - CLOSE_OTHER_MENUS: il riquadro ha appena aperto il suo menu → gli
  //     altri frami della stessa scheda chiudono il loro.
  // Il messaggio non porta dati arbitrari: solo l'id di un'icona del registro
  // del menu, che il frame principale risolve nel proprio registro.
  const frameBridge = (msg, sender, payload) => {
    const wc = sender && sender.wc;
    if (!wc) return { ok: false, error: 'no-sender' };
    try {
      if (payload.type === MSG.TOP_FRAME_COMMAND) {
        const main = wc.mainFrame;
        if (main && !main.detached) main.send('filo:broadcast', payload);
      } else {
        // A TUTTI i frame tranne il mittente: chi ha aperto il menu lo tiene.
        for (const f of wc.mainFrame?.framesInSubtree || []) {
          if (f === sender.frame || f.detached) continue;
          try { f.send('filo:broadcast', payload); } catch (_) {}
        }
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    return { ok: true };
  };

  on(MSG.RUN_IN_TOP_FRAME, async (msg, sender) => frameBridge(msg, sender, {
    type: MSG.TOP_FRAME_COMMAND,
    iconId: String(msg?.iconId || ''),
    surface: String(msg?.surface || ''),
  }));

  on(MSG.CLOSE_OTHER_MENUS, async (msg, sender) => frameBridge(msg, sender, {
    type: MSG.CLOSE_OTHER_MENUS,
  }));

  // #445 — menu del tasto destro disegnato dalla PAGINA per conto di un riquadro
  // incorporato troppo basso per contenerlo. Instrada in entrambe le direzioni
  // fra due soli frame della stessa scheda: il riquadro che ha aperto il menu e
  // il frame principale che lo disegna. Il legame nasce con 'open' e dura finché
  // il menu resta aperto; ogni messaggio successivo deve portare lo stesso
  // token, altrimenti non va da nessuna parte. Nessun altro frame è
  // raggiungibile, e un frame non può parlare a se stesso.
  on(MSG.PROJECT_MENU, async (msg, sender) => {
    const wc = sender && sender.wc;
    const from = sender && sender.frame;
    if (!wc || !from) return { ok: false, error: 'no-sender' };
    const phase = String(msg?.phase || '');
    let main = null;
    try { main = wc.mainFrame; } catch (_) { main = null; }
    if (!main || main.detached) return { ok: false, error: 'no-main-frame' };

    const send = (target, payload) => {
      if (!target || target.detached) return { ok: false, error: 'frame-gone' };
      try { target.send('filo:broadcast', { ...payload, type: MSG.PROJECTED_MENU }); } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
      return { ok: true };
    };

    if (phase === 'open') {
      // Solo un riquadro può CHIEDERE la proiezione: il frame principale ha già
      // tutta la finestra e non ha niente da delegare.
      if (from === main) return { ok: false, error: 'not-a-subframe' };
      const token = String(msg?.token || '');
      if (!token) return { ok: false, error: 'no-token' };
      wc._filoProjectedMenu = { token, frame: from };
      return send(main, {
        phase: 'open',
        token,
        spec: msg?.spec,
        x: Number(msg?.x) || 0,
        y: Number(msg?.y) || 0,
        keepOnScroll: !!msg?.keepOnScroll,
      });
    }

    const link = wc._filoProjectedMenu;
    if (!link || !msg?.token || link.token !== String(msg.token)) {
      return { ok: false, error: 'no-projection' };
    }
    // La direzione la decide CHI parla: dal frame principale si torna al
    // riquadro, dal riquadro si va al frame principale. Un terzo frame che
    // conoscesse il token non otterrebbe comunque niente.
    if (from === main) {
      if (phase === 'close') wc._filoProjectedMenu = null;
      return send(link.frame, { phase, token: link.token, id: msg?.id, arg: msg?.arg });
    }
    if (from !== link.frame) return { ok: false, error: 'not-the-owner' };
    if (phase === 'close') wc._filoProjectedMenu = null;
    return send(main, { phase, token: link.token, path: msg?.path, props: msg?.props });
  });

  on(MSG.REPLACE_MISSPELLING, async (msg, sender) => {
    // Usa l'API nativa di Electron per sostituire la parola sotto il cursore
    // del context-menu nativo (vedi `wc.on('context-menu', ...)` in tabs.js).
    // Funziona uniformemente su input, textarea e contenteditable.
    try {
      const win = winOf(sender);
      const tab = sender?.tab?.id ? win?._filoTabs?.tabs?.find((t) => t.id === sender.tab.id) : null;
      const wc = tab?.view?.webContents;
      if (wc && typeof wc.replaceMisspelling === 'function' && msg.suggestion) {
        wc.replaceMisspelling(String(msg.suggestion));
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    return { ok: true };
  });
};
