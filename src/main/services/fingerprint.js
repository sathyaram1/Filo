// Anti-fingerprinting: ai segnali ad alta entropia (canvas, WebGL, audio) si aggiunge un rumore DETERMINISTICO per-sito, impercettibile all'utente ma sufficiente a rompere la correlazione cross-site.
// Qui vive il master secret persistente; alla pagina arriva SOLO il seed, via IPC sincrono (ipc.js `filo:fp-config`) e poi preload/fingerprint-guard.js, così il secret non tocca mai il mondo non fidato.
// Tre livelli: off; default = HMAC(secret, eTLD+1 + settimana ISO), ruota ogni settimana; privacy = HMAC(secret, eTLD+1 + session_id), ruota a ogni avvio.

const crypto = require('node:crypto');

const MODES = { OFF: 'off', DEFAULT: 'default', PRIVACY: 'privacy' };
const SECRET_KEY = '__fpMasterSecret';

let _secret = null; // Buffer (32 byte)
let _sessionId = crypto.randomUUID();
let _mode = MODES.DEFAULT;

function _storage() {
  // Lo stesso store su disco usato dallo shim chrome.storage.local.
  return require('../shim/storage');
}

function getMode(settings) {
  const m = settings && settings.security && settings.security.fingerprint
    && settings.security.fingerprint.mode;
  return [MODES.OFF, MODES.DEFAULT, MODES.PRIVACY].includes(m) ? m : MODES.DEFAULT;
}

function levelNum(mode) {
  return mode === MODES.PRIVACY ? 2 : mode === MODES.DEFAULT ? 1 : 0;
}

// Best-effort: se lo storage non risponde si usa un secret effimero — il rumore funziona comunque, solo non sopravvive al riavvio.
async function init(settings) {
  _mode = getMode(settings);
  try {
    const store = _storage();
    const got = await store.get(SECRET_KEY);
    let hex = got && got[SECRET_KEY];
    if (typeof hex !== 'string' || hex.length < 32) {
      hex = crypto.randomBytes(32).toString('hex');
      await store.set({ [SECRET_KEY]: hex });
    }
    _secret = Buffer.from(hex, 'hex');
  } catch (_) {
    _secret = crypto.randomBytes(32);
  }
  return _secret;
}

function setMode(settings) {
  _mode = getMode(settings);
}

// Non è la Public Suffix List completa: sarebbe pesante da bundlare nel preload e qui basta rendere coerente il seed fra i sottodomini dello stesso servizio ("accounts.google.com" → "google.com", "bbc.co.uk" → "bbc.co.uk").
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk',
  'co.jp', 'or.jp', 'ne.jp', 'com.au', 'net.au', 'org.au', 'co.nz',
  'com.br', 'co.in', 'co.za', 'com.mx', 'com.tr', 'co.kr', 'com.cn',
  'com.hk', 'com.sg', 'co.il', 'com.ar', 'com.es', 'com.pl',
]);

function etld1(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIX.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

// Numero settimana ISO-8601, es. "2026-W23".
function isoWeekId(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// L'origine arriva già ridotta a eTLD+1.
function seedForOrigin(origin) {
  // Un master secret ci deve essere anche prima che init() carichi quello persistente: una pagina che chiede la config nella finestra di avvio otterrebbe seed 0, cioè protezione silenziosamente spenta. Il fallback effimero la tiene accesa, init() poi sovrascrive.
  if (!_secret) _secret = crypto.randomBytes(32);
  const temporal = _mode === MODES.PRIVACY ? _sessionId : isoWeekId();
  const h = crypto.createHmac('sha256', _secret).update(`${origin}|${temporal}`).digest();
  return h.readUInt32BE(0) >>> 0;
}

// Pagine di autenticazione: il rumore altera esattamente i segnali che i motori antifrode dei provider usano per riconoscere un browser genuino, e su un login Google fa scattare "Si è verificato un errore durante l'accesso" — riproducibile solo con un accesso vero, quindi difficile da diagnosticare dai log. Stessa lista host di src/shared/authPopup.js (#209).
// NON si esenta l'intero sito di ogni provider: per gli host DEDICATI all'autenticazione l'host intero è superficie di accesso; per gli host PRODOTTO (github.com, x.com, facebook.com…) solo la superficie di login/OAuth, così la navigazione pubblica resta protetta (isIdentityAuthSurface in authPopup.js).
// L'euristica su path/query è sicura perché si applica SOLO a host già nella lista fidata: un tracker arbitrario non può auto-esentarsi scegliendo un path "/login".
function isIdentityProviderHref(href) {
  try {
    require('../../shared/authPopup');
    const mod = globalThis.SN_AUTH_POPUP;
    return !!(mod && mod.isIdentityAuthSurface(href));
  } catch (_) {
    return false;
  }
}

// App Google in cui l'utente è già AUTENTICATO (#299): lì il rumore non offre alcuna protezione — il cookie dell'account identifica comunque — ma altera i segnali antifrode e fa scattare "questo browser o questa app potrebbero non essere sicuri". Costo privacy nullo, attrito reale eliminato.
// Lista CURATA, NON l'eTLD+1 google.com: esentare tutto google.com spegnerebbe la protezione anche sulla ricerca, dove l'utente può non essere loggato. Match su host esatto o suo sottodominio.
const GOOGLE_APP_HOSTS = [
  'docs.google.com',        // Documenti, Fogli, Presentazioni, Moduli
  'drive.google.com',
  'mail.google.com',        // Gmail
  'calendar.google.com',
  'keep.google.com',
  'meet.google.com',
  'chat.google.com',
  'contacts.google.com',
  'photos.google.com',
  'sites.google.com',
  'script.google.com',      // Apps Script
  'classroom.google.com',
  'myaccount.google.com',
  'admin.google.com',       // Workspace admin
];

function isGoogleAppSurface(href) {
  let host;
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase().replace(/\.$/, '');
  } catch (_) {
    return false;
  }
  if (!host) return false;
  return GOOGLE_APP_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Solo http/https vengono protette (filo://, file://, about: → off).
function configForHref(href) {
  const level = levelNum(_mode);
  if (!level) return { level: 0, seed: 0 };
  let host = '';
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { level: 0, seed: 0 };
    host = u.hostname;
  } catch (_) {
    return { level: 0, seed: 0 };
  }
  if (!host) return { level: 0, seed: 0 };
  if (isIdentityProviderHref(href)) return { level: 0, seed: 0 };
  if (isGoogleAppSurface(href)) return { level: 0, seed: 0 };
  return { level, seed: seedForOrigin(etld1(host)) };
}

module.exports = {
  MODES,
  getMode,
  levelNum,
  init,
  setMode,
  etld1,
  isoWeekId,
  seedForOrigin,
  isIdentityProviderHref,
  isGoogleAppSurface,
  configForHref,
};
