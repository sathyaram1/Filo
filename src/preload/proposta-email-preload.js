// Preload della proposta dell'email sotto un campo di un sito (src/renderer/proposta-email.html): lo stato entra,
// escono la scelta, il tasto destro e la misura. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('propostaEmail', {
  onStato: (fn) => {
    ipcRenderer.on('proposta-email:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  scegli: (giro) => ipcRenderer.send('proposta-email:scegli', { giro }),
  menu: (giro, x, y) => ipcRenderer.send('proposta-email:menu', { giro, x, y }),
  misura: (giro, w, h) => ipcRenderer.send('proposta-email:misura', { giro, w, h }),
});
