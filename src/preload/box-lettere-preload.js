// Preload del box delle lettere del doppio Ctrl (src/main/boxDelleLettere.js): le voci arrivano dal main, la scelta, la
// lettera cambiata e la chiusura tornano lì. `giro` è il numero del box mostrato: il main scarta ciò che arriva da uno passato.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boxLettere', {
  scegli: (id, giro) => ipcRenderer.send('box-lettere:scegli', String(id == null ? '' : id), Number(giro)),
  assegna: (id, lettera, giro) => ipcRenderer.send('box-lettere:assegna', String(id == null ? '' : id), String(lettera == null ? '' : lettera), Number(giro)),
  chiudi: (giro) => ipcRenderer.send('box-lettere:chiudi', Number(giro)),
  pronto: (giro) => ipcRenderer.send('box-lettere:pronto', Number(giro)),
  onVoci: (fn) => { ipcRenderer.on('box-lettere:voci', (_e, dati) => fn(dati)); },
});
