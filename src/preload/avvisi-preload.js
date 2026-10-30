// Preload della vista degli avvisi sopra la pagina (src/renderer/avvisi.html): riceve lo stato, dice
// quanto è grande, riporta clic, tasto destro, trascinamento e puntatore sopra le carte, chiede il suggerimento
// della X e rigira alla scheda i gesti caduti nel vuoto. Nient'altro deve poter chiedere al main.

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
  // «+N», Riduci, Chiudi tutti: i comandi della pila intera, e il loro tasto destro.
  pila: (azione) => ipcRenderer.send('avvisi:pila', { azione }),
  menuPila: (x, y) => ipcRenderer.send('avvisi:menu', { pila: true, x, y }),
  sopra: (on) => ipcRenderer.send('avvisi:sopra', { sopra: !!on }),
  inoltra: (gesto) => ipcRenderer.send('avvisi:inoltra', gesto),
  // #588.8 — trascinare la carta di un file arrivato: il file lo sceglie il main dalla carta, non da qui.
  trascina: (id) => ipcRenderer.send('avvisi:trascina', { id }),
  onCursore: (fn) => {
    ipcRenderer.on('avvisi:cursore', (_event, forma) => { try { fn(forma); } catch (_) {} });
  },
});
