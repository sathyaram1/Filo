// Chi tocca la cronologia appunti (dentro ci sono anche le password copiate). Filo sempre; un sito legge l'elenco solo
// dal riquadro dove l'utente ha appena aperto il menu, nella scheda che guarda, e scrive solo dopo un suo gesto (#589.4).
// Le scritture non rispondono mai con l'elenco. Prove: tests/appunti-dai-siti.spec.mjs, tests/unit/appuntiDaiSiti.test.mjs.
'use strict';

const { daFilo } = require('./handlers/origine');
const Permessi = require('./permessiPagine');

// La domanda del menu arriva prima del segnale di Chromium che il menu è stato aperto: millisecondi, non secondi.
const ATTESA_DEL_MENU_MS = 1000;
// Una copia d'immagine si registra dopo la sua descrizione, che chiede secondi a un modello: largo apposta.
const SCRITTURA_DOPO_IL_GESTO_MS = 60000;

/** Chi chiede sta nella scheda in vista della sua finestra (o in una finestra aperta da un sito, se si vede)? */
function mittenteInVista(sender) {
  const win = sender && sender.win;
  try {
    if (!win || (win.isDestroyed && win.isDestroyed())) return false;
    if (win._filoTabs) return Boolean(sender.tab && win._filoTabs.inVista(sender.tab.id));
    return Boolean(win.isVisible && win.isVisible() && !(win.isMinimized && win.isMinimized()));
  } catch (_) { return false; }
}

/** Il menu vero (non un evento della pagina) è stato aperto da poco proprio nel riquadro, e nel documento, che chiede? */
function menuApertoQui(sender) {
  const m = sender && sender.wc && sender.wc._filoMenuAperto;
  const f = sender && sender.frame;
  if (!m || !f || m.nodo == null || Date.now() - m.alle >= Permessi.GESTO_MS) return false;
  try {
    if (f.detached) return false;
    return f.frameTreeNodeId === m.nodo && f.origin === m.origine;
  } catch (_) { return false; }
}

// Una raffica di domande dallo stesso riquadro aspetta una volta sola.
function menuEntro(sender, attesaMs) {
  if (menuApertoQui(sender)) return Promise.resolve(true);
  const wc = sender && sender.wc;
  let nodo = null;
  try { nodo = sender && sender.frame ? sender.frame.frameTreeNodeId : null; } catch (_) {}
  if (!wc || nodo == null) return Promise.resolve(false);
  const attese = wc._filoAttesaMenu || (wc._filoAttesaMenu = new Map());
  if (attese.has(nodo)) return attese.get(nodo);
  const fine = Date.now() + Math.max(0, Number(attesaMs) || 0);
  const attesa = new Promise((resolve) => {
    const guarda = () => {
      if (menuApertoQui(sender)) { resolve(true); return; }
      let morta = false;
      try { morta = Boolean(wc.isDestroyed && wc.isDestroyed()); } catch (_) { morta = true; }
      if (morta || Date.now() >= fine) { resolve(false); return; }
      setTimeout(guarda, 20);
    };
    setTimeout(guarda, 20);
  });
  attese.set(nodo, attesa);
  attesa.then(() => { if (attese.get(nodo) === attesa) attese.delete(nodo); });
  return attesa;
}

async function elencoLeggibile(sender, origin) {
  if (daFilo(origin, sender)) return true;
  if (!mittenteInVista(sender)) return false;
  if (!(await menuEntro(sender, ATTESA_DEL_MENU_MS))) return false;
  return mittenteInVista(sender);
}

/** Aggiungere, togliere, svuotare: da un sito solo dopo un gesto dell'utente su quella scheda (copia, voce del menu). */
function scritturaAmmessa(sender, origin, voce) {
  if (daFilo(origin, sender)) return true;
  const t = sender && sender.wc && sender.wc._filoGestoAlle;
  if (!(t && Date.now() - t < SCRITTURA_DOPO_IL_GESTO_MS)) return false;
  // Dallo sfondo passa solo la copia d'immagine che arriva con la sua descrizione, a scheda già cambiata.
  return mittenteInVista(sender) || Boolean(voce && voce.type === 'image');
}

module.exports = { elencoLeggibile, scritturaAmmessa, mittenteInVista, menuApertoQui, ATTESA_DEL_MENU_MS, SCRITTURA_DOPO_IL_GESTO_MS };
