// Preload della barra laterale (src/renderer/barra.html, #871): riceve lo stato e riporta i gesti
// dell'utente (spinta sul bordo, clic, trascinamenti, puntatore dentro o fuori). Nient'altro
// deve poter chiedere al main: le azioni sono id che il main riconosce, o niente.

const { contextBridge, ipcRenderer } = require('electron');

const manda = (canale) => (dati) => ipcRenderer.send(canale, dati == null ? {} : dati);

contextBridge.exposeInMainWorld('barra', {
  onStato: (fn) => {
    ipcRenderer.on('barra:stato', (_event, stato) => { try { fn(stato); } catch (_) {} });
  },
  pronta: manda('barra:pronta'),
  spinta: manda('barra:spinta'),
  apri: manda('barra:apri'),
  dentro: manda('barra:dentro'),
  fuori: manda('barra:fuori'),
  chiudi: manda('barra:chiudi'),
  azione: manda('barra:azione'),
  sistema: manda('barra:sistema'),
  menu: manda('barra:menu'),
  suggerimento: manda('barra:suggerimento'),
  misure: manda('barra:misure'),
  posa: manda('barra:posa'),
  trascinaFuori: manda('barra:trascina-fuori'),
});
