// Preload della shell: espone window.filoShell (tab, download, finestra, account).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('filoShell', {
  // Alla barra serve per nominare il tasto giusto: regola in CLAUDE.md § Mac.
  sistema: process.platform,
  // #1623 — le immagini lasciate sulla fila delle schede vanno alla chat della scheda davanti.
  percorsoDelFile: (f) => { try { return (webUtils && webUtils.getPathForFile(f)) || ''; } catch (_) { return ''; } },
  rilascioNellaChat: (voci) => ipcRenderer.send('shell:rilascio-nella-chat', Array.isArray(voci) ? voci : []),
  // Dove sta il puntatore quando è fuori dal documento della barra (#428).
  puntatore: () => ipcRenderer.invoke('shell:puntatore'),
  tabs: {
    open: (url) => ipcRenderer.invoke('tabs:open', { url }),
    // `via`: come la si chiude, per i contatori (#1470).
    close: (id, via) => ipcRenderer.invoke('tabs:close', { id, via }),
    activate: (id) => ipcRenderer.invoke('tabs:activate', { id }),
    navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', { id, url }),
    move: (id, toIndex) => ipcRenderer.invoke('tabs:move', { id, toIndex }),
    reserveTop: (px) => ipcRenderer.invoke('tabs:reserve-top', { px }),
    setChromeCompact: (on) => ipcRenderer.invoke('tabs:set-chrome-compact', { on }),
    back: (id) => ipcRenderer.invoke('tabs:back', { id }),
    forward: (id) => ipcRenderer.invoke('tabs:forward', { id }),
    reload: (id) => ipcRenderer.invoke('tabs:reload', { id }),
    // Toggle se `muted` è omesso.
    setMuted: (id, muted) => ipcRenderer.invoke('tabs:set-muted', { id, muted }),
    duplicate: (id) => ipcRenderer.invoke('tabs:duplicate', { id }),
    // Ctrl/Cmd+Shift+T e Ctrl/Cmd+L con la barra a fuoco (#1476).
    riapriChiusa: () => ipcRenderer.invoke('tabs:riapri-chiusa'),
    scriviIndirizzo: (id) => ipcRenderer.invoke('tabs:scrivi-indirizzo', { id }),
    help: (id) => ipcRenderer.invoke('tabs:help', { id }),
    snapshot: () => ipcRenderer.invoke('tabs:snapshot'),
    setActiveVisible: (visible) => ipcRenderer.invoke('tabs:set-active-visible', { visible }),
    onUpdate: (fn) => {
      const wrapped = (_event, snapshot) => { try { fn(snapshot); } catch (_) {} };
      ipcRenderer.on('tabs:updated', wrapped);
      return () => ipcRenderer.removeListener('tabs:updated', wrapped);
    },
    onPopupBlocked: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('tabs:popup-blocked', wrapped);
      return () => ipcRenderer.removeListener('tabs:popup-blocked', wrapped);
    },
    // `apriComunque`: solo l'«Apri comunque» della notifica di sito bloccato scavalca la lista.
    // `daScheda`: la scheda del popup fermato, il cui «Apri comunque» vale anche per il popup.
    openBlockedPopup: (url, apriComunque, daScheda) => ipcRenderer.invoke('tabs:open-blocked-popup', { url, apriComunque: apriComunque === true, daScheda }),
    onPermesso: (fn) => {
      const chiedi = (_event, info) => { try { fn('chiedi', info); } catch (_) {} };
      const fine = (_event, info) => { try { fn('fine', info); } catch (_) {} };
      ipcRenderer.on('tabs:permesso', chiedi);
      ipcRenderer.on('tabs:permesso-fine', fine);
      return () => { ipcRenderer.removeListener('tabs:permesso', chiedi); ipcRenderer.removeListener('tabs:permesso-fine', fine); };
    },
    rispondiPermesso: (id, si, fonte) => ipcRenderer.invoke('tabs:permesso-risposta', { id, si, fonte }),
    // Il microfono di Filo per una pagina web (#586): si apre qui, e alla pagina vanno solo i campioni.
    onMicrofono: (fn) => {
      const w = (_event, info) => { try { fn(info || {}); } catch (_) {} };
      ipcRenderer.on('shell:microfono', w);
      return () => ipcRenderer.removeListener('shell:microfono', w);
    },
    microfonoEsito: (id, esito) => ipcRenderer.send('shell:microfono-esito', { ...(esito || {}), id }),
    microfonoDati: (id, dati) => ipcRenderer.send('shell:microfono-dati', { id, dati }),
    microfonoFine: (id) => ipcRenderer.send('shell:microfono-fine', { id }),
    permessi: (id) => ipcRenderer.invoke('tabs:permessi', { id }),
    dimenticaPermessi: (id) => ipcRenderer.invoke('tabs:permessi-dimentica', { id }),
    // Proxy per-tab ("Apri da un altro paese") + stato (configurato, location).
    setProxy: (id, country, tier) => ipcRenderer.invoke('tabs:set-proxy', { id, country, tier }),
    clearProxy: (id) => ipcRenderer.invoke('tabs:clear-proxy', { id }),
    proxyStatus: () => ipcRenderer.invoke('tabs:proxy-status'),
    // Banner dei cookie del sito della scheda: true = mostrali, false = Filo li gestisce di nuovo.
    cookieBanners: (id, show) => ipcRenderer.invoke('tabs:cookie-banners', { id, show }),
    // «Resta connesso qui»: dalla scheda (id) o dalla proposta dopo un accesso (sito).
    restaConnesso: (id, on, sito) => ipcRenderer.invoke('tabs:resta-connesso', { id, on, sito }),
  },
  // I `type` corrispondono a MSG.* in src/shared/messages.js.
  downloads: {
    list: () => ipcRenderer.invoke('filo:message', { type: 'downloads_list' }),
    clear: () => ipcRenderer.invoke('filo:message', { type: 'downloads_clear' }),
    remove: (id) => ipcRenderer.invoke('filo:message', { type: 'download_remove', id }),
    // `confirmed` = la shell ha già mostrato la seconda conferma su un
    // programma (#588); senza, il main risponde needsConfirm e non apre niente.
    // `luogo`: da dove arriva il gesto, per i contatori (#1470); senza, il pannello.
    openFile: (id, confirmed, luogo) => ipcRenderer.invoke('filo:message', { type: 'download_open_file', id, confirmed: !!confirmed, luogo }),
    // Risposta all'avviso "questo è un programma: scaricarlo?".
    confirm: (id, allow) => ipcRenderer.invoke('filo:message', { type: 'download_confirm', id, allow: !!allow }),
    openFolder: (id, luogo) => ipcRenderer.invoke('filo:message', { type: 'download_open_folder', id, luogo }),
    cancel: (id) => ipcRenderer.invoke('filo:message', { type: 'download_cancel', id }),
    pause: (id) => ipcRenderer.invoke('filo:message', { type: 'download_pause', id }),
    resume: (id) => ipcRenderer.invoke('filo:message', { type: 'download_resume', id }),
    // #950 — rimette il nome con cui il file era arrivato (l'«Annulla» dell'avviso «Nome dato»).
    rimettiNome: (id, luogo) => ipcRenderer.invoke('filo:message', { type: 'download_rimetti_nome', id, luogo }),
    // Aggiornamenti live: { kind:'start'|'progress'|'done'|'error'|'missing'|'removed'|'ask', item }
    onEvent: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('shell:download', wrapped);
      return () => ipcRenderer.removeListener('shell:download', wrapped);
    },
  },
  popupMenu: (entries, x, y) => ipcRenderer.invoke('shell:popup-menu', { entries, x, y }),
  // Scelta di una voce di menu con `action` custom (vedi popup-menu.js).
  onMenuAction: (fn) => {
    const wrapped = (_event, action) => { try { fn(action); } catch (_) {} };
    ipcRenderer.on('shell:menu-action', wrapped);
    return () => ipcRenderer.removeListener('shell:menu-action', wrapped);
  },
  // L'agente "Aiuto" aziona le icone della barra: il main inoltra qui e la
  // shell clicca il bottone vero, così il cammino è lo stesso dell'utente.
  onTriggerButton: (fn) => {
    const wrapped = (_event, info) => { try { fn(info && info.command, info && info.anchor); } catch (_) {} };
    ipcRenderer.on('shell:trigger-button', wrapped);
    return () => ipcRenderer.removeListener('shell:trigger-button', wrapped);
  },
  tooltipShow: (text, x, y) => ipcRenderer.send('shell:tooltip-show', { text, x, y }),
  tooltipHide: () => ipcRenderer.send('shell:tooltip-hide'),
  // #430 — la carta con l'anteprima della scheda sotto il puntatore.
  anteprima: {
    prepara: () => ipcRenderer.send('anteprima:prepara'),
    mostra: (dati) => ipcRenderer.send('anteprima:mostra', dati),
    nascondi: (dati) => ipcRenderer.send('anteprima:nascondi', { clic: !!(dati && dati.clic === true) }),
  },
  // §2.3 — toast informativo (es. dopo il riordino automatico delle schede).
  onToast: (fn) => {
    const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
    ipcRenderer.on('shell:toast', wrapped);
    return () => ipcRenderer.removeListener('shell:toast', wrapped);
  },
  // #1619 — un tono suonato dalla chat («fammi sentire la suoneria»): la shell ha SN_SOUNDS, come le notifiche.
  onSuona: (fn) => {
    const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
    ipcRenderer.on('shell:suona', wrapped);
    return () => ipcRenderer.removeListener('shell:suona', wrapped);
  },
  // #588.5 — la pila degli avvisi va a schermo in una vista sopra la pagina; i suoi clic tornano qui.
  avvisi: {
    stato: (stato) => ipcRenderer.send('avvisi:stato', stato),
    onAzione: (fn) => {
      const wrapped = (_event, dati) => { try { fn(dati); } catch (_) {} };
      ipcRenderer.on('avvisi:azione', wrapped);
      return () => ipcRenderer.removeListener('avvisi:azione', wrapped);
    },
    onSopra: (fn) => {
      const wrapped = (_event, dati) => { try { fn(dati); } catch (_) {} };
      ipcRenderer.on('avvisi:sopra', wrapped);
      return () => ipcRenderer.removeListener('avvisi:sopra', wrapped);
    },
    // I comandi della pila intera («+N», Riduci, Chiudi tutti).
    onPila: (fn) => {
      const wrapped = (_event, dati) => { try { fn(dati); } catch (_) {} };
      ipcRenderer.on('avvisi:pila', wrapped);
      return () => ipcRenderer.removeListener('avvisi:pila', wrapped);
    },
  },
  // #871 — la barra laterale: la shell le passa tema e profilo, e la apre dalla maniglia.
  barra: {
    stato: (dati) => ipcRenderer.send('barra:dalla-shell', dati),
    commuta: () => ipcRenderer.send('barra:commuta'),
    chiudi: () => ipcRenderer.send('barra:chiudi'),
    menu: (x, y) => ipcRenderer.send('barra:menu-maniglia', { x, y }),
  },
  // Modalità annotazione del box feedback: la shell mette/toglie un velo
  // d'ombra sopra la propria barra in alto così tutto Filo va in penombra.
  onFeedbackDim: (fn) => {
    const wrapped = (_event, info) => { try { fn(!!info?.on); } catch (_) {} };
    ipcRenderer.on('shell:feedback-dim', wrapped);
    return () => ipcRenderer.removeListener('shell:feedback-dim', wrapped);
  },
  feedbackDrawState: (has) => ipcRenderer.send('shell:feedback-draw-state', { has: !!has }),
  onFeedbackClearDraw: (fn) => {
    const wrapped = () => { try { fn(); } catch (_) {} };
    ipcRenderer.on('shell:feedback-clear-draw', wrapped);
    return () => ipcRenderer.removeListener('shell:feedback-clear-draw', wrapped);
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  // Finestra incognito: sessione effimera, storage solo in RAM.
  openIncognito: () => ipcRenderer.invoke('window:open-incognito'),
  message: (msg) => ipcRenderer.invoke('filo:message', msg),
  onBroadcast: (fn) => {
    const wrapped = (_event, msg) => { try { fn(msg); } catch (_) {} };
    ipcRenderer.on('filo:broadcast', wrapped);
    return () => ipcRenderer.removeListener('filo:broadcast', wrapped);
  },
  // Account "Accedi con Google". I token vivono nel main process: qui
  // arriva solo il profilo pubblico { email, name, picture }.
  auth: {
    status: (opzioni) => ipcRenderer.invoke('filo:message', { type: 'auth_status', ...(opzioni && opzioni.senzaRete ? { senzaRete: true } : {}) }),
    signIn: () => ipcRenderer.invoke('filo:message', { type: 'auth_signin' }),
    signOut: () => ipcRenderer.invoke('filo:message', { type: 'auth_signout' }),
    onChanged: (fn) => {
      const wrapped = (_event, message) => {
        if (message?.type === 'auth_changed') { try { fn(message); } catch (_) {} }
      };
      ipcRenderer.on('filo:broadcast', wrapped);
      return () => ipcRenderer.removeListener('filo:broadcast', wrapped);
    },
  },
});
