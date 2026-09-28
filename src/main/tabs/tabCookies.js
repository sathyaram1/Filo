// Cosa ha fatto Filo col banner dei cookie di una scheda, e la scelta «mostra il banner» per quel sito.
// Mixin di TabManager come tabGeoBlock.js; l'esito lo manda il content script (src/content/cookies.js),
// il menu che lo mostra è quello del tasto destro sulla scheda (src/renderer/shell.js).

const Cookies = require('../services/cookies');

// Chiavi della memoria della pagina che i CMP usano per ricordarsi la risposta (stessa idea di isConsentName).
const WIPE_STORAGE_JS = `(() => {
  const re = /(consent|euconsent|cookielaw|optanon|onetrust|didomi|cookiebot|_sp_|cmp|cmplz|borlabs|iub|usercentrics|uc_|osano|truste|cookieyes|cky|gdpr|tcf|klaro|axeptio|tarteaucitron|cookie)/i;
  for (const st of [localStorage, sessionStorage]) {
    try { for (const k of Object.keys(st)) if (re.test(k)) st.removeItem(k); } catch (_) {}
  }
})()`;

function isWeb(url) { return /^https?:/i.test(String(url || '')); }

const cookieMethods = {
  // Esito arrivato da un frame della scheda: vale per il sito della pagina, non per quello del riquadro.
  cookieOutcome(tabId, outcome) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !isWeb(tab.url) || (outcome !== 'rejected' && outcome !== 'hidden')) return { ok: false };
    const site = Cookies.registrableOf(tab.url);
    if (!site) return { ok: false };
    const prev = tab.cookieOutcome && tab.cookieOutcome.site === site ? tab.cookieOutcome : { site, rejected: false, hidden: false };
    if (prev[outcome]) { tab.cookieOutcome = prev; return { ok: true }; }
    tab.cookieOutcome = { ...prev, [outcome]: true };
    this._broadcast();
    return { ok: true };
  },

  // Una pagina nuova dello stesso sito tiene l'esito (il sito ricorda il rifiuto e il banner non torna); un altro sito no.
  _cookieOnNavigate(tab, url) {
    if (!tab.cookieOutcome) return;
    if (!isWeb(url) || Cookies.registrableOf(url) !== tab.cookieOutcome.site) tab.cookieOutcome = null;
  },

  _cookieState(tab) {
    if (!tab || tab.isInternal || !isWeb(tab.url) || Cookies.currentMode() === Cookies.MODES.MANUAL) return null;
    const shown = Cookies.isBannerSite(tab.url);
    const o = tab.cookieOutcome;
    const same = !!(o && o.site === Cookies.registrableOf(tab.url));
    return { rejected: same && !shown && !!o.rejected, hidden: same && !shown && !!o.hidden, shown };
  },

  // show=true: su questo sito i banner tornano (e il sito dimentica la risposta di Filo); false: Filo riprende a gestirli.
  async setCookieBanners(tabId, show) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || tab.isInternal || !isWeb(tab.url)) return { ok: false, error: 'no_site' };
    const site = Cookies.registrableOf(tab.url);
    if (!site) return { ok: false, error: 'no_site' };
    const Storage = globalThis.SN_STORAGE;
    const settings = await Storage.getSettings();
    const list = Cookies.getBannerSites(settings).filter((d) => d !== site);
    if (show) list.push(site);
    list.sort();
    // Azzerato PRIMA: col ritorno all'automatico la pagina aperta rifiuta subito, e quell'esito deve restare.
    tab.cookieOutcome = null;
    const { applySettingsUpdate } = require('../services/handlers');
    await applySettingsUpdate({ security: { cookies: { bannerSites: list } } });
    const wc = tab.view && tab.view.webContents;
    if (show && wc && !wc.isDestroyed()) {
      try { await Cookies.wipeConsentCookies(wc.session, site); } catch (_) {}
      try { await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: WIPE_STORAGE_JS }]); } catch (_) {}
    }
    this._broadcast();
    this.reload(tab.id);
    return { ok: true, site, shown: !!show };
  },
};

function installCookies(TabManager) {
  Object.assign(TabManager.prototype, cookieMethods);
}

module.exports = { installCookies, WIPE_STORAGE_JS };
