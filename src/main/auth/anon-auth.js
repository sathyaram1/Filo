// Identità dell'installazione: un account Firebase ANONIMO per copia di Filo
// (feedback #598).
//
// PERCHÉ
//   La chiave OpenRouter personale e i crediti appartengono all'installazione,
//   non a un account Google: Filo deve funzionare senza login. Firebase dà a
//   ogni installazione un uid anonimo; il server ci costruisce sopra lo
//   pseudonimo (hash dell'uid con un sale che sta solo lì) e il portafoglio.
//
// COME
//   Al primo bisogno si chiama `accounts:signUp` senza email né password: torna
//   un uid, un idToken e un refreshToken. Si conserva SOLO il refreshToken,
//   cifrato con safeStorage (stesso schema di token-store.js) in un file suo.
//   Il resto (idToken, uid) si ricava dal refresh.
//
// LOGIN GOOGLE
//   Quando l'utente fa il login con Google, google-auth.js prova a COLLEGARE
//   l'account Google a questa identità (signInWithIdp con l'idToken anonimo):
//   così l'uid resta lo stesso e portafoglio e crediti seguono l'account. Se il
//   collegamento non è possibile (account Google già legato a un'altra
//   installazione) il login avviene comunque, con due identità distinte: il
//   portafoglio resta su questa. È il caso di chi installa Filo su un secondo
//   computer: lì dovrà riscattare un invito suo.
//
// Nessun require('electron') a livello di modulo: gli unit test lo caricano
// fuori da Electron. Endpoint sovrascrivibili via env per i test.

const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');

const IDENTITY_ENDPOINT = process.env.FILO_IDENTITY_ENDPOINT
  || 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const SECURE_TOKEN_ENDPOINT = process.env.FILO_SECURE_TOKEN_ENDPOINT || cfg.secureTokenEndpoint;

let session = null; // { refreshToken, idToken, idTokenExp, uid }
let inflight = null;

function filePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'identity.bin');
}

function canEncrypt() {
  try { return require('electron').safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function persist() {
  if (!session?.refreshToken || !canEncrypt()) return false;
  try {
    const { safeStorage } = require('electron');
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify({ refreshToken: session.refreshToken, uid: session.uid })), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[identity] salvataggio fallito:', e?.message || e);
    return false;
  }
}

function load() {
  if (!canEncrypt()) return null;
  let raw;
  try { raw = fs.readFileSync(filePath()); } catch (_) { return null; }
  try {
    const { safeStorage } = require('electron');
    return JSON.parse(safeStorage.decryptString(raw));
  } catch (e) {
    console.warn('[identity] file illeggibile, lo elimino:', e?.message || e);
    try { fs.rmSync(filePath(), { force: true }); } catch (_) {}
    return null;
  }
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
  const res = await fetch(`${IDENTITY_ENDPOINT}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
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
  const res = await fetch(`${SECURE_TOKEN_ENDPOINT}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // Token revocato (account cancellato dalla console): l'identità è persa,
    // se ne crea una nuova. Il portafoglio legato a quella vecchia non torna.
    if (res.status === 400) { session = null; try { fs.rmSync(filePath(), { force: true }); } catch (_) {} }
    throw new Error(`rinnovo identità fallito (${res.status})`);
  }
  const j = await res.json();
  session.idToken = j.id_token;
  session.idTokenExp = Date.now() + (Number(j.expires_in || 3600) - 60) * 1000;
  session.uid = j.user_id || session.uid || decodeJwtPayload(j.id_token).user_id || null;
  if (j.refresh_token && j.refresh_token !== session.refreshToken) { session.refreshToken = j.refresh_token; persist(); }
  return session.idToken;
}

// L'idToken dell'installazione, creando l'identità se non c'è ancora. Una sola
// chiamata in volo alla volta: dieci chiamanti all'avvio non devono creare
// dieci account.
async function getIdToken() {
  if (session?.idToken && Date.now() < session.idTokenExp) return session.idToken;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (session?.refreshToken) {
        try { return await refresh(); } catch (e) { if (session) throw e; /* identità persa: si ricrea */ }
      }
      await signUpAnonymous();
      return session.idToken;
    } finally { inflight = null; }
  })();
  return inflight;
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

// Dopo un collegamento riuscito l'account non è più anonimo, ma il refresh
// token resta valido e punta allo stesso uid: nulla da fare. Esposto per i test.
function _reset() { session = null; inflight = null; }

module.exports = { restore, getIdToken, getUid, currentIdTokenSync, hasIdentity, _reset };
