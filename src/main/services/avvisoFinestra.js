// Un avviso che DEVE essere visto va nella cornice della finestra, non nella pagina
// davanti, e resta finché non lo si chiude (o per `durataSec`); con una `chiave` sostituisce quello uguale.
// Ritorna false se nessuna finestra era pronta: chi chiama decide se riprovare.

// Una cornice che sta ancora caricando non ascolta ancora.
function cornicePronta(win) {
  if (!win || win.isDestroyed?.() || !win._filoTabs) return null;
  const wc = win.webContents;
  return wc && !wc.isDestroyed?.() && !wc.isLoading?.() ? wc : null;
}

function manda(wc, testo, { chiave, durataSec = 0, azioni } = {}) {
  try {
    const opts = { durationSec: durataSec };
    if (chiave) opts.key = chiave;
    if (Array.isArray(azioni) && azioni.length) opts.actions = azioni;
    wc.send('shell:toast', { text: testo, opts });
    return true;
  } catch (_) { return false; }
}

// `azioni`: i bottoni del toast nella forma che la cornice capisce (src/renderer/shell.js, per esempio { label, openUrl }).
function avvisoNellaFinestra(testo, opzioni = {}) {
  let dette = 0;
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      const wc = cornicePronta(win);
      if (wc && manda(wc, testo, opzioni)) dette++;
    }
  } catch (_) {}
  return dette > 0;
}

// Un avviso di Filo che non riguarda la pagina davanti (allegati non saliti, chiave, crediti, fornitore escluso): nella
// cornice della finestra davanti, perché nel documento di un sito il sito lo leggerebbe (#1509). Nessuna davanti: tutte.
function avvisoDiFilo(testo, { durataSec = 8, ...opzioni } = {}) {
  try {
    const { BrowserWindow } = require('electron');
    const wc = cornicePronta(BrowserWindow.getFocusedWindow());
    if (wc && manda(wc, testo, { ...opzioni, durataSec })) return true;
  } catch (_) {}
  return avvisoNellaFinestra(testo, { ...opzioni, durataSec });
}

// Per chi avvisa prima che esista una finestra (la lettura dei dati all'avvio): riprova finché una cornice ascolta.
// `detto` si chiama solo quando una cornice l'ha ricevuto: chi avvisa una volta sola segna lì la volta.
function avvisoQuandoPronta(testo, { chiave, entroMs = 5 * 60 * 1000, detto, azioni } = {}) {
  const ok = () => { try { detto?.(); } catch (_) {} };
  if (avvisoNellaFinestra(testo, { chiave, azioni })) { ok(); return; }
  const inizio = Date.now();
  const t = setInterval(() => {
    if (avvisoNellaFinestra(testo, { chiave, azioni })) { clearInterval(t); ok(); }
    else if (Date.now() - inizio > entroMs) clearInterval(t);
  }, 1000);
  t.unref?.();
}

module.exports = { avvisoNellaFinestra, avvisoDiFilo, avvisoQuandoPronta };
