// One-time: ottieni il refresh token Firebase dell'account OWNER (admin) per
// scrivere su Firestore dagli script che l'owner lancia in locale.
//
// PERCHÉ ESISTE
//   `scripts/owner-feedback.mjs` (le scritture dell'owner sui feedback), i
//   backfill e le migrazioni passano tutti da `scripts/lib/firestore-auth.mjs`,
//   che scrive su Firestore come admin pieno e ha bisogno di un refresh token
//   Firebase di lunga durata da scambiare per un ID token.
//   Questo script esegue UNA VOLTA, in locale, il login interattivo
//   Google→Firebase e stampa quel refresh token, da salvare nella variabile
//   d'ambiente `FILO_ADMIN_REFRESH_TOKEN` (o nel file `tests/agent/.env` della
//   root, gitignorato, accanto al token routine).
//
// USA L'ACCOUNT OWNER (quello in `adminEmails` di src/main/auth/config.js, cioè
// nella collezione `admins` su Firebase). NON l'account robot delle routine
// (è stato bloccato da Google). Il token admin resta SOLO sulla tua macchina:
// le routine cloud non lo vedono mai — consegnano le loro decisioni al canale
// autenticato verso il server (`scripts/routine-channel.mjs`), che le valida e
// le scrive per conto loro.
//
// USO:
//   node scripts/admin-login.mjs
//   (si apre il browser; accedi con l'account OWNER; il token viene stampato)

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = require(resolve(__dirname, '..', 'src', 'main', 'auth', 'config.js'));
const pkce = require(resolve(__dirname, '..', 'src', 'main', 'auth', 'pkce.js'));

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `cmd /c start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function startLoopback(expectedState) {
  return new Promise((resolveSrv) => {
    let resolveCode, rejectCode;
    const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">'
        + (error || !code ? 'Login non riuscito. Puoi chiudere questa scheda.'
          : 'Login admin completato. Torna al terminale: il refresh token è stato stampato.')
        + '</body>');
      server.close();
      if (error) return rejectCode(new Error('OAuth: ' + error));
      if (!code) return rejectCode(new Error('OAuth: nessun code nel redirect'));
      if (state !== expectedState) return rejectCode(new Error('OAuth: state non corrispondente (CSRF?)'));
      resolveCode(code);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveSrv({ redirectUri: `http://127.0.0.1:${port}`, waitForCode: () => codePromise });
    });
  });
}

async function main() {
  if (!cfg.isConfigured()) throw new Error('Manca il Google OAuth Client ID in src/main/auth/config.js');

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

  console.log('\nApro il browser per il login dell\'account OWNER (admin).');
  console.log('Se non si apre, vai a:\n' + authUrl.toString() + '\n');
  openBrowser(authUrl.toString());

  const code = await waitForCode();

  // Fase 1: code → id_token Google.
  const tokBody = new URLSearchParams({
    client_id: cfg.googleClientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (cfg.googleClientSecret) tokBody.set('client_secret', cfg.googleClientSecret);
  const tokRes = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokBody,
  });
  if (!tokRes.ok) throw new Error(`scambio token Google fallito (${tokRes.status}): ${(await tokRes.text()).slice(0, 300)}`);
  const googleTok = await tokRes.json();
  if (!googleTok.id_token) throw new Error('OAuth: nessun id_token da Google');

  // Fase 2: id_token Google → Firebase ID token + refresh token.
  const fbRes = await fetch(`${cfg.signInWithIdpEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${googleTok.id_token}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  if (!fbRes.ok) throw new Error(`Firebase signInWithIdp fallito (${fbRes.status}): ${(await fbRes.text()).slice(0, 300)}`);
  const fb = await fbRes.json();

  const isAdmin = cfg.isAdminEmail(fb.email);
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Account:', fb.email || '(email non disponibile)', '| email_verified:', fb.emailVerified);
  if (!isAdmin) {
    console.log('\n⚠  ATTENZIONE: questa email NON è nell\'allowlist admin');
    console.log('   (adminEmails in src/main/auth/config.js / collezione `admins`).');
    console.log('   Le PATCH di triage falliranno con 403. Rifai il login con l\'owner.');
  }
  console.log('\nSalva questo refresh token in `FILO_ADMIN_REFRESH_TOKEN`');
  console.log('(env, oppure in tests/agent/.env della root del repo principale):\n');
  console.log(fb.refreshToken);
  console.log('\n──────────────────────────────────────────────────────────────\n');
}

main().catch((e) => { console.error('\nErrore:', e.message); process.exit(1); });
