// Regole d'azione sul geo-block rilevato, livello DECISIONALE (proxy-per-tab-spec.md §5, #151): consuma il segnale di geoBlock.js e decide COSA fare.
// Principio guida (spec §0/§5): l'azione è automatica solo quando non può costare nulla all'utente; in tutti gli altri casi Filo PROPONE, non agisce.
// LOGICA PURA (niente electron, niente rete); il wiring che raccoglie gli input reali e applica l'azione vive in tabs.js (_geoActOnDetected).

'use strict';

// Una sola azione per decisione.
const ACTIONS = {
  NONE: 'none',           // non fare niente (sito flaggato, o proxy non disponibile)
  SILENT_RETRY: 'silent_retry', // riapri la tab proxata senza chiedere (poi toast)
  PROPOSE: 'propose',     // mostra la proposta inline, l'utente decide
};

const TIERS = { DATACENTER: 'datacenter', RESIDENTIAL: 'residential' };

// Stadi del flusso di retry (spec §5 riga (d), "mai loop di retry"): dopo un datacenter fallito con segnali di IP-block si concede UN SOLO tentativo residenziale; per ogni altro fallimento non si riprova più.
const STAGES = {
  INITIAL: 'initial',
  DATACENTER_FAILED_IPBLOCK: 'datacenter_failed_ipblock',
  DATACENTER_FAILED: 'datacenter_failed',
  RESIDENTIAL_FAILED: 'residential_failed',
};

// flaggedDangerous = la tab ha un avviso "sospetto/pericoloso" attivo; proxyConfigured = esiste almeno un endpoint proxy utilizzabile. Output: { action, tier?, reason }.
function decideGeoAction({ flaggedDangerous, hasLoginCookies, proxyConfigured, stage } = {}) {
  // (c) avviso sospetto/pericoloso attivo: MAI aggirare i controlli di sicurezza di Filo. Precedenza assoluta su tutto il resto.
  if (flaggedDangerous) {
    return { action: ACTIONS.NONE, reason: 'flagged_dangerous' };
  }
  // Nessun endpoint configurato: non c'è niente da offrire, non proporre il vuoto.
  if (!proxyConfigured) {
    return { action: ACTIONS.NONE, reason: 'not_configured' };
  }

  const s = stage || STAGES.INITIAL;

  if (s === STAGES.INITIAL) {
    // (b) cookie di login presenti: MAI retry silenzioso — il cambio IP a sessione attiva causa logout forzati e alert di sicurezza del servizio. Si propone, e l'utente sceglie sapendo che lì non sarà loggato.
    if (hasLoginCookies) {
      return { action: ACTIONS.PROPOSE, reason: 'login_session' };
    }
    // (a) nessun login e sito non flaggato: retry automatico silenzioso. Se riesce il wiring mostra un toast: informare, non chiedere.
    return { action: ACTIONS.SILENT_RETRY, tier: TIERS.DATACENTER, reason: 'safe_no_login' };
  }

  // (d) il datacenter ha fallito con segnali di IP-block: UN SOLO tentativo via residenziale.
  if (s === STAGES.DATACENTER_FAILED_IPBLOCK) {
    return { action: ACTIONS.SILENT_RETRY, tier: TIERS.RESIDENTIAL, reason: 'datacenter_ipblock' };
  }

  // Ogni altro esito (datacenter fallito per altro motivo, residenziale fallito): si propone e basta. "Mai loop di retry."
  return { action: ACTIONS.PROPOSE, reason: 'retry_failed' };
}

// Nota consumo dati per una tab proxata che riproduce video a lungo (spec §1/§5): una volta per sessione, non bloccante. Lo stato di "già notato" lo tiene il wiring.
const VIDEO_DATA_NOTE_MS = 15 * 60 * 1000; // 15 minuti

function shouldNoteVideoData({ proxied, playingMs, alreadyNoted } = {}) {
  if (!proxied || alreadyNoted) return false;
  return Number(playingMs) >= VIDEO_DATA_NOTE_MS;
}

// Euristica pura sui cookie già letti dalla session della tab: il wiring passa qui solo {name, httpOnly}.
// Direzione conservativa voluta: nel dubbio si considera "c'è una sessione" e si PROPONE. Un falso positivo costa poco, un falso negativo è un logout forzato.

const LOGIN_NAME_RE = /sess|(^|[._-])sid([._-]|$)|auth|token|jwt|login|logged|account|oauth|passport|remember|csrf|(^|[._-])uid([._-]|$)/i;

// Cookie tecnici NON di autenticazione (consenso, analytics, bot-management dei CDN): non devono far scattare "sessione attiva" nemmeno se httpOnly.
const NON_AUTH_NAME_RE = /consent|cookieconsent|gdpr|^_ga|^_gid|^_gat|^_gcl|analytics|^__cf_bm$|^cf_clearance$|^__cflb$|^_fbp$|^_hj/i;

function looksLikeLoginCookie(cookie) {
  if (!cookie) return false;
  const name = String(cookie.name || '');
  if (!name) return false;
  if (NON_AUTH_NAME_RE.test(name)) return false;
  if (LOGIN_NAME_RE.test(name)) return true;
  // Un cookie httpOnly è gestito dal server e tipicamente accompagna una sessione: nel dubbio lo trattiamo come login.
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
// Esposto su globalThis come gli altri moduli condivisi: il wiring e i test lo trovano senza import.
try { globalThis.SN_GEOBLOCK_RULES = api; } catch (_) {}
