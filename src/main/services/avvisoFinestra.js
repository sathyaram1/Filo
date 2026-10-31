// Un avviso che DEVE essere visto va nella cornice della finestra, non nella pagina
// davanti, e resta finché non lo si chiude (o per `durataSec`); con una `chiave` sostituisce quello uguale.
// Ritorna false se nessuna finestra era pronta: chi chiama decide se riprovare. Un avviso d'errore dice `errore`, la
// sua chiave nell'elenco chiuso dei contatori (#1461): si conta quando una finestra l'ha mostrato.

// `azioni`: i bottoni del toast nella forma che la cornice capisce (src/renderer/shell.js, per esempio { label, openUrl }).
function avvisoNellaFinestra(testo, { chiave, durataSec = 0, azioni, errore = '', tipo = '' } = {}) {
  let dette = 0;
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      const wc = win.webContents;
      // Una cornice che sta ancora caricando non ascolta ancora.
      if (!wc || wc.isDestroyed?.() || wc.isLoading?.()) continue;
      try {
        const opts = { durationSec: durataSec };
        if (chiave) opts.key = chiave;
        // Il tipo per i contatori della finestra (#1470): un errore ha già il suo.
        if (tipo || errore) opts.tipo = tipo || errore;
        if (Array.isArray(azioni) && azioni.length) opts.actions = azioni;
        wc.send('shell:toast', { text: testo, opts });
        dette++;
      } catch (_) {}
    }
  } catch (_) {}
  if (dette > 0 && errore) { try { globalThis.SN_CONTATORI_MAIN?.erroreVisto(`avviso:${errore}`); } catch (_) {} }
  return dette > 0;
}

// Per chi avvisa prima che esista una finestra (la lettura dei dati all'avvio): riprova finché una cornice ascolta.
// `detto` si chiama solo quando una cornice l'ha ricevuto: chi avvisa una volta sola segna lì la volta.
function avvisoQuandoPronta(testo, { chiave, entroMs = 5 * 60 * 1000, detto, azioni, errore = '', tipo = '' } = {}) {
  const ok = () => { try { detto?.(); } catch (_) {} };
  if (avvisoNellaFinestra(testo, { chiave, azioni, errore, tipo })) { ok(); return; }
  const inizio = Date.now();
  const t = setInterval(() => {
    if (avvisoNellaFinestra(testo, { chiave, azioni, errore, tipo })) { clearInterval(t); ok(); }
    else if (Date.now() - inizio > entroMs) clearInterval(t);
  }, 1000);
  t.unref?.();
}

// Toglie dalle cornici l'avviso con questa chiave, quando lo stato che diceva non c'è più.
function ritiraAvviso(chiave) {
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      try { win.webContents.send('shell:toast', { ritira: String(chiave) }); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = { avvisoNellaFinestra, avvisoQuandoPronta, ritiraAvviso };
