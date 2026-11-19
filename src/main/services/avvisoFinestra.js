// Un avviso che DEVE essere visto va nella cornice della finestra, non nella pagina
// davanti, e resta finché non lo si chiude (o per `durataSec`); con una `chiave` sostituisce quello uguale.
// Ritorna false se nessuna finestra c'era: chi chiama decide se riprovare. Un avviso d'errore dice `errore`, la
// sua chiave nell'elenco chiuso dei contatori (#1461): si conta quando una finestra l'ha mostrato.

// Una cornice che sta ancora caricando non ascolta ancora: l'avviso le arriva appena ha finito. Senza, un timer scaduto
// mentre Filo riapre la finestra apposta per farsi sentire, o mentre la ricarica, non avvisava nessuno (#2390.1).
const inAttesa = new Map();
function quandoPronta(wc, chiave, invia) {
  let coda = inAttesa.get(wc);
  if (!coda) {
    coda = [];
    inAttesa.set(wc, coda);
    wc.once('did-finish-load', () => {
      inAttesa.delete(wc);
      for (const v of coda) { try { v.invia(); } catch (_) {} }
    });
    wc.once('destroyed', () => inAttesa.delete(wc));
  }
  coda.push({ chiave, invia });
}
// Un `shell:toast` a una cornice, subito o appena ha caricato. `detto`: quando l'ha ricevuto.
function allaCornice(wc, dati, detto) {
  if (!wc || wc.isDestroyed?.()) return false;
  const invia = () => { if (!wc.isDestroyed()) { wc.send('shell:toast', dati); try { detto?.(); } catch (_) {} } };
  if (wc.isLoading?.()) quandoPronta(wc, dati && dati.opts && dati.opts.key, invia);
  else invia();
  return true;
}

// `azioni`: i bottoni del toast nella forma che la cornice capisce (src/renderer/shell.js, per esempio { label, openUrl }).
// La forma (angolo, colonna della home, notifica del sistema) la sceglie ogni shell: `uid` fa dello stesso avviso
// mandato a più finestre una notifica sola. `incognito`: false = solo finestre normali, true = solo incognito.
// `carta`, `icona`, `titolo`: src/renderer/shell.js, segni().
function avvisoNellaFinestra(testo, { chiave, durataSec = 0, azioni, errore = '', tipo = '', carta = '', icona = '', titolo = '', incognito, suono } = {}) {
  let dette = 0;
  let contato = false;
  const visto = () => {
    if (contato || !errore) return;
    contato = true;
    try { globalThis.SN_CONTATORI_MAIN?.erroreVisto(`avviso:${errore}`); } catch (_) {}
  };
  const opts = { durationSec: durataSec, uid: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
  if (chiave) opts.key = chiave;
  // Il tipo per i contatori della finestra (#1470): un errore ha già il suo.
  if (tipo || errore) opts.tipo = tipo || errore;
  if (errore) opts.errore = true;
  if (carta) opts.carta = carta;
  if (icona) opts.icona = icona;
  if (titolo) opts.titolo = titolo;
  if (suono === false) opts.sound = false;
  if (Array.isArray(azioni) && azioni.length) opts.actions = azioni;
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      if (typeof incognito === 'boolean' && !!win._filoIncognito !== incognito) continue;
      try { if (allaCornice(win.webContents, { text: testo, opts }, visto)) dette++; } catch (_) {}
    }
  } catch (_) {}
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
  try { require('./avvisoSistema').ritira(chiave); } catch (_) {}
  for (const coda of inAttesa.values()) {
    for (let i = coda.length - 1; i >= 0; i--) if (coda[i].chiave && coda[i].chiave === chiave) coda.splice(i, 1);
  }
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      try { win.webContents.send('shell:toast', { ritira: String(chiave) }); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = { avvisoNellaFinestra, avvisoQuandoPronta, ritiraAvviso, allaCornice };
