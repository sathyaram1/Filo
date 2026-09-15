// Auto-update via electron-updater, solo nelle build pacchettizzate (in dev e
// nei test non c'è feed). Su Mac l'INSTALLAZIONE fallisce finché non c'è un
// certificato Apple: prevista, ma non deve essere silenziosa (vedi più sotto).

const { app } = require('electron');

function initAutoUpdater() {
  if (!app.isPackaged) return;
  // Test e smoke headless: niente traffico di rete né riavvii a sorpresa.
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

  // Un errore PRIMA di aver trovato una versione nuova (rete assente, feed
  // irraggiungibile) non riguarda l'utente e non va scritto da nessuna parte.
  let versioneTrovata = null;

  autoUpdater.on('error', (err) => {
    console.error('[updater] errore', err ? (err.stack || err).toString() : 'sconosciuto');
    avvisaSeAggiornamentoBloccato(versioneTrovata);
  });
  autoUpdater.on('update-available', (info) => {
    versioneTrovata = info?.version || null;
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
    avvisaSeAggiornamentoBloccato(versioneTrovata);
  });
}

// Un aggiornamento che non si installa e tace lascia l'utente su una versione
// vecchia per sempre: su Mac lo scriviamo fra le notifiche. Solo su Mac e solo
// con una versione trovata (altrove è rumore), e una sola scheda per versione.
async function avvisaSeAggiornamentoBloccato(versione) {
  if (process.platform !== 'darwin' || !versione) return;
  try {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.addNotification) return;
    // Il riconoscimento passa da `action`, che la scheda NON mostra: un
    // marcatore dentro al testo lo leggerebbe l'utente.
    const gia = await FiloMem.listNotifications({ includeDismissed: true });
    if (gia.some((n) => n.action?.tipo === 'aggiornamento-mac' && n.action?.versione === versione)) return;
    await FiloMem.addNotification({
      kind: 'alert',
      action: { tipo: 'aggiornamento-mac', versione },
      text: `C'è la versione ${versione} di Filo, ma su Mac non riesce a installarsi da sola.\n`
        + 'Scaricala da filo.red e sostituisci l\'app. Ci vuole un minuto.',
    });
  } catch (e) {
    console.error('[updater] avviso aggiornamento non scritto:', e?.message || e);
  }
}

module.exports = { initAutoUpdater, avvisaSeAggiornamentoBloccato };
