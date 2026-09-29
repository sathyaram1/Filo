// Preload della vista degli avvisi sopra la pagina (src/renderer/avvisi.html): riceve lo stato, dice
// quanto è grande, riporta i clic e chiede il suggerimento della X. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avvisi', {
  onStato: (fn) => {
    ipcRenderer.on('avvisi:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  misura: (w, h) => ipcRenderer.send('avvisi:misura', { w, h }),
  clic: (id, azione) => ipcRenderer.send('avvisi:clic', { id, azione }),
  // Testo vuoto lo nasconde.
  suggerimento: (testo, x, y) => ipcRenderer.send('avvisi:suggerimento', { testo: testo || '', x, y }),
});
