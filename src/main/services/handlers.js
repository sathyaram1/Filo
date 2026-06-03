// Handler centrale dei messaggi (ex chrome.runtime.onMessage del background SW).
// È il porting 1:1 della logica di src/background/background.js dell'estensione,
// con le seguenti differenze:
//   - Non registra listener chrome.runtime: la routing IPC è in src/main/ipc.js
//   - Esporta `handleMessage(msg, sender)` che ritorna l'oggetto risposta
//   - Esporta `handleStream(action, payload, origin, port)` per lo streaming
//   - Esporta `broadcastLiveUpdate` per i broadcast dashboard
//
// I moduli SN_* sono stati caricati dal loader.js — qui assumiamo siano su global.

const { app, BrowserWindow } = require('electron');
const auth = require('../auth/google-auth');
const Defaults = require('./defaultsStore');
const { permissionDeniedHelp } = require('./feedbackError');

const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS, DEFAULT_SETTINGS } = SN_CONST;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const Providers = globalThis.SN_PROVIDERS;
const Costs = globalThis.SN_COSTS;
const SavedPages = globalThis.SN_SAVED_PAGES;
const History = globalThis.SN_HISTORY;
const I18n = globalThis.SN_I18N;
const Categorizer = globalThis.SN_CATEGORIZER;
const AICache = globalThis.SN_AI_CACHE;
const Fx = globalThis.SN_FX;
const PathsCollector = globalThis.SN_PATHS_COLLECTOR;
const Paths = globalThis.SN_PATHS;
const LlmsTxt = globalThis.SN_LLMS_TXT;
const WebSearch = globalThis.SN_WEB_SEARCH;
const FiloMem = globalThis.SN_FILO_MEMORY;
const FiloState = globalThis.SN_FILO_STATE;

const KNOWN_PATHS_BUDGET_CHARS = 20 * 1024;
const DASHBOARD_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
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
  if (settings.useDefaultModels === false) return settings;
  const d = Defaults.get();
  const userKeys = settings.apiKeys || {};
  const apiKeys = {};
  for (const k of ['openrouter', 'gemini', 'tavily']) {
    apiKeys[k] = d.apiKeys[k] || userKeys[k] || '';
  }
  return {
    ...settings,
    provider: d.provider,
    geminiDirect: d.geminiDirect,
    models: d.models,
    modelRegistry: d.modelRegistry,
    apiKeys,
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
  const out = [];
  const seen = new Set();
  const push = (provider) => {
    if (seen.has(provider)) return;
    const apiKey = settings.apiKeys?.[provider];
    if (!apiKey) return;
    const concrete = SN_CONST.resolveModel(modelRef, provider, registry);
    if (!concrete) return;
    seen.add(provider);
    out.push({ provider, apiKey, model: concrete });
  };
  if (settings.geminiDirect) push('gemini');
  push(settings.provider || 'openrouter');
  push('openrouter');
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
  let messages = await buildMessages(action, payload);
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

async function executeFiloAction(action) {
  if (!action || typeof action !== 'object') return { executed: false, kept: false };
  const type = String(action.type || '').toUpperCase();
  try {
    switch (type) {
      case 'NAVIGA':
        return { executed: true, kept: true };
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
      case 'CERCA_WEB':
      case 'EVENTO_CALENDARIO':
        return { executed: false, kept: true };
      case 'APRI_FILE':
        return { executed: true, kept: true };
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

async function handleFiloChat({ userMessage, threadHistory, image, images }) {
  await FiloMem.touchSession();
  await FiloMem.appendRaw({ type: 'chat_user', summary: String(userMessage || '').slice(0, 200) });
  const memory = await FiloMem.getMemory();
  const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(memory);
  const lezioni = await lessonsBufferText();
  const { stateText } = await FiloState.assemble();
  const cleanHistory = Array.isArray(threadHistory) ? threadHistory.slice(-20) : [];
  const threadMessages = cleanHistory.map((m) => ({
    role: m.role === 'filo' ? 'assistant' : 'user',
    content: String(m.text || ''),
  }));
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
  const textReply = String(parsed.text || '').trim() || '(vuoto)';
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const renderedActions = [];
  for (const a of rawActions) {
    const res = await executeFiloAction(a);
    if (res.kept) renderedActions.push(a);
  }
  await FiloMem.appendRaw({ type: 'chat_filo', summary: textReply.slice(0, 200), extra: { actions: rawActions } });
  maybeRunLessonAgent({ userMessage, filoReply: textReply, stateText }).catch(() => {});
  return { text: textReply, actions: renderedActions, model: r.model, provider: r.provider, costEur: r.costEur };
}

async function handleFiloGenerateDashboard({ force = false } = {}) {
  // Pulisce i timer scaduti PRIMA di leggere la cache: gcTimers() invalida
  // la cache dashboard quando rimuove qualcosa, così evitiamo di riservire
  // un messaggio cached che parlava di un timer ormai scaduto (bug alpha
  // tester: "Filo non dovrebbe menzionare il timer in alto a sinistra").
  await FiloMem.gcTimers();
  const cached = await FiloMem.getDashboardCache();
  const now = Date.now();
  if (!force && cached?.ts) {
    const age = now - new Date(cached.ts).getTime();
    if (age < DASHBOARD_REFRESH_COOLDOWN_MS) {
      return { message: cached.message, suggestions: cached.suggestions, cached: true, ts: cached.ts };
    }
  }
  const settings = await getEffectiveSettings();
  if (!settings.apiKeys?.[settings.provider] && !settings.apiKeys?.gemini) {
    const saved = await SavedPages.list();
    const suggestions = saved.slice(0, 5).map((p) => ({
      icon: 'link', text: p.title || p.url,
      action: { type: 'NAVIGA', url: p.url, label: p.title || p.url },
      importance: 2,
    }));
    const message = settings.apiKeys?.openrouter || settings.apiKeys?.gemini
      ? 'Buongiorno. Filo è qui.'
      : 'Imposta una chiave API nelle Opzioni per attivare Filo. Intanto, le tue pagine salvate sono qui.';
    const payload = { message, suggestions };
    await FiloMem.setDashboardCache(payload);
    return { ...payload, cached: false, ts: new Date().toISOString() };
  }

  const memory = await FiloMem.getMemory();
  const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(memory);
  const lezioni = await lessonsBufferText();
  const { stateText } = await FiloState.assemble();
  const notesList = await FiloMem.listNotes();
  const notiList = await FiloMem.listNotifications();
  const saved = await SavedPages.list();

  const r = await handleAIRequest({
    action: ACTIONS.FILO_DASHBOARD,
    payload: {
      profilo, preferenze, espansioni, lezioni, stato: stateText,
      notifiche: notiList.length ? notiList.map((n) => `- [${n.ts}] ${n.kind}: ${n.text}`).join('\n') : '(nessuna)',
      appunti: notesList.length ? notesList.slice(0, 20).map((n) => `- [${n.ts}] ${n.text}`).join('\n') : '(nessuno)',
      salvati: saved.length ? saved.slice(0, 20).map((p) => `- ${p.title || p.url} (${p.url})`).join('\n') : '(nessuno)',
      ultimoMessaggio: cached?.message || '',
    },
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
  await FiloMem.setDashboardCache({ message, suggestions });
  return { message, suggestions, cached: false, ts: new Date().toISOString() };
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

// ─── handler centrale richiamato dall'IPC ───────────────────────────────────

async function handleMessage(msg, sender = {}) {
  const origin = sender?.tab?.url || sender?.url || '';
  switch (msg.type) {
    // ── canali interni per lo shim chrome.* nel renderer ────────────────
    case '_storage:get':
      return { ok: true, value: await globalThis.chrome.storage.local.get(msg.keys ?? null) };
    case '_storage:set':
      await globalThis.chrome.storage.local.set(msg.obj || {});
      return { ok: true };
    case '_storage:remove':
      await globalThis.chrome.storage.local.remove(msg.keys);
      return { ok: true };
    case '_storage:clear':
      await globalThis.chrome.storage.local.clear();
      return { ok: true };
    case '_tabs:create': {
      const win = winOf(sender);
      if (!win || !win._filoTabs) return { ok: false };
      const id = win._filoTabs.openTab(msg.url || 'filo://newtab/');
      return { ok: true, id };
    }
    case '_tabs:remove': {
      const win = winOf(sender);
      if (win && win._filoTabs) win._filoTabs.closeTab(msg.id);
      return { ok: true };
    }
    case MSG.AI_REQUEST: {
      const r = await handleAIRequest({ action: msg.action, payload: msg.payload, origin });
      return { ok: true, ...r };
    }
    case MSG.GET_SETTINGS:
      return { ok: true, settings: await Storage.getSettings() };
    case MSG.EXPORT_DATA: {
      // Esporta TUTTI i dati di Filo in un unico .zip (data.json + immagini
      // copiate estratte come file). L'utente sceglie dove salvarlo.
      try {
        const { dialog } = require('electron');
        const fsp = require('node:fs/promises');
        const DiskStorage = require('../shim/storage');
        const { buildExportZip } = require('./exportData');

        const allData = await DiskStorage.get(null);
        const zip = buildExportZip(allData);

        const win = winOf(sender);
        const stamp = new Date().toISOString().slice(0, 10);
        const defaultPath = `filo-export-${stamp}.zip`;
        const res = await dialog.showSaveDialog(win || undefined, {
          title: I18n.t('security_export_title'),
          defaultPath,
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        await fsp.writeFile(res.filePath, zip);
        return { ok: true, path: res.filePath, bytes: zip.length };
      } catch (e) {
        console.error('[Filo export] fallito:', e);
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case MSG.UPDATE_SETTINGS: {
      const merged = await Storage.updateSettings(msg.settings);
      broadcastToTabs({ type: MSG.SETTINGS_UPDATED, settings: merged });
      try {
        const { nativeTheme } = require('electron');
        const t = merged.theme;
        nativeTheme.themeSource = t === 'dark' ? 'dark' : t === 'light' ? 'light' : 'system';
      } catch (_) {}
      // Propaga le impostazioni di sicurezza al TabManager così la nuova
      // policy WebRTC + popup blocker si applicano immediatamente, senza
      // aspettare un reload dei tab.
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          if (w._filoTabs && typeof w._filoTabs.setSecurity === 'function') {
            w._filoTabs.setSecurity(merged.security || {});
          }
        }
      } catch (_) {}
      return { ok: true, settings: merged };
    }
    case MSG.SAVE_PAGE: {
      const entry = await SavedPages.save(msg.page);
      maybeCategorizeAsync(entry, msg.page).catch((e) => console.warn('[Filo] categorize failed', e));
      return { ok: true, entry };
    }
    case MSG.SAVE_LINK: {
      const entry = await SavedPages.save({ url: msg.url, title: msg.title });
      maybeCategorizeAsync(entry, { url: msg.url, title: msg.title }).catch((e) => console.warn('[Filo] categorize failed', e));
      return { ok: true, entry };
    }
    case MSG.GET_CATEGORIES:
      return { ok: true, categories: await Categorizer.listCategories() };
    case MSG.RENAME_CATEGORY: {
      const c = await Categorizer.renameCategory(msg.id, msg.name);
      return { ok: true, category: c };
    }
    case MSG.DELETE_CATEGORY: {
      const cats = await Categorizer.deleteCategory(msg.id);
      return { ok: true, categories: cats };
    }
    case MSG.MERGE_CATEGORIES: {
      await Categorizer.mergeCategories(msg.fromId, msg.toId);
      return { ok: true, categories: await Categorizer.listCategories() };
    }
    case MSG.MOVE_PAGE_CATEGORY: {
      const p = await Categorizer.movePageToCategory(msg.pageId, msg.categoryId);
      return { ok: true, page: p };
    }
    case MSG.GET_SAVED_PAGES:
      return { ok: true, pages: await SavedPages.list() };
    case MSG.REMOVE_SAVED_PAGE:
      return { ok: true, pages: await SavedPages.remove(msg.id) };
    case MSG.CONSUME_SAVED_PAGE:
      return { ok: true, pages: await SavedPages.consume(msg.id) };
    case MSG.GET_CLIPBOARD_HISTORY: {
      const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
      return { ok: true, items: Array.isArray(list) ? list : [] };
    }
    case MSG.PUSH_CLIPBOARD_ENTRY: {
      const cap = SN_CONST.CLIPBOARD_HISTORY_MAX;
      const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
      const arr = Array.isArray(list) ? list : [];
      const e = msg.entry;
      if (!e) return { ok: true, items: arr };
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const keyOf = (x) => {
        if (!x) return '';
        if (x.type === 'text') return 't:' + norm(x.text);
        if (x.type === 'image') return 'i:' + (x.dataUrl || '');
        return '';
      };
      const newKey = keyOf(e);
      const seen = new Set([newKey]);
      const filtered = [];
      for (const x of arr) {
        const k = keyOf(x);
        if (k === newKey || seen.has(k)) continue;
        seen.add(k);
        filtered.push(x);
      }
      filtered.unshift({ ...e, ts: Date.now() });
      const trimmed = filtered.slice(0, cap);
      await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, trimmed);
      return { ok: true, items: trimmed };
    }
    case MSG.UPDATE_CLIPBOARD_DESCRIPTION: {
      const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
      const arr = Array.isArray(list) ? list : [];
      let updated = false;
      for (const x of arr) {
        if (x.type === 'image' && x.dataUrl === msg.dataUrl) {
          x.description = msg.description;
          updated = true;
          break;
        }
      }
      if (updated) await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, arr);
      return { ok: true, items: arr };
    }
    case MSG.CLEAR_CLIPBOARD_HISTORY:
      await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
      return { ok: true };
    case MSG.GET_HISTORY:
      return { ok: true, items: await History.list() };
    case MSG.APPEND_HISTORY: {
      const item = await History.append(msg.entry);
      return { ok: true, item };
    }
    case MSG.CLEAR_HISTORY:
      await History.clear();
      return { ok: true };
    case MSG.GET_COSTS:
      return { ok: true, monthly: await Costs.getMonthly(), state: await Costs.getState() };
    case MSG.CAPTURE_VISIBLE_TAB: {
      const win = winOf(sender);
      if (!win || !win._filoTabs) return { ok: false, error: 'no window' };
      const tab = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
      if (!tab) return { ok: false, error: 'no active tab' };
      const img = await tab.view.webContents.capturePage();
      return { ok: true, dataUrl: img.toDataURL() };
    }
    case MSG.FEEDBACK_ANNOTATE: {
      // Il box feedback è appena entrato/uscito dalla modalità annotazione.
      // Inoltriamo alla shell (barra in alto) così l'ombra copre TUTTO Filo,
      // non solo l'area pagina dove vive il content script.
      const win = winOf(sender);
      try { win?.webContents?.send('shell:feedback-dim', { on: !!msg.on }); } catch (_) {}
      return { ok: true };
    }
    case MSG.FEEDBACK_CLEAR_DRAW: {
      // "Cancella disegno" dal box (pagina): cancella anche i tratti sulla barra
      // in alto, che vivono nella shell.
      const win = winOf(sender);
      try { win?.webContents?.send('shell:feedback-clear-draw'); } catch (_) {}
      return { ok: true };
    }
    case MSG.CAPTURE_FEEDBACK_TOPBAR: {
      // Scatto annotato della SOLA barra in alto di Filo (shell): il box lo
      // impila sopra lo screenshot della pagina per ottenere un'immagine di
      // tutta l'app col disegno. I tratti sono già parte del DOM della shell
      // (canvas di disegno), quindi vengono catturati direttamente.
      const win = winOf(sender);
      if (!win || !win._filoTabs) return { ok: false, error: 'no window' };
      try {
        const barH = win._filoTabs.topChromeHeight();
        if (barH <= 0) return { ok: false, error: 'no topbar' };
        const [w] = win.getContentSize();
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: barH });
        return { ok: true, dataUrl: img.toDataURL(), barHeight: barH };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    }
    case MSG.TEST_PROVIDER: {
      try {
        const provider = msg.provider;
        const apiKey = (msg.apiKey || '').trim();
        const model = msg.model || (provider === 'gemini'
          ? 'google/gemini-2.0-flash-lite-001'
          : 'google/gemini-2.0-flash-001');
        if (!apiKey) return { ok: false, error: 'API key mancante' };
        const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
        const startMs = performance.now();
        let firstTokenMs = null;
        let charCount = 0;
        const result = await Providers.streamComplete({
          provider, apiKey, model, messages,
          onDelta: (delta) => {
            if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
            charCount += (delta || '').length;
          },
        });
        const totalMs = performance.now() - startMs;
        const tokens = (result?.usage?.completionTokens) || Math.max(1, Math.round(charCount / 4));
        const tps = tokens > 0 && totalMs > 0 ? (tokens / (totalMs / 1000)) : 0;
        return {
          ok: true, provider, model,
          ttftMs: firstTokenMs != null ? Math.round(firstTokenMs) : null,
          totalMs: Math.round(totalMs), completionTokens: tokens,
          tokensPerSec: Math.round(tps * 10) / 10,
        };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    }
    case MSG.OPEN_HOME: {
      const win = winOf(sender);
      if (win?._filoTabs) win._filoTabs.openTab('filo://home/home.html');
      return { ok: true };
    }
    case MSG.OPEN_HISTORY: {
      const win = winOf(sender);
      if (win?._filoTabs) win._filoTabs.openTab('filo://history/history.html');
      return { ok: true };
    }
    case MSG.OPEN_OPTIONS: {
      const win = winOf(sender);
      if (win?._filoTabs) win._filoTabs.openTab('filo://options/options.html');
      return { ok: true };
    }
    case MSG.OPEN_SPELLCHECK_PAGE: {
      const win = winOf(sender);
      if (win?._filoTabs) win._filoTabs.openTab('filo://spellcheck/spellcheck.html');
      return { ok: true };
    }
    case MSG.CLOSE_TAB:
      if (sender?.tab?.id) {
        const win = winOf(sender);
        win?._filoTabs?.closeTab(sender.tab.id);
      }
      return { ok: true };
    case MSG.OPEN_URL: {
      const win = winOf(sender);
      if (win?._filoTabs && msg.url) win._filoTabs.openTab(msg.url);
      return { ok: true };
    }
    case MSG.QUIT_APP:
      app.quit();
      return { ok: true };
    case MSG.NAV_BACK:
      if (sender?.tab?.id) {
        const win = winOf(sender);
        win?._filoTabs?.goBack(sender.tab.id);
      }
      return { ok: true };
    case MSG.NAV_FORWARD:
      if (sender?.tab?.id) {
        const win = winOf(sender);
        win?._filoTabs?.goForward(sender.tab.id);
      }
      return { ok: true };
    case MSG.NAV_RELOAD:
      if (sender?.tab?.id) {
        const win = winOf(sender);
        win?._filoTabs?.reload(sender.tab.id);
      }
      return { ok: true };
    case MSG.NAV_STATE: {
      if (!sender?.tab?.id) return { ok: false, canBack: false, canFwd: false };
      const win = winOf(sender);
      const tab = win?._filoTabs?.tabs?.find((t) => t.id === sender.tab.id);
      const wc = tab?.view?.webContents;
      if (!wc) return { ok: false, canBack: false, canFwd: false };
      const canBack = wc.navigationHistory?.canGoBack?.() ?? wc.canGoBack?.() ?? false;
      const canFwd = wc.navigationHistory?.canGoForward?.() ?? wc.canGoForward?.() ?? false;
      return { ok: true, canBack: !!canBack, canFwd: !!canFwd };
    }
    case MSG.TOGGLE_FULLSCREEN: {
      // Il `document.requestFullscreen()` dal renderer di una WebContentsView
      // non porta la BrowserWindow a tutto schermo: la WebContentsView resta
      // confinata al suo bounds attuale. Per andare davvero in fullscreen OS
      // dobbiamo agire sulla BrowserWindow (feedback alpha).
      const win = winOf(sender);
      if (win?._filoTabs) {
        // Non basta il fullscreen OS: la view resta confinata sotto la barra
        // (tab + indirizzo). Per nascondere davvero la barra la view attiva deve
        // coprire l'intera finestra. Esc esce (gestito in tabs.js).
        win._filoTabs.toggleContentFullscreen();
      } else if (win) {
        win.setFullScreen(!win.isFullScreen());
      }
      return { ok: true };
    }
    case MSG.EXIT_FULLSCREEN: {
      // Uscita idempotente dalla modalità contenuto a tutto schermo (Esc dalla
      // pagina). Idempotente così convive col fallback before-input-event.
      const win = winOf(sender);
      if (win?._filoTabs) win._filoTabs.setContentFullscreen(false);
      return { ok: true };
    }
    case MSG.OPEN_NEW_TAB: {
      const win = winOf(sender);
      if (win?._filoTabs) win._filoTabs.openTab(msg.url || 'filo://newtab/');
      return { ok: true };
    }
    case MSG.OPEN_INCOGNITO: {
      // Apre una NUOVA finestra incognito: sessione web effimera (cookie/cache
      // in RAM) + storage filo:// instradato sull'overlay in memoria. Come in
      // Chrome, apriamo sempre una finestra nuova anche se il mittente è già
      // incognito. Lazy require di window.js per evitare cicli al boot.
      try {
        const { createIncognitoWindow } = require('../window');
        createIncognitoWindow();
        return { ok: true };
      } catch (e) {
        console.error('[Filo] open-incognito', e);
        return { ok: false, error: e.message || String(e) };
      }
    }
    case MSG.REPLACE_MISSPELLING: {
      // Usa l'API nativa di Electron per sostituire la parola sotto il cursore
      // del context-menu nativo (vedi `wc.on('context-menu', ...)` in tabs.js).
      // Funziona uniformemente su input, textarea e contenteditable.
      try {
        const win = winOf(sender);
        const tab = sender?.tab?.id ? win?._filoTabs?.tabs?.find((t) => t.id === sender.tab.id) : null;
        const wc = tab?.view?.webContents;
        if (wc && typeof wc.replaceMisspelling === 'function' && msg.suggestion) {
          wc.replaceMisspelling(String(msg.suggestion));
        }
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
      return { ok: true };
    }
    case MSG.WEB_SEARCH:
      try {
        const settings = await getEffectiveSettings();
        const tavilyKey = settings.apiKeys?.tavily || '';
        const r = await WebSearch.search({ query: msg.query, tavilyKey, maxResults: 5 });
        return { ok: true, ...r };
      } catch (e) {
        return { ok: false, error: e.message || String(e), results: [] };
      }
    // ── Rilevamento siti pericolosi ────────────────────────────────────
    // Il verdetto vive nel TabManager (per tab: bypass/dismiss); qui inoltriamo
    // alla finestra MITTENTE così l'overlay/banner agisce sul tab giusto.
    case MSG.SAFEBROWSE_GET: {
      const win = winOf(sender);
      const tabId = sender?.tab?.id;
      if (!win || !win._filoTabs || !tabId) return { ok: true, level: 'safe', message: null };
      const ctx = { hasPassword: !!msg.hasPassword, hasPayment: !!msg.hasPayment };
      return win._filoTabs.safebrowseGet(tabId, msg.url || origin, ctx);
    }
    case MSG.SAFEBROWSE_PROCEED: {
      const win = winOf(sender);
      const tabId = sender?.tab?.id;
      if (!win || !win._filoTabs || !tabId) return { ok: false };
      return win._filoTabs.safebrowseProceed(tabId, msg.url || origin);
    }
    case MSG.SAFEBROWSE_DISMISS: {
      const win = winOf(sender);
      const tabId = sender?.tab?.id;
      if (!win || !win._filoTabs || !tabId) return { ok: false };
      return win._filoTabs.safebrowseDismiss(tabId, msg.url || origin);
    }
    case MSG.SUBMIT_FEEDBACK: {
      try {
        if (!globalThis.SN_FEEDBACK?.submit) {
          throw new Error('SN_FEEDBACK non caricato nel main process');
        }
        const payload = msg.payload || {};
        console.log('[Filo feedback] submit start', {
          textLen: (payload.text || '').length,
          images: (payload.images || []).length,
          url: payload.url,
        });
        const submitP = globalThis.SN_FEEDBACK.submit(payload);
        const timeoutP = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('timeout (20s) — controlla la rete')), 20000));
        const r = await Promise.race([submitP, timeoutP]);
        console.log('[Filo feedback] submit ok', r);
        return { ok: true, ...r };
      } catch (e) {
        console.error('[Filo feedback] submit failed', e);
        return { ok: false, error: e?.message || String(e) };
      }
    }
    // ── Account "Accedi con Google" ──────────────────────────────────────
    // I token restano nel main process: qui torniamo solo il profilo pubblico
    // + se l'utente è admin (può triagiare i feedback).
    case MSG.AUTH_STATUS:
      return { ok: true, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile: auth.getProfile() };
    case MSG.AUTH_SIGNIN:
      try {
        const profile = await auth.signIn();
        broadcastToTabs({ type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile });
        // Da loggati possiamo leggere eventuali chiavi default ruotate
        // dall'admin (doc Firestore config/secrets): rinfresca in background.
        Defaults.refresh().catch(() => {});
        return { ok: true, profile, isAdmin: auth.isAdmin() };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    case MSG.AUTH_SIGNOUT:
      try {
        auth.signOut();
        broadcastToTabs({ type: MSG.AUTH_CHANGED, signedIn: false, isAdmin: false, profile: null });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    // Triage admin di un feedback: solo admin loggati, con Firebase ID token
    // come Bearer (il token non lascia mai il main). La garanzia forte è nelle
    // Firestore rules; questo è il gate applicativo + il trasporto autenticato.
    case MSG.FEEDBACK_UPDATE:
      try {
        if (!auth.isAdmin()) {
          return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
        }
        if (!globalThis.SN_FEEDBACK?.updateStatus) {
          throw new Error('SN_FEEDBACK non caricato nel main process');
        }
        const idToken = await auth.getIdToken();
        if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
        const { id, status, notes, priority } = msg;
        await globalThis.SN_FEEDBACK.updateStatus(id, { status, notes, priority }, { idToken });
        return { ok: true };
      } catch (e) {
        const raw = e?.message || String(e);
        let claims = null;
        try { claims = auth.getTokenClaims(); } catch (_) {}
        return { ok: false, error: permissionDeniedHelp(raw, claims) };
      }
    // Config "modelli predefiniti" condivisa. La lettura (per l'editor admin)
    // NON espone le chiavi vere, solo se sono configurate. La scrittura è
    // riservata agli admin (Firebase ID token come Bearer): le regole Firestore
    // rifiutano i non-admin. La modifica si propaga a tutti gli utenti.
    case MSG.DEFAULTS_GET:
      try {
        if (!auth.isAdmin()) {
          return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
        }
        await Defaults.refresh().catch(() => {});
        return { ok: true, config: Defaults.getPublicForAdmin() };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    case MSG.DEFAULTS_UPDATE:
      try {
        if (!auth.isAdmin()) {
          return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
        }
        const idToken = await auth.getIdToken();
        if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
        const config = await Defaults.update(msg.config || {}, idToken);
        return { ok: true, config };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    case MSG.SAVE_PATH:
      (async () => {
        try {
          const settings = await getEffectiveSettings();
          if (!settings.apiKeys?.[settings.provider] && !settings.apiKeys?.gemini) return;
          const ua = process.versions ? `Filo/${process.versions.electron || ''} Node/${process.version}` : '';
          const cid = msg.payload?.clientId || '';
          const invokeAI = ({ action, payload }) => handleAIRequest({ action, payload, origin });
          const r = await PathsCollector.collectAndSave({
            session: msg.payload?.session, invokeAI, userAgent: ua, clientId: cid,
          });
          if (r?.saved) console.info('[Filo] path salvato:', r.id, r.intent);
        } catch (e) { console.warn('[Filo] save_path failed', e); }
      })();
      return { ok: true };
    case MSG.FILO_CHAT: {
      const r = await handleFiloChat({ userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images });
      return { ok: true, ...r };
    }
    case MSG.FILO_GET_STATE: {
      const { state, stateText } = await FiloState.assemble();
      return { ok: true, state, stateText };
    }
    case MSG.FILO_GENERATE_DASHBOARD: {
      const r = await handleFiloGenerateDashboard({ force: !!msg.force });
      return { ok: true, ...r };
    }
    case MSG.FILO_GET_MEMORY:
      return { ok: true, memory: await FiloMem.getMemory() };
    case MSG.FILO_GET_NOTES:
      return { ok: true, notes: await FiloMem.listNotes() };
    case MSG.FILO_ADD_NOTE: {
      const note = await FiloMem.addNote({ text: msg.text, context: msg.context });
      return { ok: true, note };
    }
    case MSG.FILO_DELETE_NOTE: {
      const list = await FiloMem.deleteNote(msg.id);
      return { ok: true, notes: list };
    }
    case MSG.FILO_GET_TIMERS:
      return { ok: true, timers: await FiloMem.gcTimers() };
    case MSG.FILO_ADD_TIMER: {
      const t = await FiloMem.addTimer({ label: msg.label, seconds: msg.seconds });
      if (t) broadcastLiveUpdate();
      return { ok: true, timer: t };
    }
    case MSG.FILO_DELETE_TIMER: {
      const list = await FiloMem.deleteTimer(msg.id);
      broadcastLiveUpdate();
      return { ok: true, timers: list };
    }
    case MSG.FILO_GET_NOTIFICATIONS:
      return { ok: true, notifications: await FiloMem.listNotifications() };
    case MSG.FILO_DISMISS_NOTIFICATION: {
      const list = await FiloMem.dismissNotification(msg.id, { acted: !!msg.acted });
      broadcastLiveUpdate();
      return { ok: true, notifications: list.filter((n) => !n.dismissed) };
    }
    case 'fetch_link_meta': {
      try {
        const url = msg.url;
        if (!url) return { ok: false, error: 'url mancante' };
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const r = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
        clearTimeout(t);
        let html = '';
        const reader = r.body?.getReader?.();
        if (reader) {
          const dec = new TextDecoder('utf-8', { fatal: false });
          let total = 0;
          while (total < 65536) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            html += dec.decode(value, { stream: true });
            if (html.includes('</head>')) break;
          }
          try { reader.cancel(); } catch (_) {}
        } else {
          html = await r.text();
        }
        const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
        const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                        pick(/<title[^>]*>([^<]+)<\/title>/i);
        const ogDescription = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                              pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        return { ok: true, ogTitle, ogDescription };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    }
    default:
      return { ok: false, error: `Tipo messaggio sconosciuto: ${msg.type}` };
  }
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

module.exports = {
  handleMessage,
  handleStream,
  broadcastLiveUpdate,
  broadcastToTabs,
  handleAIRequest,
  maybeCategorizeAsync,
};
