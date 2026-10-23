// Preload dello strato del menu (src/pages/menu/): riceve il menu da disegnare e quando sparire, rimanda al main le
// voci scelte. Nient'altro deve poter chiedere al main da qui; quello che vale lo decide lui, col gesto che ha visto.

const { contextBridge, ipcRenderer } = require('electron');

const CANALI = new Set(['esegui', 'incolla', 'scegli', 'togli', 'svuota', 'tastiera', 'rotella', 'conta']);

contextBridge.exposeInMainWorld('strato', {
  onMostra: (fn) => {
    ipcRenderer.on('strato:mostra', (_event, d) => { try { fn(d); } catch (e) { console.error(e); } });
  },
  onAggiorna: (fn) => {
    ipcRenderer.on('strato:aggiorna', (_event, d) => { try { fn(d); } catch (e) { console.error(e); } });
  },
  onVia: (fn) => {
    ipcRenderer.on('strato:via', () => { try { fn(); } catch (_) {} });
  },
  // `destro`: un tasto destro fuori dal menu, che il main rigioca sulla scheda per aprire lì il menu nuovo.
  fuori: (seq, destro) => ipcRenderer.send('strato:fuori', {
    seq: Number(seq) || 0,
    ...(destro ? { destro: { x: Number(destro.x) || 0, y: Number(destro.y) || 0 } } : {}),
  }),
  chiedi: (canale, d) => { if (CANALI.has(canale)) ipcRenderer.send(`strato:${canale}`, d); },
});
