// Store della config "modelli di supporto" (doc Firestore `config/supportModels`): un campo per ogni slot, valore = catena di nickname ("flash, flash-or"), lo stesso formato di `config/models`. Dal client è write-only admin; il backend filo-security lo legge con l'Admin SDK senza passare da queste regole.
// Ogni giudice del panel L2 ha il suo slot, così l'owner può impostarli separatamente dalla dashboard. Il doc contiene anche `judgeRegistry` (nickname → { provider, model }): il registro dedicato ai giudici, SEPARATO da quello di "Modelli predefiniti" e unito a quello con precedenza dal backend. Provider OpenRouter, l'unico che il backend giudici usa.
// La CHIAVE OpenRouter dei giudici è un SEGRETO e vive nel doc separato `config/judgeSecrets` (regole solo-owner, mai inviata alle pagine): qui si espone solo il booleano presente/assente.

const auth = require('../auth/google-auth');

const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const SUPPORT_MODELS_DOC = 'config/supportModels';
// Doc separato per la chiave (segreta) dei giudici. Regole: solo owner.
const JUDGE_SECRETS_DOC = 'config/judgeSecrets';

// Slot validi, stabili: i backend filo-security li leggono per nome.
const SLOTS = ['sanitizer', 'judge1', 'judge2', 'judge3', 'judgeDynamic', 'judgeRedTeam', 'judgePriority'];

// Timeout per giudice, in MILLISECONDI nel campo `judgeTimeoutMs` dello stesso doc (lo legge il backend dei giudici). I bound stanno nelle costanti condivise, in secondi; fallback letterali se non sono caricate su globalThis.
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

// Richiede il Firebase ID token admin; la garanzia forte resta comunque la regola Firestore. I campi assenti (doc non ancora creato, slot non impostato) valgono ''.
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

// PATCH per-campo. La chiave OpenRouter dei giudici va sul doc separato e si scrive solo se passata e non vuota: vuoto = "non toccare".
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
  // Timeout per giudice: si scrive solo se è un numero valido, clampato.
  if (partial.judgeTimeoutMs != null && Number.isFinite(Number(partial.judgeTimeoutMs))) {
    const ms = clampTimeoutMs(partial.judgeTimeoutMs);
    if (ms != null) {
      fields.judgeTimeoutMs = toFsValue(ms);
      mask.push('judgeTimeoutMs');
    }
  }
  if (mask.length) await patchDoc(SUPPORT_MODELS_DOC, fields, mask, idToken);

  // Chiave giudici (doc separato): si scrive solo se digitata.
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
  out.judgeTimeoutMs = null; // null = non impostato → la UI mostra il default
  return out;
}

function sanitize(doc) {
  const out = emptyModels();
  for (const slot of SLOTS) {
    if (typeof doc[slot] === 'string') out[slot] = doc[slot];
  }
  out.judgeRegistry = sanitizeRegistry(doc.judgeRegistry);
  if (doc.judgeTimeoutMs != null && Number.isFinite(Number(doc.judgeTimeoutMs))) {
    out.judgeTimeoutMs = clampTimeoutMs(doc.judgeTimeoutMs);
  }
  return out;
}

// Solo le voci valide: provider OpenRouter (il backend giudici è OR-only) e model non vuoto; `label` opzionale conservata.
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

module.exports = { get, update, SLOTS, sanitizeRegistry, clampTimeoutMs };
