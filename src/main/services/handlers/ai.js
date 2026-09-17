// Handler di dominio AI: richieste one-shot, sintesi vocale, prove dei modelli dalle
// Opzioni, ricerca web e raccolta dei percorsi «Aiuto».

module.exports = function register(on, ctx) {
  const {
    MSG, handleAIRequest, getEffectiveSettings, modelForAction, buildAttemptChain,
    providerRouting, openWeightsBlockReason, auditServedByLater, applyLimitToChain,
    Defaults, isAdmin, broadcastToTabs,
  } = ctx;
  const { SN_CONST } = globalThis;
  const Providers = globalThis.SN_PROVIDERS;
  const Costs = globalThis.SN_COSTS;
  const WebSearch = globalThis.SN_WEB_SEARCH;
  const PathsCollector = globalThis.SN_PATHS_COLLECTOR;

  // Cache audio in memoria: rileggere lo stesso testo con la stessa voce e lo stesso modello
  // è istantaneo invece di rifare la chiamata lenta. Dura quanto la sessione.
  const crypto = require('node:crypto');
  const ttsCache = globalThis.SN_TTS_CACHE
    ? globalThis.SN_TTS_CACHE.createTtsCache({ maxBytes: 64 * 1024 * 1024 })
    : null;
  const ttsKey = (model, voice, text) =>
    crypto.createHash('sha1').update(`${model}\u0000${voice}\u0000${text}`).digest('hex');

  // Una lettura vive nel content script della scheda dov'è partita: il main tiene il set di
  // chi legge e ribroadcast, o «Interrompi lettura» non comparirebbe nelle altre schede.
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
        // Se la scheda che legge si chiude o naviga, l'audio muore ma il «reading:false» può non
        // arrivare mai: si ripulisce qui.
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
    // Azzerato subito per reattività: il flag torna coerente al prossimo report.
    broadcastToTabs({ type: MSG.TTS_STOP });
    return { ok: true };
  });

  on(MSG.AI_REQUEST, async (msg, sender, origin) => {
    const r = await handleAIRequest({ action: msg.action, payload: msg.payload, origin });
    return { ok: true, ...r };
  });

  // L'avviso di ripiego sulla voce del browser si dà una volta per sessione e si riarma
  // appena una sintesi riesce, così a una nuova caduta l'utente è di nuovo avvisato.
  let ttsFallbackAnnounced = false;

  // Voci che il router ha dichiarato in un errore, per i modelli fuori dai cataloghi noti:
  // dalla seconda richiesta valgono come catalogo, senza pagare un altro 400.
  const learnedVoices = new Map(); // modelId → [voce, …]

  // Se il router rifiuta la voce elencando quelle ammesse si riprova UNA volta con una della
  // lingua del testo; se ne pretende una e non l'abbiamo, l'errore diventa una frase utile.
  async function synthesizeWithVoiceRecovery(P, { apiKey, model, text, voice, lang, speed, routing }) {
    const Voices = globalThis.SN_TTS_VOICES;
    try {
      return await P.synthesizeSpeech({ apiKey, model, text, voice, speed, providerRouting: routing });
    } catch (e) {
      const msg = (e && e.message) || '';
      const listed = Voices ? Voices.voicesFromError(msg) : [];
      if (listed.length) {
        learnedVoices.set(model, listed);
        const retry = Voices.pickFromList(listed, lang);
        if (retry && retry !== voice) {
          console.warn(`[SN] TTS: voce "${voice || '(nessuna)'}" rifiutata da ${model}, riprovo con "${retry}"`);
          const r = await P.synthesizeSpeech({ apiKey, model, text, voice: retry, speed, providerRouting: routing });
          r.voice = retry;
          return r;
        }
      }
      const I18n = globalThis.SN_I18N;
      if (Voices && Voices.isVoiceRequiredError(msg)) {
        const err = new Error(I18n ? I18n.t('err_tts_voice_required', model) : msg);
        err.code = 'TTS_VOICE_REQUIRED';
        throw err;
      }
      // Un nome scritto a mano rifiutato con un 400 è un refuso, non un guasto: va detto così.
      const handWritten = voice && Voices && !Voices.isKnownVoice(voice, model)
        && !(learnedVoices.get(model) || []).includes(voice);
      // Il 400 si legge dallo status o, se manca, dal testo dell'errore.
      const rifiutata = (e && e.status === 400) || /\b400\b/.test(msg);
      if (handWritten && rifiutata) {
        const err = new Error(I18n ? I18n.t('err_tts_voice_unknown', model, voice) : msg);
        err.code = 'TTS_VOICE_UNKNOWN';
        throw err;
      }
      throw e;
    }
  }

  const ttsFallback = (error, errorCode) => {
    const firstFallback = !ttsFallbackAnnounced;
    ttsFallbackAnnounced = true;
    // errorCode distingue i guasti tecnici, tradotti dal content script in una frase generica,
    // dagli errori di CONFIGURAZIONE, già scritti per l'utente e da mostrare tali e quali.
    return { ok: false, error, errorCode: errorCode || '', firstFallback };
  };

  on(MSG.TTS_SYNTH, async (msg) => {
    // Se nessun fornitore sintetizza si torna { ok:false } e il content script usa la voce del
    // browser. msg.lang è la lingua della pagina e sceglie la voce, salvo scelta in Preferenze.

    // Seam di test OPT-IN: nel CI headless non c'è né chiave né motore vocale, quindi si torna
    // PCM silenzioso. Opt-in per non alterare i test del degrado senza chiave.
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
        // Stesso limite di spesa delle altre funzioni: oltre, si legge con la voce del sistema.
        attempts = await applyLimitToChain(settings, buildAttemptChain(settings, model, SN_CONST.ACTIONS.TTS));
      } catch (e) {
        // Nessun modello di sintesi configurato: si legge col browser, ma il motivo vero passa al
        // content script, così l'avviso dice cosa manca invece di un codice interno.
        return ttsFallback(e?.message || 'no_tts_model', e?.code);
      }
      const Voices = globalThis.SN_TTS_VOICES;
      const ttsPrefs = (settings && settings.tts) || {};
      // Voce: quella delle Preferenze, altrimenti la lingua del testo, altrimenti quella dell'app.
      const chosen = String(msg.voice || ttsPrefs.modelVoice || '').trim();
      let locale = '';
      try { locale = require('electron').app.getLocale(); } catch (_) { locale = ''; }
      const lang = msg.lang || locale;
      // La velocità delle Preferenze vale anche per la voce del modello.
      const rate = Number(ttsPrefs.rate);
      const speed = rate >= 0.5 && rate <= 2 ? rate : 1;
      const text = String(msg.text == null ? '' : msg.text);
      const routing = providerRouting(settings);
      let lastErr = null;
      for (const a of attempts) {
        const P = Providers.getProvider(a.provider);
        if (!P || typeof P.synthesizeSpeech !== 'function') continue;
        // La voce dipende dal MODELLO: una scelta fatta per un altro va ignorata, non spedita,
        // o è un 400 e la lettura ripiega sul browser senza spiegazioni.
        const voice = Voices
          ? Voices.resolveVoice({ chosen, lang, modelId: a.model, learned: learnedVoices.get(a.model) })
          : chosen;
        const key = ttsCache ? ttsKey(a.model, `${voice}@${speed}`, text) : null;
        if (key) {
          const hit = ttsCache.get(key);
          if (hit) {
            ttsFallbackAnnounced = false; // sintesi disponibile: riarma l'avviso
            return {
              ok: true,
              audioBase64: hit.audioBase64,
              mimeType: hit.mimeType,
              provider: a.provider,
              model: a.model,
              cached: true,
            };
          }
        }
        try {
          const r = await synthesizeWithVoiceRecovery(P, {
            apiKey: a.apiKey, model: a.model, text, voice, lang, speed, routing,
          });
          if (key) ttsCache.set(key, { audioBase64: r.audioBase64, mimeType: r.mimeType });
          ttsFallbackAnnounced = false; // sintesi riuscita: riarma l'avviso
          // Chi ha servito e quanto è costato il router lo dice dopo: si chiede a parte, senza
          // attese.
          auditServedByLater({
            settings, action: SN_CONST.ACTIONS.TTS, provider: a.provider, model: a.model,
            apiKey: a.apiKey, generationId: r.generationId, recordCost: true,
          });
          return {
            ok: true,
            audioBase64: r.audioBase64,
            mimeType: r.mimeType,
            provider: a.provider,
            model: a.model,
          };
        } catch (e) {
          lastErr = e;
          console.warn('[SN] TTS fallito:', e.message || e);
        }
      }
      return ttsFallback((lastErr && lastErr.message) || 'tts_failed', lastErr && lastErr.code);
    } catch (e) {
      return ttsFallback(e?.message || String(e));
    }
  });

  // Per la tendina delle Preferenze: quale modello legge, il suo catalogo per lingua e la
  // voce scelta. `chosen` torna anche fuori catalogo: è scritta a mano e va mostrata.
  on(MSG.TTS_VOICES, async () => {
    const Voices = globalThis.SN_TTS_VOICES;
    let model = '';
    try {
      const settings = await getEffectiveSettings();
      const ref = modelForAction(settings, SN_CONST.ACTIONS.TTS);
      const attempts = buildAttemptChain(settings, ref, SN_CONST.ACTIONS.TTS);
      model = (attempts[0] && attempts[0].model) || '';
    } catch (e) {
      // Nessun modello di lettura: la pagina lo dice invece di fingere che uno scelga da sé.
      return { ok: true, model: '', catalog: '', required: true, groups: [], error: e?.message || String(e) };
    }
    const cat = Voices ? Voices.catalogFor(model) : null;
    let groups = cat ? Voices.groupedByLang(model) : [];
    if (!cat && learnedVoices.has(model)) {
      // Catalogo imparato dal router: nomi nudi, con una lingua solo se il nome la dichiara.
      const list = learnedVoices.get(model);
      const byLang = new Map();
      for (const id of list) {
        const m = /(?:^|-)([a-z]{2})(?:-|$)/i.exec(id);
        const l = m ? m[1].toLowerCase() : '';
        if (!byLang.has(l)) byLang.set(l, []);
        byLang.get(l).push({ id, lang: l, label: id });
      }
      groups = [...byLang.entries()].map(([lang, voices]) => ({
        lang, label: (Voices.LANG_LABELS[lang] || lang || 'voci'), voices,
      }));
    }
    return {
      ok: true,
      model,
      catalog: cat ? cat.id : '',
      catalogName: cat ? cat.name : '',
      required: cat ? cat.required !== false : !learnedVoices.has(model),
      groups,
    };
  });

  // Qui NON si passa da buildAttemptChain: quella scarta i fornitori senza chiave salvata,
  // che è il caso della prova, dove la chiave si sta digitando e arriva nel messaggio.
  async function testModelFor(provider, settings) {
    const s = settings || await getEffectiveSettings();
    const action = SN_CONST.ACTIONS.PROVIDER_TEST;
    const registry = s.modelRegistry || {};
    let refs = SN_CONST.parseModelRefs(modelForAction(s, action));
    // A interruttore acceso la prova parte sull'equivalente aperto, come le richieste vere.
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
      // Stesso cancello della politica di ogni richiesta (vedi openWeightsBlockReason). Il
      // fornitore si controlla prima del modello: se non può servire, il modello non conta.
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
      const modelBlocked = openWeightsBlockReason(s, { provider, model });
      if (modelBlocked) return { ok: false, error: modelBlocked };
      // Un modello non di testo (voce, dettatura, indicizzazione) si prova nel suo mestiere.
      const kind = modelKind(provider, model, (s.modelRegistry || {})[msg.nickname] || null);
      if (kind !== 'text') {
        return await probeNonText({ kind, provider, apiKey, model, routing: providerRouting(s), nickname: msg.nickname || '' });
      }
      const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
      const startMs = performance.now();
      let firstTokenMs = null;
      let charCount = 0;
      const result = await Providers.streamComplete({
        provider, apiKey, model, messages,
        providerRouting: providerRouting(s),
        onDelta: (delta) => {
          if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
          charCount += (delta || '').length;
        },
      });
      const totalMs = performance.now() - startMs;
      // Stream concluso senza contenuto (capita su certi endpoint gratuiti): per l'utente il
      // modello non funziona, quindi è un errore, non un OK.
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

  // Schema { provider, model } o duale: stessa logica delle pagine Opzioni e admin.
  function registryEntryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Il mestiere decide COME provare un modello: provarli tutti con una chat fallirebbe su
  // tre mestieri su quattro.
  function modelKind(provider, model, entry) {
    const Caps = globalThis.SN_MODEL_CAPS;
    if (!Caps) return 'text';
    const meta = SN_CONST.entryModalities ? SN_CONST.entryModalities(entry || {}, '') : null;
    const caps = Caps.capabilitiesFor(provider, model, meta || undefined);
    if (caps.outputs.includes('embedding')) return 'embedding';
    if (caps.outputs.includes('audio')) return 'tts';
    if (!caps.uncertain && caps.inputs.includes('audio') && !caps.inputs.includes('image')) return 'stt';
    return 'text';
  }

  async function probeNonText({ kind, provider, apiKey, model, routing, nickname }) {
    const P = Providers.getProvider(provider);
    const startMs = performance.now();
    const done = (extra) => ({
      ok: true, provider, model, nickname, kind,
      ttftMs: Math.round(performance.now() - startMs),
      totalMs: Math.round(performance.now() - startMs),
      completionTokens: null, tokensPerSec: null,
      ...extra,
    });
    if (kind === 'tts') {
      if (typeof P.synthesizeSpeech !== 'function') return { ok: false, error: 'Questo fornitore non sa leggere ad alta voce' };
      // La frase di prova è italiana: si prende la voce italiana del catalogo, se ce n'è una.
      const Voices = globalThis.SN_TTS_VOICES;
      const voice = Voices ? Voices.resolveVoice({ chosen: '', lang: 'it', modelId: model, learned: learnedVoices.get(model) }) : '';
      const r = await synthesizeWithVoiceRecovery(P, { apiKey, model, text: 'Uno, due, tre: prova della voce.', voice, lang: 'it', speed: 1, routing });
      if (!r || !r.audioBase64) return { ok: false, error: 'Il modello ha risposto senza audio' };
      return done({ audioBytes: Math.round(r.audioBase64.length * 3 / 4) });
    }
    if (kind === 'embedding') {
      if (typeof P.embed !== 'function') return { ok: false, error: 'Questo fornitore non sa indicizzare' };
      const r = await P.embed({ apiKey, model, texts: ['prova'], dim: SN_CONST.EMBED_DIM, providerRouting: routing });
      const v = r && r.vectors && r.vectors[0];
      if (!v || !v.length) return { ok: false, error: 'Il modello ha risposto senza vettori' };
      return done({ dims: v.length });
    }
    if (kind === 'stt') {
      if (typeof P.transcribe !== 'function') return { ok: false, error: 'Questo fornitore non sa trascrivere' };
      const Seg = globalThis.SN_DICTATION_SEGMENTER;
      const wav = Seg.pcm16ToWav(new Int16Array(16000), 16000); // un secondo di silenzio
      const r = await P.transcribe({ apiKey, model, audioBase64: Seg.bytesToBase64(wav), format: 'wav', providerRouting: routing });
      if (!r || typeof r.text !== 'string') return { ok: false, error: 'Il modello non ha risposto' };
      return done({});
    }
    return { ok: false, error: 'Tipo di modello non riconosciuto' };
  }

  // Stessa precedenza di withDefaults: prima la chiave predefinita (build o override admin),
  // poi la personale come ripiego; qui si provano i modelli PREDEFINITI.
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
        // La riga si prova com'è scritta, anche non salvata: spende le chiavi predefinite su un
        // modello arbitrario, quindi è riservata agli amministratori.
        if (!isAdmin()) {
          return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
        }
        provider = 'openrouter';
        modelId = explicitModel;
      } else {
        // Il nickname si risolve nel registry PREDEFINITO, non nei settings personali: deve
        // trovarsi anche quando l'utente gestisce i propri modelli.
        if (!nickname) return { ok: false, error: 'Nickname mancante' };
        // Se un nickname non c'è più, «Prova» deve dirlo invece di provare un modello del codice.
        const registry = d.modelRegistry || {};
        const entry = registry[nickname];
        if (!entry) return { ok: false, error: `Modello "${nickname}" non trovato` };
        regEntry = entry;
        const single = registryEntryToSingle(entry);
        provider = single.provider || 'openrouter';
        modelId = single.model || '';
        if (!modelId) return { ok: false, error: 'Stringa modello vuota' };
      }
      // Prove pagate con le chiavi predefinite: stesso cancello (vedi openWeightsBlockReason).
      const eff = await getEffectiveSettings();
      // Si passa la voce intera: se l'owner ha classificato a mano quel modello come aperto,
      // la prova lo rispetta come fanno le richieste vere.
      const blocked = openWeightsBlockReason(eff, { ...(regEntry || {}), provider, model: modelId });
      if (blocked) return { ok: false, error: blocked };
      const apiKey = await defaultKeyFor(provider, d);
      if (!apiKey) return { ok: false, error: `Chiave ${provider} non configurata` };
      const model = modelId;
      const kind = modelKind(provider, model, regEntry);
      if (kind !== 'text') {
        return await probeNonText({ kind, provider, apiKey, model, routing: providerRouting(eff), nickname });
      }
      const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
      const startMs = performance.now();
      let firstTokenMs = null;
      let charCount = 0;
      const result = await Providers.streamComplete({
        provider, apiKey, model, messages,
        providerRouting: providerRouting(eff),
        onDelta: (delta) => {
          if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
          charCount += (delta || '').length;
        },
      });
      const totalMs = performance.now() - startMs;
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

  // La pagina admin non vede mai le chiavi vere, quindi il catalogo lo recupera il main.
  // Solo metadati, nessuna inferenza; torna { id, label } ordinati dal più recente.
  on(MSG.DEFAULT_MODELS_LIST, async (msg) => {
    try {
      if (!isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      const provider = 'openrouter';
      try { await Defaults.refreshIfStale(); } catch (_) {}
      const apiKey = await defaultKeyFor(provider, Defaults.get());
      // Il catalogo OpenRouter è pubblico: la chiave è facoltativa. La lista semplice ha solo
      // i modelli di testo; voce, dettatura e indicizzazione si chiedono per modalità.
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const queries = ['', '?output_modalities=speech', '?output_modalities=transcription', '?output_modalities=embeddings'];
      const lists = await Promise.all(queries.map(async (q) => {
        const res = await fetch('https://openrouter.ai/api/v1/models' + q, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data.data || []).map((m) => ({ id: m.id, meta: m })).filter((it) => it.id);
      }));
      const raw = lists.flat();
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

  // Non ha potere: dice solo, su un indirizzo che chi chiede ha già davanti, se una risposta
  // servirebbe a qualcosa. Risponde la stessa porta della raccolta (#584).
  on(MSG.PATH_COLLECTABLE, async (msg) => {
    try {
      const r = await PathsCollector.raccoglibile(msg?.payload?.url);
      return { ok: true, raccoglibile: !!r.ok, reason: r.reason || '' };
    } catch (e) {
      // Nel dubbio non si promette niente: meglio non chiedere che chiedere per niente.
      return { ok: true, raccoglibile: false, reason: e?.message || String(e) };
    }
  });

  on(MSG.SAVE_PATH, async (msg, sender, origin) => {
    (async () => {
      try {
        const settings = await getEffectiveSettings();
        if (!settings.apiKeys?.[settings.provider]) return;
        // Niente user agent né identificativi del mittente (#584): bastavano a rimettere insieme
        // i percorsi della stessa installazione. L'identità per i limiti si prende all'invio.
        const invokeAI = ({ action, payload }) => handleAIRequest({ action, payload, origin });
        const r = await PathsCollector.collectAndSave({ session: msg.payload?.session, invokeAI });
        if (r?.saved) console.info('[Filo] percorso in coda:', r.id, r.intent);
      } catch (e) { console.warn('[Filo] save_path failed', e); }
    })();
    return { ok: true };
  });
};
