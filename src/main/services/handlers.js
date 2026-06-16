// Handler centrale dei messaggi (ex chrome.runtime.onMessage del background SW).
// È il porting 1:1 della logica di src/background/background.js dell'estensione,
// con le seguenti differenze:
//   - Non registra listener chrome.runtime: la routing IPC è in src/main/ipc.js
//   - Esporta `handleMessage(msg, sender)` che ritorna l'oggetto risposta
//   - Esporta `handleStream(action, payload, origin, port)` per lo streaming
//   - Esporta `broadcastLiveUpdate` per i broadcast dashboard
//
// I moduli SN_* sono stati caricati dal loader.js — qui assumiamo siano su global.

const { BrowserWindow } = require('electron');
const Defaults = require('./defaultsStore');

const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS, DEFAULT_SETTINGS } = SN_CONST;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const Providers = globalThis.SN_PROVIDERS;
const Costs = globalThis.SN_COSTS;
const SavedPages = globalThis.SN_SAVED_PAGES;
const History = globalThis.SN_HISTORY;
const ArchivedTabs = globalThis.SN_ARCHIVED_TABS;
const I18n = globalThis.SN_I18N;
const Categorizer = globalThis.SN_CATEGORIZER;
const AICache = globalThis.SN_AI_CACHE;
const Fx = globalThis.SN_FX;
const Paths = globalThis.SN_PATHS;
const LlmsTxt = globalThis.SN_LLMS_TXT;
const FiloMem = globalThis.SN_FILO_MEMORY;
const FiloState = globalThis.SN_FILO_STATE;
const DashboardRefresh = globalThis.SN_DASHBOARD_REFRESH;

const KNOWN_PATHS_BUDGET_CHARS = 20 * 1024;
// #155 — intervallo minimo tra due ricalcoli in background della home: la nuova
// scheda serve sempre la cache all'istante; il ricalcolo (costoso, con l'LLM)
// avviene al massimo una volta ogni 2 minuti, accorpando le modifiche.
const DASHBOARD_MIN_INTERVAL_MS = 2 * 60 * 1000;
const FREE_PROVIDERS = new Set(['gemini']);

// Finestra principale di Filo, quella che possiede il TabManager. NON usare
// getAllWindows()[0]: le finestre figlie (tooltip, popup-menu — create con
// parent:mainWindow) si inseriscono in testa all'array in Electron, quindi
// dopo il primo hover su un tooltip [0] è la finestra del tooltip, senza
// _filoTabs, e comandi come /newtab o /modelli smettono di funzionare.
function filoWin() {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => w._filoTabs) || wins[0] || null;
}

// Finestra che possiede il tab MITTENTE. In incognito è la finestra incognito,
// così back/forward/chiudi/nuovo-tab agiscono su di essa (e i link aperti
// restano effimeri lì dentro) invece di dirottare sulla finestra principale.
// Senza questo, i comandi che leggono sender.tab.id non troverebbero il tab
// (vive nel TabManager incognito, non in quello principale). Fallback a
// filoWin() quando il mittente non ha una finestra (chiamate interne/shortcut).
function winOf(sender) {
  const w = sender && sender.win;
  return (w && w._filoTabs) ? w : filoWin();
}

// ─── helpers (identici al background.js originale) ──────────────────────────

function clusterKey(p) {
  const init = p.initialUrl || '';
  const steps = Array.isArray(p.steps) ? p.steps : [];
  const sig = steps.map((s) => `${s.action || 'click'}|${s.selector || ''}`).join(',');
  return init + '::' + sig;
}

function formatKnownPathsForPrompt(rawPaths) {
  if (!Array.isArray(rawPaths) || !rawPaths.length) return '';
  const seen = new Set();
  const dedup = [];
  for (const p of rawPaths) {
    const k = clusterKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(p);
  }
  const lines = [];
  let chars = 0;
  for (const p of dedup) {
    const intent = (p.intent || '').trim() || '(intento ignoto)';
    const init = (p.initialUrl || '').trim() || '/';
    const header = `## "${intent}" (da ${init})`;
    const stepLines = (p.steps || []).map((s, i) => {
      const a = s.action || 'click';
      const sel = s.selector || '?';
      const r = s.retracted ? ' [poi corretto]' : '';
      return `  ${i + 1}. ${a} su ${sel}${r}`;
    });
    const block = [header, ...stepLines].join('\n');
    if (chars + block.length + 2 > KNOWN_PATHS_BUDGET_CHARS) break;
    lines.push(block);
    chars += block.length + 2;
  }
  return lines.join('\n\n');
}

async function buildMessages(action, payload) {
  if (payload && Array.isArray(payload.messages) && payload.messages.length) {
    return payload.messages;
  }
  if (action === ACTIONS.EXPLAIN) {
    const fx = await Fx.get().catch(() => null);
    const fxLine = fx ? Fx.formatForPrompt(fx) : '';
    return [{ role: 'user', content: PROMPTS.explain({ selection: payload.selection, sentence: payload.sentence || payload.selection, fxLine }) }];
  }
  if (action === ACTIONS.EXPLAIN_DEEP) {
    const fx = await Fx.get().catch(() => null);
    const fxLine = fx ? Fx.formatForPrompt(fx) : '';
    return [{ role: 'user', content: PROMPTS.explainDeep({ selection: payload.selection, sentence: payload.sentence || payload.selection, fxLine }) }];
  }
  if (action === ACTIONS.TRANSLATE_SELECTION) {
    return [{ role: 'user', content: PROMPTS.translateSelection({ selection: payload.selection }) }];
  }
  if (action === ACTIONS.TRANSLATE_PAGE) {
    return [{ role: 'user', content: PROMPTS.translatePageChunk({ chunk: payload.chunk }) }];
  }
  if (action === ACTIONS.HELP) {
    const domain = (() => {
      try { return new URL(payload.url || '').hostname.toLowerCase(); }
      catch (_) { return ''; }
    })();
    const [llmsRes, pathsRes] = await Promise.all([
      domain ? LlmsTxt.get(domain).catch(() => null) : Promise.resolve(null),
      domain ? Paths.listByDomain(domain, { pageSize: 50, onlySuccess: true }).catch(() => []) : Promise.resolve([]),
    ]);
    const siteKnowledge = (llmsRes && llmsRes.present && llmsRes.text) ? llmsRes.text : '';
    const knownPaths = formatKnownPathsForPrompt(pathsRes || []);
    const sys = { role: 'system', content: PROMPTS.help({
      url: payload.url, title: payload.title, outline: payload.outline,
      viewport: payload.viewport, siteKnowledge, knownPaths,
    }) };
    const parts = [];
    const userText = payload.userMessage
      || (payload.userAction ? `(Sistema: ${payload.userAction}. Stato pagina aggiornato — valuta lo screenshot e l'outline correnti, poi indica il passo successivo o status:"done" se l'obiettivo è completato.)` : '');
    if (userText) parts.push({ type: 'text', text: userText });
    if (payload.screenshot) parts.push({ type: 'image_url', image_url: { url: payload.screenshot } });
    const userMsg = parts.length === 1 && parts[0].type === 'text'
      ? { role: 'user', content: parts[0].text }
      : { role: 'user', content: parts };
    return [sys, ...(payload.history || []), userMsg];
  }
  if (action === ACTIONS.CATEGORIZE) {
    return [{ role: 'user', content: PROMPTS.categorize(payload) }];
  }
  if (action === ACTIONS.DESCRIBE_IMAGE) {
    return [{ role: 'user', content: [
      { type: 'text', text: PROMPTS.describeImage() },
      { type: 'image_url', image_url: { url: payload.dataUrl } },
    ] }];
  }
  if (action === ACTIONS.TRANSCRIBE_IMAGE) {
    return [{ role: 'user', content: [
      { type: 'text', text: PROMPTS.transcribeImage() },
      { type: 'image_url', image_url: { url: payload.dataUrl } },
    ] }];
  }
  if (action === ACTIONS.TRANSCRIBE_AUDIO) {
    return [{ role: 'user', content: [
      { type: 'text', text: PROMPTS.transcribeAudio({ lang: payload.lang }) },
      { type: 'audio_url', audio_url: { url: payload.dataUrl } },
    ] }];
  }
  if (action === ACTIONS.SPELLCHECK_SEMANTIC) {
    return [{ role: 'user', content: PROMPTS.spellcheckSemantic({ text: payload.text, context: payload.context }) }];
  }
  if (action === ACTIONS.EDIT_TEXT) {
    return [{ role: 'user', content: PROMPTS.editText({ original: payload.original, instruction: payload.instruction }) }];
  }
  if (action === ACTIONS.EXPLAIN_LINK) {
    return [{ role: 'user', content: PROMPTS.explainLink({
      url: payload.url, anchorText: payload.anchorText,
      ogTitle: payload.ogTitle, ogDescription: payload.ogDescription,
      suspiciousFlags: payload.suspiciousFlags,
    }) }];
  }
  if (action === ACTIONS.SPELLCHECK_WORD) {
    return [{ role: 'user', content: PROMPTS.spellcheckWord({
      word: payload.word, sentence: payload.sentence || payload.word,
      prev: payload.prev || '', next: payload.next || '',
    }) }];
  }
  if (action === ACTIONS.HELP_INTENT_GUESS) {
    return [{ role: 'user', content: PROMPTS.helpIntentGuess({
      domain: payload.domain, initialUrl: payload.initialUrl, steps: payload.steps,
    }) }];
  }
  if (action === ACTIONS.HELP_INTENT_JUDGE) {
    return [{ role: 'user', content: PROMPTS.helpIntentJudge({
      proposedIntent: payload.proposedIntent, userMessages: payload.userMessages,
    }) }];
  }
  if (action === ACTIONS.FILO_CHAT) {
    return [
      { role: 'system', content: PROMPTS.filoChat(payload) },
      ...(payload.threadMessages || []),
    ];
  }
  if (action === ACTIONS.FILO_DASHBOARD) {
    return [{ role: 'user', content: PROMPTS.filoDashboard(payload) }];
  }
  if (action === ACTIONS.FILO_LESSON) {
    return [{ role: 'user', content: PROMPTS.filoLesson(payload) }];
  }
  if (action === ACTIONS.FILO_COMPACT) {
    return [{ role: 'user', content: PROMPTS.filoCompact(payload) }];
  }
  throw new Error(`Action sconosciuta: ${action}`);
}

// Quando "usa modelli predefiniti" è attivo (default), la risoluzione di
// modelli/registry/provider usa la config predefinita condivisa, e le chiavi
// sono quelle di default (build env / override admin via Firestore), con
// fallback alle eventuali chiavi personali dell'utente se i default mancano
// (es. build locale senza chiavi iniettate). Quando è disattivo, l'utente
// gestisce tutto dalle Opzioni e usiamo i suoi settings così come sono.
function withDefaults(settings) {
  const d = Defaults.get();
  // La chiave Google Safe Browsing è SEMPRE condivisa (gestita dall'admin in
  // "Modelli predefiniti" e propagata via Firestore): va iniettata anche quando
  // l'utente usa i propri modelli, perché non esiste più un campo per-utente.
  const sec = settings.security || {};
  const security = d.safeBrowsingKey
    ? { ...sec, safeBrowse: { ...(sec.safeBrowse || {}), safeBrowsingKey: d.safeBrowsingKey } }
    : sec;

  if (settings.useDefaultModels === false) {
    return security === sec ? settings : { ...settings, security };
  }
  const userKeys = settings.apiKeys || {};
  const apiKeys = {};
  for (const k of ['openrouter', 'gemini', 'tavily']) {
    apiKeys[k] = d.apiKeys[k] || userKeys[k] || '';
  }
  return {
    ...settings,
    provider: d.provider,
    models: d.models,
    modelRegistry: d.modelRegistry,
    apiKeys,
    security,
  };
}

// Settings "effettivi" per servire una richiesta AI: come getSettings() ma con
// i default condivisi applicati se useDefaultModels è attivo.
async function getEffectiveSettings() {
  return withDefaults(await Storage.getSettings());
}

function modelForAction(settings, action, override) {
  const raw = override || settings.models?.[action] || DEFAULT_SETTINGS.models[action];
  return SN_CONST.DEPRECATED_MODELS?.[raw] || raw;
}

async function ensureUnderLimit(settings) {
  if (await Costs.isOverLimit(settings.monthlyLimitEur)) {
    const e = new Error(I18n.t('err_limit_reached'));
    e.code = 'LIMIT_REACHED';
    throw e;
  }
}

async function applyLimitToChain(settings, attempts) {
  if (!(await Costs.isOverLimit(settings.monthlyLimitEur))) return attempts;
  const free = attempts.filter((a) => FREE_PROVIDERS.has(a.provider));
  if (!free.length) {
    const e = new Error(I18n.t('err_limit_reached'));
    e.code = 'LIMIT_REACHED';
    throw e;
  }
  return free;
}

function buildAttemptChain(settings, modelRef) {
  const registry = settings.modelRegistry || SN_CONST.DEFAULT_MODEL_REGISTRY;
  // Il campo di un'azione può contenere più nickname separati da virgola: il
  // primo è il primario, gli altri fallback in ordine. Per ciascuno proviamo i
  // provider disponibili (Gemini diretto → provider scelto → OpenRouter).
  const refs = SN_CONST.parseModelRefs(modelRef);
  if (!refs.length && modelRef) refs.push(modelRef);
  // Ogni modello del registry porta il proprio provider, quindi l'ordine qui
  // conta solo per i ref "legacy" (id grezzi senza nickname): proviamo prima
  // Gemini (quota free) poi OpenRouter. buildModelAttempts scarta da sé i
  // provider senza chiave o senza un id concreto per quel modello.
  const providerOrder = ['gemini', 'openrouter'];
  const out = SN_CONST.buildModelAttempts(refs, registry, providerOrder, settings.apiKeys || {});
  if (!out.length) {
    const e = new Error(I18n.t('err_no_api_key'));
    e.code = 'NO_API_KEY';
    throw e;
  }
  return out;
}

async function handleAIRequest({ action, payload, origin }) {
  const settings = await getEffectiveSettings();
  const model = modelForAction(settings, action, payload?.modelOverride);
  // Nome CONCRETO del modello primario (es. 'gemini-3.1-flash-lite'), non il
  // nickname: è il nome con cui il codice lo invoca. Lo passiamo al prompt così
  // l'assistente può dire correttamente che modello è (#158). Best-effort: se la
  // catena non è risolvibile (nessuna chiave) restiamo sul riferimento grezzo e
  // lasciamo che sia la richiesta vera, più sotto, a sollevare l'errore.
  let modelName = model;
  try {
    const ch = buildAttemptChain(settings, model);
    if (ch[0] && ch[0].model) modelName = ch[0].model;
  } catch (_) {}
  let messages = await buildMessages(action, { ...payload, modelName });
  messages = SN_CONST.injectAgentStyle(messages, action, settings.agentStyle);

  const cached = await AICache.get({ provider: settings.provider, model, messages });
  if (cached) {
    return { text: cached.text, model, provider: settings.provider, costEur: 0, usage: cached.usage || {}, cached: true };
  }

  const attemptsRaw = buildAttemptChain(settings, model);
  const attempts = await applyLimitToChain(settings, attemptsRaw);

  const result = await Providers.completeWithFallback({ attempts, messages });
  const usedProvider = result.provider || attempts[0].provider;
  const concreteModel = result.model || attempts[0].model;
  const pricing = usedProvider === 'gemini' ? null : settings.pricing?.[concreteModel];
  const costEur = await Costs.record({
    action, provider: usedProvider, model: concreteModel,
    usage: result.usage, pricing, usdToEur: settings.usdToEur,
  });

  if (
    action !== ACTIONS.TRANSLATE_PAGE && action !== ACTIONS.CATEGORIZE
    && action !== ACTIONS.SPELLCHECK_SEMANTIC && action !== ACTIONS.SPELLCHECK_WORD
    && action !== ACTIONS.HELP_INTENT_GUESS && action !== ACTIONS.HELP_INTENT_JUDGE
  ) {
    await History.append({
      action, provider: usedProvider, model: concreteModel,
      input: payload, output: result.text, origin, costEur, usage: result.usage,
    });
  }

  AICache.set({ provider: settings.provider, model, messages, text: result.text, usage: result.usage }).catch(() => {});
  return { text: result.text, model: concreteModel, provider: usedProvider, costEur, usage: result.usage };
}

// ─── Streaming via Electron IPC ─────────────────────────────────────────────
// L'API è simile a Chrome port: il renderer invia "start" via ipcRenderer.invoke
// e riceve delta/done/error via ipcRenderer.on('ai-stream:<requestId>', ...).
// Il main side è in src/main/ipc.js, qui esponiamo handleStream.

async function handleStream({ action, payload, origin, onDelta, onMeta, signal }) {
  const settings = await getEffectiveSettings();
  const model = modelForAction(settings, action);
  let messages = await buildMessages(action, payload);
  messages = SN_CONST.injectAgentStyle(messages, action, settings.agentStyle);
  if (onMeta) onMeta({ model, provider: settings.provider });

  const cached = await AICache.get({ provider: settings.provider, model, messages });
  if (cached) {
    if (onDelta) onDelta(cached.text);
    return { costEur: 0, usage: cached.usage || {}, cached: true, provider: settings.provider, model };
  }

  await ensureUnderLimit(settings);
  const attempts = buildAttemptChain(settings, model);

  const result = await Providers.streamCompleteWithFallback({
    attempts, messages, signal,
    onDelta: (delta) => { if (onDelta) onDelta(delta); },
  });
  const usedProvider = result.provider || attempts[0].provider;
  const concreteModel = result.model || attempts[0].model;
  const pricing = usedProvider === 'gemini' ? null : settings.pricing?.[concreteModel];
  const costEur = await Costs.record({
    action, provider: usedProvider, model: concreteModel,
    usage: result.usage, pricing, usdToEur: settings.usdToEur,
  });

  await History.append({
    action, provider: usedProvider, model: concreteModel,
    input: payload, output: result.text, origin, costEur, usage: result.usage,
  });

  AICache.set({ provider: settings.provider, model, messages, text: result.text, usage: result.usage }).catch(() => {});
  return { costEur, usage: result.usage, provider: usedProvider, model: concreteModel };
}

// ─── Filo agents ────────────────────────────────────────────────────────────

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  try { return JSON.parse(t); } catch (_) {}
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(t.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

async function lessonsBufferText() {
  const buf = await FiloMem.getLessonsBuffer();
  if (!buf.length) return '';
  return buf.map((l) => `- ${l.text}`).join('\n');
}

async function maybeRunLessonAgent({ userMessage, filoReply, stateText }) {
  try {
    const settings = await getEffectiveSettings();
    if (!settings.apiKeys?.[settings.provider] && !settings.apiKeys?.gemini) return;
    const memory = await FiloMem.getMemory();
    const { profilo, preferenze } = FiloMem.renderMemoryForPrompt(memory);
    const lezioniText = await lessonsBufferText();
    const interazione = `UTENTE: ${userMessage || ''}\nFILO: ${filoReply || ''}`;
    const r = await handleAIRequest({
      action: ACTIONS.FILO_LESSON,
      payload: { profilo, preferenze, lezioni: lezioniText, interazione, stato: stateText },
      origin: 'filo:lesson',
    });
    const text = (r?.text || '').trim();
    if (!text || /^NULLA DA IMPARARE/i.test(text)) return;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^LEZIONE:\s*(.+)$/i);
      if (m) await FiloMem.appendLesson(m[1]);
    }
    if (await FiloMem.lessonsBufferShouldCompact()) {
      maybeRunCompactor().catch((e) => console.warn('[Filo] compact failed', e));
    }
  } catch (e) {
    console.warn('[Filo] lesson agent failed', e);
  }
}

async function maybeRunCompactor() {
  try {
    const settings = await getEffectiveSettings();
    if (!settings.apiKeys?.[settings.provider] && !settings.apiKeys?.gemini) return;
    const memory = await FiloMem.getMemory();
    const moduliText = Object.entries(memory).map(([k, v]) => `${k}:\n${v || '(vuoto)'}`).join('\n\n');
    const buf = await FiloMem.getLessonsBuffer();
    if (!buf.length) return;
    const lezioniText = buf.map((l) => `- ${l.text}`).join('\n');
    const r = await handleAIRequest({
      action: ACTIONS.FILO_COMPACT,
      payload: { moduli: moduliText, lezioni: lezioniText },
      origin: 'filo:compact',
    });
    const text = (r?.text || '').trim();
    if (!text || /^NESSUNA MODIFICA/i.test(text)) {
      await FiloMem.clearLessonsBuffer();
      return;
    }
    const patch = FiloMem.parseCompactorOutput(text);
    if (Object.keys(patch).length) await FiloMem.patchMemory(patch);
    await FiloMem.clearLessonsBuffer();
  } catch (e) {
    console.warn('[Filo] compactor failed', e);
  }
}

// Applica un aggiornamento parziale delle impostazioni e propaga TUTTI gli
// effetti collaterali (broadcast ai tab, tema nativo, sicurezza, fingerprint,
// safebrowse, cookie). È lo stesso percorso usato dal salvataggio dalla pagina
// Preferenze: condividerlo garantisce che una modifica fatta da Filo via chat
// si comporti esattamente come una fatta a mano (es. il tema cambia live).
async function applySettingsUpdate(partial) {
  // Gli override dei token estetici finiscono dentro <style> iniettati in
  // tutte le superfici (incluse pagine web esterne): qui, nel choke point
  // delle scritture, teniamo solo i valori che passano la whitelist per tipo.
  if (partial && partial.themeTokens && globalThis.SN_THEME_TOKENS) {
    partial = { ...partial, themeTokens: globalThis.SN_THEME_TOKENS.sanitize(partial.themeTokens).clean };
  }
  const merged = await Storage.updateSettings(partial);
  broadcastToTabs({ type: MSG.SETTINGS_UPDATED, settings: merged });
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
    }
  } catch (_) {}
  try { require('./fingerprint').setMode(merged); } catch (_) {}
  wireSafebrowse(withDefaults(merged)).catch(() => {});
  try {
    const Cookies = require('./cookies');
    Cookies.configureFromSettings(merged);
    broadcastToTabs({ type: MSG.COOKIES_CONFIG_UPDATE, mode: Cookies.getMode(merged) });
  } catch (_) {}
  try { require('./adblock').configureFromSettings(merged); } catch (_) {}
  try { require('./siteBlock').configureFromSettings(merged); } catch (_) {}
  return merged;
}

// Risolve il tema effettivo (light/dark) come applicato sulle superfici: i
// default di alcuni token estetici differiscono fra chiaro e scuro, e la
// verifica di leggibilità (#146.4) deve confrontare i valori giusti.
function resolveTheme(settings) {
  const t = settings && settings.theme;
  if (t === 'dark') return 'dark';
  if (t === 'light') return 'light';
  try { return require('electron').nativeTheme.shouldUseDarkColors ? 'dark' : 'light'; }
  catch (_) { return 'light'; }
}

// Scheda WEB bersaglio dei comandi proxy ("apri QUESTA tab da X", #152). La
// chat di Filo vive nella dashboard, che è essa stessa una scheda interna
// (filo://) e non è instradabile: "questa tab" significa la scheda web attiva,
// e se l'attiva è interna (l'utente è passato alla dashboard per parlare con
// Filo) ripieghiamo sull'ultima scheda web usata — quella che stava guardando.
function targetWebTab(sender) {
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm) return { win: null, tm: null, tab: null };
  const isWeb = (t) => t && !t.isInternal && /^https?:\/\//i.test(t.url || '');
  const active = tm.tabs.find((t) => t.id === tm.activeId);
  if (isWeb(active)) return { win, tm, tab: active };
  const recent = tm.tabs.filter(isWeb).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
  return { win, tm, tab: recent[0] || null };
}

// Risincronizza la cache delle regole proxy in TUTTE le finestre dopo un
// cambio (la scrittura su storage è condivisa, le cache in-memory no).
function refreshProxyRulesAllWindows() {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win._filoTabs && typeof win._filoTabs.loadProxyRules === 'function') {
        win._filoTabs.loadProxyRules().catch(() => {});
      }
    }
  } catch (_) {}
}

// ── cwd PERSISTENTE dei comandi dell'assistente ───────────────────────────────
// I comandi dell'assistente girano via runCommand one-shot (shell nuova ogni
// volta): senza traccia esplicita, ereditano la cwd del processo Electron (la
// cartella di Filo) e un `cd` non avrebbe effetto sul comando successivo. La
// teniamo per-webContents (muore con la scheda) con un fallback condiviso quando
// non c'è sender (test / chiamate interne). Parte da defaultCwd() = home, la
// STESSA mostrata nella barra della home → percorso mostrato e cartella reale
// coincidono. La shell PERSISTENTE della modalità terminale (src/main/services/
// shell.js) resta separata e off-limits all'LLM: qui non la tocchiamo.
let _assistantCwdFallback = '';
function getAssistantCwd(sender) {
  const { defaultCwd } = require('./shell');
  if (sender) return sender._filoAssistantCwd || defaultCwd();
  return _assistantCwdFallback || defaultCwd();
}
function setAssistantCwd(sender, cwd) {
  if (!cwd) return;
  if (sender) { try { sender._filoAssistantCwd = cwd; } catch (_) {} }
  else _assistantCwdFallback = cwd;
}

async function executeFiloAction(action, { confirmed = false, sender = null } = {}) {
  if (!action || typeof action !== 'object') return { executed: false, kept: false };
  const type = String(action.type || '').toUpperCase();

  // IMPOSTA_ESTETICA: il livello (1 normale, 2 se rende il testo illeggibile)
  // dipende dallo stato risultante, che solo il main conosce (ha i token
  // correnti). Iniettiamo `_illegible` PRIMA del gate, mai dall'LLM (#146.4).
  if (type === 'IMPOSTA_ESTETICA') {
    try {
      const T = globalThis.SN_THEME_TOKENS;
      const token = action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
      const valore = action.valore ?? action.value ?? action.val ?? action.colore;
      if (T && T.validate(token, valore)) {
        const settings = await Storage.getSettings();
        action._illegible = T.illegibleAfter(token, valore, settings.themeTokens || {}, resolveTheme(settings));
      }
    } catch (_) {}
  }

  // ── modalità terminale: gate hard, indipendente dal livello (#146.6) ──────
  // Filo non può eseguire ALCUN comando se l'utente non ha attivato la modalità
  // terminale nelle impostazioni. Controllo PRIMA del gate dei livelli: così un
  // terminale disattivato non fa nemmeno comparire il box "digita conferma" —
  // l'utente vede subito che deve attivarlo.
  if (type === 'ESEGUI_COMANDO') {
    const cmd = String(action.comando ?? action.command ?? action.cmd ?? '').trim();
    let s = {};
    try { s = await Storage.getSettings(); } catch (_) {}
    if (!s.terminal || !s.terminal.enabled) {
      return { executed: false, kept: true, output: { command: cmd, blocked: 'disabled' } };
    }
  }

  // ── gate dei livelli di sicurezza (#146.2) ────────────────────────────────
  // Il livello è assegnato STATICAMENTE nel registro (src/shared/actionLevels.js),
  // mai deciso dall'LLM. Azione non registrata → rifiutata (ogni nuovo potere
  // di Filo è obbligato a dichiarare il suo livello). Livello ≥ 2 senza
  // conferma utente → non si esegue: torna al client con la spiegazione, il
  // client mostra popup (2) o box "digita conferma" (3) e solo allora rimanda
  // l'azione via MSG.FILO_CONFIRM_ACTION. La riclassificazione avviene anche
  // alla conferma (`confirmed` salta solo la sospensione, non il registro).
  const Levels = globalThis.SN_ACTION_LEVELS;
  const level = Levels ? Levels.levelFor(action) : 1;
  if (Levels && !level) {
    console.warn('[Filo] azione non registrata rifiutata:', type);
    return { executed: false, kept: false, rejected: true };
  }
  // PULISCI_TAB e CANCELLA_ARCHIVIO hanno già un flusso di conferma dedicato
  // lato client (bottone → RUN_TAB_TRIAGE / pannello eliminazione): restano
  // `kept` come prima e la conferma la gestisce la loro UI specifica.
  const hasBespokeConfirm = type === 'PULISCI_TAB' || type === 'CANCELLA_ARCHIVIO';
  if (level >= 2 && !confirmed && !hasBespokeConfirm) {
    return {
      executed: false,
      kept: true,
      needsConfirm: level,
      describe: Levels ? Levels.describe(action) : '',
    };
  }

  try {
    switch (type) {
      case 'NAVIGA': {
        // #162 — Filo apre il link DIRETTAMENTE in una nuova scheda, invece di
        // limitarsi a mostrare un bottone che l'utente deve cliccare. La chat di
        // Filo vive nella dashboard (scheda interna): apriamo nel TabManager
        // della finestra, attivando la nuova scheda (l'utente ha chiesto di
        // aprire → vuole arrivarci). La bolla conserva comunque un riferimento
        // cliccabile per riaprirlo (kept:true).
        const url = String(action.url ?? action.href ?? action.link ?? '').trim();
        if (!url) return { executed: false, kept: false };
        let opened = false;
        try {
          const win = winOf(sender);
          const tm = win && win._filoTabs;
          if (tm && typeof tm.openTab === 'function') {
            tm.openTab(url, { activate: true });
            opened = true;
          }
        } catch (e) {
          console.warn('[Filo] apertura link fallita', e?.message || e);
        }
        return { executed: opened, kept: true, opened };
      }
      case 'TIMER': {
        const seconds = Number(action.seconds || action.secondi || 0);
        const label = String(action.label || action.etichetta || 'Timer');
        const entry = await FiloMem.addTimer({ label, seconds });
        if (entry) broadcastLiveUpdate();
        return { executed: !!entry, kept: false };
      }
      case 'SVEGLIA':
        await FiloMem.addNotification({ kind: 'process', text: `Sveglia: ${action.time || action.orario || ''} ${action.label || action.etichetta || ''}`.trim() });
        broadcastLiveUpdate();
        return { executed: true, kept: false };
      case 'SALVA_APPUNTO': {
        const text = action.text || action.testo;
        if (text) await FiloMem.addNote({ text, context: action.context || action.contesto });
        return { executed: !!text, kept: false };
      }
      case 'INVIA_FEEDBACK': {
        // Filo invia un feedback a nome dell'utente (#146.5). Livello 2: a
        // questo punto la conferma è già passata (il gate sopra ha lasciato
        // procedere solo con confirmed:true). Il feedback parte come quelli
        // inviati dal box: stesso schema, ma clientId 'filo:chat' così in
        // dashboard si vede che l'ha mandato Filo.
        const testo = String(action.testo ?? action.text ?? action.messaggio ?? '').trim();
        if (!testo) return { executed: false, kept: false };
        const FB = globalThis.SN_FEEDBACK;
        if (!FB || typeof FB.submit !== 'function') return { executed: false, kept: false };
        const titolo = String(action.titolo ?? action.title ?? action.name ?? '').trim()
          || (typeof FB.fallbackName === 'function' ? FB.fallbackName(testo) : '');
        let userAgent = 'Filo desktop';
        try { const { app } = require('electron'); userAgent = `Filo desktop ${app.getVersion()}`; } catch (_) {}
        try {
          const r = await FB.submit({ text: testo, name: titolo, clientId: 'filo:chat', userAgent });
          return { executed: !!(r && r.id), kept: false };
        } catch (e) {
          console.warn('[Filo] invio feedback fallito', e?.message || e);
          return { executed: false, kept: false };
        }
      }
      case 'IMPOSTA_PREFERENZA': {
        // Filo modifica una preferenza dell'app su richiesta dell'utente. La
        // scrittura passa per applySettingsUpdate (stesso percorso della pagina
        // Preferenze), così la modifica si applica live (es. il tema cambia
        // subito nella dashboard, che ascolta SETTINGS_UPDATED).
        const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
        const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
        const built = global.SN_PREF.buildPreferencePartial(chiave, valore);
        if (!built) return { executed: false, kept: false };
        await applySettingsUpdate(built.partial);
        return { executed: true, kept: false };
      }
      case 'IMPOSTA_ESTETICA': {
        // Filo cambia un token estetico (colore/font/raggio/opacità) su
        // richiesta in chat (#146.4). Lo applica SUBITO (livello 1) e la bolla
        // mostra un controllo per raffinarlo. La scrittura fonde il token nella
        // mappa esistente (themeTokens è REPLACE in storage: vietato passare il
        // singolo token o si azzererebbero gli altri override) e passa per
        // applySettingsUpdate, così il cambiamento è live su tutte le superfici.
        const T = globalThis.SN_THEME_TOKENS;
        const token = action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
        const valore = action.valore ?? action.value ?? action.val ?? action.colore;
        if (!T || !T.validate(token, valore)) return { executed: false, kept: false };
        const settings = await Storage.getSettings();
        const overrides = { ...(settings.themeTokens || {}) };
        overrides[token] = String(valore).trim();
        await applySettingsUpdate({ themeTokens: overrides });
        // kept:true → il client renderizza il bottone di raffinamento (GUI).
        return { executed: true, kept: true };
      }
      case 'CERCA_WEB':
      case 'EVENTO_CALENDARIO':
        return { executed: false, kept: true };
      case 'PULISCI_TAB':
        // Non eseguiamo subito: il client mostra un bottone di conferma; al
        // click manda RUN_TAB_TRIAGE. Teniamo il bottone nella bolla.
        return { executed: false, kept: true };
      case 'CANCELLA_ARCHIVIO':
        // §5 — azione distruttiva: il client mostra l'elenco dei match + conferma.
        return { executed: false, kept: true };
      case 'CANCELLA_MEMORIA': {
        // Livello 3: a questo punto l'utente ha già digitato "conferma" (gate sopra).
        // Azzera tutti i moduli di memoria (PROFILO, PREFERENZE, espansioni) e il
        // buffer delle lezioni non compattate. Irreversibile.
        try {
          await FiloMem.setMemory({ PROFILO: '', PREFERENZE: '' });
          await FiloMem.clearLessonsBuffer();
          broadcastLiveUpdate();
          return { executed: true, kept: false };
        } catch (e) {
          console.warn('[Filo] cancella memoria fallito', e?.message || e);
          return { executed: false, kept: false };
        }
      }
      case 'APRI_FILE':
        return { executed: true, kept: true };
      case 'ESEGUI_COMANDO': {
        // A questo punto: modalità terminale attiva (gate sopra) e livello
        // soddisfatto (1 = passa diretto; 2/3 = già confermato). Eseguiamo il
        // comando ESATTO che è stato classificato: nessuna divergenza tra ciò
        // che il gate ha valutato e ciò che lanciamo (stessa stringa `comando`).
        const cmd = String(action.comando ?? action.command ?? action.cmd ?? '').trim();
        if (!cmd) return { executed: false, kept: true, output: { command: '', blocked: 'empty' } };
        let settings = {};
        try { settings = await Storage.getSettings(); } catch (_) {}
        const shell = settings.terminal && settings.terminal.shell;
        const { runCommand } = require('./terminal');
        // cwd PERSISTENTE: partiamo dalla cartella corrente dell'assistente e
        // catturiamo quella risultante, così un `cd` resta valido per il comando
        // successivo e il percorso torna al client per aggiornare la barra.
        const cwd = getAssistantCwd(sender);
        const out = await runCommand(cmd, { shell, cwd, trackCwd: true });
        if (out.cwd) setAssistantCwd(sender, out.cwd);
        return { executed: out.code === 0, kept: true, output: out };
      }
      // ── proxy per-tab via linguaggio naturale (#152) ───────────────────────
      // Le primitive sono le STESSE della UI (tasto destro sulla tab): l'agente
      // chiama setTabProxy/clearTabProxy/regole-per-dominio del TabManager.
      case 'PROXY_TAB': {
        // Eseguita subito (livello 1, completamente reversibile): nessun bottone
        // di follow-up in chat — il testo della risposta è già la conferma, come
        // per IMPOSTA_PREFERENZA. kept:false → non resta un'azione nella bolla.
        const { tm, tab } = targetWebTab(sender);
        if (!tm || !tab) return { executed: false, kept: false, output: { proxy: 'no_web_tab' } };
        const r = await tm.setTabProxy(tab.id, action.country ?? action.paese ?? action.codicePaese ?? action.location);
        return {
          executed: !!(r && r.ok),
          kept: false,
          output: { proxy: r && r.ok ? 'on' : (r && r.error) || 'failed', country: r && r.country },
        };
      }
      case 'RIMUOVI_PROXY': {
        const { tm, tab } = targetWebTab(sender);
        if (!tm || !tab) return { executed: false, kept: false };
        const r = tm.clearTabProxy(tab.id);
        return { executed: !!(r && r.ok), kept: false };
      }
      case 'RIMUOVI_PROXY_TUTTE': {
        const win = winOf(sender);
        const tm = win && win._filoTabs;
        if (!tm) return { executed: false, kept: false };
        const count = tm.clearAllProxies();
        return { executed: true, kept: false, output: { proxy: 'cleared_all', count } };
      }
      case 'REGOLA_PROXY_DOMINIO': {
        const { tm, tab } = targetWebTab(sender);
        if (!tm) return { executed: false, kept: false };
        const country = action.country ?? action.paese ?? action.codicePaese ?? action.location;
        // Dominio esplicito dall'LLM, altrimenti quello della scheda web attiva.
        const domain = action.dominio ?? action.domain ?? action.sito ?? (tab ? tab.url : '');
        const r = await tm.setDomainProxyRule(country, { domain });
        if (r && r.ok) refreshProxyRulesAllWindows();
        return {
          executed: !!(r && r.ok),
          kept: false,
          output: r && r.ok ? { proxyRule: 'set', domain: r.domain, country: r.country } : { proxyRule: 'failed', error: r && r.error },
        };
      }
      case 'RIMUOVI_REGOLA_PROXY': {
        const { tm, tab } = targetWebTab(sender);
        if (!tm) return { executed: false, kept: false };
        const domain = action.dominio ?? action.domain ?? action.sito ?? (tab ? tab.url : '');
        const r = await tm.removeDomainProxyRule({ domain });
        if (r && r.ok) refreshProxyRulesAllWindows();
        return {
          executed: !!(r && r.ok),
          kept: false,
          output: r && r.ok ? { proxyRule: 'removed', domain: r.domain } : { proxyRule: 'failed' },
        };
      }
      case 'STILE_PAGINA': {
        // Filo cambia l'aspetto del testo della pagina che l'utente guarda
        // (#185). Le regole {selettore, css} prodotte dall'LLM vengono SANIFICATE
        // qui (mai fidarsi del CSS dell'LLM) e iniettate live nella scheda web
        // attiva. Effimero (un reload lo toglie) e reversibile (RIPRISTINA_STILE_PAGINA).
        const R = globalThis.SN_PAGE_RESTYLE;
        if (!R) return { executed: false, kept: false };
        const css = R.buildCss(R.normalizeRules(action));
        if (!css) return { executed: false, kept: false };
        const { tm, tab } = targetWebTab(sender);
        if (!tm || !tab) return { executed: false, kept: false, output: { restyle: 'no-page' } };
        const r = await tm.applyPageStyle(css, tab);
        return { executed: !!(r && r.ok), kept: false };
      }
      case 'RIPRISTINA_STILE_PAGINA': {
        const { tm, tab } = targetWebTab(sender);
        if (!tm || !tab) return { executed: false, kept: false, output: { restyle: 'no-page' } };
        const r = await tm.clearPageStyle(tab);
        return { executed: !!(r && r.ok), kept: false };
      }
      default:
        return { executed: false, kept: false };
    }
  } catch (e) {
    console.warn('[Filo] action exec failed', type, e);
    return { executed: false, kept: false };
  }
}

function broadcastLiveUpdate() {
  const msg = { type: MSG.FILO_LIVE_UPDATED };
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('filo:broadcast', msg); } catch (_) {}
      if (win._filoTabs) {
        for (const t of win._filoTabs.tabs) {
          try { t.view.webContents.send('filo:broadcast', msg); } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

// Rende leggibile al modello l'output dei comandi eseguiti in un turno: estrae
// l'`_output` dalle azioni ESEGUI_COMANDO e lo formatta come osservazione. Va
// accodato al messaggio dell'assistente di quel turno. Limita la dimensione per
// non far esplodere il prompt.
function commandOutputsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'ESEGUI_COMANDO') continue;
    const out = a._output;
    if (!out || out.blocked) continue; // comando bloccato (terminale spento): niente output reale
    const cmd = String(out.command || a.comando || a.command || a.cmd || '').trim();
    let body = String(out.stdout || '');
    if (out.stderr) body += (body ? '\n' : '') + out.stderr;
    body = body.trim();
    if (body.length > 4000) body = body.slice(0, 4000) + '\n…(output troncato)';
    const meta = [];
    if (typeof out.code === 'number') meta.push(`uscita ${out.code}`);
    if (out.cwd) meta.push(`cartella ${out.cwd}`);
    if (out.timedOut) meta.push('interrotto per timeout');
    blocks.push(
      `[Ho eseguito nel terminale: ${cmd}]\n` +
      (body ? `[Output]\n${body}` : '[Nessun output]') +
      (meta.length ? `\n[Esito] ${meta.join(' · ')}` : ''),
    );
  }
  return blocks.join('\n\n').trim();
}

async function handleFiloChat({ userMessage, threadHistory, image, images, sender = null }) {
  await FiloMem.touchSession();
  await FiloMem.appendRaw({ type: 'chat_user', summary: String(userMessage || '').slice(0, 200) });
  const memory = await FiloMem.getMemory();
  const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(memory);
  const lezioni = await lessonsBufferText();
  const { stateText } = await FiloState.assemble();
  const cleanHistory = Array.isArray(threadHistory) ? threadHistory.slice(-20) : [];
  // Re-immissione dell'output dei comandi nel contesto del modello: l'output di
  // un ESEGUI_COMANDO eseguito in un turno precedente viene accodato al
  // messaggio dell'assistente, così nei turni successivi il modello SA davvero
  // cosa ha prodotto il comando (prima lo vedeva solo l'utente, e l'assistente
  // rispondeva "non ho ancora l'output").
  const threadMessages = [];
  for (const m of cleanHistory) {
    const role = m.role === 'filo' ? 'assistant' : 'user';
    let content = String(m.text || '');
    if (role === 'assistant') {
      const obs = commandOutputsForPrompt(m.actions);
      if (obs) content = content ? `${content}\n\n${obs}` : obs;
    }
    threadMessages.push({ role, content });
  }
  const imageList = (Array.isArray(images) && images.length) ? images : (image ? [image] : []);
  if (imageList.length) {
    const parts = [];
    if (userMessage) parts.push({ type: 'text', text: String(userMessage) });
    for (const im of imageList) parts.push({ type: 'image_url', image_url: { url: im } });
    threadMessages.push({ role: 'user', content: parts });
  } else {
    threadMessages.push({ role: 'user', content: String(userMessage || '') });
  }

  const r = await handleAIRequest({
    action: ACTIONS.FILO_CHAT,
    payload: { profilo, preferenze, espansioni, lezioni, stato: stateText, threadMessages },
    origin: 'filo:chat',
  });

  const parsed = extractJson(r.text) || { text: r.text || '', actions: [] };
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  // #162 — quando Filo vuole solo ESEGUIRE qualcosa (es. aprire un link) non
  // deve scrivere testo di riempimento: il "(vuoto)" che compariva era un
  // placeholder confuso ("hai scritto tu vuoto o è stato prodotto da filo?").
  // Il fallback "(vuoto)" resta SOLO per la risposta davvero vuota (niente
  // testo E niente azioni), che sarebbe altrimenti una bolla muta.
  const textReply = String(parsed.text || '').trim() || (rawActions.length ? '' : '(vuoto)');
  const renderedActions = [];
  for (const a of rawActions) {
    const res = await executeFiloAction(a, { sender });
    if (!res.kept) continue;
    // Azione sospesa in attesa di conferma (#146.2): il client renderizza il
    // bottone che apre il popup/box e poi manda MSG.FILO_CONFIRM_ACTION.
    const rendered = res.needsConfirm
      ? { ...a, _confirm: { level: res.needsConfirm, text: res.describe || '' } }
      : { ...a };
    // Output di un comando eseguito subito (livello 1) o esito bloccato
    // (terminale spento): il client lo mostra in chat (#146.6).
    if (res.output) rendered._output = res.output;
    renderedActions.push(rendered);
  }
  await FiloMem.appendRaw({ type: 'chat_filo', summary: textReply.slice(0, 200), extra: { actions: rawActions } });
  maybeRunLessonAgent({ userMessage, filoReply: textReply, stateText }).catch(() => {});
  return { text: textReply, actions: renderedActions, model: r.model, provider: r.provider, costEur: r.costEur };
}

// #155 — raccoglie gli input della home (letture locali, NIENTE chiamata LLM) e
// calcola la firma stabile per capire se andrebbe ricalcolata. Niente AI qui:
// è la parte "economica" che si può fare a ogni apertura di scheda.
async function gatherDashboardInputs({ openTabsCount = 0 } = {}) {
  const settings = await getEffectiveSettings();
  const hasKey = !!(settings.apiKeys?.[settings.provider] || settings.apiKeys?.gemini);
  const memory = await FiloMem.getMemory();
  const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(memory);
  const lezioni = await lessonsBufferText();
  const { stateText } = await FiloState.assemble();
  const notesList = await FiloMem.listNotes();
  const notiList = await FiloMem.listNotifications();
  const timersList = await FiloMem.listTimers();
  const saved = await SavedPages.list();

  const payload = {
    profilo, preferenze, espansioni, lezioni, stato: stateText,
    notifiche: notiList.length ? notiList.map((n) => `- [${n.ts}] ${n.kind}: ${n.text}`).join('\n') : '(nessuna)',
    appunti: notesList.length ? notesList.slice(0, 20).map((n) => `- [${n.ts}] ${n.text}`).join('\n') : '(nessuno)',
    salvati: saved.length ? saved.slice(0, 20).map((p) => `- ${p.title || p.url} (${p.url})`).join('\n') : '(nessuno)',
    tabAperte: openTabsCount,
  };

  // Fascia oraria grossolana per rinfrescare il saluto col passare della giornata
  // (mattina/pomeriggio/sera/notte) senza ricalcoli al minuto.
  const h = new Date().getHours();
  const partOfDay = h < 6 ? 'notte' : h < 12 ? 'mattina' : h < 18 ? 'pomeriggio' : 'sera';

  const signature = DashboardRefresh.computeSignature({
    profilo, preferenze, espansioni, lezioni,
    noteIds: notesList.map((n) => n.id || n.text),
    notificaIds: notiList.map((n) => n.id || n.text),
    salvatiUrls: saved.map((p) => p.url),
    timerIds: timersList.map((t) => `${t.id}:${t.label}:${t.paused ? 1 : 0}`),
    openTabsCount, partOfDay,
  });

  return { settings, hasKey, payload, signature, saved };
}

// Messaggio "senza chiave API": istantaneo, dalle pagine salvate. Niente LLM.
function buildNoKeyDashboard(settings, saved) {
  const suggestions = saved.slice(0, 5).map((p) => ({
    icon: 'link', text: p.title || p.url,
    action: { type: 'NAVIGA', url: p.url, label: p.title || p.url },
    importance: 2,
  }));
  const message = settings.apiKeys?.openrouter || settings.apiKeys?.gemini
    ? 'Buongiorno. Filo è qui.'
    : 'Imposta una chiave API nelle Opzioni per attivare Filo. Intanto, le tue pagine salvate sono qui.';
  return { message, suggestions };
}

// Genera il messaggio della home con l'LLM e lo mette in cache (con la firma).
// Questa è la parte COSTOSA: non va mai sul cammino di apertura di una scheda
// (tranne il primissimo caricamento, quando non c'è ancora nulla in cache).
async function generateDashboardFromInputs(inputs) {
  const cached = await FiloMem.getDashboardCache();
  const r = await handleAIRequest({
    action: ACTIONS.FILO_DASHBOARD,
    payload: { ...inputs.payload, ultimoMessaggio: cached?.message || '' },
    origin: 'filo:dashboard',
  });
  const parsed = extractJson(r.text);
  let message = '';
  let suggestions = [];
  if (parsed && typeof parsed === 'object') {
    message = String(parsed.message || '').trim();
    if (Array.isArray(parsed.suggestions)) {
      suggestions = parsed.suggestions
        .map((s) => ({
          icon: String(s.icon || 'link').toLowerCase(),
          text: String(s.text || '').trim(),
          action: s.action && typeof s.action === 'object' ? s.action : null,
          importance: Number(s.importance) || 2,
        }))
        .filter((s) => s.text);
    }
  }
  if (!message) message = 'Filo è in ascolto.';
  await FiloMem.setDashboardCache({ message, suggestions, signature: inputs.signature });
  return { message, suggestions, ts: new Date().toISOString() };
}

// Scheduler throttle+coalesce per il ricalcolo in background (#155): al massimo
// un ricalcolo ogni DASHBOARD_MIN_INTERVAL_MS, accorpando tutte le richieste.
// Creato pigramente (SN_DASHBOARD_REFRESH è caricato dal loader).
let _dashboardScheduler = null;
function dashboardScheduler() {
  if (_dashboardScheduler) return _dashboardScheduler;
  _dashboardScheduler = DashboardRefresh.createScheduler({
    minIntervalMs: DASHBOARD_MIN_INTERVAL_MS,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    run: async (openTabsCount) => {
      // Ri-raccoglie gli input ORA: accorpa tutte le modifiche della finestra.
      await FiloMem.gcTimers();
      const inputs = await gatherDashboardInputs({ openTabsCount: openTabsCount || 0 });
      if (!inputs.hasKey) return;
      const cached = await FiloMem.getDashboardCache();
      // Se nel frattempo gli input sono tornati uguali alla cache, niente AI.
      if (cached && cached.signature === inputs.signature) return;
      const result = await generateDashboardFromInputs(inputs);
      // Spinge l'aggiornamento alle home aperte: si aggiornano senza rifare l'LLM.
      broadcastToTabs({
        type: MSG.FILO_DASHBOARD_UPDATED,
        message: result.message, suggestions: result.suggestions, ts: result.ts,
      });
    },
  });
  return _dashboardScheduler;
}

async function handleFiloGenerateDashboard({ force = false, openTabsCount = 0 } = {}) {
  // Pulisce i timer scaduti PRIMA di leggere la cache: gcTimers() invalida
  // la cache dashboard quando rimuove qualcosa, così evitiamo di riservire
  // un messaggio cached che parlava di un timer ormai scaduto (bug alpha
  // tester: "Filo non dovrebbe menzionare il timer in alto a sinistra").
  await FiloMem.gcTimers();
  const inputs = await gatherDashboardInputs({ openTabsCount });
  const cached = await FiloMem.getDashboardCache();

  // Senza chiave API: messaggio istantaneo dalle pagine salvate (come prima).
  if (!inputs.hasKey) {
    const payload = buildNoKeyDashboard(inputs.settings, inputs.saved);
    await FiloMem.setDashboardCache({ ...payload, signature: inputs.signature });
    return { ...payload, cached: false, ts: new Date().toISOString() };
  }

  // C'è già una cache e non è un refresh esplicito: la serviamo SUBITO — la
  // nuova scheda non aspetta MAI l'LLM. Se gli input sono cambiati, accodiamo
  // un ricalcolo in background (throttle + coalesce); quando è pronto, la home
  // si aggiorna da sola via FILO_DASHBOARD_UPDATED.
  if (cached && cached.message && !force) {
    if (cached.signature !== inputs.signature) dashboardScheduler().request(openTabsCount);
    return { message: cached.message, suggestions: cached.suggestions, cached: true, ts: cached.ts };
  }

  // Primo caricamento (nessuna cache) o refresh forzato: genera ora.
  const result = await generateDashboardFromInputs(inputs);
  dashboardScheduler().markRan(); // il run sincrono conta per il throttle
  return { ...result, cached: false };
}

async function maybeCategorizeAsync(savedEntry, pageInput) {
  const settings = await getEffectiveSettings();
  if (!settings.featureFlags?.categorize) return;
  if (await Costs.isOverLimit(settings.monthlyLimitEur)) return;
  if (!settings.apiKeys?.[settings.provider]) return;
  const invokeAI = ({ action, payload }) => handleAIRequest({ action, payload, origin: pageInput?.url || '' });
  const result = await Categorizer.categorize({
    invokeAI,
    page: {
      url: savedEntry.url, title: savedEntry.title,
      description: pageInput?.description || '', excerpt: pageInput?.excerpt || '',
      thumbnail: savedEntry.thumbnail,
    },
  });
  if (!result?.category) return;
  const list = await SavedPages.list();
  const idx = list.findIndex((p) => p.id === savedEntry.id);
  if (idx >= 0) {
    list[idx].category = result.category.name;
    list[idx].categoryId = result.category.id;
    list[idx].categoryConfidence = result.confidence;
    await globalThis.chrome.storage.local.set({ [SN_CONST.STORAGE_KEYS.SAVED_PAGES]: list });
  }
}

// ─── registro handler per dominio ────────────────────────────────────────────
// Lo switch storico di handleMessage è spezzato in moduli sotto handlers/:
// ogni modulo registra i propri tipi di messaggio nel registro, handleMessage
// fa solo lookup + fallback. I sottomoduli ricevono via ctx le funzioni di
// supporto condivise che restano in questo file (winOf, getEffectiveSettings,
// broadcast, …); i singleton SN_* li leggono da globalThis come qui sopra.

const registry = new Map();

function on(type, fn) {
  if (registry.has(type)) throw new Error(`[handlers] handler duplicato per "${type}"`);
  registry.set(type, fn);
}

const handlerCtx = {
  MSG,
  winOf,
  filoWin,
  broadcastToTabs,
  broadcastLiveUpdate,
  getEffectiveSettings,
  withDefaults,
  Defaults,
  isAdmin: () => {
    try { return require('../auth/google-auth').isAdmin(); } catch (_) { return false; }
  },
  applySettingsUpdate,
  wireSafebrowse,
  modelForAction,
  buildAttemptChain,
  applyLimitToChain,
  handleAIRequest,
  maybeCategorizeAsync,
  searchArchivedTabs,
  handleFiloChat,
  handleFiloGenerateDashboard,
  executeFiloAction,
};

require('./handlers/nav')(on, handlerCtx);
require('./handlers/tabs')(on, handlerCtx);
require('./handlers/storage')(on, handlerCtx);
require('./handlers/pages')(on, handlerCtx);
require('./handlers/ai')(on, handlerCtx);
require('./handlers/filo')(on, handlerCtx);
require('./handlers/auth')(on, handlerCtx);
require('./handlers/safebrowse')(on, handlerCtx);
require('./handlers/misc')(on, handlerCtx);

// ─── handler centrale richiamato dall'IPC ───────────────────────────────────

async function handleMessage(msg, sender = {}) {
  const origin = sender?.tab?.url || sender?.url || '';
  const fn = registry.get(msg.type);
  if (fn) return fn(msg, sender, origin);
  return { ok: false, error: `Tipo messaggio sconosciuto: ${msg.type}` };
}

// §2.1 — decisione LLM di triage tab. Riceve i metadati/segnali di TUTTE le tab
// candidate + (opz.) un estratto del contenuto e la memoria a lungo termine, e
// torna per ciascuna una decisione keep/archive con motivazione. Batch unico.
// Ritorna { decisions: [{ i, action, reason }], model, provider, costEur } oppure
// lancia se manca la chiave / supera il limite di costo.
async function runTabTriageDecision({ tabs = [], memory = '', trigger = 'idle' } = {}) {
  if (!Array.isArray(tabs) || !tabs.length) return { decisions: [] };
  const settings = await getEffectiveSettings();
  const model = modelForAction(settings, ACTIONS.FILO_TAB_TRIAGE);
  const attemptsRaw = buildAttemptChain(settings, model);
  const attempts = await applyLimitToChain(settings, attemptsRaw);

  const system = [
    'Sei il gestore delle schede del browser dell\'utente. Decidi quali schede',
    'TENERE aperte e quali ARCHIVIARE. Archiviare NON è perdere: la scheda viene',
    'chiusa ma salvata in cronologia e resta sempre riapribile. L\'obiettivo è',
    'liberare la barra dalle schede non più utili, riducendo il rumore.',
    '',
    'Comprendi la NATURA del servizio, non solo le metriche:',
    '- comunicazione/lavoro attivo (WhatsApp, email, editor, doc in modifica) → TIENI;',
    '- feed di consumo (social, aggregatori) → ARCHIVIA anche se riaperti spesso;',
    '- pagina di risultati di ricerca, "dead-end" aperta e mai più rivista,',
    '  contenuto già consumato, duplicati → ARCHIVIA.',
    'Segnali per TENERE: interazione recente, form compilato non inviato, audio in',
    'riproduzione, contenuto consumato solo in parte (scroll basso), task in corso',
    'collegato ad altre schede co-aperte.',
    'Rispetta le istruzioni esplicite dell\'utente nella sua memoria (es. "tieni',
    'sempre aperta X").',
    '',
    'Rispondi SOLO con JSON: {"decisions":[{"i":<indice>,"action":"keep"|"archive",',
    '"reason":"<breve motivo in italiano>"}]} con una voce per OGNI scheda ricevuta.',
  ].join('\n');

  const lines = tabs.map((t, i) => {
    const parts = [`#${i}`, t.title ? `"${String(t.title).slice(0, 120)}"` : '', t.url || ''];
    const sig = [];
    if (typeof t.idleMin === 'number') sig.push(`inattiva da ${t.idleMin}min`);
    if (typeof t.ageMin === 'number') sig.push(`aperta da ${t.ageMin}min`);
    if (typeof t.scrollPct === 'number') sig.push(`scroll ${t.scrollPct}%`);
    if (t.formDirty) sig.push('form non inviato');
    if (t.audible) sig.push('audio in riproduzione');
    if (Array.isArray(t.coOpenUrls) && t.coOpenUrls.length) sig.push(`co-aperte: ${t.coOpenUrls.length}`);
    let s = parts.filter(Boolean).join(' ') + (sig.length ? ` [${sig.join(', ')}]` : '');
    if (t.contentExtract) s += `\n   estratto: ${String(t.contentExtract).slice(0, 500).replace(/\s+/g, ' ')}`;
    return s;
  }).join('\n');

  const userParts = [];
  if (memory) userParts.push(`Memoria/istruzioni dell'utente:\n${String(memory).slice(0, 1500)}\n`);
  userParts.push(`Trigger: ${trigger}.`);
  userParts.push(`Schede aperte (${tabs.length}):\n${lines}`);

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') },
  ];

  const result = await Providers.completeWithFallback({ attempts, messages });
  const usedProvider = result.provider || attempts[0].provider;
  const concreteModel = result.model || attempts[0].model;
  try {
    const pricing = usedProvider === 'gemini' ? null : settings.pricing?.[concreteModel];
    await Costs.record({
      action: ACTIONS.FILO_TAB_TRIAGE, provider: usedProvider, model: concreteModel,
      usage: result.usage, pricing, usdToEur: settings.usdToEur,
    });
  } catch (_) {}

  const parsed = extractJson(result.text) || {};
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  return { decisions, model: concreteModel, provider: usedProvider };
}

// ─── §3.2 ricerca semantica dell'archivio ───────────────────────────────────

// Quantizza un vettore float in int8 normalizzato (peso ~1 byte/dim invece di 4+).
function quantizeEmbedding(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => Math.max(-127, Math.min(127, Math.round((v / norm) * 127))));
}

function cosineInt(a, b) {
  let s = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return s / (Math.sqrt(na) * Math.sqrt(nb));
}

// Completamento LLM one-shot per un'azione (risolve modello/chiave/limite e
// registra il costo). Ritorna il testo. Usato da riassunto, triage, re-rank.
async function runOneShot(action, messages) {
  const settings = await getEffectiveSettings();
  const model = modelForAction(settings, action);
  const attempts = await applyLimitToChain(settings, buildAttemptChain(settings, model));
  const result = await Providers.completeWithFallback({ attempts, messages });
  const usedProvider = result.provider || attempts[0].provider;
  const concreteModel = result.model || attempts[0].model;
  try {
    const pricing = usedProvider === 'gemini' ? null : settings.pricing?.[concreteModel];
    await Costs.record({
      action, provider: usedProvider, model: concreteModel,
      usage: result.usage, pricing, usdToEur: settings.usdToEur,
    });
  } catch (_) {}
  return result.text || '';
}

// §3.1 — riassunto breve di una pagina (per l'archivio + base dell'embedding).
async function summarizeTab(title, content) {
  const text = String(content == null ? '' : content).slice(0, 6000).trim();
  if (!text && !title) return '';
  const messages = [
    { role: 'system', content:
      'Riassumi in italiano il contenuto di una pagina web in 2-4 frasi (max ~120 parole), '
      + 'così che l\'utente possa ritrovarla in futuro: cattura argomento, entità chiave e scopo. '
      + 'Nessun preambolo né meta-commento, solo il riassunto.' },
    { role: 'user', content: `Titolo: ${title || '(senza titolo)'}\n\nContenuto:\n${text || '(nessun testo estratto)'}` },
  ];
  try { return (await runOneShot(ACTIONS.FILO_TAB_SUMMARY, messages)).trim(); } catch (_) { return ''; }
}

// Embedding di testi via modello Google (chiave Gemini effettiva). null se manca.
async function embedTexts(texts) {
  const G = globalThis.SN_PROVIDER_GEMINI;
  if (!G || typeof G.embed !== 'function') return null;
  const settings = await getEffectiveSettings();
  const key = settings.apiKeys && settings.apiKeys.gemini;
  if (!key) return null;
  return G.embed({ apiKey: key, texts, model: SN_CONST.EMBED_MODEL, dim: SN_CONST.EMBED_DIM });
}

// §3.1/§3.2 — arricchisce una tab archiviata: genera un riassunto LLM, lo
// embeddizza (modello Google) e salva riassunto + embedding + snippet, così la
// tab diventa cercabile semanticamente e mostra una sintesi. `payload` può essere
// { title, content } oppure una stringa (trattata come contenuto). Best-effort:
// se manca la chiave o il testo, fa il possibile (anche solo snippet) e non rompe.
async function enrichArchivedTab(id, payload) {
  try {
    if (!id) return;
    const title = (payload && typeof payload === 'object') ? (payload.title || '') : '';
    const content = (payload && typeof payload === 'object')
      ? (payload.content || '')
      : String(payload == null ? '' : payload);
    const base = `${title}\n${content}`.replace(/\s+/g, ' ').trim();
    if (!base) return;

    const summary = await summarizeTab(title, content); // best-effort (può essere '')
    const toEmbed = (summary || base).slice(0, 4000);
    const vecs = await embedTexts([toEmbed]);

    const patch = {};
    if (summary) patch.summary = summary;
    patch.snippet = (summary || content || title).replace(/\s+/g, ' ').trim().slice(0, 240);
    if (vecs && vecs[0] && vecs[0].length) patch.embedding = quantizeEmbedding(vecs[0]);
    if (Object.keys(patch).length) await ArchivedTabs.update(id, patch);
  } catch (_) { /* l'arricchimento non deve mai disturbare */ }
}
globalThis.SN_TAB_ENRICH = enrichArchivedTab;

// §3.2 step 4 — re-rank LLM dei top-K: legge i riassunti e riordina per pertinenza.
// Ritorna un array di indici (in `items`) o null se non disponibile.
async function rerankResults(query, items) {
  const lines = items.map((it, i) =>
    `#${i} ${it.title || ''}\n${(it.summary || it.snippet || it.url || '').slice(0, 300)}`).join('\n\n');
  const messages = [
    { role: 'system', content:
      'Sei un motore di ricerca. Data una query e una lista di pagine (indice + riassunto), '
      + 'ordina gli indici dal più pertinente al meno pertinente alla query, scartando i non '
      + 'pertinenti. Rispondi SOLO con JSON: {"order":[indici]}.' },
    { role: 'user', content: `Query: ${query}\n\nPagine:\n${lines}` },
  ];
  try {
    const parsed = extractJson(await runOneShot(ACTIONS.FILO_TAB_SEARCH, messages));
    const order = parsed && Array.isArray(parsed.order)
      ? parsed.order.filter((n) => Number.isInteger(n) && n >= 0 && n < items.length)
      : null;
    return order && order.length ? order : null;
  } catch (_) { return null; }
}

// Ricerca semantica: embeddizza la query, ordina le tab per similarità coseno.
// Ritorna { results } (metadati senza embedding) oppure { results:null } se non
// è possibile (niente chiave) così la pagina ripiega sul filtro per sottostringa.
async function searchArchivedTabs(query, { topK = 40 } = {}) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return { ok: true, results: null };
  let qvecs = null;
  try { qvecs = await embedTexts([q]); } catch (_) { qvecs = null; }
  if (!qvecs || !qvecs[0] || !qvecs[0].length) return { ok: true, results: null, noEmbed: true };
  const qv = quantizeEmbedding(qvecs[0]);
  const items = await ArchivedTabs.list();
  const scored = [];
  for (const it of items) {
    if (!Array.isArray(it.embedding) || !it.embedding.length) continue;
    scored.push({ score: cosineInt(qv, it.embedding), it });
  }
  scored.sort((a, b) => b.score - a.score);
  let results = scored.slice(0, topK).map(({ score, it }) => {
    const { embedding, ...meta } = it;
    return { ...meta, score };
  });

  // §3.2 step 4 — re-rank LLM dei primi risultati (best-effort): legge i riassunti
  // e li riordina per pertinenza alla query. Se non disponibile, resta l'ordine
  // per similarità coseno.
  const rerankK = 25;
  const head = results.slice(0, rerankK);
  if (head.length > 1) {
    const order = await rerankResults(q, head);
    if (order) {
      const seen = new Set(order);
      const reranked = order.map((i) => head[i]);
      const dropped = head.filter((_, i) => !seen.has(i)); // scartati dall'LLM → in coda
      results = [...reranked, ...dropped, ...results.slice(rerankK)];
    }
  }
  return { ok: true, results };
}

function broadcastToTabs(message) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win._filoTabs) {
        for (const t of win._filoTabs.tabs) {
          try { t.view.webContents.send('filo:broadcast', message); } catch (_) {}
        }
      }
      try { win.webContents.send('filo:broadcast', message); } catch (_) {}
    }
  } catch (_) {}
}

// Configura il rilevatore di siti pericolosi (services/safebrowse) con chiavi e
// provider derivati dalle impostazioni. Va richiamato al boot e a ogni
// UPDATE_SETTINGS. Best-effort: se SN_SAFEBROWSE non c'è o la feature è spenta,
// disinnesca tutti i provider di rete/LLM/sandbox (resta solo l'analisi locale
// deterministica, che non costa nulla e non fa rete).
async function wireSafebrowse(settingsArg) {
  const SB = globalThis.SN_SAFEBROWSE;
  if (!SB || typeof SB.configure !== 'function') return;
  let settings = settingsArg;
  if (!settings) {
    try { settings = await getEffectiveSettings(); } catch (_) { settings = {}; }
  }
  const sb = (settings.security && settings.security.safeBrowse) || {};
  if (sb.enabled === false) {
    SB.configure({ gsbKey: '', runLlm: null, enableSandbox: false, enableNetwork: false });
    return;
  }
  // Giudice LLM: riusa la catena di fallback dei provider con un modello
  // economico. Solo METADATI (mai contenuto pagina) passano da llm.judge.
  const runLlm = sb.llmJudge === false ? null : async (messages) => {
    const s = await getEffectiveSettings();
    const attempts = buildAttemptChain(s, 'flash-lite');
    const r = await Providers.completeWithFallback({ attempts, messages });
    return r.text;
  };
  SB.configure({
    gsbKey: sb.safeBrowsingKey || '',
    runLlm,
    enableSandbox: sb.sandbox !== false,
    enableNetwork: sb.networkSignals !== false,
  });
}

// Esposto su globalThis così il TabManager (src/main/tabs.js) può chiamare la
// decisione LLM senza creare un ciclo di require fra tabs.js e handlers.js.
globalThis.SN_TAB_TRIAGE_DECIDE = runTabTriageDecision;

// Livello 2 del rilevamento geo-block (proxy-per-tab-spec.md §4): classificatore
// LLM per la coda ambigua (403, pagina vuota, "non disponibile" generico). Come
// per il giudice safebrowse, riusa la catena provider con un modello economico
// e passa SOLO metadati minimali (titolo + ~500 char di testo della pagina
// d'errore + status + dominio); il contenuto è input non fidato (hardening nel
// prompt del classificatore). Cache (dominio, path-pattern) condivisa con TTL.
// Esposto su globalThis per evitare il ciclo di require tabs.js↔handlers.js.
let geoClassifierCache = null;
globalThis.SN_GEO_CLASSIFY = async function geoClassify(input) {
  const Classifier = globalThis.SN_GEOBLOCK_CLASSIFIER;
  if (!Classifier) return { class: null, route: { proxy: false }, skipped: true };
  if (!geoClassifierCache) geoClassifierCache = Classifier.createCache();
  const complete = async ({ messages, signal }) => {
    const s = await getEffectiveSettings();
    const attempts = buildAttemptChain(s, 'flash-lite');
    const r = await Providers.completeWithFallback({ attempts, messages, signal });
    return r.text;
  };
  return Classifier.classify(input, { complete, cache: geoClassifierCache });
};

// Esposto su globalThis per i test Playwright (app.evaluate non ha require):
// è il dispatch con il gate dei livelli di sicurezza (#146.2).
globalThis.SN_EXECUTE_FILO_ACTION = executeFiloAction;
// Idem per la chat della home: i test ne ispezionano il prompt costruito (#158).
globalThis.SN_HANDLE_FILO_CHAT = handleFiloChat;

module.exports = {
  handleMessage,
  handleStream,
  broadcastLiveUpdate,
  broadcastToTabs,
  handleAIRequest,
  maybeCategorizeAsync,
  wireSafebrowse,
  runTabTriageDecision,
  executeFiloAction,
};
