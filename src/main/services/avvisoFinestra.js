// Un avviso che DEVE essere visto va nella cornice della finestra, non nella pagina
// davanti, e resta finché non lo si chiude (o per `durataSec`); con una `chiave` sostituisce quello uguale.
// Ritorna false se nessuna finestra era pronta: chi chiama decide se riprovare.

function avvisoNellaFinestra(testo, { chiave, durataSec = 0 } = {}) {
  let dette = 0;
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      const wc = win.webContents;
      // Una cornice che sta ancora caricando non ascolta ancora.
      if (!wc || wc.isDestroyed?.() || wc.isLoading?.()) continue;
      try {
        wc.send('shell:toast', { text: testo, opts: chiave ? { durationSec: durataSec, key: chiave } : { durationSec: durataSec } });
        dette++;
      } catch (_) {}
    }
  } catch (_) {}
  return dette > 0;
}

// Per chi avvisa prima che esista una finestra (la lettura dei dati all'avvio): riprova finché una cornice ascolta.
// `detto` si chiama solo quando una cornice l'ha ricevuto: chi avvisa una volta sola segna lì la volta.
function avvisoQuandoPronta(testo, { chiave, entroMs = 5 * 60 * 1000, detto } = {}) {
  const ok = () => { try { detto?.(); } catch (_) {} };
  if (avvisoNellaFinestra(testo, { chiave })) { ok(); return; }
  const inizio = Date.now();
  const t = setInterval(() => {
    if (avvisoNellaFinestra(testo, { chiave })) { clearInterval(t); ok(); }
    else if (Date.now() - inizio > entroMs) clearInterval(t);
  }, 1000);
  t.unref?.();
}

module.exports = { avvisoNellaFinestra, avvisoQuandoPronta };
