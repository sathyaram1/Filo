// Login «Accedi con Google»: OAuth PKCE nel browser di sistema, poi Firebase signInWithIdp.
// Solo il Firebase ID token popola request.auth nelle regole Firestore (SECURITY.md §1).
// Si persiste solo il refresh token, cifrato; i token non escono mai dal processo main.

const http = require('node:http');
// electron si richiede dentro signIn(): gli unit test caricano questo file senza Electron.
const cfg = require('./config');
const pkce = require('./pkce');
const store = require('./token-store');

let session = null; // { refreshToken, idToken, idTokenExp, email, name, picture }

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

// Avvia un server loopback effimero e ritorna { redirectUri, waitForCode }.
function startLoopback(expectedState) {
  return new Promise((resolve, reject) => {
    let resolveCode, rejectCode;
    const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">'
        + (error || !code
          ? 'Accesso non riuscito. Puoi chiudere questa scheda.'
          : 'Accesso a Filo completato. Puoi chiudere questa scheda e tornare all\'app.')
        + '</body>');
      server.close();
      if (error) return rejectCode(new Error('OAuth: ' + error));
      if (!code) return rejectCode(new Error('OAuth: nessun code nel redirect'));
      if (state !== expectedState) return rejectCode(new Error('OAuth: state non corrispondente (possibile CSRF)'));
      resolveCode(code);
    });

    server.on('error', reject);
    // porta 0 = il SO assegna una porta libera, solo su loopback.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ redirectUri: `http://127.0.0.1:${port}`, waitForCode: () => codePromise });
    });
  });
}

async function exchangeCodeForGoogleToken(code, verifier, redirectUri) {
  const body = new URLSearchParams({
    client_id: cfg.googleClientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (cfg.googleClientSecret) body.set('client_secret', cfg.googleClientSecret);

  const res = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`scambio token Google fallito (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json(); // { id_token, access_token, ... }
}

// Collegamento all'identità dell'installazione (#598): si passa il suo idToken, così l'uid
// non cambia. Se Google è già legato altrove si fa il login normale, a identità distinte.
async function signInWithFirebase(googleIdToken) {
  const anonToken = await installationToken();
  const attempt = async (linkTo) => {
    const body = {
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: true,
      returnSecureToken: true,
    };
    if (linkTo) body.idToken = linkTo;
    const res = await fetch(`${cfg.signInWithIdpEndpoint}?key=${cfg.firebaseApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error(`Firebase signInWithIdp fallito (${res.status}): ${(await res.text()).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json(); // { idToken, refreshToken, email, emailVerified, displayName, photoUrl, expiresIn }
  };
  if (anonToken) {
    try { return await attempt(anonToken); } catch (e) {
      console.warn("[auth] collegamento all'identità dell'installazione non riuscito, login separato:", e?.message || e);
    }
  }
  return attempt(null);
}

// L'idToken dell'identità anonima, rinnovato se scaduto: senza identità non c'è niente da
// collegare, e se il rinnovo non riesce si fa il login normale.
async function installationToken() {
  try {
    const anon = require('./anon-auth');
    if (!anon.hasIdentity()) return null;
    return await anon.getIdToken();
  } catch (_) { return null; }
}

function persist() {
  if (!session) return;
  store.save({
    refreshToken: session.refreshToken,
    email: session.email,
    name: session.name,
    picture: session.picture,
  });
}

function setSession(fb) {
  session = {
    refreshToken: fb.refreshToken,
    idToken: fb.idToken,
    idTokenExp: Date.now() + (Number(fb.expiresIn || 3600) - 60) * 1000,
    email: fb.email || '',
    name: fb.displayName || '',
    picture: fb.photoUrl || '',
  };
}

// API pubblica

// Carica la sessione persistita all'avvio (non fa rete: l'id token si
// rinnoverà alla prima richiesta che lo serve).
function restore() {
  const saved = store.load();
  if (saved?.refreshToken) {
    session = { ...saved, idToken: null, idTokenExp: 0 };
  }
  return getProfile();
}

async function signIn() {
  if (!cfg.isConfigured()) {
    throw new Error('Login non configurato: manca il Google OAuth Client ID (vedi src/main/auth/config.js).');
  }
  const { verifier, challenge, method, state } = pkce.createPkce();
  const { redirectUri, waitForCode } = await startLoopback(state);

  const authUrl = new URL(cfg.authEndpoint);
  authUrl.search = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: method,
    state,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

  const { shell } = require('electron');
  await shell.openExternal(authUrl.toString());

  const code = await waitForCode();
  const googleTok = await exchangeCodeForGoogleToken(code, verifier, redirectUri);
  if (!googleTok.id_token) throw new Error('OAuth: nessun id_token da Google');
  const fb = await signInWithFirebase(googleTok.id_token);
  setSession(fb);
  persist();
  return getProfile();
}

function signOut() {
  session = null;
  store.clear();
}

async function refreshIfNeeded() {
  if (!session?.refreshToken) return null;
  if (session.idToken && Date.now() < session.idTokenExp) return session.idToken;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  });
  const res = await fetch(`${cfg.secureTokenEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // Refresh token revocato/scaduto → sessione non più valida.
    signOut();
    throw new Error(`refresh sessione fallito (${res.status})`);
  }
  const j = await res.json(); // { id_token, refresh_token, expires_in }
  session.idToken = j.id_token;
  session.idTokenExp = Date.now() + (Number(j.expires_in || 3600) - 60) * 1000;
  if (j.refresh_token) { session.refreshToken = j.refresh_token; persist(); }
  return session.idToken;
}

// Firebase ID token valido per le chiamate Firestore (Authorization: Bearer).
async function getIdToken() {
  return refreshIfNeeded();
}

// È l'uid, non l'email, quello che le regole Firestore vedono come request.auth.uid
// (es. il vincolo chiave==uid del voto sulla board). null se non loggato.
async function getUid() {
  if (!isSignedIn()) return null;
  try {
    const tok = await getIdToken();
    if (!tok) return null;
    const p = decodeJwtPayload(tok);
    return p.user_id || p.sub || null;
  } catch (_) { return null; }
}

function getProfile() {
  if (!session) return null;
  return { email: session.email, name: session.name, picture: session.picture };
}

// Claim email/email_verified come le vedono le regole: servono a spiegare un 403
// «Missing or insufficient permissions» in termini azionabili. null se il token manca.
function getTokenClaims() {
  const tok = session?.idToken;
  const p = tok ? decodeJwtPayload(tok) : {};
  return {
    email: p.email || session?.email || '',
    email_verified: typeof p.email_verified === 'boolean' ? p.email_verified : null,
  };
}

function isSignedIn() {
  return Boolean(session?.refreshToken);
}

// True se l'utente loggato è nell'allowlist admin (gate UX; la garanzia forte
// è nelle Firestore rules). Senza sessione → false.
function isAdmin() {
  return isSignedIn() && cfg.isAdminEmail(session?.email);
}

module.exports = {
  restore,
  signIn,
  signOut,
  getIdToken,
  getUid,
  getProfile,
  getTokenClaims,
  isSignedIn,
  isAdmin,
  // esportati per i test
  _internals: { decodeJwtPayload, startLoopback },
};
