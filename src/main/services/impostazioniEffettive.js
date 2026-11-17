// Le impostazioni effettive (default, chiavi, modello per azione, catena dei tentativi) e il gate dei modelli.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const { BrowserWindow } = require('electron');
const Defaults = require('./defaultsStore');
const { settingsForOwnerAction, fillMovedSlots, ownerSlotFor } = require('./resolveSupportModel');
const SegretiLetti = require('./segretiLetti');
const ContatoriSicurezza = require('./contatoriSicurezza');
const ContatoriServizio = require('./contatoriServizio');
const FiloParla = require('./filoParla');
const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS } = SN_CONST;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const Costs = globalThis.SN_COSTS;
const I18n = globalThis.SN_I18N;
const { broadcastToTabs } = require('./broadcast');
// Questi vivono in moduli che caricano questo: si chiedono al momento della chiamata, non al caricamento.
const segretiCustoditi = (...a) => require('./porteUscita').segretiCustoditi(...a);
const wireSafebrowse = (...a) => require('./handlers').wireSafebrowse(...a);

const Gate = globalThis.SN_MODEL_GATE.create({
  getSettings: () => getEffectiveSettings(),
  buildChain: (s, ref, action) => buildAttemptChain(s, ref, action),
  modelFor: (s, action) => modelForAction(s, action),
  routing: (s, a) => providerRouting(s, a && a.sort, a && a.weights),
  noteServed: (s, action, r) => noteServedProvider(s, action, r),
  costs: Costs,
  segreti: async () => segretiCustoditi(),
  segretiTolti: (action, tipi) => ContatoriSicurezza.misura('segretiTolti', action, tipi),
  ricordaEsterni: (messages) => SegretiLetti.ricordaBuste(messages),
  // La prova di una riga delle Opzioni non è una funzione: la frase nomina solo il modello.
  funzioneDi: (action) => (action === ACTIONS.PROVIDER_TEST ? '' : actionLabelForSettings(action)),
  rimedioDi: (s, action, err) => globalThis.SN_CHAT_ERRORS.rimedioNessunHost(doveSiSceglieIlModello(s, action), err, s),
  // Lo crea handlers/contatori.js, registrato più sotto: lo si chiede a ogni chiamata.
  contatore: () => globalThis.SN_CONTATORI_MAIN,
  durataCache: (s) => globalThis.SN_FILO_CONTESTO.tetti(s && s.contestoFilo, Defaults.get().contestoFilo).cache,
});

// Chiave GSB effettiva: la condivisa (build, o quella dell'admin finché è dentro) vince sulla personale.
function safeBrowsingKeyFor(settings, d = Defaults.get()) {
  return d.safeBrowsingKey || settings?.security?.safeBrowse?.safeBrowsingKey || '';
}

// Quando "usa modelli predefiniti" è attivo (default), la risoluzione di
// modelli/registry/provider usa la config predefinita condivisa, e le chiavi
// sono quelle di default (build env / override admin via Firestore), con
// fallback alle eventuali chiavi personali dell'utente se i default mancano
// (es. build locale senza chiavi iniettate). Quando è disattivo, l'utente
// gestisce tutto dalle Opzioni e usiamo i suoi settings così come sono.
function withDefaults(settings) {
  const d = Defaults.get();
  // La chiave Safe Browsing è SEMPRE condivisa, anche con modelli propri: non esiste più un
  // campo per-utente, e arriva incastonata dal build (#581). Non è un doppione.
  const sec = settings.security || {};
  const sbKey = safeBrowsingKeyFor(settings, d);
  const security = sbKey
    ? { ...sec, safeBrowse: { ...(sec.safeBrowse || {}), safeBrowsingKey: sbKey } }
    : sec;

  // Politica sui fornitori: è una regola di Filo, non una preferenza, quindi viene sempre dai
  // default condivisi e mai dallo storage utente, così l'owner la aggiorna senza rilasciare.
  const baseExcluded = Array.isArray(d.excludedProviders) ? d.excludedProviders : [];
  // L'ordinamento degli host invece lo può scegliere chi usa Filo: la sua scelta vale sopra quella condivisa.
  const sortPersonale = SN_CONST.normalizeProviderSort(settings.ordineHost);
  const providerSort = sortPersonale || (typeof d.providerSort === 'string' ? d.providerSort : '');

  // «Solo modelli a pesi aperti» è invece una scelta di CHI USA Filo e sta sopra la config
  // condivisa: allunga l'esclusione con Anthropic, perché rifiuta anche la scelta dell'owner.
  const openWeightsOnly = settings.openWeightsOnly === true;
  const excludedProviders = SN_CONST.effectiveExcludedProviders(baseExcluded, openWeightsOnly);
  // Con la chiave propria e il suo interruttore (#962) le richieste pagate con lei hanno una lista loro; quale vale lo
  // decide la chiave con cui una chiamata parte davvero (SN_CONST.excludedProvidersForKey).
  const excludedProvidersOwnKey = SN_CONST.ownKeyExcludedProviders(settings, openWeightsOnly);

  if (settings.useDefaultModels === false) {
    // Anche chi gestisce i modelli da sé usa la chiave personale se non ne ha scritta una:
    // quali modelli e con che chiave pagarli sono due scelte diverse (#598).
    const own = settings.apiKeys || {};
    const personal = personalOpenrouterKey();
    const apiKeys = own.openrouter || !personal ? own : { ...own, openrouter: personal };
    // Un fornitore salvato che Filo non ha più (Gemini) spegnerebbe ogni funzione che cerca la sua chiave.
    const provider = Defaults.fornitoreUsabile(settings.provider) ? settings.provider : d.provider;
    const modelRegistry = SN_CONST.registroConPesiCondivisi(settings.modelRegistry, d.modelRegistry);
    return { ...settings, modelRegistry, provider, apiKeys, openWeightsOnly, excludedProviders, excludedProvidersOwnKey, providerSort, security };
  }
  // OpenRouter (#598): fra la chiave dell'utente e quella di fabbrica c'è la
  // PERSONALE creata dal server al riscatto dell'invito (il suo tetto sono i
  // suoi crediti). La regola dell'ordine sta in SN_CONST.effectiveApiKeys.
  const apiKeys = SN_CONST.effectiveApiKeys(settings.apiKeys, personalOpenrouterKey(), d.apiKeys);
  return {
    ...settings,
    provider: d.provider,
    models: SN_CONST.effectiveModels(d.models, settings.modelliScelti, d.modelRegistry),
    modelRegistry: sortPersonale ? SN_CONST.registroSenzaOrdinamento(d.modelRegistry) : d.modelRegistry,
    openWeightsOnly,
    excludedProviders,
    excludedProvidersOwnKey,
    providerSort,
    apiKeys,
    security,
  };
}

function personalOpenrouterKey() {
  try { return require('../auth/wallet-store').personalKey(); } catch (_) { return ''; }
}

// Come getSettings(), ma coi default condivisi applicati se useDefaultModels è attivo.
async function getEffectiveSettings() {
  return withDefaults(await Storage.getSettings());
}

// NIENTE ripiego su un modello scritto nel codice: senza modello per questa funzione la
// stringa torna vuota e l'errore dice quale funzione è scoperta e dove si imposta.
function modelForAction(settings, action) {
  const raw = settings.models?.[action] || '';
  return SN_CONST.DEPRECATED_MODELS?.[raw] || raw;
}

// Errore di CONFIGURAZIONE scritto per l'utente: quale funzione non parte, perché e dove
// si imposta. Il nome è quello che l'utente legge nelle Opzioni, dove il messaggio manda.
function actionLabelForSettings(action) {
  try {
    const rows = globalThis.SN_MODEL_CHAIN?.actionLabels?.() || [];
    const row = rows.find(([a]) => a === action);
    if (row) {
      const label = I18n.t(row[1]);
      if (label && label !== row[1]) return label;
    }
  } catch (_) {}
  return (SN_CONST.actionLabel && SN_CONST.actionLabel(action)) || action || '';
}

// Dove si sceglie il modello di una funzione: lo dicono sia l'errore di configurazione sia il «nessun host ammesso» (#828).
function doveSiSceglieIlModello(settings, action) {
  if (ownerSlotFor(action)) return 'gestione';
  return settings && settings.useDefaultModels === false ? 'opzioni' : 'predefiniti';
}
const DOVE_MODELLO_I18N = { gestione: 'err_model_where_owner', opzioni: 'err_model_where_own', predefiniti: 'err_model_where_default' };

function modelConfigError(settings, action, missingRefs) {
  const label = actionLabelForSettings(action);
  const where = I18n.t(DOVE_MODELLO_I18N[doveSiSceglieIlModello(settings, action)]);
  const missing = missingRefs || [];
  const e = new Error(missing.length
    ? I18n.t('err_unknown_model_for_action', label, SN_CONST.formatModelRefsForMessage(missing), where)
    : I18n.t('err_no_model_for_action', label, where));
  e.code = 'NO_MODEL_FOR_ACTION';
  e.action = action || '';
  e.missingRefs = missing;
  return e;
}

// Dice QUALE funzione si ferma e come sbloccarla: un «errore del modello» generico
// manderebbe a cercare un guasto dove non c'è.
function openWeightsConfigError(settings, action, droppedRefs) {
  const label = actionLabelForSettings(action);
  const refs = droppedRefs || [];
  const e = new Error(I18n.t(
    ownerSlotFor(action) ? 'err_open_weights_only_no_model_owner' : 'err_open_weights_only_no_model',
    label,
    SN_CONST.formatModelRefsForMessage(refs),
  ));
  e.code = 'NO_OPEN_WEIGHTS_MODEL';
  e.action = action || '';
  e.droppedRefs = refs;
  return e;
}

// Catena di tentativi per servire una richiesta. L'UNICA sorgente dei modelli è
// la configurazione effettiva (condivisa o personale): il registry scritto nel
// codice NON viene più rifuso qui sotto. Rifonderlo significava che un modello
// cancellato dalla configurazione continuava a girare — scelto dal codice, mai
// da una persona — e per giunta poteva essere di un fornitore escluso dalla
// politica sui modelli.
//
// Se la funzione non ha nessun modello, o cita solo scorciatoie che non
// esistono, la richiesta si ferma con un errore leggibile invece di ripiegare in
// silenzio. La catena di ripiego fra i modelli CONFIGURATI resta intatta.
function buildAttemptChain(settings, modelRef, action) {
  const registry = settings.modelRegistry || {};
  // Più nickname separati da virgola: il primo è il primario, gli altri ripieghi in ordine.
  const refs = SN_CONST.parseModelRefs(modelRef);
  if (!refs.length) throw modelConfigError(settings, action, []);

  // Scorciatoie citate ma inesistenti: mai risolte di nascosto. Se ne resta almeno una
  // valida si parte con quelle, altrimenti la funzione non parte e lo dice.
  const missing = SN_CONST.missingModelRefs(refs, registry);
  let usable = SN_CONST.usableModelRefs(refs, registry);
  if (!usable.length) throw modelConfigError(settings, action, missing);
  if (missing.length) {
    console.warn(`[Filo modelli] "${action || modelRef}" cita modelli inesistenti: ${missing.join(', ')}`);
  }

  // «Solo modelli a pesi aperti»: ogni modello proprietario è SOSTITUITO col suo equivalente
  // aperto, e chi non ne ha esce. Un ripiego su un proprietario non si costruisce proprio.
  const openWeightsOnly = settings.openWeightsOnly === true;
  let pesiAperti = null;
  if (openWeightsOnly) {
    // Il sostituto deve saper fare QUEL mestiere, o la dettatura finisce su un modello muto.
    const pol = SN_CONST.applyOpenWeightsPolicy(usable, registry, action);
    if (pol.substituted.length) {
      console.log(`[Filo policy] "${action || modelRef}" (solo pesi aperti): `
        + pol.substituted.map((s) => `${s.from} → ${s.to}`).join(', '));
    }
    if (!pol.refs.length) throw openWeightsConfigError(settings, action, pol.dropped);
    usable = pol.refs;
    pesiAperti = { sostituiti: pol.substituted.length, tolti: pol.dropped.length };
  }

  // Stesso ordine di fornitori di SN_CONST.canServeAction: se le due liste
  // divergono, «pronto» e «servibile» si contraddicono in silenzio (#663).
  const out = SN_CONST.buildModelAttempts(usable, registry, SN_CONST.PROVIDER_ORDER, settings.apiKeys || {});
  if (!out.length) {
    const e = new Error(I18n.t('err_no_api_key'));
    e.code = 'NO_API_KEY';
    throw e;
  }

  // Politica sui fornitori (#421): ai tentativi OpenRouter alleghiamo la lista di
  // esclusione (forme base dei produttori) e l'eventuale ordinamento. Il provider
  // Gemini è DIRETTO (non passa da un router che sceglie l'host) e ignora il
  // campo. Se dopo l'esclusione OpenRouter non trova un host ammesso, risponde
  // con un errore: la richiesta fallisce in modo evidente invece di essere
  // servita da un fornitore escluso.
  for (const a of out) {
    if (a.provider !== 'openrouter') continue;
    const routing = providerRouting(settings, a.sort, a.weights);
    if (routing) a.providerRouting = routing;
  }
  // Il tetto della risposta per la famiglia della funzione (#1097.3): Preferenze, poi Modelli predefiniti, poi il codice.
  const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;
  let owner = null;
  try { owner = Defaults.get().lunghezzaRisposte; } catch (_) {}
  const tetto = LR ? LR.perAzione(action, settings.lunghezzaRisposte, owner) : null;
  if (tetto) for (const a of out) a.maxTokens = tetto;
  // I modelli che l'interruttore ha cambiato: li contano i contatori del servizio (#1472) quando la catena parte davvero.
  if (pesiAperti) Object.defineProperty(out, 'pesiAperti', { value: pesiAperti, enumerable: false });
  return out;
}

// Istruzioni di routing (chi NON deve servire + ordinamento) da allegare a una
// chiamata OpenRouter. Vive fuori da buildAttemptChain perché la politica sui
// fornitori non riguarda solo le funzioni: anche una PROVA fatta dalle Opzioni è
// una richiesta vera che finisce su un host, e senza queste istruzioni sarebbe
// l'unica richiesta di Filo libera di essere servita da un fornitore escluso.
// Ritorna null se non c'è niente da dire.
// La regola (la voce vince sul globale, `ignore` resta com'è) sta in SN_CONST.
function providerRouting(settings, entrySort, entryWeights) {
  return SN_CONST.providerRoutingFor(settings, entrySort, entryWeights);
}

// Cancello della politica per chi NON passa da buildAttemptChain: i pulsanti «Prova» mandano
// richieste vere che finiscono su un host, e sarebbero le uniche servite da un escluso.
function openWeightsBlockReason(settings, entry) {
  const kind = SN_CONST.openWeightsBlockKind(
    settings && settings.openWeightsOnly === true, entry,
  );
  if (kind) ContatoriServizio.misura('bloccoPesi', kind);
  if (kind === 'provider') return I18n.t('err_open_weights_only_provider_blocked');
  if (kind === 'model') {
    return I18n.t('err_open_weights_only_model_blocked', (entry && entry.model) || '—');
  }
  return null;
}

// Registra e verifica CHI ha davvero servito una risposta (#421). Il fornitore
// upstream (es. "Together", "DeepInfra", oppure — se la politica è stata aggirata
// — un produttore escluso) è la controprova della lista di esclusione: senza
// registrarlo, l'esclusione è solo una speranza. Viola la politica un host
// escluso e, per un modello da comprare solo dal produttore, un host che non è
// suo (#904): Claude servito da Amazon Bedrock o da Azure.
// Ritorna { servedBy, violation }. Il caso non resta nei log: la voce di cronologia
// resta marchiata e chi usa Filo lo vede in un avviso (#1478).
function noteServedProvider(settings, action, result) {
  const servedBy = (result && result.servedBy) || null;
  const model = (result && result.model) || '';
  // Con la lista della chiave che ha pagato (#962): coi crediti, anche dopo un ripiego, vale l'intera.
  const why = SN_CONST.servedViolationOf(settings, { ...result, servedBy, model });
  const violation = Boolean(why);
  if (why === 'not-producer') {
    console.error(
      `[Filo policy] Richiesta "${action}" per "${model}" servita da "${servedBy}", che non è `
      + 'del produttore: il vincolo provider.only non ha tenuto, o l\'host ha un nome nuovo '
      + '(PRODUCER_ONLY_MODELS in constants.js).',
    );
  } else if (violation) {
    console.error(
      `[Filo policy] Richiesta "${action}" servita da un fornitore ESCLUSO: "${servedBy}". `
      + 'La politica sui modelli è stata aggirata (nome host non intercettato dalla lista di '
      + 'esclusione): aggiornare excludedProviders in config/models.',
    );
  }
  if (violation) {
    avvisaFuoriPolitica(settings, why, servedBy, model, action);
    const fonte = (result && (result.keySource || (result.usage && result.usage.keySource))) || '';
    ContatoriServizio.misura('violazione', { action, modello: model, host: servedBy, motivo: why, fonte });
  }
  return { servedBy, violation };
}

// Un avviso per host e motivo, in coda finché la pagina in vista lo prende: la pausa di dieci minuti parte da lì (#1478.1).
const AvvisiFuoriPolitica = require('./avvisiFuoriPolitica').crea({ manda: (m) => broadcastToTabs(m) });
// Tornati su Filo dalla barra delle schede, o su una scheda scelta da lì, la pagina non riceve il fuoco: li si ripropone.
globalThis.SN_AVVISI_FUORI_POLITICA = AvvisiFuoriPolitica;
try { require('electron').app.on('browser-window-focus', () => AvvisiFuoriPolitica.riproponi()); } catch (_) {}
function avvisaFuoriPolitica(settings, why, servedBy, model, action) {
  const chiave = `${why}|${SN_CONST.normalizeProviderName(servedBy)}`;
  AvvisiFuoriPolitica.avvisa(chiave, () => {
    let text;
    if (why === 'not-producer') {
      const regola = SN_CONST.producerOnlyRule(model);
      text = I18n.t('toast_served_not_producer', servedBy, (regola && regola.nome) || 'il suo produttore');
    } else {
      text = I18n.t(settings && settings.openWeightsOnly === true ? 'toast_open_weights_violated' : 'toast_served_excluded', servedBy);
    }
    const segnala = I18n.t('segnala_fuori_politica', actionLabelForSettings(action), model || '—', servedBy);
    const pesiAperti = why !== 'not-producer' && settings && settings.openWeightsOnly === true;
    return {
      messaggio: { type: MSG.SHOW_TOAST, text, duration: 8000, segnala },
      alMostrare: pesiAperti ? () => globalThis.SN_CONTATORI_MAIN?.erroreVisto('avviso:pesi_aperti_violati') : null,
    };
  });
}

// Applica un aggiornamento parziale delle impostazioni e propaga TUTTI gli
// effetti collaterali (broadcast ai tab, tema nativo, sicurezza, fingerprint,
// safebrowse, cookie). È lo stesso percorso usato dal salvataggio dalla pagina
// Preferenze: condividerlo garantisce che una modifica fatta da Filo via chat
// si comporti esattamente come una fatta a mano (es. il tema cambia live).
// Filo passa da «non ho un modello da chiamare» a «ce l'ho», o viceversa. Le
// home già aperte lo devono sapere: l'accoglienza che aspettava parte e il
// cartello sparisce, senza che l'utente ricarichi o apra una scheda nuova.
// Le sorgenti sono TRE e arrivano in momenti diversi: la configurazione
// condivisa (dalla rete, dopo l'avvio), le impostazioni (chiave, modelli,
// interruttore dei pesi aperti) e il portafoglio, dove vive la chiave di chi
// entra con un invito. Un solo avviso per tutte e tre (#663).
// Si confronta anche il MOTIVO, non solo il sì/no: la home scrive un messaggio
// diverso per ognuno, e col solo sì/no restava a chiedere una cosa già fatta.
let _statoProntezza = null;
async function avvisaSeLaProntezzaCambia() {
  let ora = false;
  let stato = '';
  try {
    const s = await getEffectiveSettings();
    ora = SN_CONST.canServeAction(s, ACTIONS.FILO_CHAT)
      || SN_CONST.canServeAction(s, ACTIONS.FILO_DASHBOARD);
    stato = ora ? 'ok' : `no:${SN_CONST.whyCannotServe(s, [ACTIONS.FILO_DASHBOARD, ACTIONS.FILO_CHAT])}`;
  } catch (_) { return; }
  if (_statoProntezza === stato) return;
  _statoProntezza = stato;
  broadcastToTabs({ type: MSG.FILO_READY_CHANGED, ready: ora });
}

// La configurazione condivisa si ascolta da subito, perché arriva mentre la
// prima home è già aperta. Il portafoglio chiama da sé: sta sotto, e non può
// richiedere questo modulo senza chiudere il cerchio.
try { Defaults.onChanged(() => { avvisaSeLaProntezzaCambia().catch(() => {}); }); } catch (_) {}
globalThis.SN_PRONTEZZA_CAMBIATA = () => { avvisaSeLaProntezzaCambia().catch(() => {}); };

// `mentreScrive`: la lista dei bloccati arriva a metà riga, e le schede aperte aspettano che stia ferma (#590.2).
async function applySettingsUpdate(partial, { mentreScrive = false } = {}) {
  // Gli override dei token estetici finiscono dentro <style> iniettati in
  // tutte le superfici (incluse pagine web esterne): qui, nel choke point
  // delle scritture, teniamo solo i valori che passano la whitelist per tipo.
  if (partial && partial.themeTokens && globalThis.SN_THEME_TOKENS) {
    partial = { ...partial, themeTokens: globalThis.SN_THEME_TOKENS.sanitize(partial.themeTokens).clean };
  }
  // Una scorciatoia di Filo che non partirebbe mai non si salva: chi scrive (Preferenze, chat) l'ha già rifiutata col
  // perché, questo è il confine per tutte le altre strade (#842).
  if (partial && partial.scorciatoie && typeof partial.scorciatoie === 'object' && globalThis.SN_TASTI) {
    const T = globalThis.SN_TASTI;
    const tocca = (id) => Object.prototype.hasOwnProperty.call(partial.scorciatoie, id);
    // Si confrontano con la mappa che risulterà (un backup può scambiarne due), non con quella di adesso.
    const dopo = Object.fromEntries(T.AZIONI_FILO.map((a) => {
      const v = tocca(a.id) ? partial.scorciatoie[a.id] : T.scorciatoiaFilo(a.id);
      return [a.id, typeof v === 'string' && v ? v : a.serie];
    }));
    const buone = {};
    for (const a of T.AZIONI_FILO) {
      if (!tocca(a.id)) continue;
      // Arriva già nella forma salvata (Ctrl vale Cmd anche su Mac): non si rilegge come una frase detta.
      const v = partial.scorciatoie[a.id] || a.serie;
      if (typeof v === 'string' && v.length <= 80 && !T.rifiutoScorciatoiaFilo(a.id, v, undefined, dopo)) buone[a.id] = T.valoreDaSalvare(a.id, v);
      else console.warn('[Filo] scorciatoia non salvata', a.id, String(v).slice(0, 40));
    }
    partial = { ...partial, scorciatoie: buone };
  }
  // La chiave OpenRouter propria si mette e si toglie da due posti
  // (Impostazioni e pagina Crediti, #629): se cambia, il rifiuto registrato
  // per quella di prima non vale più, e la pagina Crediti aperta accanto si
  // aggiorna da sé. Si guarda il valore, non il campo: le Impostazioni
  // rimandano la stessa chiave a ogni salvataggio automatico.
  let ownKeyBefore = null;
  if (partial && partial.apiKeys && Object.prototype.hasOwnProperty.call(partial.apiKeys, 'openrouter')) {
    try { ownKeyBefore = String((await Storage.getSettings())?.apiKeys?.openrouter || '').trim(); } catch (_) { ownKeyBefore = null; }
  }
  const merged = await Storage.updateSettings(partial);
  if (ownKeyBefore !== null && ownKeyBefore !== String(merged?.apiKeys?.openrouter || '').trim()) {
    try { await globalThis.SN_WALLET_MAIN?.ownKeyChanged?.(); } catch (_) {}
  }
  try { require('../movimento').segui(merged); } catch (_) {}
  try { require('../shortcuts').configura(merged); } catch (_) {}
  try { require('../confermeSopraPagina').seguiTema(merged); } catch (_) {}
  broadcastToTabs({ type: MSG.SETTINGS_UPDATED, settings: merged });
  avvisaSeLaProntezzaCambia().catch(() => {});
  try {
    const { nativeTheme } = require('electron');
    const t = merged.theme;
    nativeTheme.themeSource = t === 'dark' ? 'dark' : t === 'light' ? 'light' : 'system';
  } catch (_) {}
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs && typeof w._filoTabs.setSecurity === 'function') {
        w._filoTabs.setSecurity(merged.security || {});
      }
      try { w._filoTabs?.barra?.impostazioni(merged.barraLaterale); } catch (_) {}
      try { w._filoTabs?.barra?.destro?.impostazioni(merged.pannelloDestro); } catch (_) {}
    }
  } catch (_) {}
  try { require('./fingerprint').setMode(merged); } catch (_) {}
  try { require('../updater').seguiImpostazioni(merged); } catch (_) {}
  try { globalThis.SN_CONTATORI_MAIN?.seguiImpostazioni(merged); } catch (_) {}
  wireSafebrowse(merged).catch(() => {});
  try {
    const Cookies = require('./cookies');
    const cookiesChanged = Cookies.configureFromSettings(merged);
    require('./cookieIncorporati').configureFromSettings(merged);
    require('./riquadriRotti').configureFromSettings(merged);
    require('./cookieBanners').configureFromSettings(merged);
    // Ogni frame di ogni scheda rilegge la sua config: solo se la modalità o i siti coi banner sono cambiati.
    if (cookiesChanged) {
      broadcastToTabs({ type: MSG.COOKIES_CONFIG_UPDATE, mode: Cookies.getMode(merged) });
      // Il menu della scheda dice se su quel sito i banner si vedono: la barra deve saperlo subito.
      for (const w of BrowserWindow.getAllWindows()) { try { w._filoTabs && w._filoTabs._broadcast(); } catch (_) {} }
    }
  } catch (_) {}
  try { require('./adblock').configureFromSettings(merged); } catch (_) {}
  try {
    if (require('./adSkip').configureFromSettings(merged)) broadcastToTabs({ type: MSG.AD_SKIP_CONFIG_UPDATE });
  } catch (_) {}
  try { require('./bloccoYouTube').configureFromSettings(merged); } catch (_) {}
  try { require('./siteBlock').configureFromSettings(merged); } catch (_) {}
  try { require('../propostaEmail').impostazioni(merged); } catch (_) {}
  try { require('./testoDeiCampi').impostazioni(merged); } catch (_) {}
  // Una scheda già aperta su un sito appena messo in lista si porta via subito (#590).
  try {
    for (const w of BrowserWindow.getAllWindows()) w._filoTabs?.riapplicaListaBloccati?.({ mentreScrive });
  } catch (_) {}
  try { require('./downloads').configureFromSettings(merged); } catch (_) {}
  try { FiloParla.configura(merged); } catch (_) {}
  return merged;
}

// I default di alcuni token cambiano fra chiaro e scuro: la verifica di leggibilità
// (#146.4) deve confrontare i valori del tema giusto.
function resolveTheme(settings) {
  const t = settings && settings.theme;
  if (t === 'dark') return 'dark';
  if (t === 'light') return 'light';
  try { return require('electron').nativeTheme.shouldUseDarkColors ? 'dark' : 'light'; }
  catch (_) { return 'light'; }
}

module.exports = {
  Gate,
  safeBrowsingKeyFor,
  withDefaults,
  getEffectiveSettings,
  modelForAction,
  buildAttemptChain,
  providerRouting,
  openWeightsBlockReason,
  AvvisiFuoriPolitica,
  applySettingsUpdate,
  resolveTheme,
};
