// Rilevamento siti pericolosi e config cookie. Il verdetto vive nel TabManager (per tab:
// bypass/dismiss): si inoltra alla finestra MITTENTE, così l'overlay agisce sul tab giusto.

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const Storage = globalThis.SN_STORAGE;

  on(MSG.SAFEBROWSE_GET, async (msg, sender, origin) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: true, level: 'safe', message: null };
    const ctxPage = { hasPassword: !!msg.hasPassword, hasPayment: !!msg.hasPayment };
    return win._filoTabs.safebrowseGet(tabId, msg.url || origin, ctxPage);
  });

  on(MSG.SAFEBROWSE_PROCEED, async (msg, sender, origin) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.safebrowseProceed(tabId, msg.url || origin);
  });

  on(MSG.SAFEBROWSE_DISMISS, async (msg, sender, origin) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.safebrowseDismiss(tabId, msg.url || origin);
  });

  // Geo-block accettato: instrada la tab dal paese indicato; il tabId arriva dal sender.
  on(MSG.GEO_PROPOSE_ACCEPT, async (msg, sender) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.geoProposeAccept(tabId, msg.country);
  });

  // Geo-block: proposta rifiutata o chiusa → non riproporla per questo dominio nel tab.
  on(MSG.GEO_PROPOSE_DISMISS, async (msg, sender, origin) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.geoProposeDismiss(tabId, msg.url || origin);
  });

  on(MSG.COOKIES_CONFIG, async () => {
    // Config globale, non per-tab: il content script la chiede per rifiutare i banner CMP e
    // riscrivere gli embed YouTube.
    const settings = await Storage.getSettings();
    return { ok: true, mode: require('../cookies').getMode(settings) };
  });
};
