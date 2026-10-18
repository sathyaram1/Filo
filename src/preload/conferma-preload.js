// Preload della vista delle conferme sopra un sito (src/renderer/conferma.html): riceve la domanda,
// rimanda la risposta e i tasti per il campo di chi scriveva nella pagina. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('conferma', {
  onMostra: (fn) => {
    ipcRenderer.on('conferma:mostra', (_event, richiesta) => { try { fn(richiesta); } catch (_) {} });
  },
  onVia: (fn) => {
    ipcRenderer.on('conferma:via', () => { try { fn(); } catch (_) {} });
  },
  esito: (id, ok) => ipcRenderer.send('conferma:esito', { id, ok: ok === true }),
  tasto: (id, tasto) => ipcRenderer.send('conferma:tasto', { id, tasto: String(tasto || '') }),
});
