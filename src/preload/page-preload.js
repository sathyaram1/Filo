// Preload per le pagine web (ogni WebContentsView non-internal).
//
// STATUS: minimale. In questa fase espone solo lo strato IPC + il hook
// shortcut → finestra. L'iniezione dei content script completi (menu tasto
// destro, popup, sidebar, highlight, spellcheck, feedback) viene wired
// in un passo successivo: i file di src/content/* e src/shared/* hanno
// l'IIFE pattern e si caricano via require(), ma vanno verificati uno per
// uno contro lo shim chrome.* per non rompere il broadcast bidirezionale.
//
// Per la chiusura del refactor questo file caricherà tutta la catena.

const { contextBridge, ipcRenderer } = require('electron');

// Espose un namespace minimale al main world (la pagina) per debug/manualità.
contextBridge.exposeInMainWorld('filo', {
  message: (msg) => ipcRenderer.invoke('filo:message', msg),
});

// Riceve shortcut globali (Alt+E/T/S/H) dispatchati dal main process via
// shortcut:triggered. Per ora li log soltanto — quando le content script
// saranno injectate, qui faremo `window.dispatchEvent(new CustomEvent(...))`
// o invocheremo direttamente il loro entry point.
ipcRenderer.on('shortcut:triggered', (_event, { command }) => {
  try { window.dispatchEvent(new CustomEvent('filo:shortcut', { detail: { command } })); } catch (_) {}
});

// Hook usato dal main shortcut save-for-later per estrarre metadata dalla
// pagina. Verrà rimpiazzato dai content script veri quando saranno wired.
window.__sn_collectSavePayload = () => {
  try {
    const desc = document.querySelector('meta[name="description"]')?.content
      || document.querySelector('meta[property="og:description"]')?.content || '';
    const favicon = document.querySelector('link[rel*="icon"]')?.href || '';
    const excerpt = (document.body?.innerText || '').slice(0, 600);
    return { description: desc, favicon, excerpt };
  } catch (_) { return {}; }
};
