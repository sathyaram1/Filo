// Handler di dominio: rilevamento siti pericolosi e config cookie.
// Il verdetto safebrowse vive nel TabManager (per tab: bypass/dismiss); qui
// inoltriamo alla finestra MITTENTE così l'overlay/banner agisce sul tab giusto.

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

  on(MSG.COOKIES_CONFIG, async () => {
    // Il content script chiede la modalità corrente per decidere se rifiutare
    // i banner CMP e riscrivere gli embed YouTube. È una config globale, non
    // per-tab (settings.security.cookies.mode).
    const settings = await Storage.getSettings();
    return { ok: true, mode: require('../cookies').getMode(settings) };
  });
};
