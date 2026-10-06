// A chi va la foto di una pagina: al frame principale di una pagina che si vede, e inquadra sé stessa (#589.5). Mai a una
// scheda di sfondo, a un riquadro (avrebbe la pagina che lo ospita) o a un popup, che ripiegava sulla finestra principale.
// Prove: tests/foto-della-pagina.spec.mjs, tests/unit/fotoDellaPagina.test.mjs.
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

module.exports = { paginaDaFotografare, barraDaFotografare };
