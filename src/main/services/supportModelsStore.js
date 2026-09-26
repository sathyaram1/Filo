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

// Legge un documento DICENDO com'è andata (#679). «Non esiste» e «non ti
// riguarda» sono risposte del server, definitive finché non cambia chi usa
// Filo; «non ho potuto chiedere» no. Senza questa distinzione il permesso
// negato, che è la risposta normale per chiunque non gestisca Filo, passava
// per un guasto di passaggio e faceva ripartire le letture ogni mezzo minuto.
async function leggiDoc(docPath, idToken) {
  const url = `${FIRESTORE_BASE}/${docPath}?key=${API_KEY}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (_) {
    return { risposto: false, doc: null };
  }
  if (res.status === 404) return { risposto: true, doc: {} };
  if (res.status === 401 || res.status === 403) return { risposto: true, doc: null };
  if (!res.ok) return { risposto: false, doc: null };
  try {
    const json = await res.json();
    return { risposto: true, doc: fsDocToObject(json) };
  } catch (_) {
    return { risposto: false, doc: null };
  }
}

async function fetchDoc(docPath, idToken) {
  return (await leggiDoc(docPath, idToken)).doc;
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

// ── Copia in memoria ─────────────────────────────────────────────────────────
//
// `get()` legge DUE documenti, e chi risolve uno slot di supporto la chiama a
// ogni chiamata di modello: erano due letture di Firestore per ogni giudizio
// (#679). La copia dura cinque minuti e la butta il salvataggio.
//
// Si mette via SOLO una risposta intera. Quella arrivata a metà si serve e
// basta: se la si archiviasse, sopravviverebbe al ritorno della rete, e per
// tutta la sua durata la schermata direbbe che la chiave dei giudici non c'è o
// i controlli interni userebbero il modello scritto nel codice invece di
// quello scelto dall'owner (#679, secondo giro). Riprovare subito non è un
// ciclo e non costa letture: una lettura che non è partita non si paga.
const CACHE_TTL_MS = 5 * 60 * 1000;

// Solo risposte intere: { identita, ts, valore }.
let cache = null;
let adesso = () => Date.now();

// La risposta dipende da CHI sta usando Filo: i segreti dei giudici li legge
// solo l'owner. Senza questa firma, un logout lascerebbe in circolo per cinque
// minuti la risposta dell'account di prima.
function identita() {
  let email = '';
  try { email = String((auth.getProfile && auth.getProfile()) ? auth.getProfile().email || '' : '').toLowerCase(); } catch (_) {}
  let admin = false;
  try { admin = Boolean(auth.isAdmin && auth.isAdmin()); } catch (_) {}
  return `${email}|${admin ? 1 : 0}`;
}

// Chi chiama non deve poter modificare la copia condivisa scrivendo nel
// risultato: sono dati semplici, una copia profonda basta.
function clona(v) {
  return JSON.parse(JSON.stringify(v));
}

function invalidaCache() { cache = null; }

// ── API ──────────────────────────────────────────────────────────────────────

// Legge il doc config/supportModels. Richiede il Firebase ID token admin (per
// garantire che solo l'owner legga; la regola Firestore è la garanzia forte).
// Ritorna un oggetto con i campi degli slot (stringhe). I campi assenti (doc non
// ancora creato o slot non ancora impostato) hanno valore ''.
async function get() {
  const chi = identita();
  const ultimaBuona = cache && cache.identita === chi ? cache : null;
  if (ultimaBuona && adesso() - ultimaBuona.ts < CACHE_TTL_MS) return clona(ultimaBuona.valore);

  let idToken = null;
  try { idToken = await auth.getIdToken(); } catch (_) {}
  const [doc, secrets] = await Promise.all([
    leggiDoc(SUPPORT_MODELS_DOC, idToken),
    leggiDoc(JUDGE_SECRETS_DOC, idToken),
  ]);

  // Quello che non è arrivato vale l'ultima risposta buona, anche scaduta, mai
  // un vuoto: con un vuoto chi risolve uno slot ricadrebbe sui modelli scritti
  // nel codice per un singhiozzo di rete.
  const out = doc.risposto
    ? (doc.doc ? sanitize(doc.doc) : emptyModels())
    : (ultimaBuona ? clona(ultimaBuona.valore) : emptyModels());
  // La chiave vera non esce mai da qui: solo presente/assente. Se la sua
  // lettura non è partita non si inventa un «non c'è» (#679, primo giro).
  if (secrets.risposto) {
    const key = secrets.doc && typeof secrets.doc.openrouterKey === 'string' ? secrets.doc.openrouterKey.trim() : '';
    out.openrouterKeyPresent = Boolean(key);
  } else {
    out.openrouterKeyPresent = Boolean(ultimaBuona && ultimaBuona.valore.openrouterKeyPresent);
  }

  // Il server ha risposto su entrambi, fosse anche «non ti riguarda»: è una
  // risposta intera, e si tiene. A metà no: la prossima chiamata riprova, e
  // appena la rete torna Filo ha il valore giusto invece di quello di ripiego.
  if (doc.risposto && secrets.risposto) cache = { identita: chi, ts: adesso(), valore: out };
  return clona(out);
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
  // Chi ha appena salvato deve vedere il salvato, non la copia di prima.
  invalidaCache();
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

module.exports = {
  get,
  update,
  SLOTS,
  sanitizeRegistry,
  clampTimeoutMs,
  invalidaCache,
  CACHE_TTL_MS,
  // L'orologio si sostituisce solo nei test: aspettare cinque minuti veri non
  // è una prova che si possa correre.
  _setAdesso: (fn) => { adesso = typeof fn === 'function' ? fn : Date.now; },
};
