// IPC routing: traduce le chiamate dal renderer (shell, pagine interne,
// content script via preload) al handler centrale dei servizi.
//
// Canali esposti:
//   filo:message     — invoke(msg) → response. Equivalente a chrome.runtime.sendMessage.
//   ai-stream:start  — invoke({ requestId, action, payload }). Il main streamma
//                      via ai-stream:<requestId>:delta / :done / :error fino al renderer.
//   ai-stream:abort  — send({ requestId })
//   tabs:*           — controllo del TabManager dalla shell renderer.

const { ipcMain, BrowserWindow, app } = require('electron');
const path = require('node:path');
const { handleMessage, handleStream, broadcastToTabs } = require('./services/handlers');
const { showPopupMenu } = require('./popup-menu');
const { showTooltip, hideTooltip } = require('./popup-tooltip');
const { createSession, defaultCwd, commandExists } = require('./services/shell');
const { hostResolves } = require('./services/hostResolve');
const DiskStorage = require('./shim/storage');

const inFlightStreams = new Map(); // requestId → AbortController
// Una shell PERSISTENTE per scheda, chiavata sull'id del WebContents che la
// possiede: i comandi successivi della stessa scheda riusano lo stesso
// processo (variabili, $env, cwd persistono). Muore alla chiusura della scheda.
const shellSessions = new Map(); // webContents.id → sessione shell persistente

function senderInfo(event) {
  const wc = event.sender;
  // BrowserWindow.fromWebContents() può ritornare null per le WebContentsView
  // figlie: in quel caso iteriamo tutte le finestre per trovare il TabManager
  // che possiede questa wc. Senza il fallback, sender.tab restava null e i
  // bottoni back/forward/reload/closeTab del menu (che leggono sender.tab.id)
  // non facevano nulla (feedback alpha).
  let win = BrowserWindow.fromWebContents(wc);
  let tab = null;
  if (win?._filoTabs) {
    tab = win._filoTabs.tabs.find((t) => t.view.webContents === wc);
  }
  if (!tab) {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs?.tabs?.find((tt) => tt.view.webContents === wc);
      if (t) { tab = t; win = w; break; }
    }
  }
  return {
    tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
    url: wc.getURL(),
    isShell: win ? win.webContents === wc : false,
    // Riferimento alla finestra proprietaria (in-process: l'handler è chiamato
    // direttamente, non oltre il confine IPC) + flag incognito, così i servizi
    // aprono i tab nella finestra giusta e l'IPC instrada lo storage in RAM.
    win: win || null,
    isIncognito: !!win?._filoIncognito,
    // webContents grezzo del mittente: serve agli handler che vogliono PUSHARE
    // dati alla scheda fuori dal ciclo richiesta/risposta (es. il reasoning in
    // diretta della chat → canale 'filo:reasoning'). In-process, mai oltre IPC.
    wc,
    // #405 — frame ESATTO che ha parlato. Da quando i content script girano
    // anche nei riquadri incorporati, "la scheda" non basta più a sapere chi
    // ha chiesto qualcosa: le risposte push (stream della spiegazione,
    // chiusura dei menu degli altri frame) devono tornare al frame giusto e
    // non al solo frame principale.
    frame: event.senderFrame || null,
  };
}

function registerIpcHandlers() {
  // Alla chiusura di Filo non lasciamo shell orfane: nessuna persistenza dopo
  // l'uscita (alla riapertura si parte da una shell pulita).
  app.on('before-quit', () => {
    for (const s of shellSessions.values()) { try { s.kill(); } catch (_) {} }
    shellSessions.clear();
  });

  // Config anti-fingerprinting per la pagina che sta per caricarsi. SINCRONO:
  // il preload deve installare gli override PRIMA degli script di pagina, non
  // può aspettare una Promise. Ritorna { level, seed }: il seed è derivato in
  // main dal master secret (che NON attraversa mai questo confine). Vedi
  // services/fingerprint.js e preload/fingerprint-guard.js.
  ipcMain.on('filo:fp-config', (event, href) => {
    try {
      event.returnValue = require('./services/fingerprint').configForHref(href);
    } catch (_) {
      event.returnValue = { level: 0, seed: 0 };
    }
  });

  // #405 — l'utente sta interagendo con QUESTO frame (la pagina o uno dei suoi
  // riquadri incorporati). Serve alle scorciatoie che lavorano sulla selezione:
  // vanno consegnate a chi ha davvero il testo selezionato. Nessun dato nel
  // messaggio: conta solo il mittente.
  ipcMain.on('filo:frame-active', (event) => {
    try { event.sender._filoActiveFrame = event.senderFrame || null; } catch (_) {}
  });

  ipcMain.handle('filo:message', async (event, msg) => {
    const info = senderInfo(event);
    // In incognito avvolgiamo l'handler in runIncognito(): ogni lettura/scrittura
    // dello storage che ne discende (anche dopo await) finisce nell'overlay in
    // RAM invece che su disco. Copre TUTTE le azioni di memoria senza dover
    // gattare ogni singolo case.
    const run = () => handleMessage(msg, info);
    try {
      return info.isIncognito ? await DiskStorage.runIncognito(run) : await run();
    } catch (err) {
      console.error('[Filo IPC] handler error', msg?.type, err);
      return { ok: false, error: err.message || String(err), code: err.code || 'UNKNOWN' };
    }
  });

  ipcMain.handle('ai-stream:start', async (event, { requestId, action, payload }) => {
    const incognito = !!BrowserWindow.fromWebContents(event.sender)?._filoIncognito
      || senderInfo(event).isIncognito;
    const ac = new AbortController();
    inFlightStreams.set(requestId, ac);
    // #405 — la risposta torna al FRAME che ha chiesto lo stream, non al frame
    // principale della scheda. Con i content script attivi anche dentro i
    // riquadri incorporati, una spiegazione chiesta dentro un video o una
    // mappa partiva ma le sue parole finivano in un frame che non le aspettava:
    // il riquadro restava a girare a vuoto per sempre.
    const target = event.senderFrame || event.sender;
    const send = (suffix, data) => {
      try {
        const t = (target && target.detached) ? event.sender : target;
        t.send(`ai-stream:${requestId}:${suffix}`, data);
      } catch (_) {}
    };
    // ai-stream è un canale IPC SEPARATO da filo:message: va avvolto anch'esso
    // in runIncognito così cache AI e tracciamento costi restano effimeri.
    const work = async () => {
      try {
        const meta = {};
        const result = await handleStream({
          action, payload, origin: event.sender.getURL(),
          signal: ac.signal,
          onMeta: (m) => { Object.assign(meta, m); send('meta', m); },
          onDelta: (delta) => send('delta', { delta }),
          // Fallback dopo delta già streamati: il renderer deve azzerare il
          // testo parziale del tentativo fallito (#273).
          onReset: () => send('reset', {}),
        });
        send('done', { ...result });
      } catch (err) {
        console.warn('[Filo IPC] stream error', requestId, err);
        send('error', { message: err.message || String(err), code: err.code || 'UNKNOWN' });
      } finally {
        inFlightStreams.delete(requestId);
      }
    };
    if (incognito) await DiskStorage.runIncognito(work); else await work();
    return { ok: true };
  });

  ipcMain.on('ai-stream:abort', (_event, { requestId }) => {
    const ac = inFlightStreams.get(requestId);
    if (ac) {
      try { ac.abort(); } catch (_) {}
      inFlightStreams.delete(requestId);
    }
  });

  // ─── shell (modalità terminale della dashboard) ──────────────────────────
  // Esegue un comando in streaming su una shell PERSISTENTE per scheda. SOLO
  // per le pagine interne fidate (filo://): le pagine web esterne NON devono
  // poter avviare una shell.
  ipcMain.handle('shell:start', (event, { execId, command, cwd, shell } = {}) => {
    const url = event.sender.getURL() || '';
    if (!url.startsWith('filo://')) return { ok: false, error: 'forbidden' };
    if (!execId || typeof command !== 'string') return { ok: false, error: 'bad-args' };
    const send = (suffix, data) => {
      try { event.sender.send(`shell:${execId}:${suffix}`, data); } catch (_) {}
    };
    const key = event.sender.id;
    const wantShell = shell || 'powershell';
    let session = shellSessions.get(key);
    // (Ri)crea la sessione se manca, è morta o l'utente ha cambiato shell nelle
    // Preferenze. La cwd passata serve solo allo spawn iniziale: per una
    // sessione viva è la sessione stessa a tenere la directory (cd persiste).
    if (!session || session.dead || session.shell !== wantShell) {
      if (session) { try { session.kill(); } catch (_) {} }
      session = createSession({ shell: wantShell, cwd });
      shellSessions.set(key, session);
      // La shell muore con la scheda: chiudere la scheda è il modo più
      // intuitivo per uccidere un processo collegato.
      event.sender.once('destroyed', () => {
        const s = shellSessions.get(key);
        if (s) { try { s.kill(); } catch (_) {} shellSessions.delete(key); }
      });
    }
    session.exec(command, {
      onData: (d) => send('data', d),
      onExit: (e) => send('exit', e),
      onError: (e) => send('error', e),
    });
    return { ok: true };
  });

  // Esiste questo comando nella shell? Usato dall'evidenziazione live della
  // dashboard (modalità terminale) per colorare di rosso i "/comando" che non
  // verrebbero riconosciuti. Solo pagine interne filo:// (come shell:start).
  ipcMain.handle('shell:which', async (event, { command, shell, cwd } = {}) => {
    const url = event.sender.getURL() || '';
    if (!url.startsWith('filo://')) return { ok: false, error: 'forbidden' };
    try {
      const exists = await commandExists({ shell, cwd, command });
      return { ok: true, exists };
    } catch (_) {
      return { ok: false, exists: false };
    }
  });

  // Questo "/dominio.tld" esiste davvero? Usato dalla barra comando della
  // dashboard per (a) colorare di rosso un sito inesistente mentre si scrive e
  // (b) non navigare a vuoto verso una pagina bianca quando lo si invia. Solo
  // pagine interne filo:// (come shell:which). In caso di dubbio torna
  // resolves:true così non blocca mai una navigazione legittima.
  ipcMain.handle('net:resolves', async (event, { host } = {}) => {
    const url = event.sender.getURL() || '';
    if (!url.startsWith('filo://')) return { ok: false, error: 'forbidden' };
    try {
      const resolves = await hostResolves(host);
      return { ok: true, resolves };
    } catch (_) {
      return { ok: true, resolves: true };
    }
  });

  // Directory iniziale da mostrare nella riga grigia quando si attiva il terminale.
  ipcMain.handle('shell:home', () => {
    try { return { ok: true, cwd: defaultCwd() }; } catch (_) { return { ok: false }; }
  });

  // Testo grezzo verso lo stdin del comando interattivo in corso (casella stdin).
  ipcMain.on('shell:input', (event, { text } = {}) => {
    const s = shellSessions.get(event.sender.id);
    if (s) s.write(String(text == null ? '' : text));
  });

  // Stop: uccide l'intera shell della scheda (e l'albero di processi). Il
  // comando successivo ne ricrea una pulita; la cwd è preservata dalla
  // dashboard (che la ripassa). Le variabili impostate prima dello Stop vanno
  // perse: è il compromesso per un'interruzione affidabile su Windows.
  ipcMain.on('shell:abort', (event) => {
    const s = shellSessions.get(event.sender.id);
    if (s) { try { s.kill(); } catch (_) {} shellSessions.delete(event.sender.id); }
  });

  // ─── tab control dalla shell ─────────────────────────────────────────────
  const winFor = (event) => {
    const wc = event.sender;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoShell?.webContents === wc) return w;
      if (w._filoTabs?.tabs?.some((t) => t.view.webContents === wc)) return w;
    }
    return BrowserWindow.fromWebContents(wc) || BrowserWindow.getAllWindows()[0];
  };
  ipcMain.handle('tabs:open', (event, { url } = {}) => {
    const win = winFor(event);
    if (!win || !win._filoTabs) return { ok: false };
    const id = win._filoTabs.openTab(url || 'filo://newtab/');
    return { ok: true, id };
  });
  ipcMain.handle('tabs:close', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.closeTab(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:activate', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.activate(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:navigate', (event, { id, url }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.navigate(id, url);
    return { ok: true };
  });
  // Drag & drop nella barra: sposta una tab a una nuova posizione (toIndex).
  ipcMain.handle('tabs:move', (event, { id, toIndex } = {}) => {
    const win = winFor(event);
    const moved = win?._filoTabs ? win._filoTabs.moveTab(id, toIndex) : false;
    return { ok: true, moved };
  });
  ipcMain.handle('tabs:reserve-top', (event, { px }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setTopInset(px);
    return { ok: true };
  });
  // Chrome compatto: la shell nasconde la barra indirizzi fuori dalla home, e
  // chiede al main di far risalire la WebContentsView a coprire quello spazio.
  ipcMain.handle('tabs:set-chrome-compact', (event, { on } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setChromeCompact(!!on);
    return { ok: true };
  });
  ipcMain.handle('tabs:back', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.goBack(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:forward', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.goForward(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:reload', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.reload(id);
    return { ok: true };
  });
  // Menu tasto destro su tab: silenzia/riattiva l'audio. Se `muted` non è
  // passato (undefined) facciamo un toggle.
  ipcMain.handle('tabs:set-muted', (event, { id, muted } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) {
      if (muted === undefined) win._filoTabs.toggleMute(id);
      else win._filoTabs.setMuted(id, muted);
    }
    return { ok: true };
  });
  // Menu tasto destro su tab: apre una copia della tab (stesso URL).
  ipcMain.handle('tabs:duplicate', async (event, { id } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false };
    const newId = await win._filoTabs.duplicateTab(id);
    return { ok: !!newId, id: newId };
  });
  // Menu tasto destro su tab: "Aiuto" → apre la sidebar Aiuto su quella scheda
  // col contesto della tab.
  ipcMain.handle('tabs:help', (event, { id } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.openHelp(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:set-active-visible', (event, { visible } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setActiveVisible(visible !== false);
    return { ok: true };
  });
  ipcMain.handle('tabs:snapshot', (event) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { activeId: null, tabs: [] };
    return win._filoTabs.snapshot();
  });
  ipcMain.handle('tabs:open-blocked-popup', (event, { url } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs || !url) return { ok: false };
    win._filoTabs.openBlockedPopup(url);
    return { ok: true };
  });
  // Proxy per-tab ("Apri da un altro paese"): instrada/de-instrada una singola
  // tab attraverso un endpoint in un altro paese. La lista location curate
  // serve al menu tasto destro sulla tab (feedback UI separato).
  ipcMain.handle('tabs:set-proxy', async (event, { id, country, tier } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false, error: 'no_tab' };
    return win._filoTabs.setTabProxy(id, country, { tier });
  });
  ipcMain.handle('tabs:clear-proxy', (event, { id } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false, error: 'no_tab' };
    return win._filoTabs.clearTabProxy(id);
  });
  // Stato per il menu della shell: la voce compare solo se un endpoint è
  // configurato; defaultCountry = ultima location usata, altrimenti il default.
  ipcMain.handle('tabs:proxy-status', async () => {
    const ProxyTab = require('./services/proxyTab');
    let settings = null;
    try { settings = await globalThis.SN_STORAGE?.getSettings?.(); } catch (_) {}
    const p = (settings && settings.proxy) || {};
    return {
      configured: ProxyTab.isConfigured(settings),
      locations: ProxyTab.LOCATIONS,
      defaultCountry: ProxyTab.normalizeCountry(p.lastCountry)
        || ProxyTab.normalizeCountry(p.defaultCountry) || 'us',
    };
  });

  // ─── popup menu custom (sopra le WebContentsView) ────────────────────────
  ipcMain.handle('shell:popup-menu', (event, { entries, x, y }) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false };
    showPopupMenu(win, entries, x, y, (value) => {
      // Le voci con `action` custom tornano al renderer chiamante; quelle con
      // `url` (default) aprono un nuovo tab.
      if (typeof value === 'string' && value.startsWith('@action:')) {
        try { event.sender.send('shell:menu-action', value.slice('@action:'.length)); } catch (_) {}
      } else if (value) {
        win._filoTabs.openTab(value);
      }
    });
    return { ok: true };
  });

  // ─── tooltip custom (sopra le WebContentsView) ───────────────────────────
  ipcMain.on('shell:tooltip-show', (event, { text, x, y }) => {
    const win = winFor(event);
    if (!win) return;
    showTooltip(win, String(text || ''), Number(x) || 0, Number(y) || 0);
  });
  ipcMain.on('shell:tooltip-hide', () => hideTooltip());

  // ─── disegno annotazione sulla barra in alto (shell) ─────────────────────
  // La shell ci dice se c'è un disegno sulla sua barra: lo rilanciamo ai content
  // script (box feedback) così "Cancella disegno" compare anche quando si è
  // disegnato SOLO sulla barra e l'invio allega lo screenshot annotato.
  ipcMain.on('shell:feedback-draw-state', (_event, { has } = {}) => {
    try {
      const { MSG } = globalThis.SN_MSG;
      broadcastToTabs({ type: MSG.FEEDBACK_DRAW_STATE, topbar: !!has });
    } catch (_) {}
  });

  // ─── controlli finestra (min / max / close) ──────────────────────────────
  ipcMain.handle('window:minimize', (event) => {
    const win = winFor(event); if (win) win.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = winFor(event);
    if (win) {
      if (win.isMaximized()) win.unmaximize(); else win.maximize();
    }
    return { ok: true };
  });
  ipcMain.handle('window:close', (event) => {
    const win = winFor(event); if (win) win.close();
    return { ok: true };
  });

  // ─── apertura finestra incognito ─────────────────────────────────────────
  // Lazy require di window.js per evitare un ciclo di import al boot.
  ipcMain.handle('window:open-incognito', () => {
    try {
      const { createIncognitoWindow } = require('./window');
      createIncognitoWindow();
      return { ok: true };
    } catch (err) {
      console.error('[Filo IPC] open-incognito', err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

async function openInternalPage(name) {
  // Vedi filoWin() in handlers.js: getAllWindows()[0] può essere una finestra
  // figlia (tooltip/popup) senza _filoTabs. Cerca quella che possiede i tab.
  const wins = BrowserWindow.getAllWindows();
  const win = wins.find((w) => w._filoTabs) || wins[0];
  if (!win || !win._filoTabs) return;
  const url = `filo://${name}/${name}.html`;
  win._filoTabs.openTab(url);
}

module.exports = { registerIpcHandlers, openInternalPage };
