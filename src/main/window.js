// Finestra principale: BrowserWindow che ospita la "shell" del browser
// (tab bar + barra indirizzi + pulsanti) e una serie di WebContentsView,
// una per ogni tab aperto.

const { BrowserWindow } = require('electron');
const path = require('node:path');
const { TabManager } = require('./tabs');

const SHELL_HEIGHT = 88;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 500,
    // Background diverso dal cream della shell così se la WebContentsView
    // non rende vediamo subito un'area di colore diverso (debugging visivo).
    backgroundColor: '#222222',
    title: 'Filo',
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon-128.png'),
    // Chrome-like: la title bar nativa è rimossa, i controlli minimize/maximize/
    // close vivono nella tab-row della shell (vedi src/renderer/shell.html).
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  win.loadURL('filo://shell/shell.html');

  const tabs = new TabManager(win, null, { shellHeight: SHELL_HEIGHT });
  win._filoTabs = tabs;

  // Carica le impostazioni di sicurezza correnti e applicale prima che si apra
  // il primo tab — così la policy WebRTC è già attiva e il popup blocker
  // funziona sul newtab e su qualunque pagina successiva.
  try {
    const Storage = globalThis.SN_STORAGE;
    if (Storage && typeof Storage.getSettings === 'function') {
      Storage.getSettings().then((s) => {
        try { tabs.setSecurity(s?.security || {}); } catch (_) {}
      }).catch(() => {});
    }
  } catch (_) {}

  win.on('resize', () => tabs.layout());
  win.on('enter-full-screen', () => tabs.layout());
  win.on('leave-full-screen', () => tabs.layout());

  win.webContents.once('did-finish-load', () => {
    tabs.openTab('filo://newtab/');
    // Forza display + focus: necessario perché in alcune configurazioni la
    // WebContentsView appena creata può non avere un display surface valido,
    // restando un quadrato bianco/cream finché la finestra non riceve
    // attenzione esplicita dal compositor OS.
    try {
      win.show();
      win.moveTop();
      win.focus();
    } catch (_) {}
  });

  return win;
}

module.exports = { createMainWindow, SHELL_HEIGHT };
