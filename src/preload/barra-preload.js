// Preload della barra laterale (src/renderer/barra.html, #871): riceve lo stato e riporta i gesti
// dell'utente (spinta sul bordo, clic, trascinamenti, puntatore dentro o fuori, gesti del vuoto).
// Nient'altro deve poter chiedere al main: le azioni sono id che il main riconosce, o niente.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  posa: manda('barra:posa'),
  // I gesti caduti nel vuoto della vista (ombra, fasce sopra e sotto il pannello): li rigira il main alla scheda.
  inoltra: manda('barra:inoltra'),
  onCursore: (fn) => {
    ipcRenderer.on('barra:cursore', (_event, forma) => { try { fn(forma); } catch (_) {} });
  },
  chiedi: manda('barra:chiedi'),
  // #1623 — le immagini lasciate sulla barra: { voci: [{ nome, percorso } | { nome, dataUrl }] }.
  rilascio: manda('barra:rilascio'),
  percorsoDelFile: (f) => { try { return (webUtils && webUtils.getPathForFile(f)) || ''; } catch (_) { return ''; } },
});
