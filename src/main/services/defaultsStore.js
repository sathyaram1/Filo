// Configurazione predefinita condivisa: provider, modelli e registro nel doc pubblico
// config/models; le chiavi segrete da config/secrets, leggibile SOLO dagli admin (#581).
// Precedenza: secrets > build per le chiavi, config/models > costanti per i modelli.

const auth = require('../auth/google-auth');
const { getBuildKeys, getBuildSafeBrowsingKey } = require('../config/default-keys');
// L'elenco dei gruppi di mittente dell'auto-approvazione deve restare uno solo (#446).
require('../../shared/feedbackThread.js');
// Registra SN_ROUTINE_SESSIONI: le regole su quante sessioni e da quale
// account, le stesse che applica la pagina di gestione.
require('../../shared/routineSessioni.js');
// Registra SN_ROUTINE_MODELLI: modello e sforzo per fase, stesse regole della pagina.
require('../../shared/routineModelli.js');
// Registra SN_SPESA_GIUDICI (#1515), che legge i numeri con SN_CAMPO_NUMERO: stesse regole della pagina.
require('../../shared/campoNumero.js');
require('../../shared/spesaGiudici.js');

const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MODELS_DOC = 'config/models';
const SECRETS_DOC = 'config/secrets';
const AUTOMATION_DOC = 'config/automation';
// Documento a lettura pubblica: le macchine delle routine non hanno credenziali.
const ROUTINES_DOC = 'config/routines';
// Le manopole dei crediti (#652). Il documento lo legge il server dei crediti a
// ogni riscatto, quota e premio; da qui lo scrive l'owner dalla sua pagina.
const CREDITS_DOC = 'config/credits';
// Gli interruttori delle funzioni in pausa per chi non è owner (#896 Red Team, #1592 Bacheca e Mazzi):
// un documento ciascuno, lettura pubblica, scrittura dell'owner.
const DOC_IN_PAUSA = Object.freeze({ redteam: 'config/redteam', bacheca: 'config/bacheca', mazzi: 'config/mazzi' });

// Cache degli override remoti dall'ultimo refresh.
// Campi del doc modelli lasciati dal fornitore ritirato: il salvataggio li toglie.
const CAMPI_RITIRATI = ['geminiDirect'];

function fornitoreNoto(p) {
  const C = globalThis.SN_CONST || {};
  return typeof p === 'string' && (C.PROVIDER_ORDER || ['openrouter']).includes(p);
}

let remoteModels = null;  // { provider?, models?, modelRegistry? }
// Popolato solo per gli admin (#581): per gli altri resta null, valgono le chiavi di build.
let remoteSecrets = null; // { apiKeys?: { openrouter?, tavily? }, safeBrowsingKey? }
let lastFetchTs = 0;
let adesso = () => Date.now();

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

// Legge un documento DICENDO com'è andata, non solo cosa ha portato (#679).
// «Non esiste» e «non ti riguarda» sono risposte definitive del server; «non
// ho potuto chiedere» no, e chi tiene una copia in memoria deve distinguerle:
// contare un tentativo fallito come una lettura fatta lascia Filo con la
// configurazione che non ha fino alla scadenza lunga.
// `tokenMancato`: chi usa Filo è dentro ma la sessione non ha dato il token, e
// il «non ti riguarda» detto a un anonimo non parla di lui (#679.2).
async function leggiDoc(docPath, idToken, { tokenMancato = false } = {}) {
  const url = `${FIRESTORE_BASE}/${docPath}?key=${API_KEY}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (_) {
    return { risposto: false, doc: null }; // offline o rete giù → usa i fallback
  }
  if (res.status === 404) return { risposto: true, doc: {} };
  if (res.status === 401 || res.status === 403) return { risposto: !tokenMancato, doc: null };
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

// ── API ──────────────────────────────────────────────────────────────────────

// Vero se chi sta usando Filo è nell'allowlist admin. È solo il gate LOCALE che
// evita di bussare a un documento che non ci riguarda: la garanzia forte è la
// regola Firestore (`config/secrets` → `allow read: if isAdmin()`), che risponde
// permission denied a chiunque altro anche se questa funzione mentisse.
function isAdminUser() {
  try { return Boolean(auth.isAdmin()); } catch (_) { return false; }
}

// config/models è pubblico; config/secrets si legge SOLO da admin (#581).
async function refresh() {
  // Letto PRIMA del token: un rinnovo che fallisce chiude la sessione, e dopo
  // l'owner sembrerebbe uno qualunque.
  const admin = isAdminUser();
  let dentro = false;
  try { dentro = Boolean(auth.isSignedIn()); } catch (_) {}
  let prima = null;
  try { prima = JSON.stringify(get()); } catch (_) { prima = null; }
  let idToken = null;
  try { idToken = await auth.getIdToken(); } catch (_) {}
  const tokenMancato = (admin || dentro) && !idToken;

  const models = await leggiDoc(MODELS_DOC, idToken, { tokenMancato });
  if (models.doc) remoteModels = models.doc;
  let risposto = models.risposto;

  if (admin && !idToken) {
    // Owner senza token: le sue chiavi non si sono potute chiedere. Si tiene
    // l'ultima copia (la serve `get()` solo se admin c'è) e si riprova presto:
    // spegnerla faceva pagare la chiave del build per mezz'ora (#679.2).
    risposto = false;
  } else if (admin) {
    const secrets = await leggiDoc(SECRETS_DOC, idToken);
    // Il «non ti riguarda» detto a un token vero è definitivo, e spegne la copia.
    if (secrets.risposto) remoteSecrets = secrets.doc;
    risposto = risposto && secrets.risposto;
  } else {
    // Chi non è admin non ha override; il cancello che conta sta in `get()`,
    // qui si libera solo la copia in memoria.
    remoteSecrets = null;
  }
  // Solo una lettura a cui il server HA risposto rimanda la prossima (#679).
  // Se Filo si apre mentre la rete non c'è ancora, la configurazione non
  // arriva e nessuna funzione ha un modello da usare: segnare quel tentativo
  // come fatto teneva l'app senza modelli fino alla scadenza lunga, anche se
  // la rete tornava un istante dopo. Riprovare subito non è un ciclo: qui ci
  // si passa solo all'avvio, all'accesso e quando una pagina chiede la config.
  if (risposto) lastFetchTs = adesso();
  const dopo = get();
  // La configurazione condivisa arriva dalla RETE, e la prima home è già a
  // schermo quando arriva: chi decide se Filo può rispondere deve poterlo
  // rifare adesso, invece di lasciare l'utente sul cartello «non posso
  // rispondere» finché non ricarica (#663).
  let dopoJson = null;
  try { dopoJson = JSON.stringify(dopo); } catch (_) { dopoJson = null; }
  if (prima !== dopoJson) {
    for (const fn of ascoltatori) { try { fn(dopo); } catch (_) {} }
  }
  return dopo;
}

// Chi vuole sapere che la configurazione condivisa è cambiata davvero.
const ascoltatori = [];
function onChanged(fn) {
  if (typeof fn === 'function') ascoltatori.push(fn);
}

// Ogni quanto la config remota si rilegge da sola. Cinque minuti erano
// trecento letture di Firestore al giorno PER UTENTE, per un documento che
// cambia quando l'owner lo tocca (#679). Mezz'ora perché la rilettura
// periodica serve solo alle installazioni ALTRUI: su quella di chi salva il
// documento la config torna aggiornata subito, perché `update()` chiude
// chiamando `refresh()`.
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

// Refresh "pigro": rinfresca al massimo una volta ogni `maxAgeMs`.
async function refreshIfStale(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (adesso() - lastFetchTs < maxAgeMs) return get();
  return refresh();
}

// Registro e catene di build sono VUOTI: nessun modello scritto nel codice dell'app.
// Nei test valgono quelli di prova, così i test hanno una configurazione nota.
function buildModels() {
  const C = globalThis.SN_CONST || {};
  const T = globalThis.SN_TEST_MODELS; // presente solo nei test (loader.js)
  return T ? { registry: T.registry, models: T.models } : { registry: C.DEFAULT_MODEL_REGISTRY || {}, models: C.DEFAULT_MODELS || {} };
}

// Il fornitore del documento remoto vale solo se Filo lo sa chiamare e la politica lo ammette: il
// documento è rimasto su 'gemini' dopo l'uscita di Google, e nessuna chiave lo trovava più.
function fornitoreUsabile(nome, C = globalThis.SN_CONST || {}) {
  if (typeof nome !== 'string' || !nome) return false;
  if ((C.PRODUCER_DIRECT_PROVIDERS || []).includes(nome)) return false;
  if (nome === (C.DEFAULT_PROVIDER || 'openrouter')) return true;
  const Gate = globalThis.SN_MODEL_GATE;
  return Boolean(Gate && Gate.hasProvider(nome));
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

  let remoteReasons = [];
  if (remoteModels) {
    if (fornitoreUsabile(remoteModels.provider, C)) out.provider = remoteModels.provider;
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
    if (Array.isArray(remoteModels.excludedProviderReasons)) {
      remoteReasons = remoteModels.excludedProviderReasons;
    }
    if (typeof remoteModels.providerSort === 'string') {
      out.providerSort = remoteModels.providerSort.trim();
    }
    // #1004 — gli elenchi delle pagine delicate (posta, banche, sanità, pa): ogni categoria remota sostituisce la sua.
    if (remoteModels.sitiDelicati && typeof remoteModels.sitiDelicati === 'object') {
      out.sitiDelicati = remoteModels.sitiDelicati;
    }
    // #868 — i due tetti di quanto filo la chat ha davanti: valgono per chi non li ha cambiati in Preferenze.
    if (remoteModels.contestoFilo && typeof remoteModels.contestoFilo === 'object') {
      out.contestoFilo = tettiContesto(remoteModels.contestoFilo);
    }
    // #1097.3 — il tetto delle risposte per famiglia di funzioni: vale per chi non l'ha cambiato in Preferenze.
    if (remoteModels.lunghezzaRisposte && typeof remoteModels.lunghezzaRisposte === 'object') {
      out.lunghezzaRisposte = tettiRisposte(remoteModels.lunghezzaRisposte);
    }
    if (Array.isArray(remoteModels.modelRegistryDeleted)) {
      for (const nick of remoteModels.modelRegistryDeleted) {
        if (typeof nick !== 'string' || !nick) continue;
        if (remoteModels.modelRegistry && nick in remoteModels.modelRegistry) continue;
        delete out.modelRegistry[nick];
      }
    }
  }

  // Il perché di ogni esclusione: sta in un campo a parte, così i client che
  // leggono solo `excludedProviders` (array di nomi) restano compatibili.
  out.excludedProviderReasons = typeof C.excludedProviderReasons === 'function'
    ? C.excludedProviderReasons(out.excludedProviders, remoteReasons, C.DEFAULT_EXCLUDED_PROVIDER_REASONS)
    : [];

  // Le chiavi lette da admin valgono solo finché admin c'è ADESSO, non fino alla
  // prossima rilettura: un logout non rilegge niente, e la copia restava in uso
  // a chi usava il computer dopo, fino a mezz'ora (#679.1).
  if (remoteSecrets && isAdminUser()) {
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
    excludedProviderReasons: eff.excludedProviderReasons,
    providerSort: eff.providerSort,
    apiKeysPresent: {
      openrouter: Boolean(eff.apiKeys.openrouter),
      tavily: Boolean(eff.apiKeys.tavily),
    },
    safeBrowsingKeyPresent: Boolean(eff.safeBrowsingKey),
    // #1004 — gli elenchi delle pagine delicate in vigore, e quelli del codice: l'editor salva solo le categorie che
    // se ne discostano, così una banca aggiunta con un rilascio arriva anche dove l'owner non ha toccato niente.
    sitiDelicati: PD() ? PD().elenco(eff.sitiDelicati) : (eff.sitiDelicati || {}),
    sitiDelicatiDiSerie: PD() ? PD().elenco(null) : {},
    contestoFilo: eff.contestoFilo || {},
    contestoFiloDiSerie: contestoDiSerie(),
    lunghezzaRisposte: eff.lunghezzaRisposte || {},
    lunghezzaRisposteDiSerie: risposteDiSerie(),
  };
}
const PD = () => globalThis.SN_PAGINE_DELICATE || null;

// Solo numeri dentro i limiti: un valore assente vuol dire «quello del codice».
function tettiContesto(o) {
  const FC = globalThis.SN_FILO_CONTESTO;
  const out = {};
  for (const k of ['giorni', 'token']) {
    const v = FC ? FC.numeroIn(o && o[k], FC.LIMITI[k]) : null;
    if (v != null) out[k] = k === 'token' ? Math.round(v) : v;
  }
  const cache = FC ? FC.durataIn(o && o.cache) : null;
  if (cache) out.cache = cache;
  return out;
}
function contestoDiSerie() {
  const FC = globalThis.SN_FILO_CONTESTO;
  return FC ? { ...FC.TETTI_DI_SERIE } : {};
}

// Solo le famiglie note, coi numeri nei limiti: un valore assente vuol dire «quello del codice».
function tettiRisposte(o) {
  const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;
  if (!LR) return {};
  const pulito = LR.pulisci(o);
  return Object.fromEntries(Object.entries(pulito).filter(([, v]) => v != null));
}
function risposteDiSerie() {
  const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;
  return LR ? { ...LR.DI_SERIE } : {};
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
  // Il fornitore dichiarato si riscrive a ogni salvataggio dei modelli, anche se
  // l'editor non lo mostra: un valore ritirato restava lì per sempre (#663).
  if (typeof partial.provider === 'string' || partial.models || partial.modelRegistry) {
    const C = globalThis.SN_CONST || {};
    modelFields.provider = toFsValue(fornitoreNoto(partial.provider) ? partial.provider : (C.DEFAULT_PROVIDER || 'openrouter'));
    modelMask.push('provider');
  }
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
  if (Array.isArray(partial.excludedProviderReasons)) {
    const C = globalThis.SN_CONST || {};
    const kinds = C.EXCLUDED_PROVIDER_KINDS || [];
    const clean = partial.excludedProviderReasons
      .filter((r) => r && typeof r.name === 'string' && r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        kind: kinds.includes(r.kind) ? r.kind : '',
        note: typeof r.note === 'string' ? r.note.trim() : '',
      }));
    modelFields.excludedProviderReasons = toFsValue(clean);
    modelMask.push('excludedProviderReasons');
  }
  if (typeof partial.providerSort === 'string') {
    modelFields.providerSort = toFsValue(partial.providerSort.trim());
    modelMask.push('providerSort');
  }
  // #1004 — le categorie delle pagine delicate: l'oggetto inviato sostituisce quello remoto per intero.
  if (partial.sitiDelicati && typeof partial.sitiDelicati === 'object' && !Array.isArray(partial.sitiDelicati)) {
    const clean = {};
    for (const [k, v] of Object.entries(partial.sitiDelicati)) {
      if (!/^[a-z0-9_-]{1,40}$/i.test(k) || !Array.isArray(v)) continue;
      clean[k] = [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean))];
    }
    modelFields.sitiDelicati = toFsValue(clean);
    modelMask.push('sitiDelicati');
  }
  // #868 — l'oggetto inviato sostituisce quello remoto: un tetto tolto torna al valore del codice.
  if (partial.contestoFilo && typeof partial.contestoFilo === 'object' && !Array.isArray(partial.contestoFilo)) {
    modelFields.contestoFilo = toFsValue(tettiContesto(partial.contestoFilo));
    modelMask.push('contestoFilo');
  }
  if (partial.lunghezzaRisposte && typeof partial.lunghezzaRisposte === 'object' && !Array.isArray(partial.lunghezzaRisposte)) {
    modelFields.lunghezzaRisposte = toFsValue(tettiRisposte(partial.lunghezzaRisposte));
    modelMask.push('lunghezzaRisposte');
  }
  // Nella maschera ma non nel corpo: Firestore li cancella.
  if (modelMask.length) modelMask.push(...CAMPI_RITIRATI);
  if (modelMask.length) {
    await patchDoc(MODELS_DOC, modelFields, modelMask, idToken);
    // Il salvato entra subito nella copia: se la rilettura qui sotto non arriva,
    // la schermata non deve tornare ai valori di prima (#679.2).
    remoteModels = { ...(remoteModels || {}) };
    for (const k of modelMask) remoteModels[k] = fromFsValue(modelFields[k]);
  }

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
  if (secretMask.length) {
    await patchDoc(SECRETS_DOC, secretFields, secretMask, idToken);
    const prima = remoteSecrets || {};
    remoteSecrets = { ...prima, apiKeys: { ...(prima.apiKeys || {}), ...fromFsValue(secretFields.apiKeys || { mapValue: {} }) } };
    if ('safeBrowsingKey' in secretFields) remoteSecrets.safeBrowsingKey = fromFsValue(secretFields.safeBrowsingKey);
  }

  // La rilettura qui NON è un lusso: è ciò che rende immediata la modifica
  // sulla macchina di chi salva. La rilettura periodica è lenta apposta
  // (DEFAULT_MAX_AGE_MS), e senza questa riga l'owner cambierebbe un modello e
  // continuerebbe a usare il vecchio per mezz'ora.
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

// L'automatica per fiducia (config/automation, campo `autoApprove`, SPEC-DOMANDE.md §10): quali livelli di fiducia
// entrano in coda da soli col master acceso. Decide il backend di sicurezza; qui lettura e scrittura per la dashboard.
// Campo assente ⇒ tutti ammessi; una mappa per mittente salvata prima la traduce resolveAutoApprove (modulo condiviso).
function autoApproveGroups() {
  const T = globalThis.SN_FEEDBACK_THREAD;
  return (T && T.AUTO_APPROVE_GROUPS) || ['fidato', 'non_fidato'];
}

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

// ── Ciò che le routine devono sapere (config/routines) ──────────────────────
// Interruttore master e tentativi del loop vivono in un documento SEPARATO da
// config/automation, e leggibile senza credenziali.
//
// Perché separato: chi legge queste cose sono le macchine delle routine, che
// non hanno nessuna credenziale. Finché stavano nel documento admin-only la
// lettura falliva sempre, in silenzio, e si ricadeva sui default: in dashboard
// sembravano attive, ma nessuna routine le ha mai viste (stessa radice del
// registro worker sempre vuoto, #451). Dentro non c'è niente di segreto — solo
// se e come le routine devono lavorare — e la scrittura resta all'owner.
//
// MIGRAZIONE: se il campo non c'è ancora nel documento nuovo lo si cerca in
// quello vecchio, così i valori già scelti dall'owner non si azzerano sotto gli
// occhi. Il primo salvataggio li porta di là.
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

// I lavori server alle routine (#1159): solo un `true` scritto apposta li accende, come legge il server.
async function getLavoriServer(idToken) {
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  return !!doc && doc.lavoriServer === true;
}

async function setLavoriServer(on, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare i lavori server.');
  await patchDoc(ROUTINES_DOC, { lavoriServer: toFsValue(Boolean(on)) }, ['lavoriServer'], idToken);
  return Boolean(on);
}

// I bilanci dei giri di correzione, uno per livello (config/routines, campi in
// VERIFIER_CAP_KEYS — feedback #561) e il testo della fase 2 (`fixInstructions`).
// Li applica il SERVER quando registra la critica; qui la dashboard li legge e
// li scrive. Non c'è un default: i numeri stanno SOLO nel documento (decisione
// dell'owner del 2026-09-16 — un default nel codice faceva ragionare la
// verifica locale con 5/2/0 mentre la dashboard diceva 10/1/0). Un campo che
// nel documento non c'è torna `null`, e la dashboard lo mostra vuoto. Il range
// da SN_CONST.AUTOMATION; clamp prudente sia in lettura sia in scrittura. Lo 0
// è un valore valido per tutti.
const CAP_KEYS = (globalThis.SN_FB_TRANSITIONS && globalThis.SN_FB_TRANSITIONS.VERIFIER_CAP_KEYS) || ['cap3', 'cap2', 'cap1', 'cap0'];
/** La forma di risposta coi bilanci tutti a `null`: un campo che nel documento non c'è resta vuoto. */
function capsVuoti() {
  const out = { fixInstructions: '', giroStretto: false };
  for (const k of CAP_KEYS) out[k] = null;
  return out;
}
const FIX_INSTRUCTIONS_MAX = Number(globalThis.SN_CONST && globalThis.SN_CONST.AUTOMATION && globalThis.SN_CONST.AUTOMATION.FIX_INSTRUCTIONS_MAX) || 8000;

function automationRange() {
  const A = (globalThis.SN_CONST && globalThis.SN_CONST.AUTOMATION) || {};
  return {
    min: Number.isFinite(A.CAP_MIN) ? A.CAP_MIN : 0,
    max: Number.isFinite(A.CAP_MAX) ? A.CAP_MAX : 10,
  };
}

function clampCap(n) {
  const { min, max } = automationRange();
  const v = Math.round(Number(n));
  if (n === '' || n === null || n === undefined || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

async function getRoutineCaps(idToken) {
  // SOLO config/routines: è il documento che il server legge davvero. Un
  // ripiego sul vecchio config/automation mostrava valori che il server
  // ignorava: la manopola girava, le ruote no.
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  // `null` = non ho potuto leggere: dirlo, o «spento» e «non impostato» sembrano parole del server.
  if (doc === null) throw new Error('Impostazioni del giro di verifica non raggiungibili.');
  const out = capsVuoti();
  for (const k of CAP_KEYS) {
    if (doc && doc[k] != null) out[k] = clampCap(doc[k]);
  }
  // Spento di serie: solo un true esplicito nel documento lo accende.
  out.giroStretto = !!doc && doc.giroStretto === true;
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
  if (typeof p.giroStretto === 'boolean') {
    fields.giroStretto = toFsValue(p.giroStretto);
    mask.push('giroStretto');
  }
  if (mask.length) await patchDoc(ROUTINES_DOC, fields, mask, idToken);
  try {
    return await getRoutineCaps(idToken);
  } catch (e) {
    // Scritto ma non riletto: un salvataggio riuscito non deve sembrare fallito. Tornano i soli campi scritti.
    if (!mask.length) throw e;
    const scritto = capsVuoti();
    for (const k of mask) scritto[k] = k === 'fixInstructions' ? p[k].slice(0, FIX_INSTRUCTIONS_MAX) : (k === 'giroStretto' ? p[k] : clampCap(p[k]));
    return scritto;
  }
}


// Come partono le sessioni delle routine (config/routines): quante insieme,
// da quale account per prima, quali account sono esclusi. Le regole stanno in
// SN_ROUTINE_SESSIONI (stesse per pagina e main); qui si legge il documento e
// si scrivono i SOLI campi ricevuti.
// `null` = non ho potuto leggere, ed è diverso da «documento senza quei campi»
// (che invece vale come «i valori di partenza»). Confonderli faceva mostrare
// alla pagina «una sessione, tutti e due gli account in uso» come se venisse
// dal server, proprio a chi la apre per controllare di non bruciare crediti.
async function getRoutineSessions(idToken) {
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  if (doc === null) throw new Error('Impostazioni delle sessioni non raggiungibili.');
  return globalThis.SN_ROUTINE_SESSIONI.leggiDoc(doc);
}

async function setRoutineSessions(patch, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare le sessioni delle routine.');
  const esito = globalThis.SN_ROUTINE_SESSIONI.valida(patch);
  // Un valore fuori intervallo non si aggiusta di nascosto: chi ha scritto
  // deve sapere che sul server è rimasto quello di prima.
  if (!esito.ok) throw new Error(esito.testo);
  const fields = {};
  const mask = [];
  for (const [k, v] of Object.entries(esito.valori)) {
    fields[k] = toFsValue(v);
    mask.push(k);
  }
  if (mask.length) await patchDoc(ROUTINES_DOC, fields, mask, idToken);
  // La scrittura è andata: se la rilettura che la segue non riesce, dirlo è
  // l'unica risposta vera. Fingere un fallimento cancellerebbe una scrittura
  // avvenuta, e fingere una lettura rimetterebbe i valori di partenza.
  try {
    return Object.assign({ letto: true }, await getRoutineSessions(idToken));
  } catch (_) {
    return Object.assign({ letto: false }, esito.valori);
  }
}

// Modello e sforzo del worker per fase (config/routines, campo `roleModels`): li legge il server quando
// consegna un biglietto. Regole in SN_ROUTINE_MODELLI; `null` dalla lettura è «non letto», come sopra.
async function getRoutineRoleModels(idToken) {
  const doc = await fetchDoc(ROUTINES_DOC, idToken);
  if (doc === null) throw new Error('Modelli delle fasi non raggiungibili.');
  return globalThis.SN_ROUTINE_MODELLI.leggiDoc(doc);
}

// Si scrive il SOLO campo scelto (maschera sulla foglia): il modello di una fase non riscrive il suo sforzo né
// le altre fasi. Vuoto = la foglia esce dalla maschera senza valore, e Firestore la toglie.
async function setRoutineRoleModel(patch, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare i modelli delle fasi.');
  const RM = globalThis.SN_ROUTINE_MODELLI;
  const esito = RM.valida(patch);
  if (!esito.ok) throw new Error(esito.testo);
  const { ruolo, campo, valore } = esito;
  const fields = valore
    ? { [RM.CAMPO]: toFsValue({ [ruolo]: { [campo]: valore } }) }
    : {};
  await patchDoc(ROUTINES_DOC, fields, [RM.percorso(ruolo, campo)], idToken);
  const scritto = { ruolo, campo, valore };
  try {
    return { letto: true, scritto, roleModels: await getRoutineRoleModels(idToken) };
  } catch (_) {
    return { letto: false, scritto };
  }
}


// ── Aperto a tutti: Red Team (#896), Bacheca e Mazzi (#1592) ────────────────
// `aperto` è vero solo per un `openToAll: true` scritto: documento assente o
// illeggibile vale «in pausa», come sul server. `risposto` distingue la rete giù
// dal no del server, perché chi tiene una copia in memoria possa riprovare.
function docInPausa(nome) {
  const doc = Object.prototype.hasOwnProperty.call(DOC_IN_PAUSA, nome) ? DOC_IN_PAUSA[nome] : null;
  if (!doc) throw new Error(`Interruttore sconosciuto: ${nome}`);
  return doc;
}

async function getApertoATutti(nome) {
  const r = await leggiDoc(docInPausa(nome), null);
  return { risposto: r.risposto, aperto: !!(r.doc && r.doc.openToAll === true) };
}

async function setApertoATutti(nome, on, idToken) {
  const doc = docInPausa(nome);
  if (!idToken) throw new Error('Serve un ID token admin per aprire o mettere in pausa una funzione.');
  await patchDoc(doc, {
    openToAll: toFsValue(Boolean(on)),
    updatedAt: { timestampValue: new Date(adesso()).toISOString() },
  }, ['openToAll', 'updatedAt'], idToken);
  return Boolean(on);
}

const getRedteamOpen = () => getApertoATutti('redteam');
const setRedteamOpen = (on, idToken) => setApertoATutti('redteam', on, idToken);

// ── Manopole dei crediti (#652) ──────────────────────────────────────────────
// Le impostazioni di `config/credits` che l'owner cambia dalla sua
// pagina. La tabella di cosa sono e quanto possono valere sta in
// src/shared/wallet.js: qui si applica, non si ridichiara.
//
// Si scrivono SOLO i campi ricevuti (mask sui campi foglia): il documento porta
// anche i contatori del server (inviti rimasti, somma dei tetti, cambio del
// giorno) e riscriverlo intero li cancellerebbe.

function knobRules(chiave) {
  const W = globalThis.SN_WALLET;
  const k = W && W.knobOf ? W.knobOf(chiave) : null;
  return k ? { min: k.min, max: k.max, intero: true, etichetta: k.etichetta } : null;
}

async function getCreditsKnobs(idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per leggere le impostazioni dei crediti.');
  const doc = await fetchDoc(CREDITS_DOC, idToken);
  // `null` = non ho potuto leggere (rete giù): è diverso da «mai scritto».
  if (doc === null) throw new Error('Impostazioni dei crediti non raggiungibili.');
  const W = globalThis.SN_WALLET;
  const keys = (W && W.OWNER_KNOB_KEYS) || [];
  const out = {};
  for (const k of keys) out[k] = doc[k] == null ? null : Number(doc[k]);
  return out;
}

async function setCreditsKnobs(patch, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare le impostazioni dei crediti.');
  const CN = globalThis.SN_CAMPO_NUMERO;
  const p = patch && typeof patch === 'object' ? patch : {};
  const fields = {};
  const mask = [];
  const W = globalThis.SN_WALLET;
  for (const chiave of (W && W.OWNER_KNOB_KEYS) || []) {
    if (p[chiave] == null) continue;
    const regole = knobRules(chiave);
    // Lo stesso controllo della pagina, rifatto qui: un numero storto non deve
    // arrivare al documento da cui il server legge quanto regalare.
    const esito = CN.controlla(p[chiave], regole);
    if (!esito.ok) throw new Error(esito.testo);
    fields[chiave] = toFsValue(esito.valore);
    mask.push(chiave);
  }
  if (!mask.length) throw new Error('Non c’è niente da salvare.');
  await patchDoc(CREDITS_DOC, fields, mask, idToken);
  return getCreditsKnobs(idToken);
}

// Il tetto di spesa dei giudici per i non fidati e la lunghezza che ricevono (#1515): campi di config/automation,
// regole in SN_SPESA_GIUDICI. La spesa di oggi la scrive solo il server; `spesa: null` = non letta, non zero.
async function getJudgeBudget(idToken) {
  const SG = globalThis.SN_SPESA_GIUDICI;
  const cfg = await leggiDoc(AUTOMATION_DOC, idToken);
  if (!cfg.risposto || !cfg.doc) throw new Error('Impostazioni dei giudici non raggiungibili.');
  const conto = await leggiDoc(SG.DOC_SPESA, idToken);
  const oraMs = adesso();
  return {
    ...SG.leggiImpostazioni(cfg.doc),
    spesa: conto.risposto && conto.doc ? SG.spesaDiOggi(conto.doc, oraMs) : null,
    oraMs,
  };
}

async function setJudgeBudget(patch, idToken) {
  if (!idToken) throw new Error('Serve un ID token admin per cambiare il tetto dei giudici.');
  const SG = globalThis.SN_SPESA_GIUDICI;
  const esito = SG.valida(patch);
  if (!esito.ok) throw new Error(esito.testo);
  const mask = Object.keys(esito.valori);
  if (!mask.length) throw new Error('Non c’è niente da salvare.');
  const fields = {};
  for (const k of mask) fields[k] = toFsValue(esito.valori[k]);
  await patchDoc(AUTOMATION_DOC, fields, mask, idToken);
  try {
    return await getJudgeBudget(idToken);
  } catch (_) {
    // Scritto ma non riletto: tornano i soli campi scritti, gli altri restano ignoti.
    const scritto = SG.leggiImpostazioni(esito.valori);
    const out = { spesa: null, oraMs: adesso(), letto: false };
    if (SG.CAMPI.tetto in esito.valori) out.tettoUsd = scritto.tettoUsd;
    if (SG.CAMPI.caratteri in esito.valori) out.maxCaratteri = scritto.maxCaratteri;
    return out;
  }
}

// Log dei worker delle routine (config/automation, campo `workerLog`): elenco
// delle ultime esecuzioni di scripts/dispatch.mjs, ciascuna { role, startedAt,
// num }. Lo scrive dispatch a ogni worker spawnato; qui lo LEGGIAMO soltanto
// (owner-gated) per la tab "Log" della dashboard. Ritorna le voci più recenti
// PRIMA (ordine decrescente per istante d'avvio), già normalizzate. Documento o
// campo assente / lettura fallita ⇒ lista vuota (mai un errore per un log).
// `severo`: una lettura fallita lancia invece di valere «registro vuoto» (il giro
// della Gestione deve distinguere «non lo so» da «niente di nuovo», #676.1).
async function getWorkerLog(idToken, { severo = false } = {}) {
  const letto = await leggiDoc(AUTOMATION_DOC, idToken);
  if (severo && (!letto.risposto || !letto.doc)) throw new Error('registro dei worker non letto');
  const doc = letto.doc;
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
  tettiContesto,
  tettiRisposte,
  get,
  fornitoreUsabile,
  getPublicForAdmin,
  onChanged,
  refresh,
  refreshIfStale,
  DEFAULT_MAX_AGE_MS,
  // L'orologio si sostituisce solo nei test: far scadere una mezz'ora
  // aspettandola davvero non è una prova che si possa correre.
  _setAdesso: (fn) => { adesso = typeof fn === 'function' ? fn : Date.now; },
  update,
  getAutomationGate,
  setAutomationGate,
  getAutomationAutoApprove,
  setAutomationAutoApprove,
  getLavoriServer,
  setLavoriServer,
  getRoutinesEnabled,
  setRoutinesEnabled,
  getRoutineCaps,
  setRoutineCaps,
  getRoutineSessions,
  setRoutineSessions,
  getRoutineRoleModels,
  setRoutineRoleModel,
  getJudgeBudget,
  setJudgeBudget,
  getCreditsKnobs,
  setCreditsKnobs,
  getRedteamOpen,
  setRedteamOpen,
  getApertoATutti,
  setApertoATutti,
  getWorkerLog,
};
