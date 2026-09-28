// Blocco apertura siti in blacklist (#170.3): decide se una navigazione top-level va bloccata.
// Non notifica e non conosce le schede: lo chiama solo _maybeBlockNavigation di tabs.js,
// l'unico passaggio di ogni cambio d'indirizzo (#590). Eccezioni: vedi shouldBlockNavigation.

let enabled = true;
let useAdblockLists = true;
let userBlacklist = new Set(); // domini extra inseriti dall'utente

// Pagine dei RISULTATI che concedono l'eccezione: nome esatto E percorso del motore, mai la
// forma del nome, che chiunque si procura (searx.<qualunque>, sites.google.com: #590). path null = host senza pagine di terzi.
const RISULTATI = [
  { host: /^(?:www\.)?google\.(?:com|com?\.[a-z]{2}|[a-z]{2})$/, path: /^\/(?:search|url)$/ },
  { host: /^(?:www\.)?bing\.com$/, path: /^\/(?:search|ck\/a)$/ },
  { host: /^(?:html\.|lite\.)?duckduckgo\.com$/, path: null },
  { host: /^(?:www\.)?ecosia\.org$/, path: /^\/search$/ },
  { host: /^(?:www\.)?startpage\.com$/, path: /^\/(?:sp|do)\// },
  { host: /^(?:www\.)?qwant\.com$/, path: null },
  { host: /^(?:[a-z]{2}\.)?search\.yahoo\.com$/, path: /^\/search/ },
  { host: /^r\.search\.yahoo\.com$/, path: null },
  { host: /^search\.yahoo\.co\.jp$/, path: /^\/search/ },
  { host: /^(?:www\.)?yandex\.(?:com|com\.tr|[a-z]{2})$/, path: /^\/(?:search|clck)(?:\/|$)/ },
  { host: /^ya\.ru$/, path: /^\/search(?:\/|$)/ },
  { host: /^(?:www|m)\.baidu\.com$/, path: /^\/(?:s|link)$/ },
  { host: /^search\.brave\.com$/, path: null },
  { host: /^kagi\.com$/, path: /^\/search$/ },
  { host: /^(?:www\.)?mojeek\.com$/, path: /^\/search$/ },
  { host: /^(?:www\.)?ask\.com$/, path: /^\/web$/ },
];

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
  s = s.replace(/^www\./, '').replace(/\.+$/, '');
  // Un nome con lettere accentate va confrontato nella forma che ha nell'URL (punycode).
  if (/[^\x00-\x7f]/.test(s)) {
    try { s = new URL(`http://${s}`).hostname; } catch (_) {}
  }
  return s;
}

// Un dominio è valido come voce di blacklist solo se ha un'estensione (almeno
// un punto + TLD alfabetico). Allineato al campo "siti fidati": una voce come
// "facebook" o un IP non è mai un host reale, quindi non deve entrare nel Set
// (matcherebbe "facebook.com/com", non "facebook") dando falsa sicurezza.
function isValidDomain(host) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host);
}

// Da lista grezza (settings) → Set di domini normalizzati E validi.
function toBlacklistSet(list) {
  return new Set(list.map(normalizeDomain).filter(isValidDomain));
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

// La pagina di partenza è una pagina di risultati di un motore di ricerca?
function isSearchEngineUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  return RISULTATI.some((r) => r.host.test(host) && (!r.path || r.path.test(u.pathname)));
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

// Decisione centrale. Ritorna { block, host, reason }. L'unica eccezione è il
// referrer di un motore di ricerca (l'utente l'ha cercato apposta): un'apertura
// di Filo o del modello NON è esente (#590), a scavalcare è solo «Apri comunque».
function shouldBlockNavigation(targetUrl, { fromUrl = '' } = {}) {
  const res = { block: false, host: '', reason: '' };
  if (!enabled) return res;

  let u;
  try {
    u = new URL(targetUrl);
  } catch (_) {
    return res; // URL non valido: non interferiamo
  }
  // Solo navigazioni web top-level: le pagine interne di Filo non si bloccano mai.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return res;

  // «sito.it.» è lo stesso host di «sito.it» per il DNS: senza, il punto finale aggira la lista.
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  res.host = host;

  if (fromUrl && isSearchEngineUrl(fromUrl)) return res;

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

// Per i test: imposta stato senza passare da settings.
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
