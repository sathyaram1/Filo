// Preload minimale per il popup menu custom della shell.
// Espone un'unica funzione: select(url) che notifica il main della scelta.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  select: (url) => ipcRenderer.send('popup-menu:select', url),
});
