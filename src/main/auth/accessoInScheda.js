// Una pagina d'accesso di Google aperta in una scheda della finestra normale (#1123), seguita fino alla fine: dice a
// chi l'ha aperta se l'utente la chiude o se Google rifiuta l'accesso lì dentro. L'esito dell'accesso non lo decide.
// Il riconoscimento del rifiuto sta in rifiutoGoogle.js.

'use strict';

const { rifiutoDiGoogle } = require('./rifiutoGoogle');

function hostDi(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (_) { return ''; }
}

// L'accesso va nelle schede normali: in incognito i cookie di Google sparirebbero con la finestra.
function finestraNormale() {
  const { BrowserWindow } = require('electron');
  const buona = (w) => {
    try { return !!w && !w.isDestroyed() && !!w._filoTabs && !w._filoIncognito; } catch (_) { return false; }
  };
  const davanti = BrowserWindow.getFocusedWindow();
  if (buona(davanti)) return davanti;
  // Il menu dell'account è una finestrella figlia: conta la finestra sotto.
  try { const madre = davanti && davanti.getParentWindow(); if (buona(madre)) return madre; } catch (_) {}
  return BrowserWindow.getAllWindows().find(buona) || null;
}

// `hostAccesso`: dove Google mostra i suoi rifiuti. `fino(url)`: vero quando la scheda è arrivata dove l'accesso
// finisce, e da lì non si segue più. `finestra`: quella da cui è partito il gesto, se è normale.
// Torna null se nessuna finestra normale può aprire la scheda.
function apri(url, { hostAccesso = hostDi(url), suChiusa, suRifiuto, fino, finestra = null } = {}) {
  let win = finestra;
  try { if (!win || win.isDestroyed() || !win._filoTabs || win._filoIncognito) win = finestraNormale(); } catch (_) { win = finestraNormale(); }
  if (!win) return null;
  const tabs = win._filoTabs;
  const id = tabs.openTab(url, { activate: true });
  if (!id) return null;
  let finita = false;
  const smetti = () => {
    if (finita) return;
    finita = true;
    tabs.sorveglia(id, null);
    try { win.removeListener('closed', suFinestraChiusa); } catch (_) {}
  };
  const suFinestraChiusa = () => { if (!finita) { smetti(); if (suChiusa) suChiusa(); } };
  win.once('closed', suFinestraChiusa);
  tabs.sorveglia(id, (evento, dati) => {
    if (finita) return;
    if (evento === 'chiusa') { smetti(); if (suChiusa) suChiusa(); return; }
    const u = dati && dati.url;
    if (fino && evento === 'naviga' && fino(u)) { smetti(); return; }
    // Una pagina di Google che non si carica è un vicolo cieco come il rifiuto: si ripiega uguale.
    const motivo = evento === 'fallita' ? (hostDi(u) === hostAccesso ? 'rete' : null) : rifiutoDiGoogle(u, hostAccesso);
    if (!motivo) return;
    smetti();
    try { tabs.chiudiDiServizio(id); } catch (_) {}
    if (suRifiuto) suRifiuto(motivo);
  });
  return {
    id,
    // Riporta davanti la scheda ancora aperta; false se non c'è più da seguire.
    riporta() {
      if (finita || win.isDestroyed() || !tabs.tabs.some((t) => t.id === id)) return false;
      try { if (win.isMinimized()) win.restore(); win.focus(); } catch (_) {}
      tabs.activate(id);
      return true;
    },
    chiudi() {
      const aperta = !finita;
      smetti();
      if (aperta && !win.isDestroyed()) { try { tabs.chiudiDiServizio(id); } catch (_) {} }
    },
  };
}

module.exports = { apri, finestraNormale };
