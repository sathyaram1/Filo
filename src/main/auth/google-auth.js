// Manager del login "Accedi con Google" per Filo desktop.
//
// Flusso (vedi Filo/SECURITY.md §1):
//   Fase 1 — Google OAuth 2.0 Authorization Code + PKCE:
//     apre il consenso in una SCHEDA di Filo (così l'account Google entra anche
//     nelle schede, #1123; se Google la rifiuta, nel browser di sistema), riceve
//     il codice su un micro-server loopback temporaneo, lo scambia per un id_token.
//   Fase 2 — Firebase Identity Toolkit (signInWithIdp):
//     scambia l'id_token Google per un Firebase ID token + refresh token.
//     Solo il Firebase ID token popola request.auth nelle regole Firestore.
//
// Persistiamo SOLO il refresh token Firebase + il profilo, cifrati via
// token-store (safeStorage). L'ID token (vita breve) si rigenera al bisogno.
//
// Tutto vive nel processo main: i token non sono mai esposti alle pagine web.

const http = require('node:http');
// Niente require('electron') a livello di modulo: questo file viene richiesto
// (transitivamente, via defaultsStore/supportModelsStore) anche dagli unit test
// node:test che girano fuori da Electron: `shell` e `net` si chiedono dentro le funzioni.
const cfg = require('./config');
const pkce = require('./pkce');
const store = require('./token-store');
const guasti = require('./guastiAccesso');

let session = null; // { refreshToken, idToken, idTokenExp, email, name, picture }
// Se la sessione sopravviverà alla chiusura: senza cifratura del sistema resta
// solo in memoria, e chi ha appena fatto l'accesso deve saperlo subito (#708.1).
let ricordata = false;

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

// `code` è la causa per chi ha chiesto l'accesso (esitoAccesso.js ne fa la frase).
function erroreAccesso(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Chi chiude la scheda del browser non richiama mai il loopback: senza un tetto
// l'accesso resterebbe in corso per sempre. Largo: consenso, scelta account, 2FA.
const ATTESA_ACCESSO_MS = 10 * 60 * 1000;
let flussoInCorso = null;

// A tempo costante: un tentativo sbagliato non chiude più l'ascolto, quindi i tentativi sono illimitati.
function stessoState(ricevuto, atteso) {
  const a = Buffer.from(String(ricevuto ?? ''));
  const b = Buffer.from(String(atteso));
  return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
}

// Avvia un server loopback effimero e ritorna { redirectUri, waitForCode, abort }.
function startLoopback(expectedState) {
  return new Promise((resolve, reject) => {
    let resolveCode, rejectCode;
    const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
    codePromise.catch(() => {}); // un flusso interrotto prima di waitForCode non è un rifiuto orfano

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      // Lo state prima di tutto: una richiesta che non lo porta (un altro programma locale, il favicon) non chiude
      // né fa fallire l'accesso, che resta in ascolto del ritorno vero.
      if (!stessoState(url.searchParams.get('state'), expectedState)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Richiesta non riconosciuta.');
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">'
        + (error || !code
          ? 'Accesso non riuscito. Puoi chiudere questa scheda.'
          : 'Accesso a Filo completato. Puoi chiudere questa scheda e tornare all\'app.')
        + '</body>');
      server.close();
      if (error) return rejectCode(erroreAccesso(error === 'access_denied' ? 'annullato' : 'servizio', 'OAuth: ' + error));
      if (!code) return rejectCode(new Error('OAuth: nessun code nel redirect'));
      resolveCode(code);
    });

    server.on('error', reject);
    // porta 0 = il SO assegna una porta libera, solo su loopback.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const abort = (err) => { server.close(() => {}); rejectCode(err); };
      resolve({ redirectUri: `http://127.0.0.1:${port}`, waitForCode: () => codePromise, abort });
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
    // Niente returnIdpCredential: con quello un collegamento rifiutato torna 200, senza token.
    const body = {
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: 'http://localhost',
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
    const fb = await res.json(); // { idToken, refreshToken, email, emailVerified, displayName, photoUrl, expiresIn }
    if (!rispostaConSessione(fb)) {
      throw new Error(`Firebase signInWithIdp senza sessione: ${String(fb?.errorMessage || (fb?.needConfirmation ? 'needConfirmation' : 'token assenti')).slice(0, 120)}`);
    }
    return fb;
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
  ricordata = store.save({
    refreshToken: session.refreshToken,
    email: session.email,
    name: session.name,
    picture: session.picture,
    foto: session.foto || '',
    fotoDi: session.fotoDi || '',
  });
}

// La foto del profilo è una copia nella cartella dati (#1273): si scarica una volta per account (o quando Google ne indica
// un'altra, o all'avvio dopo se non era arrivata), senza cookie, e barra, shell e home la mostrano da lì. `suFoto` avvisa chi deve ridisegnarla.
const copie = () => require('../services/copieIcone');
const ascoltaFoto = new Set();
function suFoto(fn) { ascoltaFoto.add(fn); return () => ascoltaFoto.delete(fn); }
let fotoInCorso = null;
let fotoPer = null;
// L'account vale per tutte le finestre: la copia va su disco anche se l'accesso è partito da una finestra in incognito.
const fuoriIncognito = (fn) => { try { return require('../shim/storage').runNormale(fn); } catch (_) { return fn(); } };

function aggiornaFoto() {
  const s = session;
  // Un accesso nuovo mentre arriva la foto di quello prima aspetta il suo turno, non la perde.
  if (fotoInCorso) return fotoPer === s ? fotoInCorso : fotoInCorso.then(() => aggiornaFoto());
  if (!s || (!s.picture && !s.foto)) return Promise.resolve();
  const nome = copie().nomeDa(s.foto);
  const presente = !!nome && require('node:fs').existsSync(require('node:path').join(copie().cartella(), nome));
  if (s.fotoDi === s.picture && (presente || !s.foto)) return Promise.resolve();
  fotoPer = s;
  fotoInCorso = fuoriIncognito(async () => {
    let rif = '';
    if (s.picture) {
      const { session: sessioni } = require('electron');
      const { dato } = await require('../services/iconaScheda').iconaPer(sessioni.defaultSession, [s.picture], { cookie: false });
      rif = dato ? await copie().conserva(dato) : '';
    }
    if (session !== s) { copie().togliSeOrfane(rif); return; }
    // Non arrivata (rete assente, server che non risponde): non si segna come presa, così l'avvio dopo la richiede.
    if (s.picture && !rif) return;
    const vecchia = s.foto;
    s.foto = rif;
    s.fotoDi = s.picture;
    persist();
    if (vecchia && vecchia !== rif) copie().togliSeOrfane(vecchia);
    for (const fn of ascoltaFoto) { try { fn(getProfile()); } catch (_) {} }
  }).catch(() => {}).finally(() => { fotoInCorso = null; fotoPer = null; });
  return fotoInCorso;
}
copie().usaCopie('foto-profilo', () => [session && session.foto]);

// Una risposta 200 può non essere un accesso (FEDERATED_USER_ID_ALREADY_LINKED, needConfirmation): senza i due
// token non c'è sessione, e salvarla farebbe credere a un accesso riuscito.
function rispostaConSessione(fb) {
  return Boolean(fb && !fb.errorMessage && fb.idToken && fb.refreshToken);
}

function setSession(fb) {
  // Prima di toccare la sessione o il segno dell'owner caduto (#912): un accesso non avvenuto non li cambia.
  if (!rispostaConSessione(fb)) throw new Error('accesso senza sessione: risposta di Firebase senza token');
  const prima = session;
  const picture = fb.photoUrl || '';
  // Lo stesso account con la stessa foto tiene la sua copia; un altro account la sua la scarica di nuovo.
  const stessaFoto = !!(prima && prima.foto && prima.fotoDi === picture && prima.email === (fb.email || ''));
  if (prima && prima.foto && !stessaFoto) copie().togliSeOrfane(prima.foto);
  session = {
    refreshToken: fb.refreshToken,
    idToken: fb.idToken,
    idTokenExp: Date.now() + (Number(fb.expiresIn || 3600) - 60) * 1000,
    email: fb.email || '',
    name: fb.displayName || '',
    picture,
    foto: stessaFoto ? prima.foto : '',
    fotoDi: stessaFoto ? prima.fotoDi : '',
  };
  segnaOwnerCaduto(false);
}

// #912: l'owner buttato fuori da un rinnovo fallito resta l'owner per i feedback che manda dopo (aspettano che
// rientri, non partono da anonimi). Un file e non la memoria: vale anche dopo un riavvio. Lo toglie solo un accesso o un'uscita voluta.
let ownerCaduto = null;
function fileOwnerCaduto() {
  const { app } = require('electron');
  return require('node:path').join(app.getPath('userData'), 'accesso-owner-caduto');
}
function accessoOwnerCaduto() {
  if (ownerCaduto === null) {
    try { ownerCaduto = require('node:fs').existsSync(fileOwnerCaduto()); } catch (_) { ownerCaduto = false; }
  }
  return ownerCaduto;
}
function segnaOwnerCaduto(caduto) {
  if (accessoOwnerCaduto() === !!caduto) return;
  ownerCaduto = !!caduto;
  try {
    const fs = require('node:fs');
    if (caduto) fs.writeFileSync(fileOwnerCaduto(), String(Date.now()));
    else fs.rmSync(fileOwnerCaduto(), { force: true });
  } catch (_) {}
}

// API pubblica

// Carica la sessione persistita all'avvio (non fa rete: l'id token si
// rinnoverà alla prima richiesta che lo serve).
function restore() {
  const saved = store.load();
  if (saved?.refreshToken) {
    session = { ...saved, idToken: null, idTokenExp: 0 };
    ricordata = store.canEncrypt();
    // Una sessione di prima del #1273 ha solo l'indirizzo della foto: la copia si fa una volta, adesso.
    try { aggiornaFoto(); } catch (_) {}
  }
  return getProfile();
}

async function signIn() {
  if (!cfg.isConfigured()) {
    throw erroreAccesso('non-configurato', 'Login non configurato: manca il Google OAuth Client ID (vedi src/main/auth/config.js).');
  }
  const { net } = require('electron');
  if (net && typeof net.isOnline === 'function' && !net.isOnline()) {
    throw erroreAccesso('rete', 'nessuna connessione');
  }
  // Un accesso alla volta: chi lo chiede mentre uno aspetta riporta davanti la
  // STESSA pagina e ne condivide l'esito, così qualunque strada completi arriva a Filo.
  if (flussoInCorso) {
    const f = await flussoInCorso;
    if (f.aspettaBrowser) {
      f.rinnovaAttesa();
      await mostraAccesso(f);
    }
    return f.esito;
  }
  const prossimo = nuovoFlusso();
  flussoInCorso = prossimo;
  const libera = () => { if (flussoInCorso === prossimo) flussoInCorso = null; };
  let f;
  try {
    f = await prossimo;
  } catch (e) {
    libera();
    throw e;
  }
  f.esito.then(libera, libera);
  try {
    await mostraAccesso(f);
  } catch (e) {
    f.loop.abort(e);
    throw e;
  }
  return f.esito;
}

const AVVISO_NEL_BROWSER = 'Google non accetta l\'accesso dentro Filo, quindi continua nel browser. Filo si collega lo stesso, ma YouTube, Gmail e Drive nelle schede restano scollegati.';
const AVVISO_NON_CARICATA = 'La pagina d\'accesso di Google non si è caricata in Filo, quindi continua nel browser.';

// Prima in una scheda della finestra normale: lì l'accesso a Google vale anche per YouTube, Gmail e Drive (#1123).
// Il browser di sistema resta il ripiego, quando Google rifiuta la scheda o una finestra normale non c'è.
async function mostraAccesso(f) {
  if (f.scheda && f.scheda.riporta()) return;
  if (!f.nelBrowser) {
    let scheda = null;
    try {
      scheda = require('./accessoInScheda').apri(f.url, {
        hostAccesso: hostDi(cfg.authEndpoint),
        suChiusa: () => f.loop.abort(erroreAccesso('annullato', 'scheda di accesso chiusa')),
        suRifiuto: (motivo) => passaAlBrowser(f, motivo),
      });
    } catch (_) {}
    if (scheda) { f.scheda = scheda; return; }
  }
  f.nelBrowser = true;
  await apriBrowser(f.url);
}

// Lo stesso indirizzo, quindi lo stesso codice e lo stesso loopback: l'accesso a Filo riesce comunque.
function passaAlBrowser(f, motivo) {
  f.scheda = null;
  f.nelBrowser = true;
  console.warn('[auth] scheda d\'accesso abbandonata (' + motivo + '): accesso nel browser di sistema');
  // Una pagina che non si carica non è un no di Google: la riga dice il motivo vero, e l'invito a collegare resta.
  const nonCaricata = motivo === 'rete';
  if (!nonCaricata) { try { require('./prodottiGoogle').googleRifiutaLeSchede(); } catch (_) {} }
  // La riga «continua nel browser» solo se il browser si è aperto: altrimenti parla l'errore dell'accesso.
  apriBrowser(f.url).then(() => {
    const testo = nonCaricata ? AVVISO_NON_CARICATA : AVVISO_NEL_BROWSER;
    try { require('../services/avvisoFinestra').avvisoNellaFinestra(testo, { chiave: 'accesso-nel-browser', tipo: 'accesso_nel_browser' }); } catch (_) {}
  }, (e) => f.loop.abort(e));
}

function hostDi(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (_) { return ''; }
}

async function apriBrowser(url) {
  try {
    await require('electron').shell.openExternal(url);
  } catch (e) {
    throw erroreAccesso('browser', 'browser non aperto: ' + (e?.message || e));
  }
}

async function nuovoFlusso() {
  const { verifier, challenge, method, state } = pkce.createPkce();
  const loop = await startLoopback(state);
  const { redirectUri } = loop;

  const authUrl = new URL(cfg.authEndpoint);
  authUrl.search = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: method,
    state,
    // Di Google serve solo l'id_token: niente accesso offline, e il consenso si chiede una volta sola.
    prompt: 'select_account',
  }).toString();

  const f = { url: authUrl.toString(), loop, aspettaBrowser: true, scheda: null, nelBrowser: false };
  let timer = null;
  // Il tetto riparte a ogni riapertura: chi riapre il browser ricomincia da capo.
  f.rinnovaAttesa = () => {
    clearTimeout(timer);
    timer = setTimeout(() => loop.abort(erroreAccesso('scaduto', 'accesso non completato in tempo')), ATTESA_ACCESSO_MS);
  };
  f.rinnovaAttesa();
  f.esito = (async () => {
    let code;
    try {
      code = await loop.waitForCode();
    } finally {
      clearTimeout(timer);
      f.aspettaBrowser = false;
      // Arrivato il codice (o finita l'attesa) la scheda resterebbe su una pagina morta del loopback.
      if (f.scheda) { f.scheda.chiudi(); f.scheda = null; }
    }
    const googleTok = await exchangeCodeForGoogleToken(code, verifier, redirectUri);
    if (!googleTok.id_token) throw new Error('OAuth: nessun id_token da Google');
    const fb = await signInWithFirebase(googleTok.id_token);
    setSession(fb);
    persist();
    aggiornaFoto();
    return getProfile();
  })();
  return f;
}

// Per il confronto delle uscite (#810): i valori, mai a un prompt.
function segreti() {
  return [session?.refreshToken, session?.idToken].filter(Boolean);
}

function chiudiSessione() {
  const foto = session && session.foto;
  session = null;
  ricordata = false;
  store.clear();
  if (foto) copie().togliSeOrfane(foto);
}

function signOut() {
  chiudiSessione();
  segnaOwnerCaduto(false);
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
    // Si esce solo se il servizio dice che il refresh token non vale più: un 503 o un proxy
    // che risponde 403 lasciano sessione e auth.bin come sono, e il prossimo tentativo riesce.
    const testo = await res.text().catch(() => '');
    if (!guasti.rinnovoRifiutato(testo)) throw guasti.nonRaggiungibile(res.status);
    const eraOwner = isAdmin();
    chiudiSessione();
    if (eraOwner) segnaOwnerCaduto(true);
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

// `picture` è la copia della foto (filo://icone/…), mai l'indirizzo di Google: le pagine non la chiedono a nessuno.
function getProfile() {
  if (!session) return null;
  return { email: session.email, name: session.name, picture: copie().eCopia(session.foto) ? session.foto : '' };
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

function isRemembered() {
  return isSignedIn() && ricordata;
}

// True se l'utente loggato è nell'allowlist admin (gate UX; la garanzia forte
// è nelle Firestore rules). Senza sessione → false.
function isAdmin() {
  return isSignedIn() && cfg.isAdminEmail(session?.email);
}

module.exports = {
  restore,
  segreti,
  signIn,
  signOut,
  getIdToken,
  getUid,
  getProfile,
  getTokenClaims,
  isSignedIn,
  isRemembered,
  isAdmin,
  accessoOwnerCaduto,
  suFoto,
  aggiornaFoto,
  // esportati per i test
  _internals: { decodeJwtPayload, startLoopback, nuovoFlusso },
};
