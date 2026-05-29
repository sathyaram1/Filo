// Auto-update via electron-updater.
//
// Funziona SOLO nelle build pacchettizzate (installer NSIS): a ogni avvio
// controlla le GitHub Releases del repo configurato in package.json
// (`build.publish`), scarica in background la versione più recente e la
// applica automaticamente alla chiusura dell'app. Il tester non fa nulla.
//
// In dev (`npm start`/`electron .`) e nei test non c'è un feed di update,
// quindi l'updater è disattivato: lì l'aggiornamento avviene via `git pull`
// del `prestart`.

const { app } = require('electron');

function initAutoUpdater() {
  // Solo build installate: in dev/test non esiste un feed remoto.
  if (!app.isPackaged) return;
  // Non interferire con gli scenari di test/smoke headless.
  if (process.env.FILO_SMOKE || process.env.FILO_USER_DATA) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    // Dipendenza assente (build vecchia): nessun auto-update, ma l'app parte.
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[updater] errore', err ? (err.stack || err).toString() : 'sconosciuto');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update disponibile:', info?.version);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] già aggiornato');
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update scaricato:', info?.version, '— sarà applicato al riavvio');
  });

  autoUpdater.checkForUpdatesAndNotify().catch((e) => {
    console.error('[updater] controllo update fallito:', e?.message || e);
  });
}

module.exports = { initAutoUpdater };
