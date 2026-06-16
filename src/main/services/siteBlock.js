// Blocco apertura siti in blacklist (#170.3).
//
// PERCHÉ ESISTE
//   L'ad-blocking (adblock.js) annulla le SINGOLE richieste verso domini di
//   ad/tracker, ma non impedisce di APRIRE la pagina top-level di un sito che
//   sta in blacklist. Questo modulo decide, a livello di navigazione top-level,
//   se l'apertura di un sito va bloccata del tutto.
//
//   Sorgenti della blacklist:
//   - le liste pubbliche già scaricate dall'ad-blocker (#170.2: StevenBlack +
//     EasyList), opzionali (useAdblockLists);
//   - una blacklist DEDICATA dell'utente (domini aggiunti a mano nelle
//     Preferenze).
//
//   ECCEZIONI (l'apertura è consentita anche se il sito è in blacklist):
//   a) la navigazione proviene da un MOTORE DI RICERCA (referrer Google/Bing/…):
//      l'utente l'ha cercato apposta, non lo intercettiamo;
//   b) la navigazione è ORIGINATA DA FILO (azione NAVIGA dell'assistente o
//      navigazione interna filo://): è Filo stesso ad aprire, su richiesta
//      esplicita dell'utente.
//
//   Quando invece blocca, il chiamante (tabs.js) mostra una notifica in basso a
//   destra (#170.1) col sito bloccato e l'opzione "Apri comunque".
//
// API: configureFromSettings, shouldBlockNavigation, isSearchEngineUrl,
//      isBlacklistedHost, setForTest, status.

let enabled = true;
let useAdblockLists = true;
let userBlacklist = new Set(); // domini extra inseriti dall'utente

// Motori di ricerca il cui referrer rende lecita l'apertura di un sito in
// blacklist. Riconoscimento per pattern sul dominio registrabile, robusto ai
// molti TLD di Google/Yandex e ai sottodomini (www., search., ecc.).
const SEARCH_ENGINE_PATTERNS = [
  /(^|\.)google\.[a-z.]+$/, // google.com, google.it, google.co.uk, …
  /(^|\.)bing\.com$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)startpage\.com$/,
  /(^|\.)qwant\.com$/,
  /(^|\.)yahoo\.[a-z.]+$/, // search.yahoo.com, yahoo.com, …
  /(^|\.)yandex\.[a-z.]+$/,
  /(^|\.)baidu\.com$/,
  /(^|\.)brave\.com$/, // search.brave.com
  /(^|\.)kagi\.com$/,
  /(^|\.)mojeek\.com$/,
  /(^|\.)ask\.com$/,
  /(^|\.)searx\b/, // istanze SearXNG (searx.*)
];

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

// Normalizza un dominio inserito dall'utente: toglie schema, path, porta, www.
function normalizeDomain(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, ''); // schema
  s = s.split('/')[0]; // path
  s = s.split('?')[0];
  s = s.split('#')[0];
  s = s.split(':')[0]; // porta
  s = s.replace(/^www\./, '');
  return s;
}

// Match per suffisso di dominio: "a.b.example.com" matcha "example.com".
function matchesSuffix(host, set) {
  if (!host || !set || !set.size) return false;
  let h = host;
  while (h) {
    if (set.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return false;
}

function isSearchEngineHost(host) {
  if (!host) return false;
  return SEARCH_ENGINE_PATTERNS.some((re) => re.test(host));
}

// Il referrer (o la pagina di partenza) è un motore di ricerca?
function isSearchEngineUrl(url) {
  return isSearchEngineHost(hostnameOf(url));
}

// L'host è in blacklist? (blacklist dedicata dell'utente, oppure — se
// abilitato — le liste pubbliche dell'ad-blocker.)
function isBlacklistedHost(host) {
  if (!host) return false;
  if (matchesSuffix(host, userBlacklist)) return true;
  if (useAdblockLists) {
    try {
      const ad = require('./adblock');
      if (ad && typeof ad.isBlockedHost === 'function' && ad.isBlockedHost(host)) return true;
    } catch (_) {}
  }
  return false;
}

// Decisione centrale. Ritorna { block, host, reason }.
//   targetUrl: dove si vuole andare.
//   fromUrl:   pagina di partenza / referrer (per l'eccezione "ricerca").
//   viaFilo:   true se l'apertura è originata da Filo (eccezione "Filo").
function shouldBlockNavigation(targetUrl, { fromUrl = '', viaFilo = false } = {}) {
  const res = { block: false, host: '', reason: '' };
  if (!enabled) return res;

  let u;
  try {
    u = new URL(targetUrl);
  } catch (_) {
    return res; // URL non valido: non interferiamo
  }
  // Solo navigazioni web top-level. filo://, about:, data:, chrome:, ecc. sono
  // sempre lecite (le pagine interne di Filo non si bloccano mai).
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return res;

  const host = u.hostname.toLowerCase();
  res.host = host;

  // Eccezione b) — Filo apre direttamente (NAVIGA / navigazione interna).
  if (viaFilo) return res;
  // Eccezione a) — la navigazione proviene da un motore di ricerca.
  if (fromUrl && isSearchEngineHost(hostnameOf(fromUrl))) return res;

  if (!isBlacklistedHost(host)) return res;

  res.block = true;
  res.reason = matchesSuffix(host, userBlacklist) ? 'blacklist' : 'lists';
  return res;
}

function configureFromSettings(settings) {
  const sb = (settings && settings.security && settings.security.siteBlock) || {};
  enabled = sb.enabled !== false;
  useAdblockLists = sb.useAdblockLists !== false;
  const list = Array.isArray(sb.blacklist) ? sb.blacklist : [];
  userBlacklist = new Set(list.map(normalizeDomain).filter(Boolean));
}

// Per i test: imposta stato senza passare da settings.
function setForTest({ enabled: en, useAdblockLists: ual, blacklist } = {}) {
  if (en !== undefined) enabled = !!en;
  if (ual !== undefined) useAdblockLists = !!ual;
  if (Array.isArray(blacklist)) {
    userBlacklist = new Set(blacklist.map(normalizeDomain).filter(Boolean));
  }
}

function status() {
  return {
    enabled,
    useAdblockLists,
    blacklistSize: userBlacklist.size,
  };
}

module.exports = {
  configureFromSettings,
  shouldBlockNavigation,
  isSearchEngineUrl,
  isBlacklistedHost,
  normalizeDomain,
  setForTest,
  status,
};
