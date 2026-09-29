// Blocco apertura siti in blacklist (#170.3): decide se una navigazione top-level va bloccata.
// Non notifica e non conosce le schede: lo chiama solo _decisioneBlocco di tabs.js,
// l'unico passaggio di ogni cambio d'indirizzo (#590). Regole: tests/unit/siteBlock.test.mjs.

const NomiSito = require('../../shared/nomiSito.js');

let enabled = true;
let useAdblockLists = true;
let userBlacklist = new Set(); // domini extra inseriti dall'utente

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
  // «*.sito.it» e «.sito.it», la forma di filtri e cookie per «il sito e i sottodomini», valgono «sito.it».
  s = s.replace(/^\*?\.+/, '').replace(/\.+$/, '').replace(/^www\./, '');
  // Un nome con lettere accentate va confrontato nella forma che ha nell'URL (punycode).
  if (/[^\x00-\x7f]/.test(s)) {
    try { s = new URL(`http://${s}`).hostname; } catch (_) {}
  }
  return s;
}

// Una voce come "facebook" o un IP non è mai un host reale: non entra nel Set dando falsa sicurezza.
function isValidDomain(host) {
  return NomiSito.valido(host);
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

// Decisione centrale. Ritorna { block, host, reason }. Nessuna eccezione per
// provenienza, nemmeno una ricerca (#590, scelta dell'owner): scavalca solo «Apri comunque».
function shouldBlockNavigation(targetUrl) {
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
  // Il nome come lo legge l'utente (münchen.de, non xn--mnchen-3ya.de): va in notifica e in chat.
  res.host = NomiSito.leggibile(host);

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
  isBlacklistedHost,
  normalizeDomain,
  setForTest,
  status,
};
