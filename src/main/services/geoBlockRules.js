// Regole d'azione sul geo-block, livello decisionale (proxy-per-tab-spec.md §5, #151).
// L'azione è automatica solo quando non può costare nulla: altrimenti Filo PROPONE.
// Logica pura; il wiring che raccoglie gli input e agisce è in tabs.js (_geoActOnDetected).

'use strict';

// Una sola azione per decisione.
const ACTIONS = {
  NONE: 'none',           // non fare niente (sito flaggato, o proxy non disponibile)
  SILENT_RETRY: 'silent_retry', // riapri la tab proxata senza chiedere (poi toast)
  PROPOSE: 'propose',     // mostra la proposta inline, l'utente decide
};

const TIERS = { DATACENTER: 'datacenter', RESIDENTIAL: 'residential' };

// Stadi del retry, «mai loop di retry» (§5 d): dopo un datacenter fallito con segnali di
// IP-block si concede UN SOLO tentativo residenziale, e per ogni altro caso non si riprova.
const STAGES = {
  INITIAL: 'initial',
  DATACENTER_FAILED_IPBLOCK: 'datacenter_failed_ipblock',
  DATACENTER_FAILED: 'datacenter_failed',
  RESIDENTIAL_FAILED: 'residential_failed',
};

// flaggedDangerous = avviso sospetto/pericoloso attivo sulla tab; proxyConfigured = c'è
// almeno un endpoint utilizzabile. Output: { action, tier?, reason }.
function decideGeoAction({ flaggedDangerous, hasLoginCookies, proxyConfigured, stage } = {}) {
  // (c) MAI aggirare i controlli di sicurezza di Filo: precedenza assoluta su tutto.
  if (flaggedDangerous) {
    return { action: ACTIONS.NONE, reason: 'flagged_dangerous' };
  }
  // Nessun endpoint configurato: non c'è niente da offrire, non proporre il vuoto.
  if (!proxyConfigured) {
    return { action: ACTIONS.NONE, reason: 'not_configured' };
  }

  const s = stage || STAGES.INITIAL;

  if (s === STAGES.INITIAL) {
    // (b) cookie di login presenti: MAI retry silenzioso, il cambio IP a sessione attiva causa
    // logout forzati e alert del servizio. Si propone, e l'utente sceglie a ragion veduta.
    if (hasLoginCookies) {
      return { action: ACTIONS.PROPOSE, reason: 'login_session' };
    }
    // (a) nessun login e sito non flaggato: retry silenzioso. Se riesce il wiring fa un toast:
    // informare, non chiedere.
    return { action: ACTIONS.SILENT_RETRY, tier: TIERS.DATACENTER, reason: 'safe_no_login' };
  }

  // (d) il datacenter ha fallito con segnali di IP-block: UN SOLO tentativo via residenziale.
  if (s === STAGES.DATACENTER_FAILED_IPBLOCK) {
    return { action: ACTIONS.SILENT_RETRY, tier: TIERS.RESIDENTIAL, reason: 'datacenter_ipblock' };
  }

  // Ogni altro esito: si propone e basta, mai loop di retry.
  return { action: ACTIONS.PROPOSE, reason: 'retry_failed' };
}

// Nota consumo dati per una tab proxata che riproduce video a lungo: una volta per
// sessione e non bloccante; lo stato di «già notato» lo tiene il wiring.
const VIDEO_DATA_NOTE_MS = 15 * 60 * 1000;

function shouldNoteVideoData({ proxied, playingMs, alreadyNoted } = {}) {
  if (!proxied || alreadyNoted) return false;
  return Number(playingMs) >= VIDEO_DATA_NOTE_MS;
}

// Euristica pura sui cookie già letti dalla session: il wiring passa solo {name, httpOnly}.
// Nel dubbio si assume «c'è una sessione» e si PROPONE: un falso negativo è un logout.

const LOGIN_NAME_RE = /sess|(^|[._-])sid([._-]|$)|auth|token|jwt|login|logged|account|oauth|passport|remember|csrf|(^|[._-])uid([._-]|$)/i;

// Cookie tecnici non di autenticazione (consenso, analytics, bot-management dei CDN):
// non devono far scattare «sessione attiva» nemmeno se httpOnly.
const NON_AUTH_NAME_RE = /consent|cookieconsent|gdpr|^_ga|^_gid|^_gat|^_gcl|analytics|^__cf_bm$|^cf_clearance$|^__cflb$|^_fbp$|^_hj/i;

function looksLikeLoginCookie(cookie) {
  if (!cookie) return false;
  const name = String(cookie.name || '');
  if (!name) return false;
  if (NON_AUTH_NAME_RE.test(name)) return false;
  if (LOGIN_NAME_RE.test(name)) return true;
  // Un httpOnly è gestito dal server e di solito accompagna una sessione: nel dubbio è login.
  return !!cookie.httpOnly;
}

function hasLoginCookie(cookies) {
  if (!Array.isArray(cookies)) return false;
  return cookies.some(looksLikeLoginCookie);
}

const api = {
  ACTIONS,
  TIERS,
  STAGES,
  VIDEO_DATA_NOTE_MS,
  decideGeoAction,
  shouldNoteVideoData,
  looksLikeLoginCookie,
  hasLoginCookie,
};

module.exports = api;
try { globalThis.SN_GEOBLOCK_RULES = api; } catch (_) {}
