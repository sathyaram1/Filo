// Protezione anti-fingerprinting.
//
// Il fingerprinting è il secondo vettore di tracking dopo i cookie: i siti
// combinano segnali ad alta entropia del browser (canvas, WebGL, audio) per
// generare un identificativo unico senza bisogno di cookie. Filo aggiunge a
// quei segnali un rumore DETERMINISTICO per-sito, impercettibile all'utente ma
// sufficiente a rompere la correlazione cross-site.
//
// Questo modulo (main process) custodisce il "master secret" persistente e
// calcola, per ogni origine, il seed del rumore. Il seed — NON il secret —
// viene passato al preload via IPC sincrono (vedi ipc.js `filo:fp-config`) e di
// lì iniettato nel main world della pagina (vedi preload/fingerprint-guard.js).
// Così il secret non tocca mai il mondo non fidato della pagina.
//
// Tre livelli, come per i cookie:
//   off     (0) — nessun rumore.
//   default (1) — seed = HMAC(secret, eTLD+1 + settimana ISO). Ruota ogni
//                 settimana. Nessun impatto su banche/CAPTCHA.
//   privacy (2) — seed = HMAC(secret, eTLD+1 + session_id). Ruota a ogni
//                 avvio dell'app.

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

// Carica (o genera) il master secret persistente e fissa la modalità corrente.
// Chiamato una volta all'avvio. Best-effort: in caso di errore di storage usa
// un secret effimero (il rumore funziona comunque, solo non sopravvive al
// riavvio — accettabile).
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

// eTLD+1 con una piccola lista di suffissi multi-parte comuni. Non è un Public
// Suffix List completo (sarebbe pesante da bundlare nel preload e qui non
// serve: l'obiettivo è solo rendere coerente il seed tra sottodomini dello
// stesso servizio). "accounts.google.com" → "google.com"; "bbc.co.uk" → "bbc.co.uk".
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

// Seed uint32 per un'origine (già ridotta a eTLD+1).
function seedForOrigin(origin) {
  // Garantisce un master secret anche se init() non ha ancora caricato/generato
  // quello persistente. Senza questo, una pagina che chiede la config nella
  // finestra di avvio (IPC sincrono filo:fp-config, prima che whenReady completi
  // init) otterrebbe seed 0 = protezione anti-fingerprint silenziosamente spenta.
  // Il fallback effimero la tiene attiva; init() poi sovrascrive _secret con
  // quello persistente (coerente fra riavvii).
  if (!_secret) _secret = crypto.randomBytes(32);
  const temporal = _mode === MODES.PRIVACY ? _sessionId : isoWeekId();
  const h = crypto.createHmac('sha256', _secret).update(`${origin}|${temporal}`).digest();
  return h.readUInt32BE(0) >>> 0;
}

// Pagine di provider di identità (Google, Microsoft, GitHub, …): il rumore
// anti-fingerprint su canvas/WebGL/audio, per quanto impercettibile per un
// umano, altera esattamente i segnali che questi provider usano nei loro
// motori antifrode per riconoscere un browser genuino da uno automatizzato/
// manomesso. Su un sito normale è innocuo; su un login Google può far scattare
// il blocco "Si è verificato un errore durante l'accesso" — riproducibile
// solo con un vero tentativo di accesso, quindi difficile da diagnosticare
// dai soli log. Riusiamo la stessa lista host di src/shared/authPopup.js (già
// usata per non bloccare i popup OAuth come popup pubblicitari, #209): stessi
// host, stesso motivo — sono endpoint di autenticazione, non vanno alterati.
//
// Usiamo SOLO il match su host noto (isKnownIdentityHost), NON l'euristica
// isAuthPopup() completa (path /login|/auth|/sso… o query client_id+redirect_uri):
// quell'euristica è pensata per riconoscere popup OAuth generici, dove un falso
// positivo è innocuo (al massimo si consente un popup in più). Qui un falso
// positivo spegnerebbe la protezione anti-fingerprint su un sito qualunque —
// un tracker potrebbe disattivarla deliberatamente scegliendo un path "/login"
// o aggiungendo client_id/redirect_uri in query.
function isIdentityProviderHref(href) {
  try {
    require('../../shared/authPopup');
    const mod = globalThis.SN_AUTH_POPUP;
    return !!(mod && mod.isKnownIdentityHost(href));
  } catch (_) {
    return false;
  }
}

// Superfici "prodotto" di Google in cui l'utente è AUTENTICATO col proprio
// account (Documenti/Fogli/Presentazioni, Drive, Gmail, Calendar, Meet…). Qui
// il rumore anti-fingerprint non offre ALCUNA protezione privacy — sei comunque
// identificato dal cookie del tuo account Google, che ti segue su tutte le sue
// app — ma altera gli stessi segnali canvas/WebGL/audio che i controlli di
// sicurezza antifrode di Google campionano lungo il flusso di accesso, facendo
// scattare il blocco "questo browser o questa app potrebbero non essere sicuri"
// (feedback #299: accesso a Google Documenti). È lo stesso ragionamento
// dell'esenzione del login (accounts.google.com, via isIdentityProviderHref),
// esteso alle app in cui quel login sfocia: costo privacy nullo, elimina un
// possibile attrito reale.
//
// Lista CURATA (come AUTH_HOSTS), NON l'eTLD+1 google.com: esentare tutto
// "google.com" spegnerebbe la protezione anche sulla ricerca (www.google.com),
// dove l'utente può NON essere loggato e il rumore ha un valore reale. Match su
// host esatto o suo sottodominio.
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

// Config { level, seed } per la pagina identificata da href. Solo http/https
// vengono protette (filo://, file://, about: → off).
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
