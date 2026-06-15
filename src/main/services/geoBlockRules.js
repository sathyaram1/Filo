// Regole d'azione su geo-block rilevato — livello DECISIONALE (proxy-per-tab-spec.md
// §5, feedback #151). Consuma il segnale del rilevamento (geoBlock.js) e decide
// COSA fare: il rilevamento espone il problema, qui sta la sola parte che NON è
// automatica.
//
// Principio guida (spec §0/§5): l'azione è automatica solo quando non può costare
// nulla all'utente; in tutti gli altri casi Filo PROPONE, non agisce.
//
// Questo modulo è LOGICA PURA (nessun require('electron'), nessuna rete): la
// matrice di decisione gira sotto node:test (tests/unit/geoBlockRules.test.mjs).
// Il wiring che raccoglie gli input reali (cookie di login, flag sicurezza, esito
// del retry) e applica l'azione vive in tabs.js (_geoActOnDetected).

'use strict';

// Le azioni possibili. Una sola per decisione.
const ACTIONS = {
  NONE: 'none',           // non fare niente (sito flaggato, o proxy non disponibile)
  SILENT_RETRY: 'silent_retry', // riapri la tab proxata senza chiedere (poi toast)
  PROPOSE: 'propose',     // mostra la proposta inline, l'utente decide
};

const TIERS = { DATACENTER: 'datacenter', RESIDENTIAL: 'residential' };

// Stadi del flusso di retry (spec §5, riga (d)): "mai loop di retry".
//   initial                  → prima decisione dopo il rilevamento
//   datacenter_failed_ipblock → il retry datacenter è fallito con segnali di
//                               IP-block: un SOLO tentativo residenziale
//   datacenter_failed         → il retry datacenter è fallito per altro motivo
//                               (non configurato, errore proxy): niente residenziale
//   residential_failed        → anche il residenziale è fallito: si propone e basta
const STAGES = {
  INITIAL: 'initial',
  DATACENTER_FAILED_IPBLOCK: 'datacenter_failed_ipblock',
  DATACENTER_FAILED: 'datacenter_failed',
  RESIDENTIAL_FAILED: 'residential_failed',
};

// Matrice di decisione (spec §5). Input:
//   flaggedDangerous  bool   il tab ha un avviso "sospetto/pericoloso" attivo
//   hasLoginCookies   bool   esistono cookie di login per il dominio nella tab
//   proxyConfigured   bool   esiste almeno un endpoint proxy utilizzabile
//   stage             string vedi STAGES (default INITIAL)
// Output: { action, tier?, reason }.
function decideGeoAction({ flaggedDangerous, hasLoginCookies, proxyConfigured, stage } = {}) {
  // (c) sito con avviso sospetto/pericoloso attivo → MAI aggirare i controlli di
  // sicurezza di Filo. Precedenza assoluta su tutto il resto.
  if (flaggedDangerous) {
    return { action: ACTIONS.NONE, reason: 'flagged_dangerous' };
  }
  // Nessun endpoint configurato: non c'è niente da offrire, non proporre il vuoto.
  if (!proxyConfigured) {
    return { action: ACTIONS.NONE, reason: 'not_configured' };
  }

  const s = stage || STAGES.INITIAL;

  if (s === STAGES.INITIAL) {
    // (b) cookie di login presenti → MAI retry silenzioso (il cambio IP a
    // sessione attiva causa logout forzati e alert di sicurezza del servizio):
    // si propone, l'utente sceglie sapendo che lì non sarà loggato.
    if (hasLoginCookies) {
      return { action: ACTIONS.PROPOSE, reason: 'login_session' };
    }
    // (a) nessun login + sito non flaggato → retry automatico silenzioso via
    // datacenter. Se riesce, il wiring mostra un toast (informare, non chiedere).
    return { action: ACTIONS.SILENT_RETRY, tier: TIERS.DATACENTER, reason: 'safe_no_login' };
  }

  // (d) il datacenter ha fallito con segnali di IP-block → un SOLO tentativo via
  // residenziale.
  if (s === STAGES.DATACENTER_FAILED_IPBLOCK) {
    return { action: ACTIONS.SILENT_RETRY, tier: TIERS.RESIDENTIAL, reason: 'datacenter_ipblock' };
  }

  // Ogni altro esito (datacenter fallito per altro motivo, residenziale fallito):
  // si propone e basta. "Mai loop di retry."
  return { action: ACTIONS.PROPOSE, reason: 'retry_failed' };
}

// Nota consumo dati per tab proxata che riproduce video a lungo (spec §1/§5:
// "se la tab proxata riproduce video da >15 min, nota discreta una volta per
// sessione, non bloccante"). Logica pura della soglia + gate "già notato"; lo
// stato della sessione (chi ha già visto la nota) lo tiene il wiring.
const VIDEO_DATA_NOTE_MS = 15 * 60 * 1000; // 15 minuti

function shouldNoteVideoData({ proxied, playingMs, alreadyNoted } = {}) {
  if (!proxied || alreadyNoted) return false;
  return Number(playingMs) >= VIDEO_DATA_NOTE_MS;
}

// "Cookie di login presenti per il dominio" (spec §5, riga (b)) — euristica pura
// sui cookie già letti dalla session del tab. Il wiring legge i cookie reali
// (Electron session.cookies.get) e passa qui solo {name, httpOnly}.
//
// Direzione conservativa voluta: nel dubbio si considera "c'è una sessione" →
// PROPONE invece di riprovare in silenzio. La spec è esplicita che il retry
// silenzioso a sessione attiva è il danno da evitare (logout forzati, alert di
// sicurezza), quindi un falso positivo qui costa poco, un falso negativo molto.

// Nomi che indicano in modo diretto una sessione/identità.
const LOGIN_NAME_RE = /sess|(^|[._-])sid([._-]|$)|auth|token|jwt|login|logged|account|oauth|passport|remember|csrf|(^|[._-])uid([._-]|$)/i;

// Cookie tecnici NON di autenticazione, anche quando httpOnly: consenso,
// analytics, bot-management dei CDN. Non devono far scattare "sessione attiva".
const NON_AUTH_NAME_RE = /consent|cookieconsent|gdpr|^_ga|^_gid|^_gat|^_gcl|analytics|^__cf_bm$|^cf_clearance$|^__cflb$|^_fbp$|^_hj/i;

function looksLikeLoginCookie(cookie) {
  if (!cookie) return false;
  const name = String(cookie.name || '');
  if (!name) return false;
  if (NON_AUTH_NAME_RE.test(name)) return false;
  if (LOGIN_NAME_RE.test(name)) return true;
  // Un cookie httpOnly è gestito dal server e tipicamente accompagna una
  // sessione: nel dubbio lo trattiamo come login (direzione conservativa).
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
// Esposto su globalThis come gli altri moduli condivisi: il wiring e i test lo
// trovano senza import espliciti.
try { globalThis.SN_GEOBLOCK_RULES = api; } catch (_) {}
