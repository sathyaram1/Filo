// Provider OpenRouter: client minimale con streaming SSE. Dal router passano anche le tre funzioni che prima volevano l'API diretta di un produttore — lettura ad alta voce (/audio/speech), dettatura (/audio/transcriptions) e indicizzazione (/embeddings) — con la stessa chiave e la stessa lista di esclusione.
// Dove il router non dice nella risposta chi ha davvero servito, il riscontro si chiede a posteriori (lookupServedBy).

(function (global) {
  'use strict';

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
  const SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
  const TRANSCRIPTIONS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions';
  const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';
  const GENERATION_ENDPOINT = 'https://openrouter.ai/api/v1/generation';

  function buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // Header raccomandati da OpenRouter: opzionali, utili per la fairness dei rate limit.
      'HTTP-Referer': 'https://filo.local',
      'X-Title': 'Filo',
    };
  }

  // Traduce il livello di reasoning scelto dall'owner (#369): 'off' → { enabled: false }, low/medium/high → { effort }. `wantThoughts` chiede anche i token di ragionamento in streaming; null se non c'è nulla da chiedere.
  // I modelli che non ragionano ignorano il campo: è best-effort.
  function reasoningField(level, wantThoughts) {
    if (level === 'off') return { enabled: false };
    const out = {};
    if (level === 'low' || level === 'medium' || level === 'high') out.effort = level;
    if (wantThoughts) out.enabled = true;
    return Object.keys(out).length ? out : null;
  }

  // Blocco `provider` per il routing (politica sui fornitori, #421): di suo OpenRouter sceglie l'host col prezzo migliore, che può essere il produttore del modello. Con `ignore` gli diciamo quali NON usare.
  // Se dopo l'esclusione non resta nessun host ammesso, OpenRouter risponde con un errore che risale come un normale errore provider: la richiesta FALLISCE in modo evidente invece di passare da un host escluso.
  // `sort` sceglie l'ordine fra gli ammessi (latency/throughput) invece del prezzo; `allow_fallbacks` non si tocca, perché fra gli host AMMESSI il ripiego automatico deve restare attivo.
  function providerBlock(routing) {
    if (!routing || typeof routing !== 'object') return null;
    const p = {};
    const ignore = Array.isArray(routing.ignore) ? routing.ignore.filter(Boolean) : [];
    if (ignore.length) p.ignore = ignore;
    if (routing.sort === 'latency' || routing.sort === 'throughput' || routing.sort === 'price') {
      p.sort = routing.sort;
    }
    if (routing.allowFallbacks === false) p.allow_fallbacks = false;
    // Con gli strumenti in richiesta, solo gli host che li supportano davvero: senza, il router può passare a un host che ignora `tools` in silenzio e il modello risponde a parole invece di agire.
    if (routing.requireParameters === true) p.require_parameters = true;
    return Object.keys(p).length ? p : null;
  }

  // `toolChoice` ('auto' | 'none' | 'required') è facoltativo.
  function toolsFields(tools, toolChoice) {
    const out = {};
    if (Array.isArray(tools) && tools.length) {
      out.tools = tools;
      if (toolChoice) out.tool_choice = toolChoice;
    }
    return out;
  }

  // Forma piatta usata dal resto di Filo: { id, name, arguments (stringa JSON) }.
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

  // In streaming le chiamate arrivano a pezzi: l'indice, poi id e nome, poi i frammenti di argomenti da accodare.
  // `onStart(call)` avvisa appena si conosce il NOME di una chiamata nuova: la chat lo usa per dire subito «Cerco sul web…», prima che gli argomenti siano finiti di arrivare.
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

  // I blocchi di ragionamento strutturati (`reasoning_details`) si ricompongono per indice per poterli RIMANDARE tali e quali nel messaggio dell'assistente al giro dopo: il fornitore li reinserisce e il modello riprende da dove aveva lasciato invece di ripensare tutto.
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

  // Marcatura esplicita della parte riusabile: NON serve per i modelli che Filo usa davvero (#422), che riconoscono da soli il prefisso identico a una richiesta precedente. La vogliono i modelli Anthropic, oggi configurati solo su funzioni dal prompt corto; se un domani ne finisse uno sulla chat andrebbe aggiunto il marcatore in fondo alla parte immutabile, e si vedrebbe subito perché il riuso resterebbe a zero in cronologia.
  // Quanta parte del testo in ingresso è stata RIUSATA invece che ricalcolata (#422): il router riporta i token letti dalla cache del fornitore in `usage.prompt_tokens_details.cached_tokens` (0 o assente = nessun riuso). È la sola prova che il prefisso immutabile dei prompt funziona.
  // Il costo in dollari dichiarato dal router (`usage.cost`, con `usage.include`): 0 se assente, e chi lo legge sa che deve stimare.
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

  // Chi ha DAVVERO servito la risposta (#421): il router lo riporta a livello di risposta, ma per robustezza si guarda anche dentro la choice.
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
        // OpenRouter espone i prezzi in USD per token: si riconverte in USD per 1M.
        input: parseFloat(m.pricing.prompt) * 1_000_000,
        output: parseFloat(m.pricing.completion) * 1_000_000,
      },
    }));
  }

  async function complete({ apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, signal }) {
    // usage.include: il router aggiunge il costo in dollari della chiamata, quello che conta sul tetto della chiave personale (#598). Senza, il costo si stima dal listino.
    const body = { model, messages, stream: false, usage: { include: true }, ...toolsFields(tools, toolChoice) };
    const r = reasoningField(reasoning, false);
    if (r) body.reasoning = r;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // status/provider strutturati sull'errore: chi lo mostra all'utente può tradurlo in una frase comprensibile invece del codice HTTP nudo (#331).
      const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      err.provider = 'openrouter';
      throw err;
    }
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
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        cachedPromptTokens: cachedPromptTokens(usage),
        costUsd: costUsdOf(usage),
        servedBy: extractServedBy(data),
      },
    };
  }

  // onDelta(testo), onReasoning(chunk), onToolCall({ id, name }) appena si conosce il nome. Ritorna { text, toolCalls, reasoningDetails, finishReason, servedBy, usage }.
  async function streamComplete({ apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal }) {
    const reqBody = { model, messages, stream: true, usage: { include: true }, ...toolsFields(tools, toolChoice) };
    // Unisce il livello scelto dall'owner (#369) e la richiesta del caller di STREAMARE i token di ragionamento. Best-effort: i modelli che non ragionano non ne emettono.
    const r = reasoningField(reasoning, !!onReasoning);
    if (r) reqBody.reasoning = r;
    const pb = providerBlock(providerRouting);
    if (pb) reqBody.provider = pb;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(reqBody),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      err.provider = 'openrouter';
      throw err;
    }

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
          // Chi ha servito arriva in streaming insieme ai chunk (di norma con l'ultimo): si tiene l'ultimo valore visto.
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
      text: fullText, toolCalls: calls.list(), reasoningDetails: details.list(), finishReason, servedBy, usage,
    };
  }

  // Errore HTTP con status e provider strutturati (come per le chat, #331).
  async function httpError(res) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    err.provider = 'openrouter';
    return err;
  }

  // Audio in PCM grezzo (16 bit, mono): il content script lo incapsula in un WAV e lo suona. Il router risponde coi soli byte, ma l'id della generazione è negli header e con quello si chiede dopo chi ha servito (lookupServedBy).
  async function synthesizeSpeech({ apiKey, model, text, voice, speed, providerRouting, signal }) {
    const body = { model, input: String(text == null ? '' : text), response_format: 'pcm' };
    if (voice) body.voice = voice;
    const sp = Number(speed);
    if (Number.isFinite(sp) && sp > 0 && sp !== 1) body.speed = sp;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const res = await fetch(SPEECH_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
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
    };
  }

  // `audioBase64` sono i byte grezzi del file (niente data URI); `format` è l'estensione; `language` è un ISO-639-1 e se manca il modello la riconosce da sé.
  async function transcribe({ apiKey, model, audioBase64, format, language, providerRouting, signal }) {
    const body = { model, input_audio: { data: audioBase64, format: format || 'wav' } };
    if (language) body.language = language;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const res = await fetch(TRANSCRIPTIONS_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const usage = data.usage || {};
    return {
      text: typeof data.text === 'string' ? data.text : '',
      servedBy: extractServedBy(data),
      generationId: res.headers.get('x-generation-id') || data.id || null,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        cachedPromptTokens: 0,
        seconds: Number(usage.seconds) || 0,
        // Per l'audio il costo in dollari del router è l'unico numero che abbia senso (non ci sono token): si registra tale e quale.
        costUsd: Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null,
      },
    };
  }

  // Vettori nell'ordine dei testi. `dim` chiede vettori accorciati (i modelli "a matrioska" lo permettono); se il fornitore ne manda di più lunghi si tagliano qui: le prime `dim` componenti sono quelle che contano, e la ricerca vuole vettori tutti della stessa lunghezza.
  async function embed({ apiKey, model, texts, dim, providerRouting, signal }) {
    const input = (texts || []).map((t) => String(t == null ? '' : t));
    const body = { model, input };
    const d = Number(dim);
    if (Number.isInteger(d) && d > 0) body.dimensions = d;
    const pb = providerBlock(providerRouting);
    if (pb) body.provider = pb;
    const res = await fetch(EMBEDDINGS_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
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
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: 0,
        cachedPromptTokens: 0,
        costUsd: Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null,
      },
    };
  }

  // Per voce e dettatura il fornitore non è nella risposta: lo si chiede con l'id della generazione, consultabile qualche secondo dopo (finché non lo è risponde 404). Ritorna { servedBy, costUsd } oppure null.
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

  global.SN_PROVIDER_OPENROUTER = {
    listModels, complete, streamComplete, reasoningField, providerBlock, extractServedBy,
    cachedPromptTokens, synthesizeSpeech, transcribe, embed, lookupServedBy,
    createToolCallAccumulator, createReasoningDetailsAccumulator, toolsFields,
    ENDPOINT, SPEECH_ENDPOINT, TRANSCRIPTIONS_ENDPOINT, EMBEDDINGS_ENDPOINT, GENERATION_ENDPOINT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
