// Handler di dominio: rilevamento siti pericolosi e cookie/consenso.
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

  // Geo-block: l'utente ha accettato la proposta inline (#151) → instrada la tab
  // dal paese indicato. Il tabId arriva dal sender (content script).
  on(MSG.GEO_PROPOSE_ACCEPT, async (msg, sender) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.geoProposeAccept(tabId, msg.country);
  });

  // Geo-block: l'utente ha rifiutato/chiuso la proposta → non riproporla per
  // questo dominio nel tab.
  on(MSG.GEO_PROPOSE_DISMISS, async (msg, sender, origin) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.geoProposeDismiss(tabId, msg.url || origin);
  });

  // Il content script di ogni frame chiede cosa fare sulla pagina. Aperto ai siti di proposito (vedi messages.js):
  // la modalità e le regole sono le stesse per tutti, e il sito vale quello della scheda, non quello del riquadro.
  on(MSG.COOKIES_CONFIG, async (msg, sender, origin) => {
    const Cookies = require('../cookies');
    const settings = await Storage.getSettings();
    const mode = Cookies.getMode(settings);
    if (mode === Cookies.MODES.MANUAL) return { ok: true, mode };
    const topUrl = String((sender && sender.url) || origin || '');
    const off = Cookies.isBannerSiteIn(Cookies.getBannerSites(settings), topUrl);
    const res = { ok: true, mode, off, topUrl };
    if (off) return res;
    res.index = require('../consentRules').detectIndex(topUrl);
    if (msg && msg.frame !== 'sub') {
      let host = '';
      try { host = new URL(topUrl).hostname; } catch (_) {}
      res.cosmetic = host ? require('../cookieBanners').forHost(host) : null;
    }
    return res;
  });

  on(MSG.COOKIES_RULE, async (msg) => {
    const rule = require('../consentRules').getRule(msg && msg.name);
    return rule ? { ok: true, rule } : { ok: false };
  });

  on(MSG.COOKIES_BANNER_TOKENS, async (msg, sender, origin) => {
    let host = '';
    try { host = new URL(String((sender && sender.url) || origin || '')).hostname; } catch (_) {}
    if (!host) return { ok: false };
    const clean = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.length <= 120) : []);
    return { ok: true, selectors: require('../cookieBanners').matchTokens(host, clean(msg && msg.ids), clean(msg && msg.classes)) };
  });

  on(MSG.COOKIES_OUTCOME, async (msg, sender) => {
    const win = winOf(sender);
    const tabId = sender && sender.tab && sender.tab.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    return win._filoTabs.cookieOutcome(tabId, msg && msg.outcome);
  });
};
