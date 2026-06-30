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

// Timeout per giudice, salvato in MILLISECONDI nel campo `judgeTimeoutMs` dello
// stesso doc (lo legge il backend dei giudici). I bound vivono nelle costanti
// condivise (in secondi); qui clampiamo in ms. Fallback letterali se le costanti
// non sono caricate su globalThis (robustezza nel main process).
function timeoutBoundsMs() {
  const A = (globalThis.SN_CONST && globalThis.SN_CONST.AUTOMATION) || {};
  const s = (v, d) => (Number.isFinite(v) ? v : d) * 1000;
  return { min: s(A.JUDGE_TIMEOUT_MIN_S, 10), max: s(A.JUDGE_TIMEOUT_MAX_S, 120) };
}
function clampTimeoutMs(n) {
  const { min, max } = timeoutBoundsMs();
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

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
  const [doc, secrets] = await Promise.all([
    fetchDoc(SUPPORT_MODELS_DOC, idToken),
    fetchDoc(JUDGE_SECRETS_DOC, idToken),
  ]);
  const out = doc ? sanitize(doc) : emptyModels();
  // La chiave vera non esce mai da qui: solo presente/assente.
  const key = secrets && typeof secrets.openrouterKey === 'string' ? secrets.openrouterKey.trim() : '';
  out.openrouterKeyPresent = Boolean(key);
  return out;
}

// Scrive (PATCH per-campo) il doc config/supportModels. Richiede ID token admin.
// Accetta gli slot in SLOTS + `judgeRegistry` (mappa). La chiave OpenRouter dei
// giudici (`openrouterKey`, segreta) va su un doc separato; si scrive solo se
// passata e non vuota (vuoto = "non toccare").
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
  if (partial.judgeRegistry && typeof partial.judgeRegistry === 'object') {
    fields.judgeRegistry = toFsValue(sanitizeRegistry(partial.judgeRegistry));
    mask.push('judgeRegistry');
  }
  // Timeout per giudice (ms): si scrive solo se passato un numero valido, clampato.
  if (partial.judgeTimeoutMs != null && Number.isFinite(Number(partial.judgeTimeoutMs))) {
    const ms = clampTimeoutMs(partial.judgeTimeoutMs);
    if (ms != null) {
      fields.judgeTimeoutMs = toFsValue(ms);
      mask.push('judgeTimeoutMs');
    }
  }
  if (mask.length) await patchDoc(SUPPORT_MODELS_DOC, fields, mask, idToken);

  // Chiave giudici (doc separato): scrivi solo se digitata.
  if (typeof partial.openrouterKey === 'string' && partial.openrouterKey.trim()) {
    await patchDoc(
      JUDGE_SECRETS_DOC,
      { openrouterKey: toFsValue(partial.openrouterKey.trim()) },
      ['openrouterKey'],
      idToken
    );
  }
  return get();
}

function emptyModels() {
  const out = Object.fromEntries(SLOTS.map((s) => [s, '']));
  out.judgeRegistry = {};
  out.openrouterKeyPresent = false;
  return out;
}

function sanitize(doc) {
  const out = emptyModels();
  for (const slot of SLOTS) {
    if (typeof doc[slot] === 'string') out[slot] = doc[slot];
  }
  out.judgeRegistry = sanitizeRegistry(doc.judgeRegistry);
  return out;
}

// Tiene solo le voci valide del registro giudici: nickname non vuoto →
// { provider, model } con provider OpenRouter (il backend giudici è OR-only) e
// model non vuoto. `label` opzionale conservata.
function sanitizeRegistry(reg) {
  const out = {};
  if (!reg || typeof reg !== 'object') return out;
  for (const [nick, raw] of Object.entries(reg)) {
    const name = String(nick || '').trim();
    if (!name) continue;
    const e = raw || {};
    const model = String(e.model || '').trim();
    if (!model) continue;
    const entry = { provider: 'openrouter', model };
    const label = String(e.label || '').trim();
    if (label) entry.label = label;
    out[name] = entry;
  }
  return out;
}

module.exports = { get, update, SLOTS, sanitizeRegistry };
