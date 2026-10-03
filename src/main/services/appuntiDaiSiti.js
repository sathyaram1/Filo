// Chi legge l'elenco della cronologia appunti (dentro ci sono anche le password copiate). Filo sempre; un sito solo
// come lo apre l'utente, col menu Incolla nella scheda che sta guardando e dopo un suo gesto (#589.4).
// Le scritture non rispondono mai con l'elenco. Prova: tests/appunti-dai-siti.spec.mjs.
'use strict';

const { daFilo } = require('./handlers/origine');
const Permessi = require('./permessiPagine');

// Il tasto destro in un riquadro di un altro sito arriva dopo la domanda: millisecondi, non secondi.
const ATTESA_DEL_GESTO_MS = 1000;

/** Chi chiede sta nella scheda in vista della sua finestra (o in una finestra aperta da un sito, se si vede)? */
function mittenteInVista(sender) {
  const win = sender && sender.win;
  try {
    if (!win || (win.isDestroyed && win.isDestroyed())) return false;
    if (win._filoTabs) return Boolean(sender.tab && win._filoTabs.inVista(sender.tab.id));
    return Boolean(win.isVisible && win.isVisible() && !(win.isMinimized && win.isMinimized()));
  } catch (_) { return false; }
}

async function elencoLeggibile(sender, origin) {
  if (daFilo(origin, sender)) return true;
  if (!mittenteInVista(sender)) return false;
  if (!(await Permessi.gestoEntro(sender.wc, ATTESA_DEL_GESTO_MS))) return false;
  return mittenteInVista(sender);
}

module.exports = { elencoLeggibile, mittenteInVista, ATTESA_DEL_GESTO_MS };
