// Rilevamento geo-block — livello 1 DETERMINISTICO (vedi proxy-per-tab-spec.md §4).
//
// Stesso pattern della pipeline siti pericolosi: segnali deterministici prima,
// LLM solo sulla coda ambigua (il classificatore LLM è un livello separato).
// Questo modulo contiene SOLO la classificazione dei segnali e il registro
// degli ascoltatori del segnale interno "geo-block rilevato per la tab X":
//
//   - matchStatus(code)      → HTTP 451 è geo-block per definizione, conclusivo
//   - matchRedirectUrl(url)  → redirect verso URL con pattern /geo, /not-available,
//                              /region-block e simili (lista curata)
//   - matchText(text)        → errori API noti (YouTube/Vimeo "not available in
//                              your country", country block di Cloudflare, …)
//
// Il wiring sugli eventi della webview vive in tabs.js (_wireGeoBlock); qui
// NIENTE require('electron'): la logica pura gira anche sotto node:test
// (tests/unit/geoBlock.test.mjs).
//
// IMPORTANTE: questo livello RILEVA ed ESPONE il segnale, non agisce mai
// (niente retry via proxy, niente proposta UI): le regole d'azione sono il
// livello decisionale, separato, che consuma onDetected().

'use strict';

// Fonti del rilevamento, nel segnale emesso.
const SOURCES = {
  HTTP_451: 'http_451',
  REDIRECT: 'redirect_pattern',
  TEXT: 'text_pattern',
};

// ─── HTTP status ────────────────────────────────────────────────────────────
// 451 Unavailable For Legal Reasons: geo-block per definizione (RFC 7725).
// Conclusivo. Il 403 NON sta qui: è ambiguo (bot-block, paywall, permessi) e
// appartiene alla coda del classificatore LLM (livello 2, feedback separato).
function matchStatus(statusCode) {
  return Number(statusCode) === 451 ? SOURCES.HTTP_451 : null;
}

// ─── Redirect verso URL "di blocco" ─────────────────────────────────────────
// Lista CURATA di pattern sul path (+query) dell'URL di destinazione di un
// redirect. Si applica solo ai redirect (mai all'URL digitato dall'utente):
// un sito che TI MANDA su /geo-blocked sta dichiarando il blocco.
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

// URL di destinazione del redirect → id del pattern o null.
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

// ─── Testo visibile della pagina ────────────────────────────────────────────
// Pattern ESPLICITI dei messaggi di geo-block noti (YouTube, Vimeo, embed,
// pagine standard dei CDN). Niente euristiche vaghe: i casi ambigui ("content
// unavailable" generico, pagina vuota) sono la coda del livello 2 LLM.
const TEXT_PATTERNS = [
  // YouTube: "The uploader has not made this video available in your country"
  { id: 'yt_uploader_country', re: /not made this video available in your country/ },
  // YouTube/Vimeo/embed: "This video is not available in your country/region"
  { id: 'not_available_in_your', re: /not (?:currently )?(?:be )?(?:available|viewable) in your (?:country|region|location|area)/ },
  { id: 'unavailable_in_your', re: /unavailable in your (?:country|region|location)/ },
  { id: 'blocked_in_your', re: /(?:blocked|restricted) in your (?:country|region|location)/ },
  { id: 'not_available_in_this_country', re: /not available in (?:this|the) (?:country|region)/ },
  // Cloudflare error 1009: "The owner of this website has banned the country
  // or region your IP address is in (XX) from accessing this website."
  { id: 'cloudflare_1009', re: /banned the country or region your ip address/ },
  { id: 'cloudflare_error_1009', re: /\berror 1009\b/ },
  // Pagina standard del 451 (anche quando lo status non è osservabile).
  { id: 'legal_reasons', re: /unavailable for legal reasons/ },
  // Varianti italiane dei player/embed localizzati.
  { id: 'it_non_disponibile_paese', re: /non (?:è|e'|e) disponibile nel tuo paese/ },
  { id: 'it_non_disponibile_area', re: /non (?:è|e'|e) disponibile nella tua (?:area|zona|regione)/ },
];

// Titolo + testo visibile (normalizzati) → id del pattern o null.
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

// Comodo per i test e per chi ha tutti i segnali insieme: il primo che
// matcha vince, nell'ordine di affidabilità (status > redirect > testo).
function classify({ statusCode, redirectUrl, text } = {}) {
  if (matchStatus(statusCode)) return { source: SOURCES.HTTP_451, detail: 'http_451' };
  const r = redirectUrl ? matchRedirectUrl(redirectUrl) : null;
  if (r) return { source: SOURCES.REDIRECT, detail: r };
  const t = text ? matchText(text) : null;
  if (t) return { source: SOURCES.TEXT, detail: t };
  return null;
}

// ─── Segnale interno "geo-block rilevato per la tab X" ──────────────────────
// Il livello decisionale (regole d'azione, feedback separato) si registra con
// onDetected(cb); tabs.js emette via emitDetected. Il segnale porta:
//   { tabId, url, host, source, detail, at }
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
// Esposto su globalThis come gli altri moduli condivisi: i livelli successivi
// (regole d'azione, agente conversazionale) e i test lo trovano senza import.
try { globalThis.SN_GEOBLOCK = api; } catch (_) {}
