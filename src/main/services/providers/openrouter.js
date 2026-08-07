// Provider OpenRouter — client minimale con supporto streaming SSE.

(function (global) {
  'use strict';

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

  function buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter raccomanda questi header (opzionali ma utili per rate limit fairness)
      'HTTP-Referer': 'https://filo.local',
      'X-Title': 'Filo',
    };
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
    return Object.keys(p).length ? p : null;
  }

  // Quanta parte del testo in ingresso è stata RIUSATA invece che ricalcolata
  // (#422). OpenRouter riporta i token letti dalla cache del fornitore in
  // `usage.prompt_tokens_details.cached_tokens` (0 o campo assente = nessun
  // riuso). È la sola prova che il prefisso immutabile dei prompt sta davvero
  // funzionando: senza questo numero "riuso a zero" e "riuso pieno" sono
  // indistinguibili.
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

  async function complete({ apiKey, model, messages, reasoning, providerRouting, signal }) {
    const body = { model, messages, stream: false };
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
      // status/provider strutturati sull'errore: chi lo mostra all'utente può
      // tradurlo in una frase comprensibile invece del codice HTTP nudo (#331).
      const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      err.provider = 'openrouter';
      throw err;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};
    return {
      text,
      servedBy: extractServedBy(data),
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        cachedPromptTokens: cachedPromptTokens(usage),
      },
    };
  }

  // Streaming SSE — onDelta(textChunk) chiamato per ogni delta. Ritorna { text, usage } finale.
  async function streamComplete({ apiKey, model, messages, reasoning, providerRouting, onDelta, onReasoning, signal }) {
    const reqBody = { model, messages, stream: true };
    // Reasoning: unisce il livello scelto dall'owner (#369) e la richiesta del
    // caller di STREAMARE i token di ragionamento (onReasoning). I modelli che
    // non ragionano semplicemente non ne emettono — best-effort.
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
    let usage = { promptTokens: 0, completionTokens: 0 };

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
          const choiceDelta = obj.choices?.[0]?.delta || {};
          const reasoning = choiceDelta.reasoning;
          if (reasoning) {
            try { onReasoning && onReasoning(reasoning); } catch (_) {}
          }
          const delta = choiceDelta.content;
          if (delta) {
            fullText += delta;
            try { onDelta && onDelta(delta); } catch (_) {}
          }
          if (obj.usage) {
            usage = {
              promptTokens: obj.usage.prompt_tokens || 0,
              completionTokens: obj.usage.completion_tokens || 0,
            };
          }
        } catch (_) {
          // riga malformata, ignora
        }
      }
    }
    return { text: fullText, servedBy, usage };
  }

  global.SN_PROVIDER_OPENROUTER = { listModels, complete, streamComplete, reasoningField, providerBlock, extractServedBy, ENDPOINT };
})(typeof globalThis !== 'undefined' ? globalThis : self);
