// Preload del fumetto dei pulsanti della barra (src/main/popup-tooltip.js): il testo entra, la misura esce.
// Nient'altro deve poter chiedere al main, e la pagina non ha Node (#834).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fumetto', {
  onTesto: (fn) => ipcRenderer.on('set', (_event, dati) => { try { fn(dati || {}); } catch (_) {} }),
  misura: (dati) => ipcRenderer.send('size', dati),
});
