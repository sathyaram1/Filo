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

  async function complete({ apiKey, model, messages, signal }) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({ model, messages, stream: false }),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};
    return {
      text,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
      },
    };
  }

  // Streaming SSE — onDelta(textChunk) chiamato per ogni delta. Ritorna { text, usage } finale.
  async function streamComplete({ apiKey, model, messages, onDelta, signal }) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
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
          const delta = obj.choices?.[0]?.delta?.content;
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
    return { text: fullText, usage };
  }

  global.SN_PROVIDER_OPENROUTER = { listModels, complete, streamComplete, ENDPOINT };
})(typeof globalThis !== 'undefined' ? globalThis : self);
