// IPC routing: traduce le chiamate dal renderer (shell, pagine interne,
// content script via preload) al handler centrale dei servizi.
//
// Canali esposti:
//   filo:message     — invoke(msg) → response. Equivalente a chrome.runtime.sendMessage.
//   ai-stream:start  — invoke({ requestId, action, payload }). Il main streamma
//                      via ai-stream:<requestId>:delta / :done / :error fino al renderer.
//   ai-stream:abort  — send({ requestId })
//   tabs:*           — controllo del TabManager dalla shell renderer.

const { ipcMain, BrowserWindow, app, session } = require('electron');
const path = require('node:path');
const { handleMessage, handleStream, broadcastToTabs } = require('./services/handlers');
const { showPopupMenu } = require('./popup-menu');
const { showTooltip, hideTooltip } = require('./popup-tooltip');
const CartaAnteprima = require('./popup-anteprima');
const { createSession, defaultCwd, commandExists } = require('./services/shell');
const { resolveShell } = require('./services/terminal');
const SegretiLetti = require('./services/segretiLetti');
// Quanto dell'output di un comando lanciato a mano passa dal registro dei segreti letti: quanto una pagina.
const MAX_STAMPATO = 8000000;
const { hostResolves } = require('./services/hostResolve');
const DiskStorage = require('./shim/storage');
const { chiediConferma, ritiraConferma } = require('./confermeSopraPagina');

const inFlightStreams = new Map(); // requestId → AbortController
// Una shell PERSISTENTE per scheda, chiavata sull'id del WebContents che la
// possiede: i comandi successivi della stessa scheda riusano lo stesso
// processo (variabili, $env, cwd persistono). Muore alla chiusura della scheda.
const shellSessions = new Map(); // webContents.id → sessione shell persistente
const comandiInCorso = new Map(); // webContents.id → chiude la carta del comando nella home (#870)

// La finestra di Filo di cui `wc` è la barra, o null. Essere il frame principale di una
// finestra non basta: un popup di accesso è una finestra vera con dentro un sito (#589.3).
function finestraDellaBarra(wc) {
  if (!wc) return null;
  for (const w of BrowserWindow.getAllWindows()) {
    if (w._filoTabs && (w.webContents === wc || w._filoShell?.webContents === wc)) return w;
  }
  return null;
}

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
    isShell: Boolean(finestraDellaBarra(wc)),
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

// La partizione della finestra in incognito a cui appartiene la pagina, '' se è di una normale. Un popup di
// accesso aperto da una sua scheda non sta in nessuna finestra di Filo: lo riconosce la sessione, che è solo sua.
function ambitoIncognitoDi(info) {
  const tieneLaPartizione = (w) => !!(w && w._filoIncognito && w._filoTabs && w._filoTabs.partition);
  if (tieneLaPartizione(info.win)) return info.win._filoTabs.partition;
  const ses = info.wc && info.wc.session;
  const w = ses ? BrowserWindow.getAllWindows().find((x) => tieneLaPartizione(x) && session.fromPartition(x._filoTabs.partition) === ses) : null;
  return w ? w._filoTabs.partition : '';
}

// La pagina che ha chiesto, come la nomina il registro dei cambi (src/shared/cambi.js, DOVE).
function provenienzaDi(info) {
  if (info && info.isShell) return { via: 'interfaccia', dove: 'shell' };
  let u = null;
  try { u = new URL(String((info && info.url) || '')); } catch (_) { u = null; }
  if (u && u.protocol === 'filo:') {
    const dove = u.hostname === 'options' && /altro/.test(u.pathname) ? 'altro' : u.hostname;
    return { via: 'interfaccia', dove };
  }
  return { via: 'pagina' };
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
      event.returnValue = require('./services/fingerprint').configForHref(href, ambitoIncognitoDi(senderInfo(event)));
    } catch (_) {
      event.returnValue = { level: 0, seed: 0 };
    }
  });

  // #754 — la pagina che sta per caricarsi, prima degli script del sito: la risposta al banner dei cookie da
  // togliere dalla sua memoria, se il sito ha cambiato elenco. SINCRONO per lo stesso motivo di fp-config.
  ipcMain.on('filo:cookie-wipe', (event, href) => {
    let out = null;
    try {
      const wc = event.sender;
      const top = event.senderFrame && wc.mainFrame && event.senderFrame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId;
      if (top) {
        for (const w of BrowserWindow.getAllWindows()) {
          const tm = w._filoTabs;
          if (tm && tm.tabs && tm.tabs.some((t) => t.view && t.view.webContents === wc)) { out = tm.takeCookieWipe(String(href || '')); break; }
        }
      }
    } catch (_) { out = null; }
    event.returnValue = out;
  });

  // Cosa la pagina che sta per caricarsi legge delle notifiche (#591): SINCRONO per lo stesso motivo di filo:fp-config.
  ipcMain.on('filo:permessi-stato', (event, href) => {
    try {
      const Permessi = require('./services/permessiPagine');
      event.returnValue = { notifiche: Permessi.statoNotifiche(event.sender.session, href), gestoMs: Permessi.GESTO_MS };
    } catch (_) {
      event.returnValue = { notifiche: 'default' };
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
    // Ogni stato che la richiesta salva diventa un evento del filo che dice da dove è venuto (#867).
    const run = () => require('./services/registroCambi').con(provenienzaDi(info), () => handleMessage(msg, info));
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
        // Chi legge lo stream (il riquadro di «spiega») scrive da sé la riga del ripiego (#662).
        const K = globalThis.SN_WALLET_MAIN;
        const conDetto = (fn) => (K && K.conRipiegoDetto ? K.conRipiegoDetto(fn) : fn());
        const result = await conDetto(() => handleStream({
          action, payload, origin: event.sender.getURL(),
          signal: ac.signal,
          onMeta: (m) => { Object.assign(meta, m); send('meta', m); },
          onDelta: (delta) => send('delta', { delta }),
          // Fallback dopo delta già streamati: il renderer deve azzerare il
          // testo parziale del tentativo fallito (#273).
          onReset: () => send('reset', {}),
        }));
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
  ipcMain.handle('shell:start', (event, { execId, command, cwd, shell, chat } = {}) => {
    const url = event.sender.getURL() || '';
    if (!url.startsWith('filo://')) return { ok: false, error: 'forbidden' };
    if (!execId || typeof command !== 'string') return { ok: false, error: 'bad-args' };
    const send = (suffix, data) => {
      try { event.sender.send(`shell:${execId}:${suffix}`, data); } catch (_) {}
    };
    const key = event.sender.id;
    // La shell EFFETTIVA su questo sistema: fuori da Windows «powershell» e
    // «cmd» non esistono e diventano la shell di sistema. Si confronta quella,
    // non quella chiesta, altrimenti su Linux e Mac la sessione risulterebbe
    // sempre «diversa» e verrebbe ricreata a ogni comando (addio `cd`).
    const wantShell = resolveShell(shell);
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
    // Quello che stampa un comando lanciato a mano è testo letto da fuori: la chat riaperta lo rilegge come
    // una frase di Filo, e la porta delle uscite deve saperlo (#810). Si tiene la coda, dove finisce l'esito.
    const stampato = [];
    let quanto = 0;
    const ambito = require('./services/downloads').scopeOfWindow(senderInfo(event).win);
    const fineLavoro = require('./services/lavoriInCorso').inizia({ tipo: 'comando', chat, testo: command, wc: event.sender, ambito });
    comandiInCorso.set(key, fineLavoro);
    const chiudi = () => { fineLavoro(); if (comandiInCorso.get(key) === fineLavoro) comandiInCorso.delete(key); };
    session.exec(command, {
      onData: (d) => {
        const pezzo = String((d && d.chunk) || '');
        stampato.push(pezzo);
        quanto += pezzo.length;
        while (quanto > MAX_STAMPATO && stampato.length > 1) quanto -= stampato.shift().length;
        send('data', d);
      },
      onExit: (e) => { chiudi(); SegretiLetti.ricorda(stampato.join(''), "dall'output di un comando"); send('exit', e); },
      onError: (e) => { chiudi(); send('error', e); },
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
    const fine = comandiInCorso.get(event.sender.id);
    if (fine) { fine(); comandiInCorso.delete(event.sender.id); }
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
  // Solo la cornice risponde a una domanda di permesso: è l'unico posto dove l'ha vista l'utente (#591.1).
  ipcMain.handle('tabs:permesso-risposta', (event, { id, si } = {}) => {
    if (!finestraDellaBarra(event.sender) || !id) return { ok: false };
    return { ok: require('./services/permessiPagine').rispondi(String(id), si === true) };
  });
  // Le scelte ricordate per il sito di una scheda: il suo menu le mostra e le toglie (#591.1).
  const paginaDiScheda = (event, id) => {
    const t = winFor(event)?._filoTabs?.tabs?.find((x) => x.id === id);
    const wc = t && t.view && t.view.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  };
  ipcMain.handle('tabs:permessi', (event, { id } = {}) => {
    const wc = paginaDiScheda(event, id);
    if (!wc) return { scelte: [] };
    const Permessi = require('./services/permessiPagine');
    const { origine, scelte } = Permessi.scelteDi(wc);
    return { scelte, ...(origine ? Permessi.nomeDaMostrare(origine) : {}) };
  });
  ipcMain.handle('tabs:permessi-dimentica', (event, { id } = {}) => {
    const wc = paginaDiScheda(event, id);
    return wc ? require('./services/permessiPagine').dimentica(wc) : { tolte: 0, cera: false };
  });
  ipcMain.handle('tabs:open-blocked-popup', (event, { url, apriComunque, daScheda } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs || !url) return { ok: false };
    // Scavalcare la lista lo chiede solo la shell, dove stanno la notifica «Sito bloccato» e la chip dei popup (#590).
    const shell = event.sender === win.webContents;
    win._filoTabs.openBlockedPopup(url, {
      apriComunque: apriComunque === true && shell,
      daScheda: shell && typeof daScheda === 'string' ? daScheda : null,
    });
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
  // #754 — dal menu della scheda: rivedere i banner dei cookie su questo sito (show) o ridarli a Filo.
  // Solo dalla shell: scrive le impostazioni.
  ipcMain.handle('tabs:cookie-banners', async (event, { id, show } = {}) => {
    const win = finestraDellaBarra(event.sender);
    if (!win) return { ok: false, error: 'forbidden' };
    // In incognito l'elenco dei siti si scrive nella memoria della sessione, non sul disco.
    const run = () => require('./services/registroCambi').con({ via: 'interfaccia', dove: 'menu-scheda' }, () => win._filoTabs.setCookieBanners(id, !!show));
    return win._filoIncognito ? DiskStorage.runIncognito(run) : run();
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

  // ─── avvisi della barra (sopra le WebContentsView, #588.5) ────────────────
  // Solo la shell della finestra manda la sua pila: una scheda non deve poter disegnare lì.
  ipcMain.on('avvisi:stato', (event, stato) => {
    const win = finestraDellaBarra(event.sender);
    if (win && win._filoTabs.avvisi) win._filoTabs.avvisi.aggiorna(stato);
  });

  // ─── conferme di Filo chieste da un sito (sopra la sua scheda, #592.6) ───────
  ipcMain.handle('filo:conferma', (event, richiesta) => chiediConferma(event, richiesta));
  ipcMain.on('filo:conferma-ritira', (event, d) => ritiraConferma(event, d));

  // ─── tooltip custom (sopra le WebContentsView) ───────────────────────────
  ipcMain.on('shell:tooltip-show', (event, { text, x, y }) => {
    const win = winFor(event);
    if (!win) return;
    showTooltip(win, String(text || ''), Number(x) || 0, Number(y) || 0);
  });
  ipcMain.on('shell:tooltip-hide', () => hideTooltip());

  // ─── puntatore fuori dal documento della barra (#428) ────────────────────
  // In coordinate della barra (px CSS), per dirle se è ancora sulla fila delle schede.
  ipcMain.handle('shell:puntatore', (event) => {
    const win = finestraDellaBarra(event.sender);
    if (!win || win.isDestroyed()) return null;
    const { screen } = require('electron');
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const z = event.sender.getZoomFactor() || 1;
    return { x: (p.x - b.x) / z, y: (p.y - b.y) / z };
  });

  // #430 — solo la barra della finestra chiede la carta, e solo per le sue schede.
  ipcMain.on('anteprima:mostra', (event, dati) => {
    const win = finestraDellaBarra(event.sender);
    if (win) CartaAnteprima.mostra(win, dati);
  });
  ipcMain.on('anteprima:prepara', (event) => {
    const win = finestraDellaBarra(event.sender);
    if (win) CartaAnteprima.prepara(win);
  });
  ipcMain.on('anteprima:nascondi', (event) => {
    const win = finestraDellaBarra(event.sender);
    if (win) CartaAnteprima.nascondi(win);
  });

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
