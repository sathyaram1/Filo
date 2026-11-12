// Preload della pillola dello schermo pieno (src/renderer/schermo-pieno.html): la frase entra; escono misura, clic,
// tasto destro, puntatore sopra e i gesti del vuoto rigirati alla pagina. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('schermoPieno', {
  onStato: (fn) => {
    ipcRenderer.on('schermo-pieno:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  misura: (giro, w, h) => ipcRenderer.send('schermo-pieno:misura', { giro, w, h }),
  clic: (giro) => ipcRenderer.send('schermo-pieno:clic', { giro }),
  menu: (giro, x, y) => ipcRenderer.send('schermo-pieno:menu', { giro, x, y }),
  sopra: (giro, on) => ipcRenderer.send('schermo-pieno:sopra', { giro, sopra: !!on }),
  inoltra: (gesto) => ipcRenderer.send('schermo-pieno:inoltra', gesto),
  onCursore: (fn) => {
    ipcRenderer.on('schermo-pieno:cursore', (_event, forma) => { try { fn(forma); } catch (_) {} });
  },
});
