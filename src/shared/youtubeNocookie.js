// Embed di YouTube → youtube-nocookie.com (#755): stesso video, niente cookie di YouTube finché non si preme play.
// Una regola sola per la rete (services/cookies.js, prima che la richiesta parta) e per il ripiego nella pagina (content/cookies.js).
// Sentinella: tests/unit/youtubeNocookie.test.mjs.

(function (global) {
  'use strict';

  // Solo gli host che servono davvero /embed: un altro sottodominio su youtube-nocookie.com non esiste.
  const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

  /** L'indirizzo nocookie di un embed di YouTube (query e frammento intatti, ?start= compreso), o null. */
  function url(src, base) {
    let u;
    try { u = base ? new URL(String(src), base) : new URL(String(src)); } catch (_) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!HOSTS.has(u.hostname.toLowerCase().replace(/\.$/, ''))) return null;
    if (!/^\/embed(\/|$)/i.test(u.pathname)) return null;
    // Un lettore guidato dalla pagina (API JS) parla con l'origine che conosce: deviato, i comandi della pagina (play, pausa) cadono nel vuoto.
    if (/^(1|true)$/i.test(u.searchParams.get('enablejsapi') || '')) return null;
    u.protocol = 'https:';
    u.hostname = 'www.youtube-nocookie.com';
    u.port = '';
    u.username = '';
    u.password = '';
    return u.href;
  }

  const api = { url };
  global.SN_YT_NOCOOKIE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
