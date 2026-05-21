// Finestra principale: BrowserWindow che ospita la "shell" del browser
// (tab bar + barra indirizzi + pulsanti) e una serie di WebContentsView,
// una per ogni tab aperto.

const { BrowserWindow, WebContentsView } = require('electron');
const path = require('node:path');
const { TabManager } = require('./tabs');

const SHELL_HEIGHT = 88; // altezza della chrome (tab bar + address bar)

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#fdf6ec',
    title: 'Filo',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  // Carichiamo la shell via protocollo filo:// così la stessa CSP/origin
  // logic delle altre pagine interne si applica anche qui.
  win.loadURL('filo://shell/shell.html');

  const tabs = new TabManager(win, { shellHeight: SHELL_HEIGHT });
  win._filoTabs = tabs; // riferimento per gli handler IPC

  win.on('resize', () => tabs.layout());
  win.on('enter-full-screen', () => tabs.layout());
  win.on('leave-full-screen', () => tabs.layout());

  // Tab iniziale = newtab dashboard
  win.webContents.once('did-finish-load', () => {
    tabs.openTab('filo://newtab/');
  });

  return win;
}

module.exports = { createMainWindow, SHELL_HEIGHT };
