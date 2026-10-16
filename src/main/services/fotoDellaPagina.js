// A chi va la foto di una pagina, e in che forma: al frame principale di una pagina che si vede, e inquadra sé stessa (#589.5),
// mai a una scheda di sfondo, a un riquadro o a un popup che ripiegava sulla finestra principale. Chi la manda a un modello la chiede leggera.
// Prove: tests/foto-della-pagina.spec.mjs, tests/aiuto-foto-leggera.spec.mjs, tests/unit/fotoDellaPagina.test.mjs.
'use strict';

const { mittenteInVista } = require('./appuntiDaiSiti');

function framePrincipale(sender) {
  const f = sender && sender.frame;
  try { return Boolean(f) && !f.detached && !f.parent; } catch (_) { return false; }
}

/** Il webContents da fotografare per chi chiede, o null. La barra fotografa la scheda in primo piano della sua finestra. */
function paginaDaFotografare(sender) {
  if (sender && sender.isShell) {
    const tm = sender.win && sender.win._filoTabs;
    const tab = tm && tm.tabs.find((t) => t.id === tm.activeId);
    return tab ? tab.view.webContents : null;
  }
  if (!sender || !sender.wc || !framePrincipale(sender) || !mittenteInVista(sender)) return null;
  return sender.wc;
}

/** La finestra di cui fotografare la barra in alto, o null: la chiede la barra stessa o la scheda in vista sotto di lei. */
function barraDaFotografare(sender) {
  const win = sender && sender.win;
  if (!win || !win._filoTabs) return null;
  if (sender.isShell) return win;
  return paginaDaFotografare(sender) ? win : null;
}

// Coi modelli che pagano per risoluzione i pixel fisici costano token, e i MB di una PNG secondi d'invio a ogni passo (#1142).
const QUALITA_LEGGERA = 85;

/** Il fattore di scala dello schermo su cui sta la finestra di chi chiede; 1 se non si sa. */
function fattoreDiScala(sender, screen) {
  try {
    const win = sender && sender.win;
    const schermo = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    const f = Number(schermo && schermo.scaleFactor);
    return Number.isFinite(f) && f > 0 ? f : 1;
  } catch (_) { return 1; }
}

/** La foto riportata ai pixel che l'utente vede (fisici diviso fattore di scala), in JPEG. Null se la foto è vuota. */
function fotoLeggera(img, fattore, qualita = QUALITA_LEGGERA) {
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const f = Number.isFinite(fattore) && fattore > 1 ? fattore : 1;
  const vista = f > 1
    ? img.resize({ width: Math.max(1, Math.round(width / f)), height: Math.max(1, Math.round(height / f)), quality: 'best' })
    : img;
  return 'data:image/jpeg;base64,' + vista.toJPEG(qualita).toString('base64');
}

module.exports = { paginaDaFotografare, barraDaFotografare, fattoreDiScala, fotoLeggera, QUALITA_LEGGERA };
