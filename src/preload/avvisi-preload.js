// Preload della vista degli avvisi sopra la pagina (src/renderer/avvisi.html): riceve lo stato, dice
// quanto è grande, riporta clic, tasto destro e puntatore sopra le carte, chiede il suggerimento della X e
// rigira alla scheda i gesti caduti nel vuoto. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avvisi', {
  onStato: (fn) => {
    ipcRenderer.on('avvisi:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  misura: (w, h) => ipcRenderer.send('avvisi:misura', { w, h }),
  clic: (id, azione) => ipcRenderer.send('avvisi:clic', { id, azione }),
  // Testo vuoto lo nasconde.
  suggerimento: (testo, x, y) => ipcRenderer.send('avvisi:suggerimento', { testo: testo || '', x, y }),
  menu: (id, x, y) => ipcRenderer.send('avvisi:menu', { id, x, y }),
  sopra: (on) => ipcRenderer.send('avvisi:sopra', { sopra: !!on }),
  inoltra: (gesto) => ipcRenderer.send('avvisi:inoltra', gesto),
  onCursore: (fn) => {
    ipcRenderer.on('avvisi:cursore', (_event, forma) => { try { fn(forma); } catch (_) {} });
  },
});
