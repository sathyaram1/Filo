// Cosa ha fatto Filo col banner dei cookie di una scheda, e la scelta «mostra il banner» per quel sito.
// Mixin di TabManager come tabGeoBlock.js; l'esito lo manda il content script (src/content/cookies.js),
// il menu che lo mostra è quello del tasto destro sulla scheda (src/renderer/shell.js).

const Cookies = require('../services/cookies');

// Chiavi della memoria della pagina che i CMP usano per ricordarsi la risposta (stessa idea di isConsentName).
const WIPE_STORAGE_JS = `(() => {
  const re = /(consent|cookie|optanon|onetrust|didomi|usercentrics|^uc_|_sp_|^cmp|cmplz|borlabs|^_?iub|iubenda|osano|truste|^cky|gdpr|tcf|klaro|axeptio|tarteaucitron)/i;
  for (const st of [localStorage, sessionStorage]) {
    try { for (const k of Object.keys(st)) if (re.test(k)) st.removeItem(k); } catch (_) {}
  }
})()`;

function isWeb(url) { return /^https?:/i.test(String(url || '')); }

// Il sito si ricorda il rifiuto e alla visita dopo il banner non c'è: senza questa memoria per sito, in una
// scheda nuova o dopo un riavvio il menu non direbbe niente e il banner non si potrebbe più rivedere.
// L'incognito tiene la sua sul TabManager della finestra (_cookieSites), mai su disco.
const MAX_REMEMBERED = 5000;
const remembered = new Map();
let saveTimer = null;

function storageKey() {
  const K = globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS;
  return (K && K.COOKIE_SITES) || 'cookieSites';
}

async function loadRemembered() {
  const Storage = globalThis.SN_STORAGE;
  if (!Storage) return;
  let data = null;
  try { data = await Storage.getRaw(storageKey(), null); } catch (_) {}
  if (!data || typeof data !== 'object') return;
  const loaded = Object.entries(data)
    .filter(([site, v]) => site && v && typeof v === 'object' && !remembered.has(site))
    .sort((a, b) => (Number(a[1].at) || 0) - (Number(b[1].at) || 0));
  const fresh = [...remembered];
  remembered.clear();
  for (const [site, v] of loaded) remembered.set(site, { rejected: !!v.rejected, hidden: !!v.hidden, at: Number(v.at) || 0 });
  for (const [site, v] of fresh) remembered.set(site, v);
  trim(remembered);
}

function trim(map) {
  while (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value);
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const Storage = globalThis.SN_STORAGE;
    if (Storage) Storage.setRaw(storageKey(), Object.fromEntries(remembered)).catch(() => {});
  }, 800);
  if (saveTimer.unref) saveTimer.unref();
}

function siteMemory(tm) {
  if (!tm.incognito) return remembered;
  if (!tm._cookieSites) tm._cookieSites = new Map();
  return tm._cookieSites;
}

function rememberOutcome(tm, site, outcome) {
  const map = siteMemory(tm);
  const prev = map.get(site) || { rejected: false, hidden: false };
  map.delete(site);
  map.set(site, { rejected: !!prev.rejected, hidden: !!prev.hidden, [outcome]: true, at: Date.now() });
  trim(map);
  if (map === remembered) saveSoon();
}

function forgetRejected(tm, site) {
  const map = siteMemory(tm);
  const prev = map.get(site);
  if (!prev || !prev.rejected) return;
  map.set(site, { ...prev, rejected: false });
  if (map === remembered) saveSoon();
}

function forgetSite(tm, site) {
  if (tm._cookieSites) tm._cookieSites.delete(site);
  if (!tm.incognito && remembered.delete(site)) saveSoon();
}

const cookieMethods = {
  // Esito arrivato da un frame della scheda: vale per il sito della pagina, non per quello del riquadro.
  // 'unconfirmed': il TCF dice che il consenso c'è ancora, quindi il «rifiutati» ricordato per il sito non vale più.
  cookieOutcome(tabId, outcome) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !isWeb(tab.url) || !['rejected', 'hidden', 'unconfirmed'].includes(outcome)) return { ok: false };
    const site = Cookies.registrableOf(tab.url);
    if (!site) return { ok: false };
    const prev = tab.cookieOutcome && tab.cookieOutcome.site === site ? tab.cookieOutcome : { site, rejected: false, hidden: false };
    if (outcome === 'unconfirmed') {
      forgetRejected(this, site);
      tab.cookieOutcome = { ...prev, rejected: false };
      this._broadcast();
      return { ok: true };
    }
    rememberOutcome(this, site, outcome);
    if (prev[outcome]) { tab.cookieOutcome = prev; return { ok: true }; }
    tab.cookieOutcome = { ...prev, [outcome]: true };
    this._broadcast();
    return { ok: true };
  },

  // Una pagina nuova dello stesso sito tiene l'esito (il sito ricorda il rifiuto e il banner non torna); un altro sito no.
  _cookieOnNavigate(tab, url) {
    tab._cookieHold = false;
    if (!tab.cookieOutcome) return;
    if (!isWeb(url) || Cookies.registrableOf(url) !== tab.cookieOutcome.site) tab.cookieOutcome = null;
  },

  _cookieState(tab) {
    if (!tab || tab.isInternal || !isWeb(tab.url) || Cookies.currentMode() === Cookies.MODES.MANUAL) return null;
    const shown = Cookies.isBannerSite(tab.url);
    const site = Cookies.registrableOf(tab.url);
    const o = tab.cookieOutcome && tab.cookieOutcome.site === site ? tab.cookieOutcome : null;
    const mem = (site && siteMemory(this).get(site)) || null;
    const did = (k) => !shown && !!((o && o[k]) || (mem && mem[k]));
    return { rejected: did('rejected'), hidden: did('hidden'), shown };
  },

  // La pagina che sta per essere ricaricata non deve rispondere al banner nel frattempo: il suo clic
  // scriverebbe una risposta che la pagina nuova troverebbe già data.
  cookieHold(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    return !!(tab && tab._cookieHold);
  },

  // show=true: su questo sito i banner tornano; false: Filo li riprende. In tutti e due i casi il sito
  // dimentica la risposta che aveva (cookies.js, configureFromSettings) e la pagina si ricarica.
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
    tab.cookieOutcome = null;
    forgetSite(this, site);
    tab._cookieHold = true;
    setTimeout(() => { tab._cookieHold = false; }, 15000);
    const { applySettingsUpdate } = require('../services/handlers');
    await applySettingsUpdate({ security: { cookies: { bannerSites: list } } });
    const wc = tab.view && tab.view.webContents;
    if (wc && !wc.isDestroyed()) {
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

module.exports = { installCookies, loadRemembered, WIPE_STORAGE_JS };
