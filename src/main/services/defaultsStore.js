// Store della configurazione "predefinita" condivisa di Filo.
//
// Cosa contiene la config predefinita:
//   - provider, geminiDirect, models (modello per azione), modelRegistry
//     → NON sono segreti (sono solo nomi di modelli): vivono nel doc Firestore
//       `config/models`, leggibile da TUTTI (anche utenti non loggati), così la
//       modifica fatta dall'admin si propaga a ogni installazione.
//   - apiKeys (openrouter/gemini/tavily) → SONO segreti. La fonte sicura e
//     zero-login sono le chiavi di build (default-keys.js, iniettate dalla CI).
//     L'admin può però ruotarle a runtime: l'override sta nel doc Firestore
//     `config/secrets`, leggibile SOLO dagli utenti loggati (request.auth!=null)
//     e consumato SOLO qui nel main (mai inviato alle pagine). Chi non è loggato
//     ricade sulle chiavi di build.
//
// Catena di precedenza (per le chiavi):  Firestore config/secrets  >  build env.
// Per la config modelli:                 Firestore config/models    >  costanti.
//
// L'admin scrive tramite l'handler DEFAULTS_UPDATE (main, con Firebase ID token
// come Bearer): le regole Firestore accettano la PATCH solo se è un admin.

const auth = require('../auth/google-auth');
const { getBuildKeys } = require('../config/default-keys');

const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MODELS_DOC = 'config/models';
const SECRETS_DOC = 'config/secrets';

// Cache degli override remoti dall'ultimo refresh.
let remoteModels = null;  // { provider?, geminiDirect?, models?, modelRegistry? }
let remoteSecrets = null; // { apiKeys?: { openrouter?, gemini?, tavily? }, safeBrowsingKey? }
let lastFetchTs = 0;

// ── Firestore Value <-> JS ───────────────────────────────────────────────────
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromFsValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFsValue(v);
    return out;
  }
  return null;
}

function fsDocToObject(doc) {
  const out = {};
  for (const [k, v] of Object.entries((doc && doc.fields) || {})) out[k] = fromFsValue(v);
  return out;
}

// Legge un documento Firestore. Ritorna l'oggetto, {} se 404 (non esiste
// ancora), oppure null se la lettura non è consentita/è fallita (403/altro).
async function fetchDoc(docPath, idToken) {
  const url = `${FIRESTORE_BASE}/${docPath}?key=${API_KEY}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (_) {
    return null; // offline o rete giù → usa i fallback
  }
  if (res.status === 404) return {};
  if (!res.ok) return null;
  try {
    const json = await res.json();
    return fsDocToObject(json);
  } catch (_) {
    return null;
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

// Aggiorna la cache leggendo da Firestore. `config/models` pubblico; i segreti
// solo se l'utente è loggato (richiede un ID token).
async function refresh() {
  let idToken = null;
  try { idToken = await auth.getIdToken(); } catch (_) {}

  const models = await fetchDoc(MODELS_DOC, idToken);
  if (models) remoteModels = models;

  if (idToken) {
    const secrets = await fetchDoc(SECRETS_DOC, idToken);
    if (secrets) remoteSecrets = secrets;
  }
  lastFetchTs = Date.now();
  return get();
}

// Refresh "pigro": rinfresca al massimo una volta ogni `maxAgeMs`.
async function refreshIfStale(maxAgeMs = 5 * 60 * 1000) {
  if (Date.now() - lastFetchTs < maxAgeMs) return get();
  return refresh();
}

// Config predefinita effettiva = costanti/build  <  override remoti.
function get() {
  const C = globalThis.SN_CONST || {};
  const out = {
    provider: C.DEFAULT_PROVIDER || 'openrouter',
    models: { ...(C.DEFAULT_MODELS || {}) },
    modelRegistry: { ...(C.DEFAULT_MODEL_REGISTRY || {}) },
    apiKeys: getBuildKeys(),
    // Chiave Google Safe Browsing condivisa (rilevamento siti pericolosi).
    // Non è una chiave di build: l'unica fonte è l'override admin via Firestore.
    safeBrowsingKey: '',
  };

  if (remoteModels) {
    if (typeof remoteModels.provider === 'string' && remoteModels.provider) out.provider = remoteModels.provider;
    if (remoteModels.models && typeof remoteModels.models === 'object') {
      out.models = { ...out.models, ...remoteModels.models };
    }
    if (remoteModels.modelRegistry && typeof remoteModels.modelRegistry === 'object') {
      // Il registry remoto sostituisce interamente quello locale (contratto:
      // "questa è la lista completa", come nelle Opzioni).
      out.modelRegistry = { ...remoteModels.modelRegistry };
    }
  }

  if (remoteSecrets) {
    if (remoteSecrets.apiKeys && typeof remoteSecrets.apiKeys === 'object') {
      // Solo i valori non vuoti sovrascrivono le chiavi di build.
      for (const k of ['openrouter', 'gemini', 'tavily']) {
        const v = remoteSecrets.apiKeys[k];
        if (typeof v === 'string' && v.trim()) out.apiKeys[k] = v.trim();
      }
    }
    if (typeof remoteSecrets.safeBrowsingKey === 'string' && remoteSecrets.safeBrowsingKey.trim()) {
      out.safeBrowsingKey = remoteSecrets.safeBrowsingKey.trim();
    }
  }
  return out;
}

// Versione "pubblica" della config predefinita per l'editor admin: NON espone
// le chiavi vere, solo se ciascuna è configurata (così la pagina può mostrare
// uno stato senza far trapelare il segreto nel renderer).
function getPublicForAdmin() {
  const eff = get();
  return {
    provider: eff.provider,
    models: eff.models,
    modelRegistry: eff.modelRegistry,
    apiKeysPresent: {
      openrouter: Boolean(eff.apiKeys.openrouter),
      gemini: Boolean(eff.apiKeys.gemini),
      tavily: Boolean(eff.apiKeys.tavily),
    },
    safeBrowsingKeyPresent: Boolean(eff.safeBrowsingKey),
  };
}

async function patchDoc(docPath, fields, mask, idToken) {
  const qs = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
  const url = `${FIRESTORE_BASE}/${docPath}?${qs}&key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`config update fallito (${res.status}): ${text.slice(0, 300)}`);
  }
}

// Scrive la config predefinita su Firestore. `partial` può contenere:
//   provider, geminiDirect, models, modelRegistry  → doc config/models
//   apiKeys: { openrouter?, gemini?, tavily? }       → doc config/secrets
// Richiede un Firebase ID token admin (le regole rifiutano i non-admin).
// Le chiavi con valore '' o assenti NON vengono scritte (così "non toccare" è
// diverso da "azzera": per azzerare passare esplicitamente null... ma per
// semplicità l'editor admin invia solo le chiavi che l'admin ha digitato).
async function update(partial, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per modificare i default.');
  partial = partial || {};

  // Doc modelli (non segreto).
  const modelFields = {};
  const modelMask = [];
  if (typeof partial.provider === 'string') { modelFields.provider = toFsValue(partial.provider); modelMask.push('provider'); }
  if (partial.models && typeof partial.models === 'object') { modelFields.models = toFsValue(partial.models); modelMask.push('models'); }
  if (partial.modelRegistry && typeof partial.modelRegistry === 'object') { modelFields.modelRegistry = toFsValue(partial.modelRegistry); modelMask.push('modelRegistry'); }
  if (modelMask.length) await patchDoc(MODELS_DOC, modelFields, modelMask, idToken);

  // Doc segreti (chiavi). Scriviamo solo i campi presenti come stringa.
  const secretFields = {};
  const secretMask = [];
  if (partial.apiKeys && typeof partial.apiKeys === 'object') {
    const ak = {};
    for (const k of ['openrouter', 'gemini', 'tavily']) {
      if (typeof partial.apiKeys[k] === 'string') ak[k] = partial.apiKeys[k].trim();
    }
    if (Object.keys(ak).length) {
      secretFields.apiKeys = toFsValue(ak);
      secretMask.push('apiKeys');
    }
  }
  if (typeof partial.safeBrowsingKey === 'string') {
    secretFields.safeBrowsingKey = toFsValue(partial.safeBrowsingKey.trim());
    secretMask.push('safeBrowsingKey');
  }
  if (secretMask.length) await patchDoc(SECRETS_DOC, secretFields, secretMask, idToken);

  await refresh();
  return getPublicForAdmin();
}

module.exports = {
  get,
  getPublicForAdmin,
  refresh,
  refreshIfStale,
  update,
};
