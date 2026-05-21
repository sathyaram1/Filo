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
