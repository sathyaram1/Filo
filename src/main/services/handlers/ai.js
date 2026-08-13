// Handler di dominio: richieste AI one-shot, sintesi vocale, test dei
// provider/modelli dalle Opzioni, ricerca web e raccolta dei path "Aiuto".

module.exports = function register(on, ctx) {
  const {
    MSG, handleAIRequest, getEffectiveSettings, modelForAction, buildAttemptChain,
    providerRouting, openWeightsBlockReason,
    Defaults, isAdmin, broadcastToTabs,
  } = ctx;
  const { SN_CONST } = globalThis;
  const Providers = globalThis.SN_PROVIDERS;
  const WebSearch = globalThis.SN_WEB_SEARCH;
  const PathsCollector = globalThis.SN_PATHS_COLLECTOR;

  // Cache in-memoria dell'audio TTS: rileggere lo stesso testo (stessa voce,
  // stesso modello) torna istantaneo invece di rifare la chiamata lenta al
  // modello. Vive per tutta la sessione dell'app. Vedi src/shared/ttsCache.js.
  const crypto = require('node:crypto');
  const ttsCache = globalThis.SN_TTS_CACHE
    ? globalThis.SN_TTS_CACHE.createTtsCache({ maxBytes: 64 * 1024 * 1024 })
    : null;
  const ttsKey = (model, voice, text) =>
    crypto.createHash('sha1').update(`${model}\u0000${voice}\u0000${text}`).digest('hex');

  // ─── Stato globale "sta leggendo" (TTS) ───────────────────────────────────
  // Una lettura ad alta voce vive nel content script della scheda dove è partita
  // (l'<audio> suona lì). Perché "Interrompi lettura" compaia anche nei menu
  // delle ALTRE schede, il main fa da fonte di verità condivisa: ogni scheda che
  // legge segnala reading:true/false, il main tiene il set delle schede che
  // leggono e ribroadcast TTS_GLOBAL_READING { active } a tutte. Lo stop globale
  // (TTS_STOP_READING) viene inoltrato come TTS_STOP a tutte le schede: solo
  // quella che legge davvero ha qualcosa da fermare.
  const readingWcs = new Set();      // id dei webContents attualmente in lettura
  const readingCleanups = new Map(); // id → funzione che stacca i listener
  let lastGlobalReading = false;
  function broadcastGlobalReading() {
    const active = readingWcs.size > 0;
    if (active === lastGlobalReading) return;
    lastGlobalReading = active;
    broadcastToTabs({ type: MSG.TTS_GLOBAL_READING, active });
  }
  function clearReading(wcId) {
    if (!readingWcs.has(wcId)) return;
    readingWcs.delete(wcId);
    const cleanup = readingCleanups.get(wcId);
    if (cleanup) { readingCleanups.delete(wcId); try { cleanup(); } catch (_) {} }
    broadcastGlobalReading();
  }
  function markReading(wc, reading) {
    if (!wc || typeof wc.id !== 'number') return;
    const id = wc.id;
    if (reading) {
      if (!readingWcs.has(id)) {
        readingWcs.add(id);
        // Se la scheda che legge viene chiusa o naviga altrove, l'<audio> muore
        // ma il "reading:false" potrebbe non arrivare mai: ripuliamo noi.
        const onNav = (_e, _url, isInPlace, isMainFrame) => { if (isMainFrame) clearReading(id); };
        const onGone = () => clearReading(id);
        try { wc.on('did-start-navigation', onNav); } catch (_) {}
        try { wc.once('destroyed', onGone); } catch (_) {}
        readingCleanups.set(id, () => {
          try { wc.removeListener('did-start-navigation', onNav); } catch (_) {}
          try { wc.removeListener('destroyed', onGone); } catch (_) {}
        });
      }
      broadcastGlobalReading();
    } else {
      clearReading(id);
    }
  }

  on(MSG.TTS_READING_STATE, async (msg, sender) => {
    markReading(sender && sender.wc, !!(msg && msg.reading));
    return { ok: true };
  });

  on(MSG.TTS_READING_STATUS, async () => {
    return { ok: true, active: readingWcs.size > 0 };
  });

  on(MSG.TTS_STOP_READING, async () => {
    // Inoltra lo stop a tutte le schede; quella che legge si ferma e poi segnala
    // reading:false (che azzera lo stato globale). Azzeriamo anche subito qui per
    // reattività: il flag tornerà comunque coerente al prossimo report.
    broadcastToTabs({ type: MSG.TTS_STOP });
    return { ok: true };
  });

  on(MSG.AI_REQUEST, async (msg, sender, origin) => {
    const r = await handleAIRequest({ action: msg.action, payload: msg.payload, origin });
    return { ok: true, ...r };
  });

  // Dedup dell'avviso "lettura a modello non disponibile → voce del browser":
  // lo segnaliamo al content script (firstFallback:true) solo la PRIMA volta che
  // ripieghiamo in una sessione dell'app. Torna false appena una sintesi riesce,
  // così se il modello torna a funzionare e poi ricasca l'utente è di nuovo avvisato.
  let ttsFallbackAnnounced = false;
  const ttsFallback = (error, errorCode) => {
    const firstFallback = !ttsFallbackAnnounced;
    ttsFallbackAnnounced = true;
    // `errorCode` distingue i guasti tecnici (che il content script traduce in
    // una frase generica) dagli errori di CONFIGURAZIONE dei modelli, il cui
    // messaggio è già scritto per l'utente e va mostrato tale e quale.
    return { ok: false, error, errorCode: errorCode || '', firstFallback };
  };

  on(MSG.TTS_SYNTH, async (msg) => {
    // Sintesi vocale via modello. Costruisce la catena per l'azione TTS e
    // prova i provider che la implementano (oggi: Gemini). Se nessuno è
    // disponibile o tutti falliscono, torna { ok:false } e il content script
    // ripiega sulla voce del browser (Web Speech).

    // Seam di test OPT-IN: nel CI headless non esiste né una chiave Gemini né un
    // motore vocale del sistema, quindi nessuna lettura potrebbe mai partire
    // davvero. Quando un test attiva esplicitamente `globalThis.__filoTestTtsCanned`
    // (via app.evaluate), ritorniamo qualche secondo di PCM silenzioso così il
    // content script riproduce un <audio> reale e lo stato "sta leggendo"
    // (ttsBusy) diventa verificabile in modo deterministico. È OPT-IN per non
    // alterare i test che verificano il degrado senza chiave (fallback voce
    // browser): quelli non settano il flag e ricevono { ok:false } come in prod.
    if (process.env.NODE_ENV === 'test' && globalThis.__filoTestTtsCanned) {
      const rate = 8000, seconds = 6;
      const audioBase64 = Buffer.alloc(rate * seconds * 2).toString('base64'); // PCM16 mono
      return { ok: true, audioBase64, mimeType: `audio/L16;rate=${rate}`, provider: 'test', model: 'test-tts' };
    }

    try {
      const settings = await getEffectiveSettings();
      const model = modelForAction(settings, SN_CONST.ACTIONS.TTS);
      let attempts;
      try {
        attempts = buildAttemptChain(settings, model, SN_CONST.ACTIONS.TTS);
      } catch (e) {
        // Nessun modello di sintesi vocale configurato (o la scorciatoia citata
        // non esiste): si legge con la voce del browser, ma il motivo VERO viene
        // passato al content script così l'avviso dice cosa manca invece di un
        // codice interno.
        return ttsFallback(e?.message || 'no_tts_model', e?.code);
      }
      const voice = (settings && settings.tts && settings.tts.modelVoice) || '';
      const text = String(msg.text == null ? '' : msg.text);
      let lastErr = null;
      for (const a of attempts) {
        // Solo Gemini implementa synthesizeSpeech; gli altri si saltano.
        if (a.provider !== 'gemini') continue;
        // Cache hit: stesso testo+voce+modello già sintetizzato in questa
        // sessione → ritorno immediato, niente chiamata al modello.
        const key = ttsCache ? ttsKey(a.model, voice, text) : null;
        if (key) {
          const hit = ttsCache.get(key);
          if (hit) {
            ttsFallbackAnnounced = false; // sintesi disponibile: riarma l'avviso
            return {
              ok: true,
              audioBase64: hit.audioBase64,
              mimeType: hit.mimeType,
              provider: 'gemini',
              model: a.model,
              cached: true,
            };
          }
        }
        try {
          const r = await Providers.getProvider('gemini').synthesizeSpeech({
            apiKey: a.apiKey, model: a.model, text, voice,
          });
          if (key) ttsCache.set(key, { audioBase64: r.audioBase64, mimeType: r.mimeType });
          ttsFallbackAnnounced = false; // sintesi riuscita: riarma l'avviso
          return {
            ok: true,
            audioBase64: r.audioBase64,
            mimeType: r.mimeType,
            provider: 'gemini',
            model: a.model,
          };
        } catch (e) {
          lastErr = e;
          console.warn('[SN] TTS gemini fallito:', e.message || e);
        }
      }
      return ttsFallback((lastErr && lastErr.message) || 'tts_failed');
    } catch (e) {
      return ttsFallback(e?.message || String(e));
    }
  });

  // Modello con cui provare un fornitore quando la prova non ne indica uno
  // (pulsante «Prova» accanto alla chiave). Prima era un nome scritto qui: si
  // finiva per provare un modello che magari nessuno usa, e nessuno poteva
  // cambiarlo. Ora è la funzione «Prova di un fornitore», impostabile come
  // tutte le altre; della sua catena si prende il primo modello servito dal
  // fornitore in prova.
  // NB: qui NON si passa da buildAttemptChain. Quella scarta i modelli dei
  // fornitori senza chiave salvata — che è esattamente il caso della prova: la
  // chiave si sta ancora digitando e arriva nel messaggio, non dalle
  // impostazioni. Risolviamo quindi il nickname direttamente sul registro
  // configurato, che resta l'unica sorgente del modello.
  async function testModelFor(provider, settings) {
    const s = settings || await getEffectiveSettings();
    const action = SN_CONST.ACTIONS.PROVIDER_TEST;
    const registry = s.modelRegistry || {};
    let refs = SN_CONST.parseModelRefs(modelForAction(s, action));
    // Stessa potatura delle richieste vere: a interruttore acceso la prova parte
    // sull'equivalente a pesi aperti, non sul modello proprietario che quella
    // funzione userebbe altrimenti.
    if (s.openWeightsOnly === true) {
      refs = SN_CONST.applyOpenWeightsPolicy(refs, registry, action).refs;
    }
    for (const ref of refs) {
      const concrete = SN_CONST.resolveModel(ref, provider, registry);
      if (concrete) return concrete;
    }
    return '';
  }

  on(MSG.TEST_PROVIDER, async (msg) => {
    try {
      const provider = msg.provider;
      const apiKey = (msg.apiKey || '').trim();
      // "Solo modelli a pesi aperti" (#461): la prova è una chiamata VERA, quindi
      // passa dallo stesso cancello delle funzioni. Il fornitore si controlla
      // prima del modello: chiedergli quale modello proverebbe non ha senso se
      // comunque non può essere interrogato.
      const s = await getEffectiveSettings();
      if (s.openWeightsOnly === true && SN_CONST.PRODUCER_DIRECT_PROVIDERS.includes(provider)) {
        return { ok: false, error: openWeightsBlockReason(s, { provider }) };
      }
      const model = (msg.model || '').trim() || await testModelFor(provider, s);
      if (!model) {
        return {
          ok: false,
          error: `Nessun modello ${provider} impostato per la prova: scegline uno in «Prova di un fornitore», fra le funzioni delle Opzioni.`,
        };
      }
      if (!apiKey) return { ok: false, error: 'API key mancante' };
      // Modello indicato dalla riga (registry personale): se è proprietario la
      // prova non parte, altrimenti l'unica richiesta che l'interruttore non
      // ferma sarebbe proprio quella che si lancia dalla pagina dove lo si
      // accende.
      const modelBlocked = openWeightsBlockReason(s, { provider, model });
      if (modelBlocked) return { ok: false, error: modelBlocked };
      const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
      const startMs = performance.now();
      let firstTokenMs = null;
      let charCount = 0;
      const result = await Providers.streamComplete({
        provider, apiKey, model, messages,
        // Anche la prova porta con sé chi NON deve servirla: senza, sarebbe
        // l'unica richiesta di Filo che un fornitore escluso può servire.
        providerRouting: providerRouting(s),
        onDelta: (delta) => {
          if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
          charCount += (delta || '').length;
        },
      });
      const totalMs = performance.now() - startMs;
      // Stream concluso senza alcun contenuto (capita ad alcuni endpoint
      // gratuiti): per l'utente il modello NON funziona, quindi è un errore,
      // non un "OK — null ms".
      if (charCount === 0) return { ok: false, error: 'Il modello ha risposto vuoto' };
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
  });

  // Normalizza una entry del registry (nuovo schema { provider, model } o
  // vecchio duale { gemini, openrouter }) in { provider, model } — stessa
  // logica delle pagine Opzioni/admin.
  function registryEntryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.gemini) return { provider: 'gemini', model: e.gemini };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Chiave per il provider con la stessa precedenza di withDefaults: prima la
  // predefinita (build/override admin via Firestore), poi quella personale
  // dell'utente come fallback — indipendentemente da useDefaultModels, perché
  // qui si testano i modelli PREDEFINITI.
  async function defaultKeyFor(provider, d) {
    const fromDefaults = ((d && d.apiKeys) || {})[provider] || '';
    if (fromDefaults) return fromDefaults;
    const eff = await getEffectiveSettings();
    return (eff.apiKeys || {})[provider] || '';
  }

  on(MSG.TEST_DEFAULT_MODEL, async (msg) => {
    try {
      const nickname = (msg.nickname || '').trim();
      const explicitModel = (msg.model || '').trim();
      try { await Defaults.refreshIfStale(); } catch (_) {}
      const d = Defaults.get();
      let provider; let modelId; let regEntry = null;
      if (explicitModel) {
        // Riga dell'editor admin, testata così com'è scritta (anche non ancora
        // salvata). Spende le chiavi predefinite su un modello arbitrario →
        // riservato agli amministratori.
        if (!isAdmin()) {
          return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
        }
        provider = msg.provider === 'gemini' ? 'gemini' : 'openrouter';
        modelId = explicitModel;
      } else {
        // Lista read-only delle Opzioni: risolve il nickname nel registry
        // PREDEFINITO (costanti + override Firestore), non nei settings
        // personali — il nickname di un default deve trovarsi anche se
        // l'utente gestisce i propri modelli (useDefaultModels OFF).
        if (!nickname) return { ok: false, error: 'Nickname mancante' };
        // Solo il registry PREDEFINITO effettivo: se un nickname non c'è più, il
        // tasto "Prova" deve dirlo, non provare un modello scritto nel codice.
        const registry = d.modelRegistry || {};
        const entry = registry[nickname];
        if (!entry) return { ok: false, error: `Modello "${nickname}" non trovato` };
        regEntry = entry;
        const single = registryEntryToSingle(entry);
        provider = single.provider || 'openrouter';
        modelId = single.model || '';
        if (!modelId) return { ok: false, error: 'Stringa modello vuota' };
      }
      // "Solo modelli a pesi aperti" (#461). Queste righe sono i modelli che
      // Filo userebbe: provarne uno è una richiesta vera, pagata con le chiavi
      // predefinite. Con l'interruttore acceso quelle proprietarie non partono —
      // altrimenti la pagina dove si accende l'interruttore sarebbe l'unico
      // posto da cui l'interruttore si può scavalcare.
      const eff = await getEffectiveSettings();
      // La voce intera, non solo fornitore+stringa: se l'owner ha classificato a
      // mano quel modello come a pesi aperti, la prova lo rispetta come lo
      // rispettano le richieste vere.
      const blocked = openWeightsBlockReason(eff, { ...(regEntry || {}), provider, model: modelId });
      if (blocked) return { ok: false, error: blocked };
      const apiKey = await defaultKeyFor(provider, d);
      if (!apiKey) return { ok: false, error: `Chiave ${provider} non configurata` };
      // Il provider Gemini ora accetta i nomi nativi (es. gemini-3.1-flash-lite),
      // quindi il modello del registry va passato così com'è: stesso percorso
      // dell'uso reale (prima qui si anteponeva "google/" e l'uso reale no →
      // il "Prova" passava ma la feature falliva).
      const model = modelId;
      const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
      const startMs = performance.now();
      let firstTokenMs = null;
      let charCount = 0;
      const result = await Providers.streamComplete({
        provider, apiKey, model, messages,
        // Come per le richieste vere: chi è escluso non serve nemmeno una prova.
        providerRouting: providerRouting(eff),
        onDelta: (delta) => {
          if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
          charCount += (delta || '').length;
        },
      });
      const totalMs = performance.now() - startMs;
      // Come in TEST_PROVIDER: stream vuoto = modello inutilizzabile = errore.
      if (charCount === 0) return { ok: false, error: 'Il modello ha risposto vuoto' };
      const tokens = (result?.usage?.completionTokens) || Math.max(1, Math.round(charCount / 4));
      const tps = tokens > 0 && totalMs > 0 ? (tokens / (totalMs / 1000)) : 0;
      return {
        ok: true, provider, model: modelId, nickname,
        ttftMs: firstTokenMs != null ? Math.round(firstTokenMs) : null,
        totalMs: Math.round(totalMs), completionTokens: tokens,
        tokensPerSec: Math.round(tps * 10) / 10,
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Catalogo modelli di un provider, recuperato dal main con le chiavi
  // predefinite: la pagina admin non vede mai le chiavi vere, quindi non può
  // interrogare le API da sola (a differenza delle Opzioni, che usano le
  // chiavi dell'utente). Solo metadati, nessuna inferenza. Ritorna
  // { ok, items: [{ id, label }] } già ordinati dal più recente e con
  // l'etichetta di categoria (Testo / Multimodale / Sintesi vocale / …).
  on(MSG.DEFAULT_MODELS_LIST, async (msg) => {
    try {
      if (!isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      const provider = msg.provider === 'gemini' ? 'gemini' : 'openrouter';
      try { await Defaults.refreshIfStale(); } catch (_) {}
      const apiKey = await defaultKeyFor(provider, Defaults.get());
      let raw;
      if (provider === 'gemini') {
        // Il catalogo Gemini richiede la chiave (gratuita: solo metadati).
        if (!apiKey) return { ok: false, error: 'Chiave gemini non configurata' };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        raw = (data.models || [])
          .map((m) => ({ id: (m.name || '').replace(/^models\//, ''), meta: m }))
          .filter((it) => it.id);
      } else {
        // Il catalogo OpenRouter è pubblico: la chiave è facoltativa.
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        raw = (data.data || []).map((m) => ({ id: m.id, meta: m })).filter((it) => it.id);
      }
      const Caps = globalThis.SN_MODEL_CAPS;
      const items = Caps.sortByRecency(raw.map((it) => ({ ...it, provider })))
        .map((it) => ({ id: it.id, label: Caps.categoryLabel(provider, it.id, it.meta) }));
      return { ok: true, provider, items };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.WEB_SEARCH, async (msg) => {
    try {
      const settings = await getEffectiveSettings();
      const tavilyKey = settings.apiKeys?.tavily || '';
      const r = await WebSearch.search({ query: msg.query, tavilyKey, maxResults: 5 });
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message || String(e), results: [] };
    }
  });

  on(MSG.SAVE_PATH, async (msg, sender, origin) => {
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
  });
};
