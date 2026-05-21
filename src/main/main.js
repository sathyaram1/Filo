// Filo — entry point del processo main Electron.
// Boota:
//   - protocollo filo:// per pagine interne e asset
//   - finestra principale con shell (tab bar + indirizzo)
//   - manager dei tab basato su WebContentsView
//   - servizi (storage, providers AI, saved pages, ecc.)
//   - shortcut globali

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

// Carica i moduli "shared/background" portati dall'estensione. Si registrano
// tutti su `globalThis` (pattern IIFE preservato dal codice extension), così
// gli altri moduli del main process li trovano via global.
require('./shim/chrome-api');
require('./services/loader');

const { createMainWindow } = require('./window');
const { registerFiloProtocol } = require('./protocol');
const { registerIpcHandlers } = require('./ipc');
const { registerShortcuts } = require('./shortcuts');

// Permette al protocollo filo:// di caricarsi con privilegi standard (CORS
// libero, fetch, ecc.) — deve essere chiamato PRIMA di app.whenReady.
require('./protocol').registerProtocolSchemes();

let mainWindow = null;

app.whenReady().then(async () => {
  await registerFiloProtocol();
  registerIpcHandlers();
  mainWindow = createMainWindow();
  registerShortcuts(mainWindow);

  // Smoke sentinel: in test mode scrivi un marker quando la prima tab è pronta
  // così uno smoke script può verificare il boot senza GUI.
  if (process.env.FILO_SMOKE) {
    const fs = require('node:fs');
    const checkReady = () => {
      const tabs = mainWindow?._filoTabs;
      const ready = tabs && tabs.tabs.length > 0 && tabs.tabs.some((t) => !t.loading);
      if (ready) {
        fs.writeFileSync(process.env.FILO_SMOKE, JSON.stringify({
          ts: new Date().toISOString(),
          tabs: tabs.snapshot(),
        }));
        setTimeout(() => app.quit(), 200);
      } else {
        setTimeout(checkReady, 250);
      }
    };
    setTimeout(checkReady, 500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Single instance: la seconda apertura ridà focus all'esistente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
