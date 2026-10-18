// Preload del menu a comparsa (src/main/popup-menu.js): le voci arrivano dal main, la scelta e la chiusura tornano lì.
// `giro` è il numero del menu mostrato: il main scarta ciò che arriva da un menu già passato.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  select: (valore, giro) => ipcRenderer.send('popup-menu:select', String(valore == null ? '' : valore), Number(giro)),
  close: (giro) => ipcRenderer.send('popup-menu:close', Number(giro)),
  pronto: (giro) => ipcRenderer.send('popup-menu:pronto', Number(giro)),
  vuoto: (giro) => ipcRenderer.send('popup-menu:vuoto', Number(giro)),
  onVoci: (fn) => { ipcRenderer.on('popup-menu:voci', (_e, dati) => fn(dati)); },
});
