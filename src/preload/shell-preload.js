// Preload della shell del browser (la finestra principale Filo).
// Espone window.filoShell con API tab-control + IPC verso il main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filoShell', {
  // Su quale sistema gira Filo: 'darwin' (Mac), 'win32' (Windows), 'linux'.
  // Serve alla barra in alto per NON mentire — il suggerimento del pulsante
  // "Nuova scheda" nomina un tasto, e su Mac quel tasto è un altro. È un dato
  // pubblico del sistema, non un'informazione dell'utente.
  sistema: process.platform,
  tabs: {
    open: (url) => ipcRenderer.invoke('tabs:open', { url }),
    close: (id) => ipcRenderer.invoke('tabs:close', { id }),
    activate: (id) => ipcRenderer.invoke('tabs:activate', { id }),
    navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', { id, url }),
    move: (id, toIndex) => ipcRenderer.invoke('tabs:move', { id, toIndex }),
    reserveTop: (px) => ipcRenderer.invoke('tabs:reserve-top', { px }),
    // "La pagina comincia almeno a questa altezza" (coordinate della shell).
    reserveFloor: (px) => ipcRenderer.invoke('tabs:reserve-floor', { px }),
    setChromeCompact: (on) => ipcRenderer.invoke('tabs:set-chrome-compact', { on }),
    back: (id) => ipcRenderer.invoke('tabs:back', { id }),
    forward: (id) => ipcRenderer.invoke('tabs:forward', { id }),
    reload: (id) => ipcRenderer.invoke('tabs:reload', { id }),
    // Menu tasto destro su tab: muta/riattiva audio (toggle se muted è omesso)
    // e duplica.
    setMuted: (id, muted) => ipcRenderer.invoke('tabs:set-muted', { id, muted }),
    duplicate: (id) => ipcRenderer.invoke('tabs:duplicate', { id }),
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
    openBlockedPopup: (url) => ipcRenderer.invoke('tabs:open-blocked-popup', { url }),
    // Proxy per-tab ("Apri da un altro paese") + stato (configurato, location).
    setProxy: (id, country, tier) => ipcRenderer.invoke('tabs:set-proxy', { id, country, tier }),
    clearProxy: (id) => ipcRenderer.invoke('tabs:clear-proxy', { id }),
    proxyStatus: () => ipcRenderer.invoke('tabs:proxy-status'),
  },
  // Scaricamenti della navigazione (#410.1): la shell legge la cronologia,
  // comanda i singoli download e riceve gli aggiornamenti di avanzamento dal
  // main via il canale 'shell:download'. I type dei messaggi corrispondono a
  // MSG.* in src/shared/messages.js.
  downloads: {
    list: () => ipcRenderer.invoke('filo:message', { type: 'downloads_list' }),
    clear: () => ipcRenderer.invoke('filo:message', { type: 'downloads_clear' }),
    remove: (id) => ipcRenderer.invoke('filo:message', { type: 'download_remove', id }),
    openFile: (id) => ipcRenderer.invoke('filo:message', { type: 'download_open_file', id }),
    openFolder: (id) => ipcRenderer.invoke('filo:message', { type: 'download_open_folder', id }),
    cancel: (id) => ipcRenderer.invoke('filo:message', { type: 'download_cancel', id }),
    pause: (id) => ipcRenderer.invoke('filo:message', { type: 'download_pause', id }),
    resume: (id) => ipcRenderer.invoke('filo:message', { type: 'download_resume', id }),
    // Aggiornamenti live: { kind:'start'|'progress'|'done'|'error', item }
    onEvent: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('shell:download', wrapped);
      return () => ipcRenderer.removeListener('shell:download', wrapped);
    },
  },
  // Permessi che i siti chiedono (#586): il main manda la richiesta, la shell
  // mostra la pastiglia "<sito> vuole usare la fotocamera" e risponde. Il main
  // chiude la pastiglia da solo (canale `permissions:closed`) quando la pagina
  // se ne va, la scheda muore o l'attesa scade — in tutti quei casi NEGA.
  permissions: {
    onRequest: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:request', wrapped);
      return () => ipcRenderer.removeListener('permissions:request', wrapped);
    },
    onClosed: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:closed', wrapped);
      return () => ipcRenderer.removeListener('permissions:closed', wrapped);
    },
    answer: (id, scelta, ricorda) => ipcRenderer.invoke('permissions:answer', { id, scelta, ricorda }),
    forOrigin: (origine) => ipcRenderer.invoke('permissions:for-origin', { origine }),
    revoke: (origine, chiave) => ipcRenderer.invoke('permissions:revoke', { origine, chiave }),
    // Quale schermo o finestra condividere, dopo il «Consenti» sulla cattura.
    onPickSource: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:pick-source', wrapped);
      return () => ipcRenderer.removeListener('permissions:pick-source', wrapped);
    },
    onSourceClosed: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:source-closed', wrapped);
      return () => ipcRenderer.removeListener('permissions:source-closed', wrapped);
    },
    pickSource: (id, fonteId, audio) => ipcRenderer.invoke('permissions:pick-source', { id, fonteId, audio }),
    // Il segno che un sito può vedere lo schermo, mentre può vederlo. Parte
    // quando la fonte viene consegnata e finisce quando la pagina se ne va,
    // muore, o si preme «Interrompi».
    onCaptureStart: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:capture-start', wrapped);
      return () => ipcRenderer.removeListener('permissions:capture-start', wrapped);
    },
    onCaptureEnd: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:capture-end', wrapped);
      return () => ipcRenderer.removeListener('permissions:capture-end', wrapped);
    },
    stopCapture: (id) => ipcRenderer.invoke('permissions:capture-stop', { id }),
    dismissCapture: (id) => ipcRenderer.invoke('permissions:capture-dismiss', { id }),
    // Una riga che Filo deve a chi naviga, senza niente da consentire: oggi
    // solo «non riesco a sapere dove sei» (#586).
    onNotice: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:notice', wrapped);
      return () => ipcRenderer.removeListener('permissions:notice', wrapped);
    },
    onNoticeEnd: (fn) => {
      const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
      ipcRenderer.on('permissions:notice-end', wrapped);
      return () => ipcRenderer.removeListener('permissions:notice-end', wrapped);
    },
    dismissNotice: (id) => ipcRenderer.invoke('permissions:notice-dismiss', { id }),
  },
  popupMenu: (entries, x, y) => ipcRenderer.invoke('shell:popup-menu', { entries, x, y }),
  // Scelta di una voce di menu con `action` custom (vedi popup-menu.js).
  onMenuAction: (fn) => {
    const wrapped = (_event, action) => { try { fn(action); } catch (_) {} };
    ipcRenderer.on('shell:menu-action', wrapped);
    return () => ipcRenderer.removeListener('shell:menu-action', wrapped);
  },
  // L'agente "Aiuto" può azionare i comandi rapidi della barra (le icone in
  // alto) chiedendo al main, che inoltra qui: la shell clicca il bottone reale.
  onTriggerButton: (fn) => {
    const wrapped = (_event, info) => { try { fn(info && info.command); } catch (_) {} };
    ipcRenderer.on('shell:trigger-button', wrapped);
    return () => ipcRenderer.removeListener('shell:trigger-button', wrapped);
  },
  tooltipShow: (text, x, y) => ipcRenderer.send('shell:tooltip-show', { text, x, y }),
  tooltipHide: () => ipcRenderer.send('shell:tooltip-hide'),
  // §2.3 — toast informativo (es. "Tab riordinate e salvate in cronologia").
  onToast: (fn) => {
    const wrapped = (_event, info) => { try { fn(info); } catch (_) {} };
    ipcRenderer.on('shell:toast', wrapped);
    return () => ipcRenderer.removeListener('shell:toast', wrapped);
  },
  // Modalità annotazione del box feedback: la shell mette/toglie un velo
  // d'ombra sopra la propria barra in alto così tutto Filo va in penombra.
  onFeedbackDim: (fn) => {
    const wrapped = (_event, info) => { try { fn(!!info?.on); } catch (_) {} };
    ipcRenderer.on('shell:feedback-dim', wrapped);
    return () => ipcRenderer.removeListener('shell:feedback-dim', wrapped);
  },
  // Disegno annotazione sulla barra in alto: la shell segnala al main se ha
  // tratti (per sincronizzare il box) e riceve l'ordine di cancellarli.
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
  // Apre una nuova finestra incognito (sessione effimera + storage in RAM).
  openIncognito: () => ipcRenderer.invoke('window:open-incognito'),
  message: (msg) => ipcRenderer.invoke('filo:message', msg),
  // Broadcast generici main→shell (es. SETTINGS_UPDATED per i token estetici).
  onBroadcast: (fn) => {
    const wrapped = (_event, msg) => { try { fn(msg); } catch (_) {} };
    ipcRenderer.on('filo:broadcast', wrapped);
    return () => ipcRenderer.removeListener('filo:broadcast', wrapped);
  },
  // Account "Accedi con Google". I token vivono nel main process: qui
  // arriva solo il profilo pubblico { email, name, picture }.
  auth: {
    status: () => ipcRenderer.invoke('filo:message', { type: 'auth_status' }),
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
