// Auto-update via electron-updater.
//
// Funziona SOLO nelle build pacchettizzate: a ogni avvio controlla le GitHub
// Releases del repo configurato in package.json (`build.publish`), scarica in
// background la versione più recente e la applica automaticamente alla
// chiusura dell'app. Il tester non fa nulla.
//
// In dev (`npm start`/`electron .`) e nei test non c'è un feed di update,
// quindi l'updater è disattivato: lì l'aggiornamento avviene via `git pull`
// del `prestart`.
//
// SU MAC L'INSTALLAZIONE PUÒ NON RIUSCIRE, ED È PREVISTO
//   Il controllo e lo scaricamento funzionano ovunque (nella release c'è
//   `latest-mac.yml` accanto a `latest.yml`). L'INSTALLAZIONE su Mac la fa un
//   meccanismo di sistema che pretende una firma vera, rilasciata da Apple:
//   Filo per ora ha solo una firma locale, che cambia a ogni build, e quel
//   meccanismo la rifiuta.
//
//   Il difetto grave non sarebbe il fallimento: sarebbe il SILENZIO. Un
//   aggiornamento che non si installa e non lo dice lascia l'utente fermo su
//   una versione vecchia per sempre, convinto di essere aggiornato. Quindi
//   quando su Mac l'aggiornamento inciampa, lo scriviamo fra le notifiche: si
//   scarica a mano, una volta, e si va avanti. Quando arriverà un certificato
//   Apple questo ripiego diventa inutile e si toglie.

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

  // La versione trovata sul feed, se ce n'è una più nuova di quella in uso.
  // Serve al ripiego qui sotto: un errore PRIMA di aver trovato un
  // aggiornamento (feed irraggiungibile, rete assente) non riguarda l'utente e
  // non va scritto da nessuna parte.
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

// Scrive fra le notifiche che c'è una versione nuova e va presa a mano.
//
// Solo su Mac, e solo se una versione nuova ESISTE davvero: altrove
// l'aggiornamento si installa da sé e un avviso sarebbe rumore; senza una
// versione trovata l'errore è del controllo, non dell'installazione, e non
// cambia niente per l'utente.
//
// Una notifica per versione: se l'app riparte dieci volte prima che l'utente
// scarichi, la scheda resta una. Chi l'ha già scartata non se la ritrova.
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
