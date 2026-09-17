// Blocco della navigazione TOP-LEVEL verso siti in blacklist: l'ad-blocker annulla le
// singole richieste, qui si apre o no. Liste pubbliche più la blacklist dell'utente.
// Due eccezioni: si arriva da un motore di ricerca, o l'apertura è originata da Filo.

let enabled = true;
let useAdblockLists = true;
let userBlacklist = new Set(); // domini extra inseriti dall'utente

// Suffissi pubblici di secondo livello (co.uk, com.au…): la label del motore sta prima.
const PUB_SLD = '(?:co|com|net|org|gov|edu|ac|ne|or|go|nom|nic)';

// Il nome dev'essere la label subito prima del suffisso pubblico, non una qualsiasi:
// google.evil.com non è Google (#230).
function engineOnPublicSuffix(name) {
  return new RegExp(`(^|\\.)${name}\\.(?:${PUB_SLD}\\.)?[a-z]{2,}$`);
}

// Motori il cui referrer rende lecita l'apertura di un sito in blacklist. Per pattern sul
// dominio registrabile, per reggere i molti TLD e i sottodomini.
const SEARCH_ENGINE_PATTERNS = [
  engineOnPublicSuffix('google'),
  /(^|\.)bing\.com$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)startpage\.com$/,
  /(^|\.)qwant\.com$/,
  engineOnPublicSuffix('yahoo'),
  engineOnPublicSuffix('yandex'),
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

function normalizeDomain(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split('/')[0];
  s = s.split('?')[0];
  s = s.split('#')[0];
  s = s.split(':')[0];
  s = s.replace(/^www\./, '');
  return s;
}

// Una voce senza punto («facebook») o un IP non è un host reale: nel Set matcherebbe cose
// sbagliate e darebbe falsa sicurezza. Stessa regola del campo «siti fidati».
function isValidDomain(host) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host);
}

function toBlacklistSet(list) {
  return new Set(list.map(normalizeDomain).filter(isValidDomain));
}

// Match per suffisso: "a.b.example.com" matcha "example.com".
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

function isSearchEngineUrl(url) {
  return isSearchEngineHost(hostnameOf(url));
}

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

// Decisione centrale → { block, host, reason }. `fromUrl` è la pagina di partenza o il
// referrer, `viaFilo` dice che l'apertura nasce da Filo.
function shouldBlockNavigation(targetUrl, { fromUrl = '', viaFilo = false } = {}) {
  const res = { block: false, host: '', reason: '' };
  if (!enabled) return res;

  let u;
  try {
    u = new URL(targetUrl);
  } catch (_) {
    return res; // URL non valido: non interferiamo
  }
  // Solo http/https: gli altri schemi, comprese le pagine di Filo, non si bloccano mai.
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
  userBlacklist = toBlacklistSet(list);
}

// Per i test: imposta lo stato senza passare da settings.
function setForTest({ enabled: en, useAdblockLists: ual, blacklist } = {}) {
  if (en !== undefined) enabled = !!en;
  if (ual !== undefined) useAdblockLists = !!ual;
  if (Array.isArray(blacklist)) {
    userBlacklist = toBlacklistSet(blacklist);
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
