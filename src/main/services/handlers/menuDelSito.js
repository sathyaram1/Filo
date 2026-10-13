// Handler del menu che un sito ha per il tasto destro (#975). Aprire e cambiare sono aperti ai siti di proposito: li
// chiede il content script dal menu di Filo, e il sito lo ricava services/menuDelSito.js dal mittente.

const { soloFilo } = require('./origine');
const MenuDelSito = require('../menuDelSito');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;

  function vistaDellaScheda(sender) {
    const win = winOf(sender);
    const tab = win && win._filoTabs && Array.isArray(win._filoTabs.tabs)
      ? win._filoTabs.tabs.find((t) => t.view && t.view.webContents === sender.wc)
      : null;
    return { win, view: tab ? tab.view : null };
  }

  on(MSG.MENU_DEL_SITO_APRI, async (msg, sender) => MenuDelSito.apri(msg, sender, vistaDellaScheda(sender)));
  on(MSG.MENU_DEL_SITO_CAMBIA, async (msg, sender) => MenuDelSito.cambia(msg, sender));
  on(MSG.MENU_DEL_SITO_ACCETTA, soloFilo(async (msg) => MenuDelSito.accetta(msg)));
};
