// Preload della vista dell'avviso del sito pericoloso (src/renderer/avviso-sito.html): lo stato entra, escono la
// scelta dei pulsanti e il punto del tasto destro. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avvisoSito', {
  onStato: (fn) => {
    ipcRenderer.on('avviso-sito:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  scelta: (scheda, scelta, testo) => ipcRenderer.send('avviso-sito:scelta', { scheda, scelta, testo: testo || '' }),
  menu: (scheda, x, y) => ipcRenderer.send('avviso-sito:menu', { scheda, x, y }),
});
