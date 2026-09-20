// Provider OpenRouter — client minimale con supporto streaming SSE.
//
// Oltre alle chat, dal router passano anche le tre funzioni che prima avevano
// bisogno dell'API diretta di un produttore: lettura ad alta voce
// (/audio/speech), dettatura (/audio/transcriptions) e indicizzazione
// (/embeddings). Stessa chiave, stessa lista di esclusione dei fornitori, e —
// dove il router non lo dice nella risposta — lo stesso riscontro su chi ha
// davvero servito, chiesto a posteriori (lookupServedBy).

(function (global) {
  'use strict';

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
  const SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
  const TRANSCRIPTIONS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions';
  const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';
  const GENERATION_ENDPOINT = 'https://openrouter.ai/api/v1/generation';
  const AUTH_KEY_ENDPOINT = 'https://openrouter.ai/api/v1/auth/key';
  const CREDITS_ENDPOINT = 'https://openrouter.ai/api/v1/credits';

  function buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter raccomanda questi header (opzionali ma utili per rate limit fairness)
      'HTTP-Referer': 'https://filo.local',
      'X-Title': 'Filo',
    };
  }

  // Il punto unico in cui la chiave entra in una chiamata (#629). Ogni
  // funzione qui sotto passa di qua, così il ripiego vale per tutte: chat,
  // spiega, traduci, voce, dettatura, vettori. Se OpenRouter rifiuta la
  // CHIAVE (401, 402, 403) e chi tiene le chiavi (SN_WALLET_MAIN, nel main)
  // ne conosce una di riserva per quella con cui si è partiti — la chiave
  // personale del portafoglio, quando la chiamata era partita con la chiave
  // scritta dall'utente — si rifà subito la stessa richiesta con la riserva,
  // nella stessa risposta. Rete, 429, 5xx e gli errori di modello non
  // c'entrano con la chiave e non passano di qui. Torna la risposta da
  // leggere più:
  //   keyUsed    la chiave che ha servito davvero (per le letture a posteriori,
  //              che vogliono la stessa chiave della generazione);
  //   keySource  'own' | 'personal' | 'factory' | '' — chi la registra decide
  //              da qui se la riga d'uso va scritta;
  //   keyFallback { status } se il ripiego è avvenuto, altrimenti null.
  // Se anche la riserva rifiuta, l'errore che risale è il SUO (con la
  // personale un 402 sono i crediti finiti), e il rifiuto della chiave
  // propria resta comunque registrato: la pagina Crediti lo mostra.
  async function fetchWithKey(url, apiKey, makeInit) {
    let res = await fetch(url, makeInit(apiKey));
    let keyUsed = apiKey;
    let keyFallback = null;
    const W = global.SN_WALLET;
    const K = global.SN_WALLET_MAIN;
    if (!res.ok && W && W.isKeyRefusalStatus(res.status) && K && typeof K.alternativeKeyFor === 'function') {
      // Un 403 è un rifiuto della chiave solo se il corpo non parla di
      // moderazione: un testo segnalato lo è con qualunque chiave, e la
      // risposta deve risalire com'è (il corpo resta da leggere per chi la
      // racconta all'utente).
      const detail = (await res.clone().text().catch(() => '')).slice(0, 300);
      let alt = null;
      if (W.isKeyRefusal(res.status, detail)) {
        try { alt = await K.alternativeKeyFor(apiKey); } catch (_) { alt = null; }
      }
      if (alt && alt.key) {
        const refused = { status: res.status, detail };
        try { await K.noteOwnKeyRefusal(refused); } catch (_) {}
        res = await fetch(url, makeInit(alt.key));
        keyUsed = alt.key;
        keyFallback = { status: refused.status, from: 'own', to: alt.source || 'personal' };
        if (!res.ok) keyFallback.failed = res.status;
      }
    }
    let keySource = '';
    if (K && typeof K.keySourceOf === 'function') {
      try { keySource = await K.keySourceOf(keyUsed); } catch (_) { keySource = ''; }
    }
    // La chiave propria ha appena servito una chiamata: il rifiuto ricordato
    // in Crediti (se c'era) non vale più, e spesa e residuo sono cambiati.
    if (res.ok && keySource === 'own' && K && typeof K.noteOwnKeySuccess === 'function') {
      try { K.noteOwnKeySuccess().catch(() => {}); } catch (_) {}
    }
    // Anche sulla risposta: così l'errore che httpError costruisce da un
    // rifiuto sa con quale chiave si era partiti e se il ripiego c'è stato
    // (e ha fallito), e chi lo racconta all'utente può dirlo per esteso.
    try { res.keySource = keySource; res.keyFallback = keyFallback; } catch (_) {}
    return { res, keyUsed, keySource, keyFallback };
  }

  // Traduce il livello di reasoning scelto dall'owner (#369) nel campo
  // `reasoning` che OpenRouter capisce. `wantThoughts` = il caller vuole anche i
  // token di ragionamento in streaming (onReasoning). Ritorna null se non c'è
  // nulla da chiedere (auto senza streaming = comportamento di prima).
  //   - 'off'  → { enabled: false }         (chiede al modello di non ragionare)
  //   - low/medium/high → { effort: <lvl> } (sforzo esplicito, quando supportato)
  // I modelli che non ragionano ignorano il campo: è best-effort.
  function reasoningField(level, wantThoughts) {
    if (level === 'off') return { enabled: false };
    const out = {};
    if (level === 'low' || level === 'medium' || level === 'high') out.effort = level;
    if (wantThoughts) out.enabled = true;
    return Object.keys(out).length ? out : null;
  }

  // Blocco `provider` per il routing (politica sui fornitori, #421). OpenRouter
  // di suo sceglie l'host col prezzo migliore, che può essere il produttore del
  // modello — escluso dalla politica di Filo. Con `ignore` gli diciamo quali NON
  // usare (forme base dei produttori); se dopo l'esclusione non resta nessun host
  // ammesso OpenRouter risponde con un errore, che risale come un normale errore
  // provider: la richiesta FALLISCE in modo evidente invece di passare da un host
  // escluso. `sort` sceglie l'ordine fra gli ammessi (latency/throughput) invece
  // del prezzo. Non tocchiamo `allow_fallbacks`: vogliamo che, fra gli host
  // AMMESSI, il ripiego automatico resti attivo.
  function providerBlock(routing) {
    if (!routing || typeof routing !== 'object') return null;
    const p = {};
    const ignore = Array.isArray(routing.ignore) ? routing.ignore.filter(Boolean) : [];
    if (ignore.length) p.ignore = ignore;
    if (routing.sort === 'latency' || routing.sort === 'throughput' || routing.sort === 'price') {
      p.sort = routing.sort;
    }
    if (routing.allowFallbacks === false) p.allow_fallbacks = false;
    // Con gli strumenti (tool calling) in richiesta, solo gli host che li
    // supportano davvero: senza questo il router può passare a un host che
    // ignora `tools` in silenzio, e il modello risponde a parole invece di agire.
    if (routing.requireParameters === true) p.require_parameters = true;
    return Object.keys(p).length ? p : null;
  }

  // Le definizioni degli strumenti nel corpo della richiesta, se ci sono.
  // `toolChoice` ('auto' | 'none' | 'required') è facoltativo.
  function toolsFields(tools, toolChoice) {
    const out = {};
    if (Array.isArray(tools) && tools.length) {
      out.tools = tools;
      if (toolChoice) out.tool_choice = toolChoice;
    }
    return out;
  }

  // Le chiamate agli strumenti di una risposta NON in streaming, nella forma
  // piatta che usa il resto di Filo: { id, name, arguments (stringa JSON) }.
  function flatToolCalls(list) {
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || !c.function) continue;
      out.push({
        id: String(c.id || ''),
        name: String(c.function.name || ''),
        arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}),
      });
    }
    return out;
  }

  // In streaming le chiamate arrivano a pezzi: un delta porta l'indice, i
  // primi anche id e nome, gli altri frammenti degli argomenti da accodare.
  // `onStart(call)` avvisa appena si conosce il NOME di una chiamata nuova: la
  // chat lo usa per dire subito «Cerco sul web…», prima che gli argomenti
  // siano finiti di arrivare.
  function createToolCallAccumulator(onStart) {
    const calls = [];
    const byIndex = new Map();
    return {
      push(deltas) {
        for (const d of Array.isArray(deltas) ? deltas : []) {
          if (!d) continue;
          const idx = Number.isInteger(d.index) ? d.index : calls.length;
          let call = byIndex.get(idx);
          if (!call) {
            call = { id: '', name: '', arguments: '', _started: false };
            byIndex.set(idx, call);
            calls.push(call);
          }
          if (d.id) call.id = String(d.id);
          const fn = d.function || {};
          if (fn.name) call.name += String(fn.name);
          if (typeof fn.arguments === 'string') call.arguments += fn.arguments;
          if (call.name && !call._started) {
            call._started = true;
            try { onStart && onStart({ id: call.id, name: call.name }); } catch (_) {}
          }
        }
      },
      list() {
        return calls.filter((c) => c.name).map(({ id, name, arguments: args }) => ({ id, name, arguments: args }));
      },
    };
  }

  // Il ragionamento arriva anche come blocchi strutturati (`reasoning_details`:
  // testo, riassunto o blocchi cifrati con firma), a frammenti indicizzati. Li
  // ricomponiamo per indice concatenando i campi testuali, così da poterli
  // RIMANDARE tali e quali nel messaggio dell'assistente al giro dopo: il
  // fornitore li reinserisce e il modello riprende da dove aveva lasciato
  // invece di ripensare tutto.
  function createReasoningDetailsAccumulator() {
    const items = [];
    const byIndex = new Map();
    const TEXT_FIELDS = ['text', 'summary', 'data'];
    return {
      push(deltas) {
        for (const d of Array.isArray(deltas) ? deltas : []) {
          if (!d || typeof d !== 'object') continue;
          const idx = Number.isInteger(d.index) ? d.index : items.length;
          let it = byIndex.get(idx);
          if (!it) {
            it = { ...d };
            byIndex.set(idx, it);
            items.push(it);
            continue;
          }
          for (const k of Object.keys(d)) {
            if (TEXT_FIELDS.includes(k) && typeof d[k] === 'string') it[k] = (typeof it[k] === 'string' ? it[k] : '') + d[k];
            else if (d[k] != null && k !== 'index') it[k] = d[k];
          }
        }
      },
      list() { return items.slice(); },
    };
  }

  // Marcatura esplicita della parte riusabile: NON serve per i modelli che Filo
  // usa davvero (#422). I modelli Gemini — sia via questo router sia via l'API
  // diretta — riconoscono da soli il prefisso identico a una richiesta
  // precedente, e lo stesso vale per OpenAI/DeepSeek/Grok/Moonshot. Fanno
  // eccezione i modelli Anthropic, che vogliono un marcatore esplicito nel corpo
  // della richiesta: oggi qui sono configurati solo su funzioni dal prompt corto
  // (spiegazione approfondita, riscrittura di un testo), dove non ci sarebbe
  // comunque nulla da riusare. Se un domani si mettesse un modello Anthropic
  // sulla chat o sull'assistente di pagina, il riordino da solo non basterebbe:
  // andrebbe aggiunto il marcatore in fondo alla parte immutabile — e si
  // vedrebbe subito, perché il riuso resterebbe a zero nella cronologia.
  //
  // Quanta parte del testo in ingresso è stata RIUSATA invece che ricalcolata
  // (#422). OpenRouter riporta i token letti dalla cache del fornitore in
  // `usage.prompt_tokens_details.cached_tokens` (0 o campo assente = nessun
  // riuso). È la sola prova che il prefisso immutabile dei prompt sta davvero
  // funzionando: senza questo numero "riuso a zero" e "riuso pieno" sono
  // indistinguibili.
  // Il costo in dollari che il router dichiara (`usage.cost`, con
  // `usage.include`). 0 se assente: chi lo legge sa che deve stimare.
  function costUsdOf(usage) {
    const c = usage && Number(usage.cost);
    return Number.isFinite(c) && c > 0 ? c : 0;
  }

  function cachedPromptTokens(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    const d = usage.prompt_tokens_details || usage.promptTokensDetails || null;
    const v = (d && (d.cached_tokens != null ? d.cached_tokens : d.cachedTokens))
      != null ? (d.cached_tokens != null ? d.cached_tokens : d.cachedTokens)
      : usage.cached_tokens;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Chi ha DAVVERO servito la risposta (#421). OpenRouter lo riporta a livello di
  // risposta come `provider`; per robustezza guardiamo anche dentro la choice.
  function extractServedBy(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const v = obj.provider || obj.choices?.[0]?.provider || null;
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  }

  // Catalogo completo per le tendine dei modelli (#591, secondo giro). Il
  // catalogo semplice elenca i soli modelli di testo: voce, dettatura e
  // indicizzazione stanno in liste a parte, per modalità, e si chiedono tutte
  // insieme. Solo metadati, nessuna inferenza: non costa niente e la chiave è
  // facoltativa. Vive qui perché la richiesta di rete al fornitore deve partire
  // da un posto solo: era scritta a mano in due punti fuori di qui, ed era la
  // riga da copiare per una chiamata che invece si paga.
  const CATALOG_MODALITIES = ['', 'speech', 'transcription', 'embeddings'];

  async function listCatalog({ apiKey } = {}) {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const lists = await Promise.all(CATALOG_MODALITIES.map(async (m) => {
      const res = await fetch(MODELS_ENDPOINT + (m ? `?output_modalities=${m}` : ''), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.data || []).map((x) => ({ id: x.id, meta: x })).filter((it) => it.id);
    }));
    return lists.flat();
  }

  async function listModels(apiKey) {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`);
    const data = await res.json();
    return (data.data || []).map((m) => ({
      id: m.id,
      name: m.name,
      pricing: m.pricing && {
        // OpenRouter espone i prezzi in USD per token. Riconvertiamo in USD per 1M.
        input: parseFloat(m.pricing.prompt) * 1_000_000,
        output: parseFloat(m.pricing.completion) * 1_000_000,
      },
    }));
  }

  async function complete({ apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, signal }) {
    // usage.include: OpenRouter aggiunge alla risposta il costo in dollari
    // della chiamata (`usage.cost`), quello che conta sul tetto della chiave
    // personale (#598). Senza, il costo si stima dal listino.
    const body = { model, messages, stream: false, usage: { include: true }, ...toolsFields(tools, toolChoice) };
    const r = reasoningField(reasoning, false);
    if (r) body.reasoning = r;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const payload = JSON.stringify(body);
    const { res, keyUsed, keySource, keyFallback } = await fetchWithKey(ENDPOINT, apiKey, (key) => ({
      method: 'POST', headers: buildHeaders(key), body: payload, signal,
    }));
    // status/provider strutturati sull'errore: chi lo mostra all'utente può
    // tradurlo in una frase comprensibile invece del codice HTTP nudo (#331).
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const message = data.choices?.[0]?.message || {};
    const text = message.content || '';
    const usage = data.usage || {};
    return {
      text,
      toolCalls: flatToolCalls(message.tool_calls),
      reasoningDetails: Array.isArray(message.reasoning_details) ? message.reasoning_details : [],
      finishReason: data.choices?.[0]?.finish_reason || null,
      servedBy: extractServedBy(data),
      keyUsed, keyFallback,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        cachedPromptTokens: cachedPromptTokens(usage),
        costUsd: costUsdOf(usage),
        servedBy: extractServedBy(data),
        keySource, keyFallback,
      },
    };
  }

  // Streaming SSE — onDelta(textChunk) chiamato per ogni delta di testo,
  // onReasoning(chunk) per il ragionamento, onToolCall({ id, name }) appena si
  // conosce il nome di una chiamata a uno strumento. Ritorna
  // { text, toolCalls, reasoningDetails, finishReason, servedBy, usage }.
  async function streamComplete({ apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal }) {
    const reqBody = { model, messages, stream: true, usage: { include: true }, ...toolsFields(tools, toolChoice) };
    // Reasoning: unisce il livello scelto dall'owner (#369) e la richiesta del
    // caller di STREAMARE i token di ragionamento (onReasoning). I modelli che
    // non ragionano semplicemente non ne emettono — best-effort.
    const r = reasoningField(reasoning, !!onReasoning);
    if (r) reqBody.reasoning = r;
    const pb = providerBlock(providerRouting);
    if (pb) reqBody.provider = pb;
    const payload = JSON.stringify(reqBody);
    // Il rifiuto della chiave arriva con lo status, prima di qualunque delta:
    // il ripiego qui non ha ancora niente da azzerare nel chiamante.
    const { res, keyUsed, keySource, keyFallback } = await fetchWithKey(ENDPOINT, apiKey, (key) => ({
      method: 'POST', headers: buildHeaders(key), body: payload, signal,
    }));
    if (!res.ok || !res.body) throw await httpError(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
    let servedBy = null;
    let finishReason = null;
    const calls = createToolCallAccumulator(onToolCall);
    const details = createReasoningDetailsAccumulator();
    let usage = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          // Chi ha servito arriva in streaming insieme ai chunk (di norma con
          // l'ultimo): teniamo l'ultimo valore visto.
          const sb = extractServedBy(obj);
          if (sb) servedBy = sb;
          const choice = obj.choices?.[0] || {};
          const choiceDelta = choice.delta || {};
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const reasoning = choiceDelta.reasoning;
          if (reasoning) {
            try { onReasoning && onReasoning(reasoning); } catch (_) {}
          }
          if (choiceDelta.reasoning_details) details.push(choiceDelta.reasoning_details);
          if (choiceDelta.tool_calls) calls.push(choiceDelta.tool_calls);
          const delta = choiceDelta.content;
          if (delta) {
            fullText += delta;
            try { onDelta && onDelta(delta); } catch (_) {}
          }
          if (obj.usage) {
            usage = {
              promptTokens: obj.usage.prompt_tokens || 0,
              completionTokens: obj.usage.completion_tokens || 0,
              cachedPromptTokens: cachedPromptTokens(obj.usage),
              costUsd: costUsdOf(obj.usage),
              servedBy: servedBy || extractServedBy(obj),
            };
          }
        } catch (_) {
          // riga malformata, ignora
        }
      }
    }
    return {
      text: fullText, toolCalls: calls.list(), reasoningDetails: details.list(), finishReason, servedBy,
      keyUsed, keyFallback, usage: { ...usage, keySource, keyFallback },
    };
  }

  // Errore HTTP con status e provider strutturati (come per le chat, #331).
  // Porta con sé anche da quale chiave si era partiti e se il ripiego sulla
  // personale c'è stato e ha fallito (fetchWithKey li lascia sulla risposta):
  // un 402 «la tua chiave» e un 402 «anche i crediti di Filo» sono due frasi
  // diverse per l'utente.
  async function httpError(res) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    err.provider = 'openrouter';
    if (res.keySource) err.keySource = res.keySource;
    if (res.keyFallback) err.keyFallback = res.keyFallback;
    return err;
  }

  // ─── Lettura ad alta voce ──────────────────────────────────────────────────
  // Chiede l'audio in PCM grezzo (16 bit, mono): il content script lo incapsula
  // in un WAV e lo suona, lo stesso formato che usava prima. Il router risponde
  // con i byte e basta: chi ha servito non è nella risposta, ma l'id della
  // generazione sì (header), e con quello si chiede dopo (lookupServedBy).
  async function synthesizeSpeech({ apiKey, model, text, voice, speed, providerRouting, signal }) {
    const body = { model, input: String(text == null ? '' : text), response_format: 'pcm' };
    if (voice) body.voice = voice;
    const sp = Number(speed);
    if (Number.isFinite(sp) && sp > 0 && sp !== 1) body.speed = sp;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const payload = JSON.stringify(body);
    const { res, keyUsed, keySource, keyFallback } = await fetchWithKey(SPEECH_ENDPOINT, apiKey, (key) => ({
      method: 'POST', headers: buildHeaders(key), body: payload, signal,
    }));
    if (!res.ok) throw await httpError(res);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      const err = new Error('OpenRouter: audio vuoto');
      err.provider = 'openrouter';
      throw err;
    }
    const ct = String(res.headers.get('content-type') || '');
    const mimeType = /rate=\d+/.test(ct) ? ct : 'audio/pcm;rate=24000';
    return {
      audioBase64: buf.toString('base64'),
      mimeType,
      generationId: res.headers.get('x-generation-id') || null,
      keyUsed, keySource, keyFallback,
    };
  }

  // ─── Dettatura ────────────────────────────────────────────────────────────
  // `audioBase64` sono i byte grezzi del file (niente data URI); `format` è
  // l'estensione ('wav', 'mp3', 'webm', …). `language` è un codice ISO-639-1
  // ('it'): se manca, il modello la riconosce da sé.
  async function transcribe({ apiKey, model, audioBase64, format, language, providerRouting, signal }) {
    const body = { model, input_audio: { data: audioBase64, format: format || 'wav' } };
    if (language) body.language = language;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const payload = JSON.stringify(body);
    const { res, keyUsed, keySource, keyFallback } = await fetchWithKey(TRANSCRIPTIONS_ENDPOINT, apiKey, (key) => ({
      method: 'POST', headers: buildHeaders(key), body: payload, signal,
    }));
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const usage = data.usage || {};
    return {
      text: typeof data.text === 'string' ? data.text : '',
      servedBy: extractServedBy(data),
      generationId: res.headers.get('x-generation-id') || data.id || null,
      keyUsed, keyFallback,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        cachedPromptTokens: 0,
        seconds: Number(usage.seconds) || 0,
        // Il router riporta il costo in dollari: per l'audio è l'unico numero
        // che abbia senso (non ci sono token), e va registrato tale e quale.
        costUsd: Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null,
        keySource, keyFallback,
      },
    };
  }

  // ─── Indicizzazione (embedding) ───────────────────────────────────────────
  // Ritorna i vettori nell'ordine dei testi. `dim` chiede vettori accorciati
  // (i modelli addestrati "a matrioska" lo permettono); se il fornitore ignora
  // la richiesta e ne manda di più lunghi, si tagliano qui: le prime `dim`
  // componenti sono comunque quelle che contano, e la ricerca lavora su
  // vettori tutti della stessa lunghezza.
  async function embed({ apiKey, model, texts, dim, providerRouting, signal }) {
    const input = (texts || []).map((t) => String(t == null ? '' : t));
    const body = { model, input };
    const d = Number(dim);
    if (Number.isInteger(d) && d > 0) body.dimensions = d;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const payload = JSON.stringify(body);
    const { res, keyUsed, keySource, keyFallback } = await fetchWithKey(EMBEDDINGS_ENDPOINT, apiKey, (key) => ({
      method: 'POST', headers: buildHeaders(key), body: payload, signal,
    }));
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const rows = Array.isArray(data.data) ? data.data.slice() : [];
    rows.sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
    const vectors = rows.map((r) => {
      const v = Array.isArray(r.embedding) ? r.embedding : [];
      return (Number.isInteger(d) && d > 0 && v.length > d) ? v.slice(0, d) : v;
    });
    const usage = data.usage || {};
    return {
      vectors,
      servedBy: extractServedBy(data),
      generationId: res.headers.get('x-generation-id') || data.id || null,
      keyUsed, keyFallback,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: 0,
        cachedPromptTokens: 0,
        costUsd: Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null,
        keySource, keyFallback,
      },
    };
  }

  // ─── Chi ha servito, a posteriori ─────────────────────────────────────────
  // Per voce e dettatura il router non mette il fornitore nella risposta: lo
  // si chiede con l'id della generazione, che diventa consultabile qualche
  // secondo dopo (finché non lo è risponde 404). Ritorna
  // { servedBy, costUsd } oppure null se ancora non c'è.
  async function lookupServedBy({ apiKey, generationId, signal }) {
    if (!generationId) return null;
    const res = await fetch(`${GENERATION_ENDPOINT}?id=${encodeURIComponent(generationId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()).data || {};
    const name = typeof data.provider_name === 'string' ? data.provider_name.trim() : '';
    const cost = Number(data.total_cost);
    return { servedBy: name || null, costUsd: Number.isFinite(cost) ? cost : null };
  }

  // ─── Cosa sa OpenRouter di una chiave ─────────────────────────────────────
  // `GET /auth/key` con la chiave come Bearer: etichetta, tetto (null = nessun
  // tetto), spesa, residuo. La pagina Crediti lo mostra per la chiave propria.
  // Nessun ripiego qui: la domanda è proprio su QUELLA chiave.
  //
  // Il tetto su una chiave è facoltativo e di solito non c'è: allora quello
  // che resta da spendere è il credito dell'ACCOUNT (comprato meno consumato),
  // che OpenRouter dice a `GET /credits` con la stessa chiave. Si chiede solo
  // in quel caso, e se non risponde resta la sola spesa (primo giro di
  // verifica del ramo).
  async function keyInfo({ apiKey, signal }) {
    const res = await fetch(AUTH_KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()).data || {};
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const out = {
      label: typeof data.label === 'string' ? data.label : '',
      limit: num(data.limit),
      usage: num(data.usage) || 0,
      limit_remaining: num(data.limit_remaining),
      account: null,
    };
    // Il credito del conto serve sempre: è quello che resta a una chiave
    // senza tetto, e con un tetto è il numero che conta quando il conto ha
    // meno del residuo del tetto (secondo giro di verifica del ramo).
    try {
      const r2 = await fetch(CREDITS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (r2.ok) {
        const d2 = (await r2.json()).data || {};
        const credits = num(d2.total_credits);
        const used = num(d2.total_usage);
        if (credits != null) out.account = { credits, usage: used || 0 };
      }
    } catch (_) { out.account = null; }
    return out;
  }

  global.SN_PROVIDER_OPENROUTER = {
    listModels, listCatalog, complete, streamComplete, reasoningField, providerBlock, extractServedBy,
    cachedPromptTokens, synthesizeSpeech, transcribe, embed, lookupServedBy, keyInfo, fetchWithKey,
    createToolCallAccumulator, createReasoningDetailsAccumulator, toolsFields,
    ENDPOINT, SPEECH_ENDPOINT, TRANSCRIPTIONS_ENDPOINT, EMBEDDINGS_ENDPOINT, GENERATION_ENDPOINT, AUTH_KEY_ENDPOINT, CREDITS_ENDPOINT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
