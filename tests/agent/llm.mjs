// Client minimale per Google AI Studio (Gemini / Gemma) con input immagine.
//
// La chiave si legge da GEMINI_API_KEY (o GOOGLE_AI_API_KEY). NON committare la
// chiave: passala via env.
//
// Modelli vision utili (free tier generoso su AI Studio):
//   gemini-3.5-flash        capace, quota bassa (~20/g) — per run mirati
//   gemini-3.1-flash-lite   buon compromesso (~500/g)
//   gemma-4-31b-it          alta quota (~1500/g)
//   gemma-4-26b-a4b-it      alta quota (~1500/g)

import { readFileSync } from 'node:fs';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function getApiKey() {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!k) throw new Error('Imposta GEMINI_API_KEY (o GOOGLE_AI_API_KEY) con la chiave AI Studio.');
  return k;
}

const isGemma = (model) => /gemma/i.test(model);

// Genera contenuto da testo (+ immagine PNG opzionale). Ritorna stringa.
export async function generate({ model, system, user, imagePath, temperature = 0.4, apiKey }) {
  apiKey = apiKey || getApiKey();
  const parts = [];
  // Gemma non supporta systemInstruction: lo fondiamo nel turno utente.
  const userText = isGemma(model) && system ? `${system}\n\n---\n\n${user}` : user;
  parts.push({ text: userText });
  if (imagePath) {
    const data = readFileSync(imagePath).toString('base64');
    parts.push({ inline_data: { mime_type: 'image/png', data } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, maxOutputTokens: 2048 },
  };
  if (!isGemma(model)) {
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    body.generationConfig.responseMimeType = 'application/json';
  }

  const url = `${ENDPOINT}/${model}:generateContent?key=${apiKey}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) { // rate limit
        const wait = 4000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      const json = await res.json();
      const cand = json.candidates?.[0];
      const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
      if (!text) throw new Error('risposta vuota: ' + JSON.stringify(json).slice(0, 300));
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

// Estrae il primo oggetto JSON da una stringa (gestisce ```json fences ecc.).
export function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  // prova diretto
  try { return JSON.parse(t); } catch (_) {}
  // prova a isolare dal primo { all'ultimo }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {}
  }
  return null;
}

// Verifica veloce che un modello risponda (e supporti immagini se imagePath dato).
export async function ping(model, imagePath) {
  const out = await generate({
    model,
    system: 'Rispondi in JSON.',
    user: imagePath ? 'Descrivi in 5 parole cosa vedi. Formato: {"desc":"..."}' : 'Dì ciao in JSON: {"hi":true}',
    imagePath,
    temperature: 0,
  });
  return out;
}
