// Handler di dominio: navigazione, apertura/chiusura tab, fullscreen e
// comandi shell. Ogni handler è registrato nel registro centrale di
// handlers.js e riceve (msg, sender, origin), ritornando l'oggetto risposta.

const { app } = require('electron');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;

  on(MSG.OPEN_HOME, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.openTab('filo://home/home.html');
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

  on(MSG.CLOSE_ALL_TABS, async (msg, sender) => {
    const win = winOf(sender);
    win?._filoTabs?.closeAllTabs();
    return { ok: true };
  });

  on(MSG.OPEN_URL, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs && msg.url) win._filoTabs.openTab(msg.url);
    return { ok: true };
  });

  on(MSG.QUIT_APP, async () => {
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
