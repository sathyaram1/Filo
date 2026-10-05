// Handler di dominio: rilevamento siti pericolosi e cookie/consenso.
// Il verdetto safebrowse vive nel TabManager (per scheda: bypass e chiusura); i pulsanti dell'avviso non passano di
// qui ma dalla sua vista (src/main/avvisoSito.js): una pagina non può confermarsi da sola.

const { soloFilo } = require('./origine');

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

  // Un campo password o carta a schermo, nella pagina o in un suo riquadro: vale per la pagina della scheda, che dà il
  // main (sender.url), mai il riquadro. Chi si dichiara delicato può solo mandare meno ai modelli (#1004).
  on(MSG.CAMPI_DELICATI, async (msg, sender) => {
    const win = winOf(sender);
    if (!win || !win._filoTabs || !sender?.tab?.id || !sender.url) return { ok: false };
    if (!msg || !(msg.hasPassword || msg.hasPayment)) return { ok: true };
    await globalThis.SN_DELICATE?.segnaCampi(sender.url, { incognito: !!win._filoTabs.incognito })?.catch?.(() => {});
    return { ok: true };
  });

  on(MSG.PAGINE_DELICATE_CAMPI, soloFilo(async () => {
    const D = globalThis.SN_DELICATE;
    const PD = globalThis.SN_PAGINE_DELICATE;
    const segnati = D ? await D.elencoCampi() : [];
    const tolti = PD ? PD.nonDelicati(await Storage.getSettings()) : [];
    const siti = [...new Set([...segnati, ...tolti])].sort().map((sito) => ({ sito, tolto: tolti.includes(sito) }));
    return { ok: true, siti };
  }));

  // La home aperta dal tasto destro sull'avviso del sito pericoloso prende la domanda o la segnalazione che il main le
  // ha lasciato (#813.5). Solo pagine di Filo: un sito non deve poter leggere né consumare la richiesta.
  on(MSG.CASA_RICHIESTA, soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    const tabId = sender?.tab?.id;
    if (!win || !win._filoTabs || !tabId) return { ok: true, richiesta: null };
    return { ok: true, richiesta: win._filoTabs.richiestaCasa(tabId) };
  }));

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

  // La pagina Sicurezza mostra il riquadro «da un altro paese» solo se la funzione
  // esiste: la stessa domanda che fanno il tasto destro e la chat (#771).
  on(MSG.PROXY_STATUS, soloFilo(async () => {
    const ProxyTab = require('../proxyTab');
    let settings = null;
    try { settings = await Storage.getSettings(); } catch (_) {}
    return { ok: true, configured: ProxyTab.isConfigured(settings), providerHost: ProxyTab.providerHost(settings) };
  }));

  // Il content script di ogni frame chiede cosa fare sulla pagina. Aperto ai siti di proposito (vedi messages.js):
  // la modalità e le regole sono le stesse per tutti, e il sito vale quello della scheda, non quello del riquadro.
  on(MSG.COOKIES_CONFIG, async (msg, sender, origin) => {
    const Cookies = require('../cookies');
    const settings = await Storage.getSettings();
    const mode = Cookies.getMode(settings);
    if (mode === Cookies.MODES.MANUAL) return { ok: true, mode };
    const topUrl = String((sender && sender.url) || origin || '');
    const win = winOf(sender);
    const hold = !!(win && win._filoTabs && sender.tab && win._filoTabs.cookieHold(sender.tab.id));
    const off = hold || Cookies.isBannerSiteIn(Cookies.getBannerSites(settings), topUrl);
    const res = { ok: true, mode, off, topUrl };
    if (off) return res;
    res.seen = win && win._filoTabs ? win._filoTabs.cookieSeen(topUrl) : null;
    res.index = require('../consentRules').detectIndex(topUrl);
    if (msg && msg.frame !== 'sub') {
      let host = '';
      try { host = new URL(topUrl).hostname; } catch (_) {}
      res.cosmetic = host ? require('../cookieBanners').forHost(host) : null;
    }
    return res;
  });

  on(MSG.COOKIES_SITES, async (msg, sender, origin) => {
    if (!String(origin || '').startsWith('filo://')) return { ok: false, error: 'forbidden' };
    const win = winOf(sender);
    if (!win || !win._filoTabs) return { ok: true, sites: [] };
    return { ok: true, sites: win._filoTabs.cookieSites() };
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

  // Il riquadro che l'ha detto può stare più giù nell'albero: la pagina vede solo il suo figlio diretto.
  on(MSG.COOKIES_FRAME_BANNER, async (msg, sender) => {
    const wc = sender && sender.wc;
    const frame = sender && sender.frame;
    const top = wc && !wc.isDestroyed() && wc.mainFrame;
    const same = (a, b) => a === b || !!(a && b && a.frameTreeNodeId === b.frameTreeNodeId);
    if (!top || !frame || same(frame, top)) return { ok: false };
    let f = frame;
    while (f.parent && !same(f.parent, top)) f = f.parent;
    if (!f.parent) return { ok: false };
    try {
      top.send('filo:broadcast', { type: MSG.COOKIES_HIDE_FRAME, url: String(f.url || ''), origin: String(f.origin || '') });
    } catch (_) { return { ok: false }; }
    return { ok: true };
  });

  on(MSG.COOKIES_OUTCOME, async (msg, sender) => {
    const win = winOf(sender);
    const tabId = sender && sender.tab && sender.tab.id;
    if (!win || !win._filoTabs || !tabId) return { ok: false };
    // La risposta del sito la guarda solo la pagina: un riquadro non sceglie quali cookie del sito togliere.
    if (msg && msg.outcome === 'answer') {
      const top = sender.wc && !sender.wc.isDestroyed() && sender.wc.mainFrame;
      if (!top || !sender.frame || sender.frame.frameTreeNodeId !== top.frameTreeNodeId) return { ok: false };
    }
    return win._filoTabs.cookieOutcome(tabId, msg && msg.outcome, msg);
  });
};
