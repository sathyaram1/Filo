// Preload dello strato del menu (src/pages/menu/): riceve dove aprirsi e quando sparire, rimanda il clic fuori.
// Nient'altro deve poter chiedere al main da qui.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('strato', {
  onMostra: (fn) => {
    ipcRenderer.on('strato:mostra', (_event, d) => { try { fn(d); } catch (_) {} });
  },
  onVia: (fn) => {
    ipcRenderer.on('strato:via', () => { try { fn(); } catch (_) {} });
  },
  fuori: (seq) => ipcRenderer.send('strato:fuori', { seq: Number(seq) || 0 }),
});
