// Un avviso che DEVE essere visto va nella cornice della finestra, non nella pagina
// davanti, e resta finché non lo si chiude; con una `chiave` sostituisce quello uguale.
// Ritorna false se nessuna finestra era pronta: chi chiama decide se riprovare.

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
        wc.send('shell:toast', { text: testo, opts: chiave ? { durationSec: 0, key: chiave } : { durationSec: 0 } });
        dette++;
      } catch (_) {}
    }
  } catch (_) {}
  return dette > 0;
}

module.exports = { avvisoNellaFinestra };
