// Shortcut globali — equivalente di chrome.commands ma a livello OS.
// Alt+E/T/S/H replicano i 4 comandi dell'estensione, ma valgono ovunque
// (anche con Filo in background).
//
// Quando uno shortcut si attiva, mandiamo un broadcast 'shortcut:triggered'
// alla webContents del tab attivo: il preload page-preload.js lo intercetta
// e lo gira al content script come MSG.SHORTCUT_TRIGGERED, identico al
// vecchio comportamento extension.

const { globalShortcut, BrowserWindow } = require('electron');

const COMMANDS = {
  'Alt+E': 'explain-selection',
  'Alt+T': 'translate-selection',
  'Alt+S': 'save-for-later',
  'Alt+H': 'open-help-sidebar',
};

function registerShortcuts(window) {
  for (const [accel, command] of Object.entries(COMMANDS)) {
    try {
      const ok = globalShortcut.register(accel, () => dispatch(command, window));
      if (!ok) console.warn('[Filo] shortcut non registrato:', accel);
    } catch (e) {
      console.warn('[Filo] register shortcut failed', accel, e);
    }
  }
}

function dispatch(command, window) {
  // Manda al webContents della tab attiva. Se è una pagina interna senza
  // content script, nessuno raccoglie: ok, è il comportamento atteso.
  const win = window || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win || !win._filoTabs) return;
  const active = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
  if (!active) return;

  if (command === 'save-for-later') {
    // Comportamento speciale: salva via servizio + chiude il tab.
    saveForLater(win, active).catch((e) => console.warn('[Filo] save-for-later failed', e));
    return;
  }
  try { active.view.webContents.send('shortcut:triggered', { command }); } catch (_) {}
}

async function saveForLater(win, tab) {
  const { handleMessage } = require('./services/handlers');
  // Chiediamo metadata al content script (best-effort), poi catturiamo thumbnail.
  let extra = {};
  try {
    extra = await tab.view.webContents.executeJavaScript(
      '(window.__sn_collectSavePayload && window.__sn_collectSavePayload()) || {}',
      true,
    );
  } catch (_) { /* tab senza content script */ }
  let thumbnail = '';
  try {
    const img = await tab.view.webContents.capturePage();
    thumbnail = img.resize({ width: 320 }).toDataURL();
  } catch (_) {}
  await handleMessage({
    type: globalThis.SN_MSG.MSG.SAVE_PAGE,
    page: {
      url: tab.url, title: tab.title,
      favicon: tab.favicon || extra.favicon,
      thumbnail,
      description: extra.description,
      excerpt: extra.excerpt,
    },
  });
  try { win._filoTabs.closeTab(tab.id); } catch (_) {}
}

module.exports = { registerShortcuts };
