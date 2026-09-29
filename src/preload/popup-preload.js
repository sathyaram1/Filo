// Preload minimale per il popup menu custom della shell: select(url) notifica
// il main della scelta, close() chiude il menu senza sceglierne nessuna (Esc).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  select: (url) => ipcRenderer.send('popup-menu:select', url),
  close: () => ipcRenderer.send('popup-menu:close'),
});
