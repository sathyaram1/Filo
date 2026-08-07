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
    // Con includeThoughts attivo, i "pensieri" arrivano come parti con
    // thought:true: NON sono la risposta, vanno separati (vedi extractParts).
    return parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
  }

  // Separa, in un chunk di stream, il testo di RISPOSTA dal RAGIONAMENTO
  // ("thought summary"). Con thinkingConfig.includeThoughts:true i pensieri
  // arrivano come parti con `thought:true`; la risposta vera è nelle altre.
  function extractParts(data) {
    const cand = data?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    let answer = '';
    let thought = '';
    for (const p of parts) {
      if (!p || typeof p.text !== 'string') continue;
      if (p.thought) thought += p.text;
      else answer += p.text;
    }
    return { answer, thought };
  }

  // `cachedContentTokenCount` = quanti token del testo in ingresso Gemini ha
  // RIUSATO dalla cache invece di ricalcolarli (#422). Il riuso è implicito e
  // automatico, ma vale solo se l'inizio della richiesta è identico a una
  // precedente: è il numero con cui si verifica che i prompt tengano davvero la
  // parte immutabile in testa. Assente/0 = nessun riuso.
  function extractUsage(data) {
    const u = data?.usageMetadata || {};
    return {
      promptTokens: u.promptTokenCount || 0,
      completionTokens: u.candidatesTokenCount || 0,
      cachedPromptTokens: u.cachedContentTokenCount || 0,
    };
  }

  // Livello di reasoning scelto dall'owner (#369) → thinkingConfig di Gemini.
  // thinkingBudget è in token: 0 disabilita il "pensiero" (sui modelli flash/lite),
  // valori crescenti danno più sforzo. `wantThoughts` = includi i thought summary
  // in streaming (onReasoning). Ritorna null se non c'è nulla da configurare
  // (auto senza streaming = comportamento di prima). I modelli che non pensano
  // ignorano il campo — best-effort, coerente con "quando possibile".
  function thinkingConfigFor(level, wantThoughts) {
    const cfg = {};
    if (level === 'off') cfg.thinkingBudget = 0;
    else if (level === 'low') cfg.thinkingBudget = 1024;
    else if (level === 'medium') cfg.thinkingBudget = 8192;
    else if (level === 'high') cfg.thinkingBudget = 24576;
    if (wantThoughts) cfg.includeThoughts = true;
    return Object.keys(cfg).length ? cfg : null;
  }

  async function complete({ apiKey, model, messages, reasoning, signal }) {
    const geminiModel = toGeminiModelId(model);
    if (!geminiModel) { const err = new Error(`Gemini: modello non Google (${model})`); err.provider = 'gemini'; throw err; }
    const url = `${BASE}/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = toGeminiRequest(messages);
    const tc = thinkingConfigFor(reasoning, false);
    if (tc) body.generationConfig = { ...(body.generationConfig || {}), thinkingConfig: tc };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // status/provider strutturati sull'errore: chi lo mostra all'utente può
      // tradurlo in una frase comprensibile invece del codice HTTP nudo (#331).
      const err = new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      err.provider = 'gemini';
      throw err;
    }
    const data = await res.json();
    return { text: extractText(data), usage: extractUsage(data) };
  }

  async function streamComplete({ apiKey, model, messages, reasoning, onDelta, onReasoning, signal }) {
    const geminiModel = toGeminiModelId(model);
    if (!geminiModel) { const err = new Error(`Gemini: modello non Google (${model})`); err.provider = 'gemini'; throw err; }
    const url = `${BASE}/models/${encodeURIComponent(geminiModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    const body = toGeminiRequest(messages);
    // Reasoning: unisce il livello dell'owner (#369, thinkingBudget) e la
    // richiesta del caller di includere i thought summary in streaming
    // (includeThoughts). Il modello manda i pensieri come parti con thought:true
    // (separate dalla risposta). Best-effort: se il modello non pensa, l'API
    // ignora il flag e non arrivano parti thought (cadiamo sulle frasi
    // indicative lato dashboard).
    const tc = thinkingConfigFor(reasoning, !!onReasoning);
    if (tc) {
      body.generationConfig = {
        ...(body.generationConfig || {}),
        thinkingConfig: tc,
      };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      err.provider = 'gemini';
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
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
        if (!payload || payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          const { answer, thought } = extractParts(obj);
          if (thought) {
            try { onReasoning && onReasoning(thought); } catch (_) {}
          }
          if (answer) {
            fullText += answer;
            try { onDelta && onDelta(answer); } catch (_) {}
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
    if (!geminiModel) { const err = new Error(`Gemini: modello non Google (${model})`); err.provider = 'gemini'; throw err; }
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

  // Embedding di uno o più testi (§3.2 ricerca semantica), via
  // batchEmbedContents. `dim` sfrutta Matryoshka (outputDimensionality) per
  // accorciare i vettori e contenere lo storage. Ritorna un array di vettori
  // (array di float).
  //
  // Il modello è OBBLIGATORIO e arriva dal chiamante: qui non c'è nessun
  // ripiego scritto nel codice. Averlo significava che, tolto il modello dalla
  // configurazione, l'indicizzazione continuava lo stesso su un modello che
  // nessuno aveva scelto — e nessuno poteva accorgersene.
  async function embed({ apiKey, texts, model, dim = 256, signal }) {
    if (!model) throw new Error('Nessun modello di indicizzazione impostato.');
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
    thinkingConfigFor,
    synthesizeSpeech,
    embed,
    toGeminiModelId,
    isGoogleModel: (id) => !!toGeminiModelId(id),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
