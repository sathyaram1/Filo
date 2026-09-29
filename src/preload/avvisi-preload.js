// Preload della vista degli avvisi sopra la pagina (src/renderer/avvisi.html): riceve lo stato,
// dice quanto è grande e riporta i clic. Nient'altro: la vista non deve poter chiedere altro al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avvisi', {
  onStato: (fn) => {
    ipcRenderer.on('avvisi:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  misura: (w, h) => ipcRenderer.send('avvisi:misura', { w, h }),
  clic: (id, azione) => ipcRenderer.send('avvisi:clic', { id, azione }),
});
