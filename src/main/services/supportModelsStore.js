// Store della config "modelli di supporto" di Filo.
//
// Vive nel doc Firestore `config/supportModels`. Contiene un campo per ogni
// slot di supporto: ogni valore è una stringa catena di nickname
// ("flash, flash-or"), lo stesso formato che il backend usa per `config/models`.
// È leggibile dal backend filo-security (Cloud Functions, via Admin SDK) senza
// passare per queste regole. Dal client è write-only admin.
//
// I 3 giudici fissi del panel L2 + il giudice dinamico hanno ciascuno il proprio
// slot (judge1/judge2/judge3/judgeDynamic) così l'owner può impostare il modello
// di OGNI giudice separatamente dalla dashboard. Il vecchio slot unico `judgeL2`
// non era letto da nessuno ed è stato rimosso.
//
// Oltre agli slot, il doc contiene il REGISTRO MODELLI DEDICATO AI GIUDICI
// (`judgeRegistry`): mappa nickname → { provider, model }. È l'analogo del
// `modelRegistry` di "Modelli predefiniti", ma SEPARATO: l'owner dà ai giudici
// scorciatoie/modelli propri, indipendenti dal resto di Filo. Il backend
// filo-security lo unisce (con precedenza) al registro condiviso per risolvere i
// nickname degli slot. Provider OpenRouter (il backend giudici è OpenRouter-only).
//
// La CHIAVE OpenRouter dei giudici è un SEGRETO e vive in un doc SEPARATO
// (`config/judgeSecrets`, campo `openrouterKey`): regole solo-owner, mai inviata
// alle pagine. Qui esponiamo solo il booleano "presente/assente".
//
// Schema doc config/supportModels:
//   {
//     sanitizer:     "flash",
//     judge1:        "flash, flash-or",
//     judge2:        "flash",
//     judge3:        "flash",
//     judgeDynamic:  "flash",
//     judgeRedTeam:  "flash",
//     judgePriority: "flash",
//     judgeRegistry: { "<nick>": { provider: "openrouter", model: "...", label?: "..." } },
//   }

const auth = require('../auth/google-auth');

const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const SUPPORT_MODELS_DOC = 'config/supportModels';
// Doc separato per la chiave (segreta) dei giudici. Regole: solo owner.
const JUDGE_SECRETS_DOC = 'config/judgeSecrets';

// Slot validi. Stabile: i backend filo-security li leggono per nome.
// I 3 giudici fissi del panel L2 + il giudice dinamico hanno ciascuno il proprio
// slot (judge1/judge2/judge3/judgeDynamic). Il vecchio slot unico `judgeL2`,
// non letto da nessuno, è stato rimosso.
const SLOTS = ['sanitizer', 'judge1', 'judge2', 'judge3', 'judgeDynamic', 'judgeRedTeam', 'judgePriority'];

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

async function fetchDoc(docPath, idToken) {
  const url = `${FIRESTORE_BASE}/${docPath}?key=${API_KEY}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (_) {
    return null;
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
    throw new Error(`support models update fallito (${res.status}): ${text.slice(0, 300)}`);
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

// Legge il doc config/supportModels. Richiede il Firebase ID token admin (per
// garantire che solo l'owner legga; la regola Firestore è la garanzia forte).
// Ritorna un oggetto con i campi degli slot (stringhe). I campi assenti (doc non
// ancora creato o slot non ancora impostato) hanno valore ''.
async function get() {
  let idToken = null;
  try { idToken = await auth.getIdToken(); } catch (_) {}
  const doc = await fetchDoc(SUPPORT_MODELS_DOC, idToken);
  if (!doc) return emptyModels();
  return sanitize(doc);
}

// Scrive (PATCH per-campo) il doc config/supportModels. Richiede ID token admin.
// Accetta solo i campi in SLOTS; gli altri vengono ignorati.
async function update(partial, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per modificare i modelli di supporto.');
  partial = partial || {};
  const fields = {};
  const mask = [];
  for (const slot of SLOTS) {
    if (typeof partial[slot] === 'string') {
      fields[slot] = toFsValue(partial[slot].trim());
      mask.push(slot);
    }
  }
  if (!mask.length) return get();
  await patchDoc(SUPPORT_MODELS_DOC, fields, mask, idToken);
  return get();
}

function emptyModels() {
  return Object.fromEntries(SLOTS.map((s) => [s, '']));
}

function sanitize(doc) {
  const out = emptyModels();
  for (const slot of SLOTS) {
    if (typeof doc[slot] === 'string') out[slot] = doc[slot];
  }
  return out;
}

module.exports = { get, update, SLOTS };
