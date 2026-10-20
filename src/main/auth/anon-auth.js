// Identità dell'installazione: un account Firebase anonimo per copia di Filo (#598).
// Crediti e chiave personale stanno su quell'uid, non sul login Google, che vi si collega.
// Si conserva solo il refreshToken, cifrato con safeStorage; il resto si ricava dal refresh.

const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const guasti = require('./guastiAccesso');
const walletStore = require('./wallet-store');
const Disco = require('../services/scritturaAtomica');

const IDENTITY_ENDPOINT = process.env.FILO_IDENTITY_ENDPOINT
  || 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const SECURE_TOKEN_ENDPOINT = process.env.FILO_SECURE_TOKEN_ENDPOINT || cfg.secureTokenEndpoint;

let session = null; // { refreshToken, idToken, idTokenExp, uid }
let inflight = null;
// Identità annullata sul server: non se ne crea un'altra in silenzio, il portafoglio è
// legato a quella. Ricominciare è una scelta dell'utente (resetIdentity).
let lost = false;
// Il file c'è ma non si è lasciato leggere né spostare: un'identità nuova scritta sopra perderebbe il portafoglio (#1087).
let fileIntoccabile = false;

function erroreIdentita(code) {
  const err = new Error(code === 'identity_lost'
    ? 'l\'identità di questa installazione è stata annullata sul server'
    : 'questo computer non riesce a leggere l\'identità salvata di questa installazione');
  err.code = code;
  return err;
}

// Un fetch che non arriva a destinazione è «sei offline», non «fetch failed».
function humanNetworkError(e) {
  const msg = String((e && e.message) || e || '');
  if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(msg)) {
    const err = new Error('nessuna connessione a internet');
    err.code = 'offline';
    return err;
  }
  return e;
}

function filePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'identity.bin');
}

function canEncrypt() {
  try { return require('electron').safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function persist() {
  if (!session?.refreshToken || !canEncrypt() || fileIntoccabile) return false;
  try {
    const { safeStorage } = require('electron');
    Disco.scriviSync(filePath(), safeStorage.encryptString(JSON.stringify({ refreshToken: session.refreshToken, uid: session.uid })), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[identity] salvataggio fallito:', e?.message || e);
    return false;
  }
}

function decifraDati(raw) {
  try {
    const { safeStorage } = require('electron');
    const j = JSON.parse(safeStorage.decryptString(raw));
    return j && j.refreshToken ? j : null;
  } catch (_) { return null; }
}

function decifra(file) {
  try { return decifraDati(fs.readFileSync(file)); } catch (_) { return null; }
}

// Un file che non si decifra (portachiavi sbagliato su Linux, DPAPI di un altro profilo su Windows) si
// mette da parte, non si cancella. Se il portafoglio aspetta proprio quell'identità, all'avvio dopo si
// riprovano le copie messe da parte: tornata la chiave giusta, tutto riparte da solo.
function load() {
  if (!canEncrypt()) return null;
  const file = filePath();
  Disco.togliTemporaneiUnaVolta(file);
  let raw;
  try { raw = Disco.leggiSync(file); } catch (e) {
    console.warn('[identity] file non letto, non lo sovrascrivo:', e?.message || e);
    fileIntoccabile = true;
    return null;
  }
  if (raw) {
    const dati = decifraDati(raw);
    if (dati) return dati;
    console.warn('[identity] file illeggibile, lo metto da parte');
    if (!guasti.metteDaParte(file, 'illeggibile-' + guasti.timbro())) fileIntoccabile = true;
    return null;
  }
  if (!walletStore.suDisco()) return null;
  const dati = guasti.riprendiDaParte(file, 'illeggibile-', decifra);
  if (dati) console.info('[identity] identità messa da parte di nuovo leggibile: ripresa');
  return dati;
}

function decodeJwtPayload(tok) {
  try {
    const part = String(tok).split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (_) { return {}; }
}

// All'avvio: rilegge il file, senza rete.
function restore() {
  const saved = load();
  if (saved?.refreshToken) session = { refreshToken: saved.refreshToken, uid: saved.uid || null, idToken: null, idTokenExp: 0 };
  return Boolean(session);
}

// Crea l'identità anonima. Errori tipici, resi leggibili: il provider anonimo
// spento nella console Firebase (ADMIN_ONLY_OPERATION), rete assente.
async function signUpAnonymous() {
  let res;
  try {
    res = await fetch(`${IDENTITY_ENDPOINT}?key=${cfg.firebaseApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
  } catch (e) { throw humanNetworkError(e); }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(/ADMIN_ONLY_OPERATION/.test(text)
      ? 'identità anonima non abilitata sul server (Firebase → Authentication → Anonymous)'
      : `identità dell'installazione non creata (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const j = await res.json(); // { idToken, refreshToken, expiresIn, localId }
  session = {
    refreshToken: j.refreshToken,
    idToken: j.idToken,
    idTokenExp: Date.now() + (Number(j.expiresIn || 3600) - 60) * 1000,
    uid: j.localId || decodeJwtPayload(j.idToken).user_id || null,
  };
  persist();
  return session;
}

async function refresh() {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
  let res;
  try {
    res = await fetch(`${SECURE_TOKEN_ENDPOINT}?key=${cfg.firebaseApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e) { throw humanNetworkError(e); }
  if (!res.ok) {
    // Persa solo se il servizio dice che il token non vale più (account cancellato o disattivato):
    // una chiave API ruotata, un 503 o un proxy non toccano né l'identità né il file.
    // Anche persa, non se ne crea un'altra qui: il portafoglio è legato a questa.
    const testo = await res.text().catch(() => '');
    if (!guasti.rinnovoRifiutato(testo)) throw guasti.nonRaggiungibile(res.status);
    lost = true;
    throw erroreIdentita('identity_lost');
  }
  const j = await res.json();
  session.idToken = j.id_token;
  session.idTokenExp = Date.now() + (Number(j.expires_in || 3600) - 60) * 1000;
  session.uid = j.user_id || session.uid || decodeJwtPayload(j.id_token).user_id || null;
  if (j.refresh_token && j.refresh_token !== session.refreshToken) { session.refreshToken = j.refresh_token; persist(); }
  return session.idToken;
}

// L'idToken dell'installazione, creandola se manca. Una sola chiamata in volo alla volta:
// dieci chiamanti all'avvio non devono creare dieci account.
async function getIdToken() {
  if (session?.idToken && Date.now() < session.idTokenExp) return session.idToken;
  if (lost) throw erroreIdentita('identity_lost');
  if (inflight) return inflight;
  // Il portachiavi può sbloccarsi dopo l'avvio: prima di arrendersi si rilegge il disco. Fuori dalla
  // corsa in volo: un errore sincrono lì dentro lascerebbe `inflight` fermo su un rifiuto per sempre.
  if (!session?.refreshToken && walletStore.suDisco()) restore();
  if (isUnreadable()) throw erroreIdentita('identity_unreadable');
  inflight = (async () => {
    try {
      if (session?.refreshToken) return await refresh();
      await signUpAnonymous();
      return session.idToken;
    } finally { inflight = null; }
  })();
  return inflight;
}

function isLost() { return lost; }

// Un portafoglio su disco senza l'identità che lo regge: crearne una nuova lo staccherebbe per sempre.
function isUnreadable() { return !session?.refreshToken && walletStore.suDisco(); }

// Solo per i test: butta via il token in memoria, così la prossima richiesta
// deve rinnovarlo (è il caso «riapri Filo senza rete»).
function _expireToken() { if (session) { session.idToken = null; session.idTokenExp = 0; } }

// Ricomincia da zero: scelta confermata dall'utente dopo che l'identità è persa o illeggibile.
// Il file resta accanto; la prossima richiesta crea un'identità nuova.
function resetIdentity() {
  session = null; lost = false; inflight = null; fileIntoccabile = false;
  try { guasti.metteDaParte(filePath(), 'prev'); } catch (_) {}
}

async function getUid() {
  if (session?.uid) return session.uid;
  const tok = await getIdToken();
  return session?.uid || decodeJwtPayload(tok).user_id || null;
}

// L'idToken corrente SENZA fare rete (per il collegamento all'account Google:
// se non c'è un'identità, non c'è niente da collegare).
function currentIdTokenSync() {
  return session?.idToken && Date.now() < session.idTokenExp ? session.idToken : null;
}

function hasIdentity() { return Boolean(session?.refreshToken); }

// Per il confronto delle uscite (#810): i valori, mai a un prompt.
function segreti() { return [session?.refreshToken, session?.idToken].filter(Boolean); }

// Dopo un collegamento riuscito l'account non è più anonimo, ma il refresh
// token resta valido e punta allo stesso uid: nulla da fare. Esposto per i test.
function _reset() { session = null; inflight = null; fileIntoccabile = false; }

module.exports = { restore, segreti, getIdToken, getUid, currentIdTokenSync, hasIdentity, isLost, isUnreadable, resetIdentity, _reset, _expireToken };
