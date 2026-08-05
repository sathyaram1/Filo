// Store della configurazione "predefinita" condivisa di Filo.
//
// Cosa contiene la config predefinita:
//   - provider, models (modello per azione), modelRegistry
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
const AUTOMATION_DOC = 'config/automation';
// Importi crediti configurabili dall'owner (gamification). NON è segreto (sono
// solo i numeri di crediti che l'utente vede già in app; il costo € reale non ci
// finisce mai): lettura PUBBLICA come config/models, così un nuovo valore
// raggiunge OGNI installazione, anche non loggata. Scrittura solo admin (regole).
const CREDITS_DOC = 'config/credits';

// Cache degli override remoti dall'ultimo refresh.
let remoteModels = null;  // { provider?, models?, modelRegistry? }
let remoteSecrets = null; // { apiKeys?: { openrouter?, gemini?, tavily? }, safeBrowsingKey? }
let remoteCredits = null; // { initial?, dailyRefill?, feedbackResolveByPriority?, ... }
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
      // Il registry remoto si SOVRAPPONE a quello di build invece di
      // sostituirlo: i nickname integrati (flash, flash-or, tts, …) devono
      // restare risolvibili anche se il doc remoto non li elenca, perché le
      // azioni assenti dal doc remoto ricadono sulle catene di default che li
      // citano. Un nickname irrisolvibile finirebbe GREZZO al provider
      // (OpenRouter 400 "flash is not a valid model ID").
      out.modelRegistry = { ...out.modelRegistry, ...remoteModels.modelRegistry };
    }
    // Tombstone: nickname integrati che l'admin ha ESPLICITAMENTE rimosso
    // dall'editor. Senza questo, il merge qui sopra (build sotto, remoto sopra)
    // ri-inietterebbe ogni modello integrato cancellato: l'admin lo elimina,
    // salva, ma alla riapertura riappare (non poteva mai davvero eliminarne uno
    // di build). La cancellazione di un nickname NON di build funzionava già,
    // perché non c'era nulla a re-iniettarlo. Distinguiamo "mai elencato dal
    // doc remoto" (→ resta, invariante flash) da "cancellato apposta" (→ sparisce):
    // solo il secondo caso finisce nella lista tombstone, quindi l'invariante
    // dei nickname integrati non toccati resta intatta. Un nickname ridefinito
    // dal doc remoto vince comunque (auto-guarigione se l'admin lo ri-aggiunge).
    if (Array.isArray(remoteModels.modelRegistryDeleted)) {
      for (const nick of remoteModels.modelRegistryDeleted) {
        if (typeof nick !== 'string' || !nick) continue;
        if (remoteModels.modelRegistry && nick in remoteModels.modelRegistry) continue;
        delete out.modelRegistry[nick];
      }
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
//   provider, models, modelRegistry  → doc config/models
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
  if (partial.modelRegistry && typeof partial.modelRegistry === 'object') {
    modelFields.modelRegistry = toFsValue(partial.modelRegistry);
    modelMask.push('modelRegistry');
    // Tombstone dei nickname integrati che l'admin ha rimosso: i nickname di
    // build ASSENTI dal registry inviato. Serve perché get() rifonde sempre il
    // registry di build sotto il remoto: senza la lista dei cancellati, un
    // modello integrato eliminato riapparirebbe alla riapertura. La lista è
    // ricalcolata a ogni salvataggio dallo stato completo dell'editor (che
    // mostra build+remoto fusi), quindi ri-aggiungere un modello lo toglie dai
    // tombstone → auto-guarigione. Solo i nickname di BUILD possono finire qui:
    // quelli custom, se rimossi, sono già assenti dal doc e non serve marcarli.
    const buildReg = (globalThis.SN_CONST && globalThis.SN_CONST.DEFAULT_MODEL_REGISTRY) || {};
    const deleted = Object.keys(buildReg).filter((k) => !(k in partial.modelRegistry));
    modelFields.modelRegistryDeleted = toFsValue(deleted);
    modelMask.push('modelRegistryDeleted');
  }
  if (modelMask.length) await patchDoc(MODELS_DOC, modelFields, modelMask, idToken);

  // Doc segreti (chiavi). Scriviamo solo i campi presenti come stringa.
  //
  // IMPORTANTE — merge, non replace: la maschera DEVE puntare ai singoli leaf
  // (`apiKeys.gemini`, `apiKeys.openrouter`, …) e NON al map intero `apiKeys`.
  // Con `updateMask=apiKeys` Firestore SOSTITUISCE l'intera mappa col valore
  // inviato: salvando solo la chiave Gemini cancellavi l'override OpenRouter già
  // presente, che poi risultava «non configurata» (feedback alpha). Con la
  // maschera per-leaf Firestore fonde: tocca solo le chiavi digitate e lascia
  // intatte le altre.
  const secretFields = {};
  const secretMask = [];
  const akFields = {};
  if (partial.apiKeys && typeof partial.apiKeys === 'object') {
    for (const k of ['openrouter', 'gemini', 'tavily']) {
      const v = partial.apiKeys[k];
      if (typeof v === 'string' && v.trim()) {
        akFields[k] = toFsValue(v.trim());
        secretMask.push(`apiKeys.${k}`);
      }
    }
    if (Object.keys(akFields).length) {
      secretFields.apiKeys = { mapValue: { fields: akFields } };
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

// ── Interruttore master dell'auto-miglioramento (config/automation) ──────────
// Campo `enabled` (bool). Doc o campo assente ⇒ false = autonomia OFF (stato
// sicuro di default: ogni feedback passa da revisione umana). Letto dalla
// dashboard owner (qui) e, in futuro, dal backend di sicurezza (via admin SDK,
// che bypassa le regole). Scrittura riservata agli admin: le regole Firestore
// rifiutano i non-admin.
async function getAutomationGate(idToken) {
  const doc = await fetchDoc(AUTOMATION_DOC, idToken);
  // doc === {} → 404 (mai scritto) ⇒ default OFF. null → lettura negata/fallita
  // ⇒ default OFF prudente (non si attiva l'autonomia per un errore di rete).
  if (!doc || typeof doc.enabled !== 'boolean') return false;
  return doc.enabled;
}

async function setAutomationGate(enabled, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare l\'interruttore.');
  await patchDoc(AUTOMATION_DOC, { enabled: toFsValue(Boolean(enabled)) }, ['enabled'], idToken);
  return Boolean(enabled);
}

// Tentativi del loop di correzione (config/automation, campo `loopCap`): quante
// FAIL consecutive del verifier prima di bloccare un fix con motivo `loop`. È la
// fonte di verità letta dalle routine (scripts/dispatch.mjs). Default e range da
// SN_CONST.AUTOMATION; clamp prudente sia in lettura sia in scrittura.
function automationDefaults() {
  const A = (globalThis.SN_CONST && globalThis.SN_CONST.AUTOMATION) || {};
  return {
    def: Number.isFinite(A.LOOP_CAP_DEFAULT) ? A.LOOP_CAP_DEFAULT : 3,
    min: Number.isFinite(A.LOOP_CAP_MIN) ? A.LOOP_CAP_MIN : 1,
    max: Number.isFinite(A.LOOP_CAP_MAX) ? A.LOOP_CAP_MAX : 10,
  };
}

function clampLoopCap(n) {
  const { def, min, max } = automationDefaults();
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

async function getAutomationLoopCap(idToken) {
  const { def } = automationDefaults();
  const doc = await fetchDoc(AUTOMATION_DOC, idToken);
  // doc === {} (404) o campo assente ⇒ default. null (lettura negata/fallita) ⇒
  // default prudente (non rompere il loop per un errore di rete).
  if (!doc || doc.loopCap == null) return def;
  return clampLoopCap(doc.loopCap);
}

async function setAutomationLoopCap(loopCap, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare i tentativi del loop.');
  const v = clampLoopCap(loopCap);
  await patchDoc(AUTOMATION_DOC, { loopCap: toFsValue(v) }, ['loopCap'], idToken);
  return v;
}

// Log dei worker delle routine (config/automation, campo `workerLog`): elenco
// delle ultime esecuzioni di scripts/dispatch.mjs, ciascuna { role, startedAt,
// num }. Lo scrive dispatch a ogni worker spawnato; qui lo LEGGIAMO soltanto
// (owner-gated) per la tab "Log" della dashboard. Ritorna le voci più recenti
// PRIMA (ordine decrescente per istante d'avvio), già normalizzate. Documento o
// campo assente / lettura fallita ⇒ lista vuota (mai un errore per un log).
async function getWorkerLog(idToken) {
  const doc = await fetchDoc(AUTOMATION_DOC, idToken);
  const raw = doc && Array.isArray(doc.workerLog) ? doc.workerLog : [];
  const entries = raw
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      role: typeof e.role === 'string' ? e.role : '',
      startedAt: typeof e.startedAt === 'string' ? e.startedAt : '',
      num: e.num == null ? '' : String(e.num),
    }))
    // Più recenti prima: dispatch le accoda in ordine cronologico.
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return entries;
}

module.exports = {
  get,
  getPublicForAdmin,
  refresh,
  refreshIfStale,
  update,
  getAutomationGate,
  setAutomationGate,
  getAutomationLoopCap,
  setAutomationLoopCap,
  getWorkerLog,
};
