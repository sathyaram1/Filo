// Quando una pagina è davanti agli occhi: chi prende gli avvisi in coda (#1478.1) e la riga del ripiego che conta come
// detta (#662.2) chiedono qui, così le due strade non divergono. Regole: tests/unit/davantiAgliOcchi.test.mjs.
'use strict';

// La scheda attiva della sua finestra (non la home pronta in riserva), con la finestra davanti. Il fuoco può stare
// sulla barra delle schede, non sulla pagina: `fuoco` è quello che dice la pagina, e basta l'uno o l'altro.
function mittenteDavanti(sender, fuoco) {
  const win = sender && sender.win;
  const tm = win && win._filoTabs;
  if (!(tm && sender.tab && !sender.riserva && tm.activeId === sender.tab.id)) return false;
  if (fuoco === true) return true;
  try { return Boolean(!win.isDestroyed() && win.isFocused()); } catch (_) { return false; }
}

// La pagina della scheda attiva nella finestra di Filo che ha il fuoco, o null (Filo dietro un'altra applicazione).
function schedaDavanti(finestre) {
  let wins = finestre;
  if (!wins) { try { wins = require('electron').BrowserWindow.getAllWindows(); } catch (_) { wins = []; } }
  for (const win of wins || []) {
    try {
      if (!win || win.isDestroyed() || !win.isFocused() || !win._filoTabs) continue;
      const tm = win._filoTabs;
      const tab = (tm.tabs || []).find((t) => t.id === tm.activeId);
      const wc = tab && tab.view && tab.view.webContents;
      if (wc && !wc.isDestroyed()) return wc;
    } catch (_) {}
  }
  return null;
}

module.exports = { mittenteDavanti, schedaDavanti };
