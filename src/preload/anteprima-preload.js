// Preload della carta di anteprima delle schede (src/renderer/anteprima.html): le foto e la carta da mostrare
// entrano, le misure e «sono vuota» escono. Nient'altro deve poter chiedere al main.

const { contextBridge, ipcRenderer } = require('electron');

const ascolta = (canale) => (fn) => {
  ipcRenderer.on(canale, (_event, dati) => { try { fn(dati); } catch (_) {} });
};

contextBridge.exposeInMainWorld('anteprima', {
  onImmagine: ascolta('anteprima:immagine'),
  onDimentica: ascolta('anteprima:dimentica'),
  onMostra: ascolta('anteprima:mostra'),
  onNascondi: ascolta('anteprima:nascondi'),
  misura: (n, w, h) => ipcRenderer.send('anteprima:misura', { n, w, h }),
  vuota: () => ipcRenderer.send('anteprima:vuota'),
});
