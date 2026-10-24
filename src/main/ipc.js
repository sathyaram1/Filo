// Instradamento IPC: da shell, pagine interne e content script agli handler dei
// servizi. Qui non c'è logica di dominio, solo smistamento e confini (chi può
// chiedere cosa, in quale finestra, con quale storage).

const { ipcMain, BrowserWindow, app, session } = require('electron');
const path = require('node:path');
const { handleMessage, handleStream, broadcastToTabs } = require('./services/handlers');
const { showPopupMenu } = require('./popup-menu');
const MenuDiRiserva = require('./menuDiRiserva');
const { showTooltip, hideTooltip } = require('./popup-tooltip');
const CartaAnteprima = require('./popup-anteprima');
const { createSession, defaultCwd, commandExists } = require('./services/shell');
const { resolveShell } = require('./services/terminal');
const { virgoletteIncollando, propostaVirgolette } = require('./services/shellVirgolette');
const SegretiLetti = require('./services/segretiLetti');
const RilascioNellaChat = require('./rilascioNellaChat');
// Quanto dell'output di un comando lanciato a mano passa dal registro dei segreti letti: quanto una pagina.
const MAX_STAMPATO = 8000000;
const { hostResolves } = require('./services/hostResolve');
const DiskStorage = require('./shim/storage');
const { chiediConferma, ritiraConferma } = require('./confermeSopraPagina');
const AzioniContate = require('./services/azioniContate');

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
  // `fromWebContents` torna null per le WebContentsView figlie: senza il giro su tutte le
  // finestre `tab` resta null e le voci del menu che leggono il suo id non fanno niente.
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
  // La home pronta per la scheda nuova (#1128) parla già come la scheda che diventerà, nella sua finestra: senza,
  // in incognito leggerebbe e scriverebbe il disco, e nessuno saprebbe che non è davanti agli occhi.
  let riserva = false;
  if (!tab) {
    for (const w of BrowserWindow.getAllWindows()) {
      const r = w._filoTabs?.riserva;
      if (r && r.possiede(wc)) { tab = { id: r.id, url: wc.getURL(), title: '' }; win = w; riserva = true; break; }
    }
  }
  return {
    riserva,
    tab: tab ? { id: tab.id, url: tab.url, title: tab.title, openedAt: tab.openedAt || null, paginaDal: tab.paginaDal || null } : null,
    url: wc.getURL(),
    isShell: Boolean(finestraDellaBarra(wc)),
    // Riferimento alla finestra proprietaria (in-process: l'handler è chiamato
    // direttamente, non oltre il confine IPC) + flag incognito, così i servizi
    // aprono i tab nella finestra giusta e l'IPC instrada lo storage in RAM.
    win: win || null,
    isIncognito: !!win?._filoIncognito,
    wc,
    // #405 — il frame ESATTO: con i content script attivi anche nei riquadri
    // incorporati, "la scheda" non basta a sapere a chi rispondere.
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

// Le quattro chiamate sincrone che una pagina fa prima dei suoi script: finché non c'è la risposta la pagina è ferma.
// Quanto ci mettono, per canale, lo contano i contatori anonimi (#1466); da una finestra incognito no.
function cronometrata(canale, gestore) {
  return (event, ...args) => {
    const t0 = performance.now();
    try { gestore(event, ...args); } finally {
      try {
        const C = globalThis.SN_CONTATORI_MAIN;
        if (C) C.ipcSincrono(canale, performance.now() - t0, { incognito: !!ambitoIncognitoDi({ win: null, wc: event.sender }) });
      } catch (_) {}
    }
  };
}

function registerIpcHandlers() {
  // Niente shell orfane dopo l'uscita: alla riapertura si riparte puliti.
  app.on('before-quit', () => {
    for (const s of shellSessions.values()) { try { s.kill(); } catch (_) {} }
    shellSessions.clear();
  });

  // SINCRONO perché il preload deve installare gli override PRIMA degli script
  // di pagina. Passa { level, seed }: il master secret NON attraversa mai qui.
  ipcMain.on('filo:fp-config', cronometrata('fp-config', (event, href) => {
    try {
      event.returnValue = require('./services/fingerprint').configForHref(href, ambitoIncognitoDi(senderInfo(event)));
    } catch (_) {
      event.returnValue = { level: 0, seed: 0 };
    }
  }));

  // #754 — la pagina che sta per caricarsi, prima degli script del sito: la risposta al banner dei cookie da
  // togliere dalla sua memoria, se il sito ha cambiato elenco. SINCRONO per lo stesso motivo di fp-config.
  ipcMain.on('filo:cookie-wipe', cronometrata('cookie-wipe', (event, href) => {
    let out = null;
    try {
      const wc = event.sender;
      const top = event.senderFrame && wc.mainFrame && event.senderFrame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId;
      if (top) {
        for (const w of BrowserWindow.getAllWindows()) {
          const tm = w._filoTabs;
          if (tm && tm.tabs && tm.tabs.some((t) => t.view && t.view.webContents === wc)) {
            out = tm.takeCookieWipe(String(href || ''));
            // La memoria della pagina che «Resta connesso» ha portato nel jar nuovo (tabs/tabRestaConnesso.js).
            const semina = tm.takeSemina(wc, String(href || ''));
            if (semina) out = { ...(out || {}), semina: semina.locale, seminaSessione: semina.sessione, seminaDb: semina.database };
            break;
          }
        }
      }
    } catch (_) { out = null; }
    event.returnValue = out;
  }));

  // #576 — i riquadri pubblicitari da nascondere nella pagina che sta per caricarsi: SINCRONO, o compaiono prima.
  ipcMain.on('filo:adblock-css', cronometrata('adblock-css', (event, href, gate) => {
    try {
      event.returnValue = require('./services/adblock').cosmeticForPage(String(href || ''), gate);
    } catch (_) {
      event.returnValue = { css: '', tokens: false };
    }
  }));

  // Il sito vale quello del frame che chiede, non quello che il messaggio dichiara.
  ipcMain.handle('filo:adblock-tokens', (event, msg) => {
    try {
      const href = (event.senderFrame && event.senderFrame.url) || '';
      return require('./services/adblock').cosmeticForTokens(href, msg && msg.ids, msg && msg.classes, msg && msg.gate);
    } catch (_) {
      return '';
    }
  });

  // Cosa la pagina che sta per caricarsi legge delle notifiche (#591): SINCRONO per lo stesso motivo di filo:fp-config.
  ipcMain.on('filo:permessi-stato', cronometrata('permessi-stato', (event, href) => {
    try {
      const Permessi = require('./services/permessiPagine');
      event.returnValue = { notifiche: Permessi.statoNotifiche(event.sender.session, href), gestoMs: Permessi.GESTO_MS };
    } catch (_) {
      event.returnValue = { notifiche: 'default' };
    }
  }));

  // Il sì vero a fotocamera, microfono o posizione, per il sito del frame che chiede e solo per lui (#1057).
  ipcMain.on('filo:permessi-si', (event, parte) => {
    try {
      const url = (event.senderFrame && event.senderFrame.url) || event.sender.getURL();
      event.returnValue = require('./services/permessiPagine').siDato(event.sender.session, url, parte);
    } catch (_) {
      event.returnValue = false;
    }
  });

  // Scrivere su un file o una cartella che la pagina ha già (#1069): la domanda, regole in services/permessiPagine.js.
  ipcMain.handle('filo:permessi-scrittura', (event) => {
    const wc = event.sender;
    const top = event.senderFrame && wc.mainFrame && event.senderFrame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId;
    if (!top) return null;
    return require('./services/permessiPagine').chiediScrittura(wc);
  });

  // #405 — l'utente sta interagendo con QUESTO frame (la pagina o uno dei suoi
  // riquadri incorporati). Serve alle scorciatoie che lavorano sulla selezione:
  // vanno consegnate a chi ha davvero il testo selezionato. Nessun dato nel
  // messaggio: conta solo il mittente.
  ipcMain.on('filo:frame-active', (event) => {
    try { event.sender._filoActiveFrame = event.senderFrame || null; } catch (_) {}
  });

  // Sincroni: devono arrivare prima della finestra che la pagina chiede nello stesso clic (#737.1 giri 6 e 7).
  ipcMain.on('filo:gesto-pagina', (event, tasto) => {
    const vero = require('./services/permessiPagine').gestoDellaPagina(event.sender, event.senderFrame, tasto);
    // Vale anche per il rilevatore dei siti pericolosi, riquadri compresi: uno scaricamento che segue l'ha chiesto l'utente (#814).
    // Lo stesso gesto dei permessi: il clic che Filo dà da sé (il «Salta» delle pubblicità) non è dell'utente.
    if (vero) for (const w of BrowserWindow.getAllWindows()) {
      try { w._filoTabs?._sbGesto?.(event.sender); } catch (_) {}
    }
    event.returnValue = true;
  });
  ipcMain.on('filo:gesto-di-filo', (event) => {
    require('./services/permessiPagine').gestoDiFilo(event.sender);
    event.returnValue = true;
  });
  ipcMain.on('filo:schermo-vecchio', (event) => {
    require('./services/permessiPagine').schermoVecchio(event.sender, event.senderFrame);
    event.returnValue = true;
  });
  ipcMain.on('filo:apertura-scelta', (event, url, azione) => {
    require('./services/permessiPagine').aperturaScelta(event.sender, url, azione);
    event.returnValue = true;
  });
  // #965 — il clic su un link «scarica» verso un file da avviso: vero se l'avviso lo ferma prima che parta.
  ipcMain.on('filo:scaricamento-scelto', (event, url, nome) => {
    let fermo = false;
    try {
      const wc = event.sender;
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs?.tabs?.some((t) => t.view.webContents === wc));
      const tab = win && win._filoTabs.tabs.find((t) => t.view.webContents === wc);
      if (tab) fermo = win._filoTabs._sbScaricamentoScelto(tab, String(url || ''), String(nome || '')) === true;
    } catch (_) {}
    event.returnValue = fermo;
  });
  ipcMain.on('filo:indirizzo-rifiutato', (event, url) => {
    try {
      const wc = event.sender;
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs?.tabs?.some((t) => t.view.webContents === wc));
      if (win) win._filoTabs.indirizzoRifiutatoDallaPagina(wc, url);
    } catch (_) {}
  });
  // #1623 — le immagini lasciate sulla fila delle schede: solo dalla barra di una finestra, mai da una pagina.
  ipcMain.on('shell:rilascio-nella-chat', (event, voci) => {
    const win = finestraDellaBarra(event.sender);
    if (win) RilascioNellaChat.consegna(win, voci).catch(() => {});
  });
  // Da un riquadro incorporato in un sito: il pannello sta nel frame principale della sua scheda.
  ipcMain.on('filo:rilascio-riquadro', (event, voci) => {
    try {
      const wc = event.sender;
      if (!event.senderFrame || !wc.mainFrame || event.senderFrame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId) return;
      for (const w of BrowserWindow.getAllWindows()) {
        const tab = w._filoTabs?.tabs?.find((t) => t.view.webContents === wc);
        if (tab) { RilascioNellaChat.dalRiquadro(tab, voci).catch(() => {}); return; }
      }
    } catch (_) {}
  });

  // #1054 — il menu del tasto destro di questa scheda, o della finestrella di accesso, si disegna nello strato sopra?
  ipcMain.on('filo:strato-menu', (event) => {
    let si = false;
    try {
      const wc = event.sender;
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs?.tabs?.some((t) => t.view.webContents === wc));
      if (win) si = !!(win._filoTabs.strato && win._filoTabs.strato.acceso);
      else {
        const propria = BrowserWindow.fromWebContents(wc);
        si = !!(propria && propria.webContents === wc && propria._filoStrato && propria._filoStrato.acceso);
      }
    } catch (_) {}
    event.returnValue = si;
  });

  // #1585 — il dizionario del correttore (dizionarioDiFilo.js). La pagina chiede sincrona (decide i segni mentre li
  // disegna) e aspetta il thread del dizionario, il principale no. `null` finché non è pronto: risponde il browser.
  const dalDizionario = (event, chiedi) => {
    let p = null;
    try { p = chiedi(require('./services/dizionarioDiFilo')); } catch (_) {}
    Promise.resolve(p).catch(() => null).then((out) => { try { event.returnValue = out ?? null; } catch (_) {} });
  };
  ipcMain.on('filo:dizionario-sbagliate', (event, parole) => dalDizionario(event, (D) => D.sbagliate(parole)));
  ipcMain.on('filo:dizionario-proposte', (event, parola) => dalDizionario(event, (D) => D.proposte(parola)));

  // Il menu di Filo nella pagina non è partito (page-preload.js): si apre quello di riserva (#1122).
  ipcMain.on('filo:menu-di-riserva', (event, richiesta) => {
    try { MenuDiRiserva.chiesto(event, richiesta); } catch (_) {}
  });

  // window.close() di una pagina web (page-preload.js): chiude la sua scheda, mai la finestra di Filo; una finestrella
  // di accesso, che è una finestra sua, si chiude come prima.
  ipcMain.on('filo:chiudi-pagina', (event) => {
    try {
      if (!event.senderFrame || event.senderFrame.parent) return;
      const wc = event.sender;
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs?.tabs?.some((t) => t.view.webContents === wc));
      if (win) { win._filoTabs.chiusaDallaPagina(wc); return; }
      const propria = BrowserWindow.fromWebContents(wc);
      if (propria && !propria._filoTabs && propria.webContents === wc) propria.close();
    } catch (_) {}
  });

  // #685.1 — Cmd+freccia che la pagina non ha usato: decide la scheda (tabs.cmdFrecciaNonUsata).
  ipcMain.on('filo:cmd-freccia', (event, verso) => {
    if (verso !== 'indietro' && verso !== 'avanti') return;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs?.tabs?.some((t) => t.view.webContents === event.sender)) {
        try { w._filoTabs.cmdFrecciaNonUsata(event.sender, verso); } catch (_) {}
        return;
      }
    }
  });

  // È la chiave a essere stata rifiutata (credito finito compreso, moderazione
  // no)? Lo decide SN_WALLET, una volta sola; qui viaggia con l'errore perché
  // chi lo mostra possa offrire la pagina Crediti invece del solo «Riprova».
  const rifiutoDellaChiave = (err) => {
    try { return Boolean(globalThis.SN_WALLET?.keyRefusalOf?.(err)); } catch (_) { return false; }
  };

  // Tetto, finestra e taglio viaggiano con l'errore: la frase e il tasto per le Preferenze si ricompongono da qui (#1097.3).
  const dettagliDelTetto = (err) => (err ? {
    ...(err.maxTokens ? { maxTokens: err.maxTokens } : {}),
    ...(err.finestra ? { finestra: err.finestra } : {}),
    ...(err.code === 'RISPOSTA_TAGLIATA' ? { finishReason: err.finishReason || null, vuota: !!err.vuota } : {}),
    // Il modello che i crediti non pagano (#830) porta il tasto per la pagina Crediti.
    ...(err.reason === 'crediti' ? { reason: 'crediti' } : {}),
  } : {});

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
      return { ok: false, error: err.message || String(err), code: err.code || 'UNKNOWN', keyRefused: rifiutoDellaChiave(err), ...dettagliDelTetto(err) };
    }
  });

  ipcMain.handle('ai-stream:start', async (event, { requestId, action, payload }) => {
    const incognito = !!BrowserWindow.fromWebContents(event.sender)?._filoIncognito
      || senderInfo(event).isIncognito;
    const ac = new AbortController();
    inFlightStreams.set(requestId, ac);
    // #405 — lo stream torna al FRAME che l'ha chiesto: mandato al principale,
    // il riquadro che aspettava girerebbe a vuoto per sempre.
    const target = event.senderFrame || event.sender;
    const send = (suffix, data) => {
      try {
        const t = (target && target.detached) ? event.sender : target;
        t.send(`ai-stream:${requestId}:${suffix}`, data);
      } catch (_) {}
    };
    // Canale SEPARATO da filo:message, quindi l'incognito va rimesso anche qui:
    // cache AI e conteggio dei costi devono restare effimeri.
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
          // #273 — se il ripiego parte dopo dei delta, il renderer deve buttare
          // il testo parziale del tentativo fallito.
          onReset: () => send('reset', {}),
        }));
        send('done', { ...result });
      } catch (err) {
        console.warn('[Filo IPC] stream error', requestId, err);
        // Lo stream dice quello che dice la risposta di `filo:message`: senza
        // status, fornitore e frase già scritta chi mostra l'errore non può
        // ricomporlo e finisce per stampare la riga grezza del servizio (#663).
        send('error', {
          message: err.message || String(err),
          code: err.code || 'UNKNOWN',
          status: Number(err && err.status) || 0,
          provider: (err && err.provider) || '',
          userMessage: (err && typeof err.userMessage === 'string') ? err.userMessage : '',
          keyRefused: rifiutoDellaChiave(err),
          ...dettagliDelTetto(err),
        });
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
    // La `cwd` passata serve solo al primo avvio: in una sessione viva la
    // directory la tiene la sessione, e un `cd` deve restare.
    if (!session || session.dead || session.shell !== wantShell) {
      if (session) { try { session.kill(); } catch (_) {} }
      session = createSession({ shell: wantShell, cwd });
      shellSessions.set(key, session);
      // Chiudere la scheda è il modo più intuitivo di uccidere il processo.
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

  // Serve a colorare di rosso un "/comando" inesistente mentre lo si scrive.
  ipcMain.handle('shell:which', async (event, { command, shell, cwd } = {}) => {
    const url = event.sender.getURL() || '';
    if (!url.startsWith('filo://')) return { ok: false, error: 'forbidden' };
    try {
      const exists = await commandExists({ shell, cwd, command });
      return { ok: true, exists };
    } catch (_) {
      // Un controllo andato storto non sa niente: `null` lascia il comando senza colore, mai rosso (#1176).
      return { ok: false, exists: null };
    }
  });

  // #968 — un percorso con spazi incollato nel comando prende le virgolette, e sotto un comando fallito per quelle
  // mancanti c'è la versione giusta. Qui si risponde e basta: cambia la riga la pagina, sotto gli occhi dell'utente.
  ipcMain.handle('shell:virgolette-incolla', async (event, opzioni = {}) => {
    if (!(event.sender.getURL() || '').startsWith('filo://')) return { ok: false, error: 'forbidden' };
    try { return { ok: true, sostituzione: await virgoletteIncollando(opzioni || {}) }; } catch (_) { return { ok: false }; }
  });
  ipcMain.handle('shell:proposta-virgolette', async (event, opzioni = {}) => {
    if (!(event.sender.getURL() || '').startsWith('filo://')) return { ok: false, error: 'forbidden' };
    try { return { ok: true, proposta: await propostaVirgolette(opzioni || {}) }; } catch (_) { return { ok: false }; }
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

  ipcMain.handle('shell:home', () => {
    try { return { ok: true, cwd: defaultCwd() }; } catch (_) { return { ok: false }; }
  });

  // Testo grezzo verso lo stdin del comando interattivo in corso.
  ipcMain.on('shell:input', (event, { text } = {}) => {
    const s = shellSessions.get(event.sender.id);
    if (s) s.write(String(text == null ? '' : text));
  });

  // Uccide la shell intera, non il solo comando: su Windows è l'unico modo di
  // interrompere in modo affidabile. Costo accettato: le variabili si perdono.
  ipcMain.on('shell:abort', (event) => {
    const fine = comandiInCorso.get(event.sender.id);
    if (fine) { fine(); comandiInCorso.delete(event.sender.id); }
    const s = shellSessions.get(event.sender.id);
    if (s) { try { s.kill(); } catch (_) {} shellSessions.delete(event.sender.id); }
  });

  const winFor = (event) => {
    const wc = event.sender;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoShell?.webContents === wc) return w;
      if (w._filoTabs?.tabs?.some((t) => t.view.webContents === wc)) return w;
    }
    return BrowserWindow.fromWebContents(wc) || BrowserWindow.getAllWindows()[0];
  };
  // I gesti della barra delle schede sono azioni contate (#1461): fino alla pagina visibile e caricata.
  const gesto = (win, azione, fn) => AzioniContate.azione(azione, fn, { incognito: !!(win && win._filoIncognito) });
  ipcMain.handle('tabs:open', (event, { url } = {}) => {
    const win = winFor(event);
    if (!win || !win._filoTabs) return { ok: false };
    // Per il giudizio sui siti «aperta da Filo» lo dice solo la barra di Filo.
    const daShell = Boolean(finestraDellaBarra(event.sender));
    const apri = () => win._filoTabs.openTab(url || 'filo://newtab/', daShell ? { origine: { tipo: 'filo' } } : {});
    // Una pagina di Filo la conta l'apertura della scheda, da qualunque strada (src/main/tabs.js).
    const id = !url || url === 'filo://newtab/' ? gesto(win, 'new-tab', apri) : apri();
    return { ok: true, id };
  });
  ipcMain.handle('tabs:close', (event, { id, via } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) gesto(win, 'close-tab', () => win._filoTabs.closeTab(id, { via: typeof via === 'string' ? via : 'altro' }));
    return { ok: true };
  });
  ipcMain.handle('tabs:activate', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.activate(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:navigate', (event, { id, url }) => {
    const win = winFor(event);
    if (win?._filoTabs) gesto(win, 'address-bar', () => win._filoTabs.navigate(id, url));
    return { ok: true };
  });
  ipcMain.handle('tabs:move', (event, { id, toIndex } = {}) => {
    const win = winFor(event);
    const moved = win?._filoTabs ? gesto(win, 'reorder-tabs', () => win._filoTabs.moveTab(id, toIndex)) : false;
    return { ok: true, moved };
  });
  ipcMain.handle('tabs:reserve-top', (event, { px }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setTopInset(px);
    return { ok: true };
  });
  // Fuori dalla home la shell nasconde la barra indirizzi: la vista della
  // scheda deve risalire a coprire lo spazio, o resta una striscia vuota.
  ipcMain.handle('tabs:set-chrome-compact', (event, { on } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setChromeCompact(!!on);
    return { ok: true };
  });
  ipcMain.handle('tabs:back', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) gesto(win, 'navigate-back-forward', () => win._filoTabs.goBack(id));
    return { ok: true };
  });
  ipcMain.handle('tabs:forward', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) gesto(win, 'navigate-back-forward', () => win._filoTabs.goForward(id));
    return { ok: true };
  });
  ipcMain.handle('tabs:reload', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) gesto(win, 'reload', () => win._filoTabs.reload(id));
    return { ok: true };
  });
  // `muted` assente = toggle.
  ipcMain.handle('tabs:set-muted', (event, { id, muted } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) {
      if (muted === undefined) win._filoTabs.toggleMute(id);
      else win._filoTabs.setMuted(id, muted);
    }
    return { ok: true };
  });
  ipcMain.handle('tabs:duplicate', async (event, { id } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false };
    const newId = await win._filoTabs.duplicateTab(id);
    return { ok: !!newId, id: newId };
  });
  ipcMain.handle('tabs:help', (event, { id } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) gesto(win, 'help-sidebar', () => win._filoTabs.openHelp(id));
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
  require('./services/microfonoDiFilo').registra({ ipcMain, BrowserWindow });
  // Solo la cornice risponde a una domanda di permesso: è l'unico posto dove l'ha vista l'utente (#591.1).
  ipcMain.handle('tabs:permesso-risposta', (event, { id, si, fonte } = {}) => {
    if (!finestraDellaBarra(event.sender) || !id) return { ok: false };
    return { ok: require('./services/permessiPagine').rispondi(String(id), si === true, typeof fonte === 'string' ? fonte.slice(0, 200) : undefined) };
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
  // Proxy di UNA scheda sola: nella UI è "Apri da un altro paese".
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
  // #759 — «Resta connesso qui» dal menu della scheda (id) o dalla proposta dopo un accesso (sito). Solo dalla
  // shell e solo nel profilo normale: l'incognito non ha jar persistenti.
  ipcMain.handle('tabs:resta-connesso', async (event, { id, on, sito } = {}) => {
    const win = finestraDellaBarra(event.sender);
    if (!win || win._filoIncognito || !win._filoTabs) return { ok: false, error: 'forbidden' };
    const dove = sito ? 'proposta-accesso' : 'menu-scheda';
    return require('./services/registroCambi').con({ via: 'interfaccia', dove },
      () => win._filoTabs.restaConnesso({ tabId: id, sito: typeof sito === 'string' ? sito : null, on: !!on }));
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

  ipcMain.handle('shell:popup-menu', (event, { entries, x, y }) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false };
    showPopupMenu(win, entries, x, y, (value) => {
      // `@action:` torna al renderer che l'ha chiesto, tutto il resto è un url.
      if (typeof value === 'string' && value.startsWith('@action:')) {
        try { event.sender.send('shell:menu-action', value.slice('@action:'.length)); } catch (_) {}
      } else if (value) {
        win._filoTabs.openTab(value, finestraDellaBarra(event.sender) ? { origine: { tipo: 'filo' } } : {});
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

  // ─── barra laterale (#871) ────────────────────────────────────────────────
  // Solo la shell della propria finestra: tema e profilo che mostra, e la maniglia.
  const barraDellaShell = (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.webContents !== event.sender) return null;
    return win._filoTabs?.barra || null;
  };
  ipcMain.on('barra:dalla-shell', (event, dati) => { barraDellaShell(event)?.dallaShell(dati); });
  ipcMain.on('barra:commuta', (event) => { barraDellaShell(event)?.commuta('clic'); });
  ipcMain.on('barra:chiudi', (event) => { barraDellaShell(event)?.chiudi(); });
  ipcMain.on('barra:menu-maniglia', (event, dati) => { barraDellaShell(event)?.menuDellaManiglia(dati); });

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
  ipcMain.on('anteprima:nascondi', (event, dati) => {
    const win = finestraDellaBarra(event.sender);
    if (win) CartaAnteprima.nascondi(win, { clic: !!(dati && dati.clic === true) });
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

  // Require pigro: window.js richiede questo file, e al boot sarebbe un ciclo.
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
  // La prima finestra può essere una figlia (tooltip, menu) senza schede: si
  // cerca quella che le possiede. Stessa cura di filoWin() in handlers.js.
  const wins = BrowserWindow.getAllWindows();
  const win = wins.find((w) => w._filoTabs) || wins[0];
  if (!win || !win._filoTabs) return;
  const url = `filo://${name}/${name}.html`;
  win._filoTabs.openTab(url);
}

module.exports = { registerIpcHandlers, openInternalPage };
