// Provider Google AI Studio (Gemini API).
// Le quote del free tier sono generose: lo usiamo come "provider gratuito"
// preferito, con OpenRouter come fallback (vedi providers/index.js).
//
// Endpoint:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={KEY}
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={KEY}

(function (global) {
  'use strict';

  const BASE = 'https://generativelanguage.googleapis.com/v1beta';

  // Converte un model id "stile OpenRouter" (google/gemini-2.0-flash-001) nel
  // nome accettato dalla Gemini API (gemini-2.0-flash). Per modelli non-Google
  // ritorna null: il caller deve quindi non usare Gemini e cadere su OpenRouter.
  //
  // Normalizzazioni applicate:
  //  - taglia il prefisso "google/"
  //  - taglia le revisioni numeriche ("-001", "-002") che su OpenRouter sono
  //    spesso solo alias del nome base (es. gemini-2.0-flash-001 → gemini-2.0-flash)
  //  - taglia il suffisso "-preview" (i preview OpenRouter NON sempre sono
  //    pubblicati sulla Gemini API con quel suffisso; provando il nome base
  //    di solito si arriva al modello stable più vicino)
  //  - se il nome è proprio "gemini" (caso patologico), torna null
  function toGeminiModelId(modelId) {
    if (!modelId) return null;
    if (!modelId.startsWith('google/')) return null;
    let id = modelId.replace(/^google\//, '');
    id = id.replace(/-\d{3}$/, '');
    id = id.replace(/-preview$/, '');
    if (!id || id === 'gemini') return null;
    return id;
  }

  // Da messaggi OpenAI-style a struttura Gemini.
  // - role 'system' -> systemInstruction (concatenato)
  // - role 'user'/'assistant' -> contents[] con role 'user'/'model'
  // - content stringa -> parts: [{text}]
  // - content array (multimodale) -> mappa type:'text' a {text} e
  //   type:'image_url' (data URL base64) a {inline_data:{mime_type,data}}
  function toGeminiRequest(messages) {
    const sysParts = [];
    const contents = [];
    for (const m of messages || []) {
      if (m.role === 'system') {
        if (typeof m.content === 'string') sysParts.push(m.content);
        continue;
      }
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts = [];
      if (typeof m.content === 'string') {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === 'text' && p.text) parts.push({ text: p.text });
          else if (p.type === 'image_url' && p.image_url?.url) {
            const url = p.image_url.url;
            const match = /^data:([^;]+);base64,(.*)$/.exec(url);
            if (match) {
              parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
            }
            // URL remoti non supportati direttamente: ignora.
          }
          else if (p.type === 'audio_url' && p.audio_url?.url) {
            const url = p.audio_url.url;
            const match = /^data:([^;]+);base64,(.*)$/.exec(url);
            if (match) {
              parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
            }
          }
        }
      }
      if (parts.length) contents.push({ role, parts });
    }
    const body = { contents };
    if (sysParts.length) body.systemInstruction = { parts: [{ text: sysParts.join('\n\n') }] };
    return body;
  }

  function extractText(data) {
    const cand = data?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    return parts.map((p) => p.text || '').join('');
  }

  function extractUsage(data) {
    const u = data?.usageMetadata || {};
    return {
      promptTokens: u.promptTokenCount || 0,
      completionTokens: u.candidatesTokenCount || 0,
    };
  }

  async function complete({ apiKey, model, messages, signal }) {
    const geminiModel = toGeminiModelId(model);
    if (!geminiModel) throw new Error(`Gemini: modello non Google (${model})`);
    const url = `${BASE}/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = toGeminiRequest(messages);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    return { text: extractText(data), usage: extractUsage(data) };
  }

  async function streamComplete({ apiKey, model, messages, onDelta, signal }) {
    const geminiModel = toGeminiModelId(model);
    if (!geminiModel) throw new Error(`Gemini: modello non Google (${model})`);
    const url = `${BASE}/models/${encodeURIComponent(geminiModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    const body = toGeminiRequest(messages);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
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
        if (!payload || payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          const delta = extractText(obj);
          if (delta) {
            fullText += delta;
            try { onDelta && onDelta(delta); } catch (_) {}
          }
          const u = extractUsage(obj);
          if (u.promptTokens || u.completionTokens) usage = u;
        } catch (_) {
          // riga malformata, ignora
        }
      }
    }
    return { text: fullText, usage };
  }

  async function listModels(apiKey) {
    const res = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`Gemini models: ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m) => ({
      // Riporta i modelli con prefisso "google/" così sono compatibili con i
      // model id usati dal resto dell'estensione (OpenRouter naming).
      id: 'google/' + (m.name || '').replace(/^models\//, ''),
      name: m.displayName || m.name,
    }));
  }

  // Esposto sia per uso diretto sia per i test della UI options.
  global.SN_PROVIDER_GEMINI = {
    listModels,
    complete,
    streamComplete,
    toGeminiModelId,
    isGoogleModel: (id) => !!toGeminiModelId(id),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
