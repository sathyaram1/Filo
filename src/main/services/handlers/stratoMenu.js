// Il menu del tasto destro che un content script descrive per lo strato sopra la scheda (#1054). Aperti ai siti: chi
// apre deve venire dal riquadro del tasto destro appena visto dal main, il resto vale solo per il menu che ha aperto.
// Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const stratoDi = (sender) => {
    if (!sender || !sender.wc) return null;
    // La finestrella di accesso ha il suo strato, e non sta in una finestra di Filo.
    if (!(sender.win && sender.win._filoTabs)) {
      let propria = null;
      try { propria = require('electron').BrowserWindow.fromWebContents(sender.wc); } catch (_) { propria = null; }
      const s = propria && propria.webContents === sender.wc ? propria._filoStrato : null;
      if (s) return s.acceso ? s : null;
    }
    const tabs = winOf(sender)?._filoTabs;
    return tabs && tabs.strato && tabs.strato.acceso ? tabs.strato : null;
  };
  const no = { ok: false };

  on(MSG.STRATO_MENU_APRI, async (msg, sender) => {
    const strato = stratoDi(sender);
    return strato ? strato.apriDa(sender, msg) : no;
  });

  on(MSG.STRATO_MENU_AGGIORNA, async (msg, sender) => {
    const strato = stratoDi(sender);
    return strato ? strato.aggiornaDa(sender, msg) : no;
  });

  on(MSG.STRATO_MENU_CHIUDI, async (msg, sender) => {
    const strato = stratoDi(sender);
    return strato ? strato.chiudiDa(sender, msg) : no;
  });
};
