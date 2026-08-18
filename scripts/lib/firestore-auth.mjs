// Autenticazione Firestore per gli script Node del repo (owner-feedback,
// backfill e migrazioni). Due modalità, scelte in automatico da
// acquireBearer():
//
//   A) SERVICE ACCOUNT (GitHub Action): chiave JSON inline in `FILO_SA_KEY`
//      oppure percorso file in `GOOGLE_APPLICATION_CREDENTIALS`. Firma un JWT
//      con la chiave privata e lo scambia con un access token OAuth2 (scope
//      datastore): le scritture passano per l'IAM e bypassano le rules.
//
//   B) REFRESH TOKEN ADMIN (fallback locale dell'owner): refresh token
//      Firebase in `FILO_ADMIN_REFRESH_TOKEN` (env o tests/agent/.env della
//      root del repo principale, gitignorato). Si ottiene una tantum con
//      `node scripts/admin-login.mjs`. Le scritture passano per le rules col
//      ruolo admin.
//
// In entrambi i casi il risultato è un bearer da mettere in Authorization.

import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const cfg = require(resolve(ROOT, 'src', 'main', 'auth', 'config.js'));

export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${cfg.firebaseProjectId}/databases/(default)/documents`;
export const FIREBASE_API_KEY = cfg.firebaseApiKey;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// Trova FILO_ADMIN_REFRESH_TOKEN: prima da env, poi dal tests/agent/.env della
// root del repo principale (i worktree ne hanno uno proprio, vuoto).
export function findAdminRefreshToken() {
  if (process.env.FILO_ADMIN_REFRESH_TOKEN) return process.env.FILO_ADMIN_REFRESH_TOKEN;
  try {
    let commonDir = git(['rev-parse', '--git-common-dir']);
    if (!isAbsolute(commonDir)) commonDir = resolve(ROOT, commonDir);
    const mainRoot = dirname(commonDir); // .../Filo/.git → .../Filo
    const envPath = resolve(mainRoot, 'tests', 'agent', '.env');
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.startsWith('FILO_ADMIN_REFRESH_TOKEN='));
      if (line) return line.slice('FILO_ADMIN_REFRESH_TOKEN='.length).trim();
    }
  } catch (_) { /* git non disponibile o env assente: gestito dal chiamante */ }
  return null;
}

export async function mintIdToken(refreshToken) {
  const res = await fetch(`${cfg.secureTokenEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`refresh admin fallito (${res.status}): ${(await res.text()).slice(0, 200)}. Rigenera il token con: node scripts/admin-login.mjs`);
  }
  return (await res.json()).id_token;
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// Carica la chiave del service account: JSON inline in FILO_SA_KEY (GitHub
// Secret) oppure percorso a file in GOOGLE_APPLICATION_CREDENTIALS. Null se
// nessuna delle due è presente → si userà il fallback admin.
export function loadServiceAccount() {
  const inline = process.env.FILO_SA_KEY;
  if (inline && inline.trim()) {
    try { return JSON.parse(inline); }
    catch (e) { throw new Error(`FILO_SA_KEY non è JSON valido: ${e.message}`); }
  }
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`GOOGLE_APPLICATION_CREDENTIALS (${p}) non è JSON valido: ${e.message}`); }
  }
  return null;
}

// Firma un JWT con la chiave privata del service account e lo scambia con un
// access token OAuth2 (scope datastore).
export async function mintAccessTokenFromSA(sa) {
  if (!sa.client_email || !sa.private_key) {
    throw new Error('chiave service account incompleta (mancano client_email/private_key)');
  }
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`token service account fallito (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).access_token;
}

// Ritorna il bearer token da usare nelle richieste, scegliendo la modalità:
// service account se disponibile, altrimenti refresh token admin. Esce dal
// processo con un messaggio chiaro se non c'è nessuna credenziale.
export async function acquireBearer() {
  const sa = loadServiceAccount();
  if (sa) {
    console.log(`Auth: service account (${sa.client_email}).`);
    return mintAccessTokenFromSA(sa);
  }
  const rt = findAdminRefreshToken();
  if (!rt) {
    console.error('Nessuna credenziale per scrivere su Firestore. Servono UNA delle due:');
    console.error('  • service account: FILO_SA_KEY (JSON) o GOOGLE_APPLICATION_CREDENTIALS (percorso file)');
    console.error('  • owner: FILO_ADMIN_REFRESH_TOKEN (env o tests/agent/.env della root) — node scripts/admin-login.mjs');
    process.exit(1);
  }
  console.log('Auth: refresh token admin (owner).');
  return mintIdToken(rt);
}
