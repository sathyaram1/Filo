// Le scorciatoie GLOBALI: valgono in tutto il sistema, anche con Filo in background.
// Si consegnano alla scheda attiva come 'shortcut:triggered', che il preload gira al
// content script.

const { globalShortcut, BrowserWindow } = require('electron');

const COMMANDS = {
  'Alt+E': 'explain-selection',
  'Alt+T': 'translate-selection',
  'Alt+S': 'save-for-later',
  'Alt+H': 'open-help-sidebar',
};

// Su Mac Alt è Opzione e SCRIVE: una scorciatoia globale con Alt lo toglierebbe a ogni
// programma, quindi ci va un Ctrl davanti. Regola in CLAUDE.md § Mac.
function acceleratorePerPiattaforma(accel) {
  return process.platform === 'darwin' ? `Control+${accel}` : accel;
}

function registerShortcuts(window) {
  for (const [accel, command] of Object.entries(COMMANDS)) {
    const reale = acceleratorePerPiattaforma(accel);
    try {
      const ok = globalShortcut.register(reale, () => dispatch(command, window));
      if (!ok) console.warn('[Filo] shortcut non registrato:', reale);
    } catch (e) {
      console.warn('[Filo] register shortcut failed', reale, e);
    }
  }
}

// L'URL serve alle schede in transizione, dove `isInternal` non è ancora aggiornato.
function isInternalTab(tab) {
  if (!tab) return false;
  return !!tab.isInternal || String(tab.url || '').startsWith('filo://');
}

function dispatch(command, window) {
  // Su una pagina interna senza content script nessuno raccoglie: è atteso.
  const win = window || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win || !win._filoTabs) return;
  const active = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
  if (!active) return;

  if (command === 'save-for-later') {
    // Una pagina filo:// non va salvata né chiusa: l'uscita è esplicita perché questo comando,
    // a differenza degli altri, agisce comunque.
    if (isInternalTab(active)) return;
    saveForLater(win, active).catch((e) => console.warn('[Filo] save-for-later failed', e));
    return;
  }
  const wc = active.view.webContents;
  // #405 — la selezione può stare in un riquadro incorporato, e `webContents.send` parla solo
  // col frame principale: questi comandi vanno all'ultimo frame toccato dall'utente.
  const SELECTION_COMMANDS = new Set(['explain-selection', 'translate-selection']);
  let target = wc;
  if (SELECTION_COMMANDS.has(command)) {
    try {
      const frame = wc._filoActiveFrame;
      if (frame && !frame.detached) target = frame;
    } catch (_) { target = wc; }
  }
  try { target.send('shortcut:triggered', { command }); } catch (_) {
    try { wc.send('shortcut:triggered', { command }); } catch (_) {}
  }
}

async function saveForLater(win, tab) {
  const { handleMessage } = require('./services/handlers');
  // #334 — url e titolo si leggono SUBITO, prima di ogni await: se la pagina naviga mentre
  // raccogliamo metadata e miniatura, salveremmo l'altra.
  const url = tab.url;
  const title = tab.title;
  const favicon = tab.favicon || '';
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
      url, title,
      favicon: favicon || extra.favicon,
      thumbnail,
      description: extra.description,
      excerpt: extra.excerpt,
    },
  });
  try { win._filoTabs.closeTab(tab.id); } catch (_) {}
}

module.exports = { registerShortcuts, dispatch, saveForLater, isInternalTab, acceleratorePerPiattaforma, COMMANDS };
