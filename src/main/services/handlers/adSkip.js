// Handler delle pubblicità dei video da saltare (#737). Aperti ai siti di proposito: li chiede il content script di
// ogni frame, l'interruttore non è un dato dell'utente e il clic vero lo decide services/adSkip.js, non il mittente.

const AdSkip = require('../adSkip');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const Storage = globalThis.SN_STORAGE;

  async function impostazioni() {
    try { return await Storage.getSettings(); } catch (_) { return null; }
  }

  on(MSG.AD_SKIP_CONFIG, async (msg, sender) => {
    const enabled = AdSkip.attivo(await impostazioni());
    return { ok: true, enabled, clicVero: enabled && AdSkip.mittenteConClicVero(sender) };
  });

  on(MSG.AD_SKIP_CLICK, async (msg, sender) => {
    if (!AdSkip.attivo(await impostazioni())) return { ok: false, code: 'off' };
    if (!AdSkip.mittenteConClicVero(sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const win = winOf(sender);
    const tab = win && win._filoTabs && Array.isArray(win._filoTabs.tabs)
      ? win._filoTabs.tabs.find((t) => t.view && t.view.webContents === sender.wc)
      : null;
    if (!tab) return { ok: false, code: 'scheda' };
    return AdSkip.clicVero(sender.wc, msg, { win, view: tab.view });
  });
};
