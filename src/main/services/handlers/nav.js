// Handler di dominio: navigazione, apertura/chiusura tab, fullscreen e comandi shell.

const { app } = require('electron');
const { soloFilo } = require('./origine');
const { azione: contata } = require('../azioniContate');

// Un'icona della home dice dove sta in px della sua pagina; il menu della shell lo vuole in px della finestra.
// Il punto resta dentro la vista: una pagina non apre il menu fuori da sé.
function ancoraNellaFinestra(win, wc, a) {
  if (!a || !wc || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
  const tab = (win._filoTabs?.tabs || []).find((t) => t.view && t.view.webContents === wc);
  if (!tab) return null;
  let zoom = 1;
  try { zoom = wc.getZoomFactor() || 1; } catch (_) { zoom = 1; }
  const b = tab.view.getBounds();
  const dentro = (v, max) => Math.min(Math.max(v, 0), max);
  return { x: b.x + dentro(a.x * zoom, b.width), y: b.y + dentro(a.y * zoom, b.height) };
}

module.exports = function register(on, ctx) {
  const { MSG, winOf, apriDaFilo, SCHEMI_USCITA } = ctx;

  // Confine d'origine sui comandi distruttivi: chiudere tutte le schede o l'app non è mai
  // legittimo per una pagina web. Vedi handlers/origine.js.
  const isFilo = (origin) => String(origin || '').startsWith('filo://');

  on(MSG.OPEN_HOME, async (msg, sender) => {
    const win = winOf(sender);
    // La lista si apre evidenziando la scheda appena salvata: chi ci arriva la prima volta vede
    // subito dove è finita.
    let url = 'filo://home/home.html';
    if (msg && msg.highlight) url += `?highlight=${encodeURIComponent(String(msg.highlight))}`;
    if (win?._filoTabs) contata('open-for-later', () => win._filoTabs.openTab(url));
    return { ok: true };
  });

  // Home vera di Filo: naviga la scheda CORRENTE, come il tasto home della barra; senza l'id
  // del mittente si ripiega su una scheda nuova.
  on(MSG.GO_HOME, async (msg, sender) => {
    const win = winOf(sender);
    if (!win?._filoTabs) return { ok: true };
    contata('home', () => {
      if (sender?.tab?.id) win._filoTabs.navigate(sender.tab.id, 'filo://newtab/');
      else win._filoTabs.openTab('filo://newtab/');
    });
    return { ok: true };
  });

  on(MSG.OPEN_HISTORY, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) contata('history', () => win._filoTabs.openTab('filo://history/history.html'));
    return { ok: true };
  });

  on(MSG.OPEN_OPTIONS, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) contata('options-models', () => win._filoTabs.openTab('filo://options/options.html'));
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
      if (win?._filoTabs) contata('close-tab', () => win._filoTabs.closeTab(sender.tab.id));
    }
    return { ok: true };
  });

  on(MSG.CLOSE_ALL_TABS, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const win = winOf(sender);
    win?._filoTabs?.closeAllTabs();
    return { ok: true };
  });

  on(MSG.OPEN_URL, async (msg, sender, origin) => {
    const win = winOf(sender);
    if (!win?._filoTabs || !msg.url) return { ok: true };
    const url = String(msg.url);
    // Da una pagina di Filo un indirizzo web o di posta passa dalla porta delle uscite (#810); `parole` = scritto dall'utente.
    if (isFilo(origin) && SCHEMI_USCITA.test(url)) {
      const parole = (Array.isArray(msg.parole) ? msg.parole : []).filter((x) => typeof x === 'string').join('\n');
      // `parole` le manda solo la barra della home, con quello che l'utente ha scritto: per il giudizio sui siti è un
      // indirizzo scritto a mano.
      // Un clic su un collegamento di Filo vale per la pagina d'arrivo come un clic su un sito; l'Invio di chi scrive no.
      const origine = parole.trim() ? { tipo: 'scritto' } : { tipo: 'filo', gesto: require('../permessiPagine').gestoDellUtente(sender?.wc) };
      const r = await apriDaFilo(url, { wc: sender?.wc, parole, apri: () => win._filoTabs.openTab(url, { origine }) });
      return { ok: true, ...r };
    }
    const daPagina = /^https?:/i.test(String(sender?.url || ''));
    const gesto = require('../permessiPagine').gestoDellUtente(sender?.wc);
    win._filoTabs.openTab(url, daPagina ? { origine: { tipo: 'link', da: sender.url, gesto } } : {});
    return { ok: true };
  });

  // «Apri comunque» della chat (#590): da una pagina di Filo scavalca la lista come quello della notifica.
  // L'assistente sta nel DOM della pagina web, che può guidargli clic e tasti: il suo bottone riporta la
  // notifica «Sito bloccato», fuori dalla pagina, e il sì si dà lì. Solo per un'apertura sua fermata.
  on(MSG.APRI_COMUNQUE, async (msg, sender, origin) => {
    const win = winOf(sender);
    const url = String((msg && msg.url) || '');
    if (!win?._filoTabs || !/^https?:\/\//i.test(url)) return { ok: false };
    if (isFilo(origin)) {
      win._filoTabs.openBlockedPopup(url, { apriComunque: true });
      return { ok: true };
    }
    if (!win._filoTabs.apribileDallAssistente(sender && sender.wc, url)) return { ok: false, error: 'forbidden' };
    // Ancora in lista: la notifica. Uscito dalla lista nel frattempo: si apre e basta. Per il giudizio sui siti
    // l'indirizzo arriva dalla pagina dell'assistente, come ogni sua apertura.
    let da = '';
    try { da = String(sender.wc.getURL() || ''); } catch (_) {}
    const gesto = require('../permessiPagine').gestoDellUtente(sender && sender.wc);
    win._filoTabs.openTab(url, { origine: /^https?:/i.test(da) ? { tipo: 'link', da, gesto } : { tipo: 'filo', gesto } });
    return { ok: true };
  });

  on(MSG.QUIT_APP, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    app.quit();
    return { ok: true };
  });

  on(MSG.AGGIORNAMENTO_INSTALLA, soloFilo(async (msg) => {
    const U = require('../../updater');
    return msg && msg.avvisa === true ? U.riavviaDallaHome() : U.riavviaEAggiorna();
  }));

  on(MSG.NAV_BACK, async (msg, sender) => {
    // Ctrl/Cmd+Z fuori da un campo subito dopo un'azione di Filo la annulla (#1461).
    if (msg && msg.daAnnulla === true) { try { globalThis.SN_CONTATORI_MAIN?.tastoAnnulla(); } catch (_) {} }
    if (sender?.tab?.id) {
      const win = winOf(sender);
      if (win?._filoTabs) contata('navigate-back-forward', () => win._filoTabs.goBack(sender.tab.id));
    }
    return { ok: true };
  });

  on(MSG.NAV_FORWARD, async (msg, sender) => {
    if (sender?.tab?.id) {
      const win = winOf(sender);
      if (win?._filoTabs) contata('navigate-back-forward', () => win._filoTabs.goForward(sender.tab.id));
    }
    return { ok: true };
  });

  on(MSG.NAV_RELOAD, async (msg, sender) => {
    if (sender?.tab?.id) {
      const win = winOf(sender);
      if (win?._filoTabs) contata('reload', () => win._filoTabs.reload(sender.tab.id));
    }
    return { ok: true };
  });

  on(MSG.NAV_STATE, async (msg, sender) => {
    if (!sender?.tab?.id) return { ok: false, canBack: false, canFwd: false };
    const win = winOf(sender);
    const tab = win?._filoTabs?.tabs?.find((t) => t.id === sender.tab.id);
    if (!tab?.view?.webContents) return { ok: false, canBack: false, canFwd: false };
    const tabs = win._filoTabs;
    return { ok: true, canBack: tabs.puoTornare(tab, 'indietro'), canFwd: tabs.puoTornare(tab, 'avanti') };
  });

  on(MSG.TOGGLE_FULLSCREEN, async (msg, sender) => {
    // `requestFullscreen()` da una WebContentsView non porta a tutto schermo la finestra: la
    // view resta nel suo bounds, quindi si agisce sulla BrowserWindow.
    const win = winOf(sender);
    if (win?._filoTabs) {
      // Non basta il fullscreen di sistema: per nascondere la barra la view attiva deve coprire
      // tutta la finestra.
      win._filoTabs.toggleContentFullscreen();
    } else if (win) {
      win.setFullScreen(!win.isFullScreen());
    }
    return { ok: true };
  });

  on(MSG.EXIT_FULLSCREEN, async (msg, sender) => {
    // Idempotente, così convive col fallback before-input-event.
    const win = winOf(sender);
    if (win?._filoTabs) win._filoTabs.setContentFullscreen(false);
    return { ok: true };
  });

  on(MSG.FULLSCREEN_STATE, async (msg, sender) => {
    // La pagina lo chiede appena si monta: l'annuncio parte al CAMBIO, e una pagina nata dopo
    // mostrerebbe «Schermo intero» essendoci già dentro.
    const win = winOf(sender);
    // È anche come la pagina si presenta: da qui il main sa che a un Esc questa scheda risponde,
    // e la aspetta invece di uscire a tempo scaduto.
    win?._filoTabs?.paginaRispondeAllEsc(sender?.tab?.id ?? null);
    return { ok: true, fullscreen: !!win?._filoTabs?.contentFullscreen };
  });

  on(MSG.ESC_CHIEDI_TASTO, async (msg, sender) => {
    // Da un riquadro incorporato il tasto lo può chiedere solo il frame principale; dice
    // soltanto «ho qualcosa di aperto» e vale sulla scheda che parla.
    const win = winOf(sender);
    win?._filoTabs?.chiediEscAlFramePrincipale(sender?.tab?.id ?? null);
    return { ok: true };
  });

  on(MSG.ESC_CONSUMATO, async (msg, sender) => {
    // A tutto schermo quell'Esc era di un riquadro di Filo sopra la pagina: l'uscita messa
    // in attesa si annulla. Vale sulla scheda che parla, mai su un'altra.
    const win = winOf(sender);
    win?._filoTabs?.escConsumato(sender?.tab?.id ?? null);
    return { ok: true };
  });

  on(MSG.OPEN_NEW_TAB, async (msg, sender) => {
    const win = winOf(sender);
    if (win?._filoTabs) {
      const apri = () => win._filoTabs.openTab(msg.url || 'filo://newtab/');
      if (msg.url) apri(); else contata('new-tab', apri);
    }
    return { ok: true };
  });

  on(MSG.SHELL_ACTION, async (msg, sender, origin) => {
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
    const anchor = isFilo(origin) ? ancoraNellaFinestra(win, sender && sender.wc, msg.anchor) : null;
    try { win.webContents.send('shell:trigger-button', anchor ? { command, anchor } : { command }); }
    catch (_) { return { ok: false, error: 'invio alla shell fallito' }; }
    return { ok: true };
  });

  on(MSG.OPEN_INCOGNITO, async () => {
    // Sempre una finestra nuova, anche da un mittente già incognito. Il require è qui dentro per
    // non creare cicli al boot.
    try {
      const { createIncognitoWindow } = require('../../window');
      contata('incognito', () => createIncognitoWindow());
      return { ok: true };
    } catch (e) {
      console.error('[Filo] open-incognito', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  // Un iframe non può parlare col frame che lo ospita (origini diverse): passa da qui. Non
  // porta dati arbitrari, solo l'id di un'icona che il frame principale risolve da sé.
  const frameBridge = (msg, sender, payload) => {
    const wc = sender && sender.wc;
    if (!wc) return { ok: false, error: 'no-sender' };
    try {
      if (payload.type === MSG.TOP_FRAME_COMMAND || payload.type === MSG.FRAME_TRANSLATE_REPORT) {
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

  // #589.11 — alla sola pagina che contiene il riquadro mittente: è il main a dire chi chiede, non lo script del
  // riquadro, che da qui non passa.
  on(MSG.VISTO_SOSPENDI, async (msg, sender) => {
    const madre = sender && sender.frame && sender.frame.parent;
    if (!madre || madre.detached) return { ok: false, error: 'no-parent' };
    try {
      madre.send('filo:broadcast', { type: MSG.VISTO_PERMESSO, n: String(msg?.n || '').slice(0, 64), si: msg?.si ? 1 : 0 });
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    return { ok: true };
  });

  // #407 — «Traduci la pagina» deve arrivare anche dentro i riquadri
  // incorporati (post incorporati, blocchi commenti, moduli di iscrizione).
  // Il frame principale non può toccarne il testo — sono altre origini — ma il
  // content script di Filo gira anche lì: qui gli si passa parola.
  //
  // Solo il frame PRINCIPALE può indire il giro. Un riquadro che comandasse i
  // suoi fratelli non risolverebbe niente e aprirebbe una strada perché un sito
  // incorporato muova la traduzione dentro riquadri che non sono suoi.
  //
  // La risposta dice a quanti riquadri è stata passata parola: è la base del
  // conto con cui la pagina decide se l'avviso finale può dire "Pagina
  // tradotta" o deve dire che una parte è rimasta fuori.
  on(MSG.TRANSLATE_FRAMES, async (msg, sender) => {
    const wc = sender && sender.wc;
    if (!wc) return { ok: false, error: 'no-sender' };
    const mainFrame = wc.mainFrame;
    if (!mainFrame) return { ok: false, error: 'no-main-frame' };
    if (sender.frame && sender.frame !== mainFrame) return { ok: false, error: 'not-top-frame' };
    const payload = {
      type: MSG.FRAME_TRANSLATE,
      mode: String(msg?.mode || 'translate'),
      runId: String(msg?.runId || ''),
    };
    let frames = 0;
    try {
      for (const f of mainFrame.framesInSubtree || []) {
        if (f === mainFrame || f.detached) continue;
        try { f.send('filo:broadcast', payload); frames++; } catch (_) {}
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    return { ok: true, frames };
  });

  // Il resoconto torna al frame principale: è l'unico che tiene il conto e scrive l'avviso.
  on(MSG.FRAME_TRANSLATE_DONE, async (msg, sender) => frameBridge(msg, sender, {
    type: MSG.FRAME_TRANSLATE_REPORT,
    runId: String(msg?.runId || ''),
    phase: String(msg?.phase || 'end'),
    frames: Number(msg?.frames) || 0,
    applied: Number(msg?.applied) || 0,
    left: Number(msg?.left) || 0,
  }));

  on(MSG.REPLACE_MISSPELLING, async (msg, sender) => {
    // API nativa: sostituisce la parola sotto il cursore in input, textarea e contenteditable.
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
