// Preload della shell del browser (la finestra principale Filo).
// Espone window.filoShell con API tab-control + IPC verso il main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filoShell', {
  tabs: {
    open: (url) => ipcRenderer.invoke('tabs:open', { url }),
    close: (id) => ipcRenderer.invoke('tabs:close', { id }),
    activate: (id) => ipcRenderer.invoke('tabs:activate', { id }),
    navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', { id, url }),
    back: (id) => ipcRenderer.invoke('tabs:back', { id }),
    forward: (id) => ipcRenderer.invoke('tabs:forward', { id }),
    reload: (id) => ipcRenderer.invoke('tabs:reload', { id }),
    snapshot: () => ipcRenderer.invoke('tabs:snapshot'),
    onUpdate: (fn) => {
      const wrapped = (_event, snapshot) => { try { fn(snapshot); } catch (_) {} };
      ipcRenderer.on('tabs:updated', wrapped);
      return () => ipcRenderer.removeListener('tabs:updated', wrapped);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  message: (msg) => ipcRenderer.invoke('filo:message', msg),
});
