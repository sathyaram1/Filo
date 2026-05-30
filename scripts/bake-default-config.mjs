// Scrive le chiavi di default nell'eseguibile, a build-time.
//
// COSA FA
//   Prima di ogni build CI, raccoglie le chiavi API di default e le scrive in
//   src/main/config/default-keys.generated.json (gitignorato, finisce SOLO nel
//   binario impacchettato). A runtime default-keys.js legge quel file con
//   precedenza sui valori d'ambiente.
//
//   Questo è il pezzo che fa propagare la rotazione chiavi dell'admin a TUTTI
//   gli utenti, anche quelli senza login: l'admin ruota le chiavi dalla pagina
//   "Modelli predefiniti" (→ Firestore config/secrets); il prossimo build (ogni
//   6h) le rilegge da Firestore e le incastona nel nuovo installer; l'auto-update
//   le consegna a tutti.
//
// FONTI DELLE CHIAVI (in ordine di precedenza, per ciascuna chiave):
//   1. Firestore config/secrets   → l'override admin più recente (richiede
//                                    FILO_ROUTINE_REFRESH_TOKEN, account robot loggato)
//   2. env FILO_DEFAULT_*         → secret del job CI (fallback se non c'è override)
//   3. assente                    → la chiave resta vuota (non blocca il build)
//
// SICUREZZA
//   - Lo script NON stampa mai i valori delle chiavi (solo "presente/assente").
//   - Il file generato è gitignorato: non torna mai nel repo pubblico.
//   - Se manca il refresh token, lo script NON fallisce: degrada ai secret env.
//     Così un build può partire anche senza account robot configurato.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = require(resolve(__dirname, '..', 'src', 'main', 'auth', 'config.js'));

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${cfg.firebaseProjectId}/databases/(default)/documents`;
const SECRETS_DOC = 'config/secrets';
const OUT_PATH = resolve(__dirname, '..', 'src', 'main', 'config', 'default-keys.generated.json');

// Refresh token Firebase → ID token (breve durata). Solo API key pubblica.
async function mintIdToken(refreshToken) {
  const res = await fetch(`${cfg.secureTokenEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`refresh sessione robot fallito (${res.status})`);
  }
  const j = await res.json();
  return j.id_token;
}

function fromFsValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFsValue(v);
    return out;
  }
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
  return null;
}

// Legge config/secrets da Firestore. Ritorna { openrouter?, gemini?, tavily? }
// oppure {} se non leggibile/assente. Non lancia: in caso di problemi degrada.
async function fetchRemoteKeys(idToken) {
  if (!idToken) return {};
  try {
    const url = `${FIRESTORE_BASE}/${SECRETS_DOC}?key=${cfg.firebaseApiKey}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return {};
    const json = await res.json();
    const fields = (json && json.fields) || {};
    const apiKeys = fields.apiKeys ? fromFsValue(fields.apiKeys) : null;
    if (apiKeys && typeof apiKeys === 'object') return apiKeys;
    return {};
  } catch (_) {
    return {};
  }
}

function envKey(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

async function main() {
  const refreshToken = process.env.FILO_ROUTINE_REFRESH_TOKEN;

  let idToken = null;
  if (refreshToken) {
    try {
      idToken = await mintIdToken(refreshToken);
    } catch (e) {
      console.warn(`[bake] override Firestore non disponibili (${e.message}); uso i secret d'ambiente.`);
    }
  } else {
    console.warn('[bake] FILO_ROUTINE_REFRESH_TOKEN assente: uso solo i secret d\'ambiente FILO_DEFAULT_*.');
  }

  const remote = await fetchRemoteKeys(idToken);

  const pick = (remoteKey, envName) => {
    const r = typeof remote[remoteKey] === 'string' ? remote[remoteKey].trim() : '';
    return r || envKey(envName);
  };

  const apiKeys = {
    openrouter: pick('openrouter', 'FILO_DEFAULT_OPENROUTER_KEY'),
    gemini: pick('gemini', 'FILO_DEFAULT_GEMINI_KEY'),
    tavily: pick('tavily', 'FILO_DEFAULT_TAVILY_KEY'),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ apiKeys, bakedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');

  // Log SENZA valori: solo presenza/assenza, così la CI non espone segreti.
  const summary = Object.fromEntries(
    Object.entries(apiKeys).map(([k, v]) => [k, v ? 'presente' : 'assente'])
  );
  console.log(`[bake] scritto ${OUT_PATH}:`, JSON.stringify(summary));
}

main().catch((e) => {
  // Anche in caso di errore inatteso, scriviamo un file vuoto valido così il
  // build non si rompe e l'app parte (chiavi vuote = utente configura le sue).
  console.warn('[bake] errore non fatale:', e.message);
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ apiKeys: { openrouter: '', gemini: '', tavily: '' }, bakedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8'
    );
  } catch (_) {}
  process.exit(0);
});
