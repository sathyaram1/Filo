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

  // Risolve un riferimento a modello nel nome accettato dalla Gemini API.
  // Per modelli non-Google ritorna null: il caller deve quindi non usare Gemini
  // e cadere su OpenRouter.
  //
  // Due forme accettate:
  //
  //  1. Nome NATIVO Gemini/Gemma — è il "codice" come appare su Google AI Studio
  //     (es. gemini-2.5-flash, gemini-3.1-flash-lite, gemma-4-31b-it). È
  //     esattamente ciò che la Gemini API si aspetta: lo passiamo invariato.
  //     Questo è anche il formato in cui il registry salva i modelli Gemini,
  //     quindi senza questo ramo OGNI tentativo sul provider Gemini falliva e
  //     ripiegava in silenzio su OpenRouter (la chiave Gemini non veniva mai
  //     usata davvero).
  //
  //  2. Stile OpenRouter "google/..." (es. google/gemini-2.0-flash-001): togliamo
  //     il prefisso "google/". Le revisioni "-001/-002" e il suffisso "-preview"
  //     erano un tempo alias che la Gemini API non pubblicava; oggi quei nomi
  //     esistono nativamente (es. gemini-2.0-flash-001, gemini-3.1-flash-lite-preview)
  //     quindi NON li tagliamo più: tagliarli punterebbe a un modello diverso.
  //     Se resta solo "gemini" (caso patologico), torna null.
  function toGeminiModelId(modelId) {
    if (!modelId) return null;
    if (/^(gemini|gemma|learnlm)[-.]/i.test(modelId)) return modelId;
    if (modelId.startsWith('google/')) {
      const id = modelId.replace(/^google\//, '');
      if (!id || id === 'gemini') return null;
      return id;
    }
    return null;
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

  // Sintesi vocale (text-to-speech). Usa generateContent con
  // responseModalities:['AUDIO'] + speechConfig. La risposta contiene audio
  // grezzo PCM (audio/L16;codec=pcm;rate=24000) in inlineData (base64).
  // Ritorna { audioBase64, mimeType } — il chiamante lo incapsula in WAV.
  async function synthesizeSpeech({ apiKey, model, text, voice, signal }) {
    const geminiModel = toGeminiModelId(model);
    if (!geminiModel) throw new Error(`Gemini: modello non Google (${model})`);
    const clean = String(text == null ? '' : text).trim();
    if (!clean) throw new Error('Gemini TTS: testo vuoto');
    const url = `${BASE}/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: clean }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } },
        },
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini TTS ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const part = parts.find((p) => p.inlineData || p.inline_data);
    const inl = part && (part.inlineData || part.inline_data);
    if (!inl || !inl.data) throw new Error('Gemini TTS: nessun audio nella risposta');
    return {
      audioBase64: inl.data,
      mimeType: inl.mimeType || inl.mime_type || 'audio/L16;codec=pcm;rate=24000',
    };
  }

  // Embedding di uno o più testi (§3.2 ricerca semantica). Usa il modello di
  // embedding di Google (default text-embedding-004) via batchEmbedContents.
  // `dim` sfrutta Matryoshka (outputDimensionality) per accorciare i vettori e
  // contenere lo storage. Ritorna un array di vettori (array di float).
  async function embed({ apiKey, texts, model = 'text-embedding-004', dim = 256, signal }) {
    const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t == null ? '' : t).slice(0, 8000));
    if (!list.length) return [];
    const id = model.replace(/^models\//, '');
    const url = `${BASE}/models/${encodeURIComponent(id)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    const body = {
      requests: list.map((text) => ({
        model: `models/${id}`,
        content: { parts: [{ text: text || ' ' }] },
        outputDimensionality: dim,
      })),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini embed ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    return (data.embeddings || []).map((e) => (e && Array.isArray(e.values) ? e.values : []));
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
    synthesizeSpeech,
    toGeminiModelId,
    isGoogleModel: (id) => !!toGeminiModelId(id),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
