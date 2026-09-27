// Un avviso che DEVE essere visto va nella cornice della finestra (la striscia
// di notifiche della shell), non nella pagina davanti, e resta finché non lo si
// chiude. Ritorna false se nessuna finestra era pronta: chi chiama decide se riprovare.
// Con una `chiave` l'avviso nuovo prende il posto di quello uguale ancora a schermo.

function avvisoNellaFinestra(testo, { chiave } = {}) {
  let dette = 0;
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      const wc = win.webContents;
      // Una cornice che sta ancora caricando non ascolta ancora.
      if (!wc || wc.isDestroyed?.() || wc.isLoading?.()) continue;
      try {
        wc.send('shell:toast', { text: testo, opts: { durationSec: 0 } });
        dette++;
      } catch (_) {}
    }
  } catch (_) {}
  return dette > 0;
}

module.exports = { avvisoNellaFinestra };
