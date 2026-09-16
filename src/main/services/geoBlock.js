// Rilevamento geo-block, livello 1 DETERMINISTICO (proxy-per-tab-spec.md §4): segnali conclusivi qui, LLM solo sulla coda ambigua (geoBlockClassifier.js).
// Questo livello RILEVA ed ESPONE il segnale, non agisce MAI: niente retry via proxy né proposta UI: le regole d'azione sono il livello decisionale, che consuma onDetected().
// Niente require('electron'): la logica pura gira anche sotto node:test. Il wiring sugli eventi della webview sta in tabs.js (_wireGeoBlock).

'use strict';

const SOURCES = {
  HTTP_451: 'http_451',
  REDIRECT: 'redirect_pattern',
  TEXT: 'text_pattern',
  // Livello 2 (geoBlockClassifier.js): la coda ambigua che i pattern deterministici non risolvono, classificata come geo_block.
  LLM: 'llm_classifier',
};

// 451 Unavailable For Legal Reasons: geo-block per definizione (RFC 7725), conclusivo. Il 403 NON sta qui: è ambiguo (bot-block, paywall, permessi) e appartiene alla coda del livello 2.
function matchStatus(statusCode) {
  return Number(statusCode) === 451 ? SOURCES.HTTP_451 : null;
}

// Lista CURATA di pattern sul path (+query) della destinazione di un redirect. Si applica solo ai redirect, mai all'URL digitato dall'utente: un sito che TI MANDA su /geo-blocked sta dichiarando il blocco.
const REDIRECT_PATTERNS = [
  { id: 'geo_segment', re: /(^|\/)geo(\/|$)/ },            // …/geo, …/geo/…
  { id: 'geo_block', re: /geo[-_]?block/ },                 // geoblock, geo-blocked…
  { id: 'geo_restrict', re: /geo[-_]?restrict/ },           // geo-restricted…
  { id: 'not_available', re: /(^|\/)not[-_]?available([/._?-]|$)/ },
  { id: 'region_block', re: /region[-_]?block/ },
  { id: 'country_block', re: /country[-_]?block/ },
  { id: 'location_block', re: /location[-_]?block/ },
  { id: 'unavailable_in_your', re: /unavailable[-_]in[-_]your/ },
];

function matchRedirectUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const subject = `${u.pathname}${u.search}`.toLowerCase();
  for (const { id, re } of REDIRECT_PATTERNS) {
    if (re.test(subject)) return id;
  }
  return null;
}

// Pattern ESPLICITI dei messaggi di geo-block noti. Niente euristiche vaghe: i casi ambigui ("content unavailable" generico, pagina vuota) sono la coda del livello 2.
const TEXT_PATTERNS = [
  { id: 'yt_uploader_country', re: /not made this video available in your country/ },
  { id: 'not_available_in_your', re: /not (?:currently )?(?:be )?(?:available|viewable) in your (?:country|region|location|area)/ },
  { id: 'unavailable_in_your', re: /unavailable in your (?:country|region|location)/ },
  { id: 'blocked_in_your', re: /(?:blocked|restricted) in your (?:country|region|location)/ },
  { id: 'not_available_in_this_country', re: /not available in (?:this|the) (?:country|region)/ },
  { id: 'cloudflare_1009', re: /banned the country or region your ip address/ },
  { id: 'cloudflare_error_1009', re: /\berror 1009\b/ },
  // Pagina standard del 451, utile anche quando lo status non è osservabile.
  { id: 'legal_reasons', re: /unavailable for legal reasons/ },
  { id: 'it_non_disponibile_paese', re: /non (?:è|e'|e) disponibile nel tuo paese/ },
  { id: 'it_non_disponibile_area', re: /non (?:è|e'|e) disponibile nella tua (?:area|zona|regione)/ },
];

function matchText(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'") // apostrofi tipografici → ASCII
    .replace(/\s+/g, ' ');
  if (!t) return null;
  for (const { id, re } of TEXT_PATTERNS) {
    if (re.test(t)) return id;
  }
  return null;
}

// Il primo che matcha vince, nell'ordine di affidabilità: status > redirect > testo.
function classify({ statusCode, redirectUrl, text } = {}) {
  if (matchStatus(statusCode)) return { source: SOURCES.HTTP_451, detail: 'http_451' };
  const r = redirectUrl ? matchRedirectUrl(redirectUrl) : null;
  if (r) return { source: SOURCES.REDIRECT, detail: r };
  const t = text ? matchText(text) : null;
  if (t) return { source: SOURCES.TEXT, detail: t };
  return null;
}

// Il livello decisionale si registra con onDetected(cb), tabs.js emette via emitDetected. Il segnale porta { tabId, url, host, source, detail, at }.
const listeners = new Set();

function onDetected(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emitDetected(signal) {
  for (const cb of listeners) {
    try { cb(signal); } catch (_) {}
  }
}

const api = {
  SOURCES,
  matchStatus,
  matchRedirectUrl,
  matchText,
  classify,
  onDetected,
  emitDetected,
};

module.exports = api;
// Esposto su globalThis come gli altri moduli condivisi: i livelli successivi e i test lo trovano senza import.
try { globalThis.SN_GEOBLOCK = api; } catch (_) {}
