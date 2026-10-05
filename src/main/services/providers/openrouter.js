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
  // del prezzo. `allow_fallbacks` resta acceso: fra gli host AMMESSI il ripiego
  // serve. Un modello da comprare solo dal produttore (#904) porta `only` anche senza `routing`.
  function providerBlock(routing, model, { tools = false } = {}) {
    const p = {};
    const r = routing && typeof routing === 'object' ? routing : {};
    const ignore = Array.isArray(r.ignore) ? r.ignore.filter(Boolean) : [];
    if (ignore.length) p.ignore = ignore;
    if (r.sort === 'latency' || r.sort === 'throughput' || r.sort === 'price') {
      p.sort = r.sort;
    }
    if (r.allowFallbacks === false) p.allow_fallbacks = false;
    // Strumenti in richiesta → solo host che li supportano davvero (#700): un host che li ignora o
    // ne rompe il JSON fa fallire il turno senza che si capisca perché. Vale per OGNI chiamata con strumenti.
    if (tools) p.require_parameters = true;
    const C = global.SN_CONST;
    const rule = C && typeof C.producerOnlyRule === 'function' ? C.producerOnlyRule(model) : null;
    if (rule) p.only = rule.only.slice();
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

  // Il 404 del router quando, fra gli host ammessi, nessuno regge i parametri chiesti (o nessuno resta).
  const NO_HOST_FOR_PARAMS_RE = /no endpoints found|no allowed providers|parameter|tool/i;

  // Una chiamata di chat (con o senza streaming). `require_parameters` scarta anche gli host che non
  // conoscono `reasoning`, e per un modello che non ragiona non ne resterebbe nessuno: il ragionamento
  // è facoltativo, gli strumenti no, quindi a quel rifiuto si rifà la richiesta senza.
  async function postChat(body, apiKey, signal) {
    const send = (b, key) => {
      const payload = JSON.stringify(b);
      return fetchWithKey(ENDPOINT, key, (k) => ({ method: 'POST', headers: buildHeaders(k), body: payload, signal }));
    };
    const first = await send(body, apiKey);
    const needsParams = !!(body.provider && body.provider.require_parameters);
    if (first.res.ok || first.res.status !== 404 || !needsParams || !body.reasoning) return first;
    const detail = await first.res.clone().text().catch(() => '');
    if (!NO_HOST_FOR_PARAMS_RE.test(detail)) return first;
    const { reasoning: _omesso, ...senzaRagionamento } = body;
    const second = await send(senzaRagionamento, first.keyUsed);
    if (!second.keyFallback && first.keyFallback) {
      second.keyFallback = first.keyFallback;
      try { second.res.keyFallback = first.keyFallback; } catch (_) {}
    }
    return second;
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
    const pb = providerBlock(providerRouting, model, { tools: !!body.tools });
    if (pb) body.provider = pb;
    const { res, keyUsed, keySource, keyFallback } = await postChat(body, apiKey, signal);
    // status/provider strutturati sull'errore: chi lo mostra all'utente può
    // tradurlo in una frase comprensibile invece del codice HTTP nudo (#331).
    if (!res.ok) throw await httpError(res, { tools: !!body.tools });
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
    const pb = providerBlock(providerRouting, model, { tools: !!reqBody.tools });
    if (pb) reqBody.provider = pb;
    // Il rifiuto della chiave arriva con lo status, prima di qualunque delta:
    // il ripiego qui non ha ancora niente da azzerare nel chiamante.
    const { res, keyUsed, keySource, keyFallback } = await postChat(reqBody, apiKey, signal);
    if (!res.ok || !res.body) throw await httpError(res, { tools: !!reqBody.tools });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
    let servedBy = null;
    let finishReason = null;
    const calls = createToolCallAccumulator(onToolCall);
    const details = createReasoningDetailsAccumulator();
    let usage = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 };
    let generationId = null;

    // Una risposta rotta a metà si paga per quanto il modello aveva scritto: l'errore porta con sé l'id per chiederne il costo.
    const read = () => reader.read().catch((err) => {
      if (generationId && err && typeof err === 'object') {
        err.generationId = generationId;
        err.keySource = keySource;
        // La chiave serve a rileggere la generazione, ma un errore si stampa e si serializza: non enumerabile.
        Object.defineProperty(err, 'keyUsed', { value: keyUsed, enumerable: false, configurable: true });
      }
      throw err;
    });
    while (true) {
      const { done, value } = await read();
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
          if (!generationId && typeof obj.id === 'string') generationId = obj.id;
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
  async function httpError(res, { tools = false } = {}) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    err.provider = 'openrouter';
    // Con gli strumenti il router cerca solo host che li reggono: il suo 404 vuol dire che fra gli
    // ammessi non ce n'è, e chi lo racconta deve dire questo, non «riprova».
    if (tools && res.status === 404 && NO_HOST_FOR_PARAMS_RE.test(errText)) err.code = 'NO_TOOL_HOST';
    if (res.keySource) err.keySource = res.keySource;
    if (res.keyFallback) err.keyFallback = res.keyFallback;
    return err;
  }

  // ─── Chi può servire un modello, prima di chiamarlo ───────────────────────
  // Sugli endpoint audio il router ignora il blocco `provider` (#713): l'esclusione si applica qui, sugli host
  // dichiarati. Regole: patterns/voce-dettatura-e-vettori-passano-dal-router-come-le-chat.md.
  const HOSTS_FRESH_MS = 60 * 60 * 1000;
  const HOSTS_RETRY_MS = 5 * 60 * 1000;
  const HOSTS_TIMEOUT_MS = 10 * 1000;
  const HOSTS_MAX_MODELS = 500;
  const hostsCache = new Map(); // id → { until, hosts, pending }

  function endpointsUrl(model) {
    const id = String(model == null ? '' : model).trim();
    const parts = id.split('/');
    if (parts.length !== 2 || parts.some((p) => !p || p === '.' || p === '..')) return '';
    return `${MODELS_ENDPOINT}/${parts.map(encodeURIComponent).join('/')}/endpoints`;
  }

  async function fetchModelHosts(apiKey, model) {
    const url = endpointsUrl(model);
    if (!url) return null;
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(HOSTS_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OpenRouter endpoints ${res.status}`);
    const data = (await res.json()) || {};
    const list = data.data && Array.isArray(data.data.endpoints) ? data.data.endpoints : [];
    const hosts = [];
    for (const e of list) {
      const name = e && typeof e.provider_name === 'string' ? e.provider_name.trim() : '';
      const tag = e && typeof e.tag === 'string' ? e.tag.trim() : '';
      if (name || tag) hosts.push({ name, tag });
    }
    return hosts;
  }

  // [{ name, tag }] o null se non si sa. Un elenco scaduto si usa mentre si rilegge;
  // una lettura fallita si ritenta dopo qualche minuto, non a ogni frase dettata.
  async function modelHosts({ apiKey, model } = {}) {
    const key = String(model == null ? '' : model).trim();
    if (!key) return null;
    const hit = hostsCache.get(key);
    if (hit && hit.pending) return hit.hosts || hit.pending;
    if (hit && Date.now() < hit.until) return hit.hosts;
    const entry = { until: 0, hosts: hit ? hit.hosts : null, pending: null };
    entry.pending = fetchModelHosts(apiKey, key)
      .then((hosts) => {
        entry.hosts = hosts;
        entry.until = Date.now() + (hosts ? HOSTS_FRESH_MS : HOSTS_RETRY_MS);
        return entry.hosts;
      })
      .catch((e) => {
        console.warn(`[Filo policy] host di "${key}" non letti:`, (e && e.message) || e);
        entry.until = Date.now() + HOSTS_RETRY_MS;
        return entry.hosts;
      })
      .finally(() => { entry.pending = null; });
    hostsCache.delete(key);
    hostsCache.set(key, entry);
    while (hostsCache.size > HOSTS_MAX_MODELS) hostsCache.delete(hostsCache.keys().next().value);
    return entry.hosts || entry.pending;
  }

  function forgetModelHosts() { hostsCache.clear(); }

  function joinNames(names) {
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  }

  async function ensureAllowedHost({ apiKey, model, providerRouting }) {
    const C = global.SN_CONST;
    if (!C || typeof C.hostPolicyViolation !== 'function') return;
    const r = providerRouting && typeof providerRouting === 'object' ? providerRouting : {};
    const excluded = Array.isArray(r.ignore) ? r.ignore.filter(Boolean) : [];
    if (!excluded.length && !C.producerOnlyRule(model)) return;
    const hosts = await modelHosts({ apiKey, model });
    if (!Array.isArray(hosts) || !hosts.length) return;
    if (hosts.some((h) => !C.hostPolicyViolation(h, model, excluded))) return;
    const names = [];
    for (const h of hosts) {
      const n = h.name || h.tag;
      if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    const I18n = global.SN_I18N;
    const chiave = names.length > 1 ? 'err_audio_no_allowed_host_many' : 'err_audio_no_allowed_host';
    const err = new Error(I18n ? I18n.t(chiave, model, joinNames(names)) : `NO_ALLOWED_HOST ${model}`);
    err.code = 'NO_ALLOWED_HOST';
    err.provider = 'openrouter';
    err.model = model;
    err.hosts = names;
    throw err;
  }

  // ─── Lettura ad alta voce ──────────────────────────────────────────────────
  // Chiede l'audio in PCM grezzo (16 bit, mono): il content script lo incapsula
  // in un WAV e lo suona, lo stesso formato che usava prima. Il router risponde
  // con i byte e basta: chi ha servito non è nella risposta, ma l'id della
  // generazione sì (header), e con quello si chiede dopo (lookupServedBy).
  async function synthesizeSpeech({ apiKey, model, text, voice, speed, providerRouting, signal }) {
    await ensureAllowedHost({ apiKey, model, providerRouting });
    const body = { model, input: String(text == null ? '' : text), response_format: 'pcm' };
    if (voice) body.voice = voice;
    const sp = Number(speed);
    if (Number.isFinite(sp) && sp > 0 && sp !== 1) body.speed = sp;
    const pb = providerBlock(providerRouting, model);
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
    await ensureAllowedHost({ apiKey, model, providerRouting });
    const body = { model, input_audio: { data: audioBase64, format: format || 'wav' } };
    if (language) body.language = language;
    const pb = providerBlock(providerRouting, model);
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
    const pb = providerBlock(providerRouting, model);
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
    listModels, complete, streamComplete, reasoningField, providerBlock, extractServedBy,
    cachedPromptTokens, synthesizeSpeech, transcribe, embed, lookupServedBy, keyInfo, fetchWithKey,
    modelHosts, forgetModelHosts,
    createToolCallAccumulator, createReasoningDetailsAccumulator, toolsFields,
    ENDPOINT, MODELS_ENDPOINT, SPEECH_ENDPOINT, TRANSCRIPTIONS_ENDPOINT, EMBEDDINGS_ENDPOINT, GENERATION_ENDPOINT, AUTH_KEY_ENDPOINT, CREDITS_ENDPOINT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
