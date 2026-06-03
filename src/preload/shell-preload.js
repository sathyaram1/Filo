// Preload della shell del browser (la finestra principale Filo).
// Espone window.filoShell con API tab-control + IPC verso il main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filoShell', {
  tabs: {
    open: (url) => ipcRenderer.invoke('tabs:open', { url }),
    close: (id) => ipcRenderer.invoke('tabs:close', { id }),
    activate: (id) => ipcRenderer.invoke('tabs:activate', { id }),
    navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', { id, url }),
    reserveTop: (px) => ipcRenderer.invoke('tabs:reserve-top', { px }),
    setChromeCompact: (on) => ipcRenderer.invoke('tabs:set-chrome-compact', { on }),
    back: (id) => ipcRenderer.invoke('tabs:back', { id }),
    forward: (id) => ipcRenderer.invoke('tabs:forward', { id }),
    reload: (id) => ipcRenderer.invoke('tabs:reload', { id }),
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
  },
  popupMenu: (entries, x, y) => ipcRenderer.invoke('shell:popup-menu', { entries, x, y }),
  // Scelta di una voce di menu con `action` custom (vedi popup-menu.js).
  onMenuAction: (fn) => {
    const wrapped = (_event, action) => { try { fn(action); } catch (_) {} };
    ipcRenderer.on('shell:menu-action', wrapped);
    return () => ipcRenderer.removeListener('shell:menu-action', wrapped);
  },
  tooltipShow: (text, x, y) => ipcRenderer.send('shell:tooltip-show', { text, x, y }),
  tooltipHide: () => ipcRenderer.send('shell:tooltip-hide'),
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
