// Preload della shell: espone window.filoShell (tab, download, finestra, account).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filoShell', {
  // 'darwin' | 'win32' | 'linux': serve alla barra per nominare il tasto giusto
  // nei suggerimenti (su Mac è Cmd, non Ctrl). Dato del sistema, non dell'utente.
  sistema: process.platform,
  tabs: {
    open: (url) => ipcRenderer.invoke('tabs:open', { url }),
    close: (id) => ipcRenderer.invoke('tabs:close', { id }),
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
    // Proxy per-tab: nella UI è "Apri da un altro paese".
    setProxy: (id, country, tier) => ipcRenderer.invoke('tabs:set-proxy', { id, country, tier }),
    clearProxy: (id) => ipcRenderer.invoke('tabs:clear-proxy', { id }),
    proxyStatus: () => ipcRenderer.invoke('tabs:proxy-status'),
  },
  // I `type` corrispondono a MSG.* in src/shared/messages.js.
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
  // Il velo del box feedback non copre la barra in alto: se la oscura la shell.
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
