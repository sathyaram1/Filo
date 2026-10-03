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

  function vistaDellaScheda(sender) {
    const win = winOf(sender);
    const tab = win && win._filoTabs && Array.isArray(win._filoTabs.tabs)
      ? win._filoTabs.tabs.find((t) => t.view && t.view.webContents === sender.wc)
      : null;
    return tab ? { win, view: tab.view } : null;
  }

  on(MSG.AD_SKIP_CLICK, async (msg, sender) => {
    if (!AdSkip.attivo(await impostazioni())) return { ok: false, code: 'off' };
    const modo = AdSkip.modoClicVero(sender);
    if (!modo) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const dove = vistaDellaScheda(sender);
    if (!dove) return { ok: false, code: 'scheda' };
    if (modo === 'riquadro') return AdSkip.richiestaDalRiquadro(sender, msg);
    return AdSkip.clicVero(sender.wc, msg, dove);
  });

  // La pagina che ospita il lettore di YouTube dice dove cade il «Salta» nella sua vista: risponde solo il suo content script.
  on(MSG.AD_SKIP_FRAME_POINT, async (msg, sender) => {
    if (!AdSkip.attivo(await impostazioni())) return { ok: false, code: 'off' };
    const p = AdSkip.puntoDalPadre(sender, msg);
    if (!p) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const dove = vistaDellaScheda(sender);
    if (!dove) return { ok: false, code: 'scheda' };
    return AdSkip.clicNelRiquadro(sender.wc, p, dove);
  });
};
