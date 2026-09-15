// Preload minimale per il popup menu custom della shell.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  select: (url) => ipcRenderer.send('popup-menu:select', url),
});
