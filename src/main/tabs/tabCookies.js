// Cosa ha fatto Filo col banner dei cookie di una scheda, e la scelta «mostra il banner» per quel sito.
// Mixin di TabManager come tabGeoBlock.js; l'esito lo manda il content script (src/content/cookies.js),
// il menu che lo mostra è quello del tasto destro sulla scheda (src/renderer/shell.js).

const Cookies = require('../services/cookies');
const Sito = require('../services/stessoSito');

// Chiavi della memoria della pagina che i CMP usano per ricordarsi la risposta (stessa idea di isConsentName),
// più quelle che il clic sul banner ha creato. La stessa regola la applica il preload (takeCookieWipe).
const STORAGE_ANSWER = /(consent|cookie|optanon|onetrust|didomi|usercentrics|^uc_|_sp_|^cmp|cmplz|borlabs|^_?iub|iubenda|osano|truste|^cky|gdpr|tcf|klaro|axeptio|tarteaucitron)/i;

function wipeStorageJs(keys) {
  const extra = JSON.stringify(Array.isArray(keys) ? keys.map(String) : []);
  return `(() => {
  const re = new RegExp(${JSON.stringify(STORAGE_ANSWER.source)}, 'i');
  const extra = new Set(${extra});
  for (const st of [localStorage, sessionStorage]) {
    try { for (const k of Object.keys(st)) if (re.test(k) || extra.has(k)) st.removeItem(k); } catch (_) {}
  }
})()`;
}

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
  for (const [site, v] of loaded) {
    remembered.set(site, { rejected: !!v.rejected, hidden: !!v.hidden, at: Number(v.at) || 0, ...answerField(v.answer), ...wipeField(v.wipe) });
  }
  for (const [site, v] of fresh) remembered.set(site, v);
  trim(remembered);
}

function trim(map) {
  while (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value);
}

// Sul disco va solo quello che il sito stesso tiene oltre la sessione: in Privacy i siti non fidati no (#754).
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const Storage = globalThis.SN_STORAGE;
    const kept = [...remembered].filter(([site]) => Cookies.keepsSiteData(site));
    if (Storage) Storage.setRaw(storageKey(), Object.fromEntries(kept)).catch(() => {});
  }, 800);
  if (saveTimer.unref) saveTimer.unref();
}
Cookies.setConfigChangeHandler(saveSoon);
// Il jar Privacy del sito è stato buttato: il sito non si ricorda più niente, e nemmeno Filo di lui.
Cookies.setJarWipeHandler((site) => { if (!Cookies.keepsSiteData(site)) remembered.delete(site); });

function siteMemory(tm) {
  if (!tm.incognito) return remembered;
  if (!tm._cookieSites) tm._cookieSites = new Map();
  return tm._cookieSites;
}

// La risposta del sito (nomi di cookie e di chiavi della pagina), tenuta col resto della memoria del sito.
const MAX_ANSWER = 40;
// Cambiati nello stesso momento ma non sono la risposta: toglierli farebbe uscire l'utente o svuoterebbe il carrello.
const NOT_AN_ANSWER = /(sess|sid|auth|token|login|logged|jwt|csrf|xsrf|account|user|cart|basket|carrello|wishlist)/i;
function cleanNames(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => typeof n === 'string' && n && n.length <= 200 && !NOT_AN_ANSWER.test(n))
    .slice(0, MAX_ANSWER);
}
function answerField(a) {
  const cookies = cleanNames(a && a.cookies);
  const storage = cleanNames(a && a.storage);
  return cookies.length || storage.length ? { answer: { cookies, storage } } : {};
}

// La memoria della pagina da svuotare della risposta, origine per origine, alla prossima pagina del sito.
function wipeField(w) {
  if (!w || typeof w !== 'object') return {};
  const done = (Array.isArray(w.done) ? w.done : []).filter((o) => typeof o === 'string' && o.length <= 300).slice(-50);
  return { wipe: { keys: cleanNames(w.keys), done } };
}

function rememberOutcome(tm, site, outcome) {
  const map = siteMemory(tm);
  const prev = map.get(site) || { rejected: false, hidden: false };
  map.delete(site);
  map.set(site, { rejected: !!prev.rejected, hidden: !!prev.hidden, [outcome]: true, at: Date.now(), ...answerField(prev.answer), ...wipeField(prev.wipe) });
  trim(map);
  if (map === remembered) saveSoon();
}

function rememberAnswer(tm, site, cookies, storage) {
  const map = siteMemory(tm);
  const prev = map.get(site) || { rejected: false, hidden: false, at: Date.now() };
  const old = prev.answer || { cookies: [], storage: [] };
  const merged = answerField({
    cookies: [...new Set([...old.cookies, ...cleanNames(cookies)])],
    storage: [...new Set([...old.storage, ...cleanNames(storage)])],
  });
  map.set(site, { ...prev, ...merged });
  trim(map);
  if (map === remembered) saveSoon();
}

// Tutte le risposte note per il sito, nel profilo normale e negli incognito aperti: i nomi sono del sito.
function answerFor(site) {
  const out = { cookies: new Set(), storage: new Set() };
  const add = (v) => { if (v && v.answer) { for (const n of v.answer.cookies) out.cookies.add(n); for (const n of v.answer.storage) out.storage.add(n); } };
  add(remembered.get(site));
  try {
    const { BrowserWindow } = require('electron');
    for (const w of BrowserWindow.getAllWindows()) { const m = w._filoTabs && w._filoTabs._cookieSites; if (m) add(m.get(site)); }
  } catch (_) {}
  return { cookies: [...out.cookies], storage: [...out.storage] };
}
Cookies.setAnswerLookup(answerFor);

function forgetRejected(tm, site) {
  const map = siteMemory(tm);
  const prev = map.get(site);
  if (!prev || !prev.rejected) return;
  map.set(site, { ...prev, rejected: false });
  if (map === remembered) saveSoon();
}

function incognitoManagers() {
  try {
    const { BrowserWindow } = require('electron');
    return BrowserWindow.getAllWindows().filter((w) => w._filoIncognito && w._filoTabs).map((w) => w._filoTabs);
  } catch (_) { return []; }
}

function allManagers() {
  try {
    const { BrowserWindow } = require('electron');
    return BrowserWindow.getAllWindows().map((w) => w._filoTabs).filter(Boolean);
  } catch (_) { return []; }
}

// Un sito entra o esce dall'elenco coi banner, da qualunque strada (menu della scheda, Sicurezza, import):
// Filo dimentica cosa aveva fatto lì, e la prossima pagina del sito parte senza la risposta nella sua memoria.
// scope: quale profilo ha cambiato elenco (services/cookies.js, wipeChanged).
function onListChange(site, answer, scope) {
  const wipe = { keys: cleanNames(answer && answer.storage), done: [] };
  const managers = [];
  if (scope && scope.normal) managers.push(...allManagers().filter((tm) => !tm.incognito));
  if (scope && scope.incognito) managers.push(...incognitoManagers());
  const maps = new Set();
  if (scope && scope.normal) maps.add(remembered);
  for (const tm of managers) if (tm.incognito) maps.add(siteMemory(tm));
  for (const map of maps) {
    map.delete(site);
    map.set(site, { rejected: false, hidden: false, at: Date.now(), wipe });
    trim(map);
    if (map === remembered) saveSoon();
  }
  for (const tm of managers) {
    let touched = false;
    for (const t of tm.tabs || []) {
      if (t.cookieOutcome && t.cookieOutcome.site === site) { t.cookieOutcome = null; touched = true; }
    }
    if (touched) { try { tm._broadcast(); } catch (_) {} }
  }
}
Cookies.setListChangeHandler(onListChange);

const cookieMethods = {
  // Esito arrivato da un frame della scheda: vale per il sito della pagina, non per quello del riquadro.
  // 'unconfirmed': il TCF dice che il consenso c'è ancora, quindi il «rifiutati» ricordato per il sito non vale più.
  cookieOutcome(tabId, outcome, msg) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !isWeb(tab.url) || !['rejected', 'hidden', 'unconfirmed', 'answer'].includes(outcome)) return { ok: false };
    const site = Cookies.registrableOf(tab.url);
    if (!site) return { ok: false };
    if (outcome === 'answer') {
      rememberAnswer(this, site, msg && msg.cookies, msg && msg.storage);
      return { ok: true };
    }
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
    // #758 — una pagina di accesso aperta come sito principale: il cookie che arriva dopo dice che l'utente è entrato.
    if (!tab.isInternal) { try { require('../services/cookieIncorporati').navigazione(url); } catch (_) {} }
    if (!tab.cookieOutcome) return;
    if (!isWeb(url) || Cookies.registrableOf(url) !== tab.cookieOutcome.site) tab.cookieOutcome = null;
  },

  // La pagina che sta per caricarsi, prima degli script del sito: la risposta da togliere, se il sito ha
  // cambiato elenco (onListChange). Una volta per origine: le altre origini del sito hanno la loro memoria.
  takeCookieWipe(href) {
    if (!isWeb(href)) return null;
    const site = Cookies.registrableOf(href);
    const map = siteMemory(this);
    const entry = site && map.get(site);
    if (!entry || !entry.wipe) return null;
    let origin = '';
    try { origin = new URL(href).origin; } catch (_) { return null; }
    if (entry.wipe.done.includes(origin)) return null;
    entry.wipe = { keys: entry.wipe.keys, done: [...entry.wipe.done, origin].slice(-50) };
    if (map === remembered) saveSoon();
    return { pattern: STORAGE_ANSWER.source, keys: entry.wipe.keys };
  },

  // Il sito della scheda ha già mostrato un banner senza «rifiuta»: alla pagina dopo si nasconde senza aspettare.
  cookieSeen(url) {
    const site = isWeb(url) && Cookies.registrableOf(url);
    const mem = site && siteMemory(this).get(site);
    return mem && mem.hidden && !mem.rejected ? 'hidden' : null;
  },

  // Cosa Filo ha fatto coi banner, sito per sito, per la pagina Sicurezza: ogni riga si può riportare ai banner.
  cookieSites() {
    const out = [];
    for (const [site, v] of siteMemory(this)) {
      if (v && (v.rejected || v.hidden)) out.push({ site, rejected: !!v.rejected, hidden: !!v.hidden, at: Number(v.at) || 0 });
    }
    return out.sort((a, b) => b.at - a.at);
  },

  _cookieState(tab) {
    if (!tab || tab.isInternal || !isWeb(tab.url) || Cookies.currentMode(this.incognito) === Cookies.MODES.MANUAL) return null;
    const shown = Cookies.isBannerSite(tab.url, this.incognito);
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
    const prima = Cookies.getBannerSites(settings);
    const copre = Sito.voceSalvata(tab.url, prima);
    const list = prima.filter((d) => d !== site && d !== copre);
    if (show) list.push(site);
    list.sort();
    tab.cookieOutcome = null;
    tab._cookieHold = true;
    setTimeout(() => { tab._cookieHold = false; }, 15000);
    // La risposta del sito si dimentica dopo averla tolta: serve anche al cambio d'elenco (cookies.js).
    const answer = answerFor(site);
    const { applySettingsUpdate } = require('../services/handlers');
    await applySettingsUpdate({ security: { cookies: { bannerSites: list } } });
    const wc = tab.view && tab.view.webContents;
    if (wc && !wc.isDestroyed()) {
      try { await Cookies.wipeConsentCookies(wc.session, site, answer.cookies); } catch (_) {}
      try { await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: wipeStorageJs(answer.storage) }]); } catch (_) {}
    }
    this._broadcast();
    this.reload(tab.id);
    return { ok: true, site, shown: !!show };
  },
};

function installCookies(TabManager) {
  Object.assign(TabManager.prototype, cookieMethods);
}

module.exports = { installCookies, loadRemembered, wipeStorageJs };
