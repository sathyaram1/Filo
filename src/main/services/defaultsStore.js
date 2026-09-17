// Configurazione predefinita condivisa: provider, modelli e registro nel doc pubblico
// config/models; le chiavi segrete da config/secrets, leggibile SOLO dagli admin (#581).
// Precedenza: secrets > build per le chiavi, config/models > costanti per i modelli.

const auth = require('../auth/google-auth');
const { getBuildKeys, getBuildSafeBrowsingKey } = require('../config/default-keys');
// L'elenco dei gruppi di mittente dell'auto-approvazione deve restare uno solo (#446).
require('../../shared/feedbackThread.js');

const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MODELS_DOC = 'config/models';
const SECRETS_DOC = 'config/secrets';
const AUTOMATION_DOC = 'config/automation';
// Documento a lettura pubblica: le macchine delle routine non hanno credenziali.
const ROUTINES_DOC = 'config/routines';

let remoteModels = null;  // { provider?, models?, modelRegistry? }
// Popolato solo per gli admin (#581): per gli altri resta null, valgono le chiavi di build.
let remoteSecrets = null; // { apiKeys?: { openrouter?, tavily? }, safeBrowsingKey? }
let lastFetchTs = 0;

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

// Ritorna l'oggetto, {} se 404 (non esiste ancora), null se la lettura è negata o fallita.
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

// Gate LOCALE, solo per non bussare a un documento che non ci riguarda: la garanzia forte
// è la regola Firestore su config/secrets, che nega anche se questa funzione mentisse.
function isAdminUser() {
  try { return Boolean(auth.isAdmin()); } catch (_) { return false; }
}

// config/models è pubblico; config/secrets si legge SOLO da admin (#581).
async function refresh() {
  let idToken = null;
  try { idToken = await auth.getIdToken(); } catch (_) {}

  const models = await fetchDoc(MODELS_DOC, idToken);
  if (models) remoteModels = models;

  if (idToken && isAdminUser()) {
    const secrets = await fetchDoc(SECRETS_DOC, idToken);
    if (secrets) remoteSecrets = secrets;
  } else {
    // Chi non è admin non ha override: si azzera invece di lasciare la cache, o dopo il logout
    // dell'owner sulla stessa installazione le chiavi lette da admin resterebbero in uso.
    remoteSecrets = null;
  }
  lastFetchTs = Date.now();
  return get();
}

async function refreshIfStale(maxAgeMs = 5 * 60 * 1000) {
  if (Date.now() - lastFetchTs < maxAgeMs) return get();
  return refresh();
}

// Registro e catene di build sono VUOTI: nessun modello scritto nel codice dell'app.
// Nei test valgono quelli di prova, così i test hanno una configurazione nota.
function buildModels() {
  const C = globalThis.SN_CONST || {};
  const T = globalThis.SN_TEST_MODELS; // presente solo nei test (loader.js)
  return T ? { registry: T.registry, models: T.models } : { registry: C.DEFAULT_MODEL_REGISTRY || {}, models: C.DEFAULT_MODELS || {} };
}

function get() {
  const C = globalThis.SN_CONST || {};
  const out = {
    provider: C.DEFAULT_PROVIDER || 'openrouter',
    models: { ...buildModels().models },
    modelRegistry: { ...buildModels().registry },
    // Politica sui fornitori: regola in constants.js (DEFAULT_EXCLUDED_PROVIDERS).
    // La lista remota SOSTITUISCE quella di build: l'owner deve poterla svuotare per intero.
    excludedProviders: [ ...(C.DEFAULT_EXCLUDED_PROVIDERS || []) ],
    providerSort: '',
    apiKeys: getBuildKeys(),
    // Chiave Safe Browsing incastonata nel build (#581): così la protezione si accende anche
    // per chi non fa login, senza tenere aperto a tutti il documento delle chiavi.
    safeBrowsingKey: getBuildSafeBrowsingKey(),
  };

  if (remoteModels) {
    if (typeof remoteModels.provider === 'string' && remoteModels.provider) out.provider = remoteModels.provider;
    if (remoteModels.models && typeof remoteModels.models === 'object') {
      out.models = { ...out.models, ...remoteModels.models };
    }
    if (remoteModels.modelRegistry && typeof remoteModels.modelRegistry === 'object') {
      // Il registry remoto si SOVRAPPONE a quello di build, non lo sostituisce: i nickname
      // integrati devono restare risolvibili, o finirebbero grezzi al provider (400 sul modello).
      out.modelRegistry = { ...out.modelRegistry, ...remoteModels.modelRegistry };
    }
    // Tombstone: i nickname di build che l'admin ha rimosso apposta. Senza, il merge qui sopra
    // li ri-inietterebbe; uno ridefinito dal remoto vince, quindi ri-aggiungerlo guarisce.
    if (Array.isArray(remoteModels.excludedProviders)) {
      out.excludedProviders = remoteModels.excludedProviders
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim());
    }
    if (typeof remoteModels.providerSort === 'string') {
      out.providerSort = remoteModels.providerSort.trim();
    }
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
      for (const k of ['openrouter', 'tavily']) {
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

// Per l'editor admin: NON espone le chiavi vere, solo se ciascuna è configurata, così nel
// renderer non trapela nessun segreto.
function getPublicForAdmin() {
  const eff = get();
  return {
    provider: eff.provider,
    models: eff.models,
    modelRegistry: eff.modelRegistry,
    excludedProviders: eff.excludedProviders,
    providerSort: eff.providerSort,
    apiKeysPresent: {
      openrouter: Boolean(eff.apiKeys.openrouter),
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

// Le chiavi con valore '' o assenti NON si scrivono: «non toccare» è diverso da «azzera»,
// e l'editor invia solo quelle digitate. Serve un ID token admin, o le regole rifiutano.
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
    // Tombstone dei nickname di build assenti dal registry inviato: senza questa lista un
    // modello integrato eliminato riapparirebbe. Solo i nickname di BUILD finiscono qui.
    const buildReg = buildModels().registry;
    const deleted = Object.keys(buildReg).filter((k) => !(k in partial.modelRegistry));
    modelFields.modelRegistryDeleted = toFsValue(deleted);
    modelMask.push('modelRegistryDeleted');
  }
  // La lista inviata sostituisce quella remota per intero: l'array è la fonte di verità.
  if (Array.isArray(partial.excludedProviders)) {
    const clean = partial.excludedProviders
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
    modelFields.excludedProviders = toFsValue(clean);
    modelMask.push('excludedProviders');
  }
  if (typeof partial.providerSort === 'string') {
    modelFields.providerSort = toFsValue(partial.providerSort.trim());
    modelMask.push('providerSort');
  }
  if (modelMask.length) await patchDoc(MODELS_DOC, modelFields, modelMask, idToken);

  // Merge, non replace: la maschera deve puntare ai leaf (apiKeys.tavily, apiKeys.openrouter).
  // Con updateMask=apiKeys Firestore sostituisce la mappa intera e cancella l'altra chiave.
  const secretFields = {};
  const secretMask = [];
  const akFields = {};
  if (partial.apiKeys && typeof partial.apiKeys === 'object') {
    for (const k of ['openrouter', 'tavily']) {
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

// Interruttore master dell'auto-miglioramento: doc o campo assente ⇒ false, autonomia OFF,
// lo stato sicuro dove ogni feedback passa da revisione umana. Scrive solo un admin.
async function getAutomationGate(idToken) {
  const doc = await fetchDoc(AUTOMATION_DOC, idToken);
  // 404 o lettura fallita ⇒ OFF: l'autonomia non deve accendersi per un errore di rete.
  if (!doc || typeof doc.enabled !== 'boolean') return false;
  return doc.enabled;
}

async function setAutomationGate(enabled, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare l\'interruttore.');
  await patchDoc(AUTOMATION_DOC, { enabled: toFsValue(Boolean(enabled)) }, ['enabled'], idToken);
  return Boolean(enabled);
}

// Auto-approvazione per mittente: quali categorie entrano in coda da sole con l'interruttore
// master acceso. Decide il backend, qui solo lettura; campo assente ⇒ tutti ammessi.
function autoApproveGroups() {
  const T = globalThis.SN_FEEDBACK_THREAD;
  return (T && T.AUTO_APPROVE_GROUPS) || ['owner', 'filo', 'claude', 'user'];
}

// Il ripiego per un documento con il solo `claude` vive in resolveAutoApprove, nel modulo
// condiviso, così dashboard e backend leggono la stessa mappa dallo stesso documento.
function normalizeAutoApprove(raw) {
  const T = globalThis.SN_FEEDBACK_THREAD;
  if (T && T.resolveAutoApprove) {
    const resolved = T.resolveAutoApprove(raw);
    if (resolved) return resolved;
  }
  const out = {};
  for (const g of autoApproveGroups()) {
    out[g] = !(raw && typeof raw === 'object' && raw[g] === false);
  }
  return out;
}

async function getAutomationAutoApprove(idToken) {
  const doc = await fetchDoc(AUTOMATION_DOC, idToken);
  return normalizeAutoApprove(doc && doc.autoApprove);
}

async function setAutomationAutoApprove(partial, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare l\'auto-approvazione.');
  // Merge sul corrente: la dashboard manda un interruttore per volta, il doc tiene una mappa.
  const current = await getAutomationAutoApprove(idToken);
  const next = { ...current };
  if (partial && typeof partial === 'object') {
    for (const g of autoApproveGroups()) {
      if (typeof partial[g] === 'boolean') next[g] = partial[g];
    }
  }
  const fields = {};
  for (const g of autoApproveGroups()) fields[g] = toFsValue(next[g]);
  await patchDoc(AUTOMATION_DOC, { autoApprove: { mapValue: { fields } } }, ['autoApprove'], idToken);
  return next;
}

// config/routines è separato da config/automation e leggibile senza credenziali: a leggerlo
// sono le macchine delle routine (#451); un campo assente si cerca ancora nel doc vecchio.
async function getRoutinesEnabled(idToken) {
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  // 404 o campo assente ⇒ acceso: spegnere dev'essere una scelta scritta, non l'effetto di un
  // documento mai creato. Il fail-closed sta da chi legge, le routine; qui è la dashboard.
  if (!doc || typeof doc.enabled !== 'boolean') return true;
  return doc.enabled;
}

async function setRoutinesEnabled(on, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per accendere o spegnere le routine.');
  await patchDoc(ROUTINES_DOC, { enabled: toFsValue(Boolean(on)) }, ['enabled'], idToken);
  return Boolean(on);
}

// Esplorazione a coda vuota: le routine cercano problemi che nessuno ha segnalato.
// Campo assente ⇒ true: solo un false scritto apposta la ferma.
async function getAutomationProberIdle(idToken) {
  // SOLO config/routines: è il documento che il server legge davvero. Un ripiego sul vecchio
  // mostrerebbe all'owner un valore che il server ignora.
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  if (doc && typeof doc.proberWhenIdle === 'boolean') return doc.proberWhenIdle;
  return true;
}

async function setAutomationProberIdle(on, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare l\'esplorazione automatica.');
  await patchDoc(ROUTINES_DOC, { proberWhenIdle: toFsValue(Boolean(on)) }, ['proberWhenIdle'], idToken);
  return Boolean(on);
}

// I tre bilanci dei giri (#561) stanno SOLO nel documento, senza default nel codice, o la
// verifica locale ragionerebbe con numeri diversi da quelli della dashboard; assente ⇒ null.
const CAP_KEYS = (globalThis.SN_FB_TRANSITIONS && globalThis.SN_FB_TRANSITIONS.VERIFIER_CAP_KEYS) || ['cap2', 'cap1', 'cap0'];
const FIX_INSTRUCTIONS_MAX = Number(globalThis.SN_CONST && globalThis.SN_CONST.AUTOMATION && globalThis.SN_CONST.AUTOMATION.FIX_INSTRUCTIONS_MAX) || 8000;

function automationRange() {
  const A = (globalThis.SN_CONST && globalThis.SN_CONST.AUTOMATION) || {};
  return {
    min: Number.isFinite(A.CAP_MIN) ? A.CAP_MIN : 0,
    max: Number.isFinite(A.CAP_MAX) ? A.CAP_MAX : 10,
  };
}

/** Il bilancio nel range, o `null` se non è un numero. */
function clampCap(n) {
  const { min, max } = automationRange();
  const v = Math.round(Number(n));
  if (n === '' || n === null || n === undefined || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

async function getRoutineCaps(idToken) {
  // Mostrare un valore pescato altrove è mostrare una regola che nessuno applica (vedi sopra).
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  const out = { cap2: null, cap1: null, cap0: null, fixInstructions: '' };
  for (const k of CAP_KEYS) {
    if (doc && doc[k] != null) out[k] = clampCap(doc[k]);
  }
  if (doc && typeof doc.fixInstructions === 'string') out.fixInstructions = doc.fixInstructions.slice(0, FIX_INSTRUCTIONS_MAX);
  return out;
}

async function setRoutineCaps(patch, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare i bilanci del verificatore.');
  const p = patch && typeof patch === 'object' ? patch : {};
  const fields = {};
  const mask = [];
  for (const k of CAP_KEYS) {
    if (p[k] == null) continue;
    const v = clampCap(p[k]);
    // Un bilancio non numerico non si scrive: non c'è un default con cui
    // sostituirlo, e un campo assente ferma la verifica con un errore chiaro.
    if (v === null) throw new Error(`${k}: serve un numero (0 compreso), non «${String(p[k])}».`);
    fields[k] = toFsValue(v);
    mask.push(k);
  }
  if (typeof p.fixInstructions === 'string') {
    fields.fixInstructions = toFsValue(p.fixInstructions.slice(0, FIX_INSTRUCTIONS_MAX));
    mask.push('fixInstructions');
  }
  if (mask.length) await patchDoc(ROUTINES_DOC, fields, mask, idToken);
  return getRoutineCaps(idToken);
}


// Log dei worker: lo scrive dispatch, qui si LEGGE soltanto (owner-gated) per la tab Log.
// Documento, campo assente o lettura fallita ⇒ lista vuota: mai un errore per un log.
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
  getAutomationAutoApprove,
  setAutomationAutoApprove,
  getAutomationProberIdle,
  setAutomationProberIdle,
  getRoutinesEnabled,
  setRoutinesEnabled,
  getRoutineCaps,
  setRoutineCaps,
  getWorkerLog,
};
