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

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const __dirname = dirname(fileURLToPath(import.meta.url));

// Legge la chiave da env oppure da tests/agent/.env (gitignorato).
// Formato .env: GEMINI_API_KEY=...
export function getApiKey() {
  let k = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!k) {
    const envPath = join(__dirname, '.env');
    if (existsSync(envPath)) {
      const m = readFileSync(envPath, 'utf8').match(/^\s*(?:GEMINI_API_KEY|GOOGLE_AI_API_KEY)\s*=\s*(.+)\s*$/m);
      if (m) k = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!k) throw new Error('Manca la chiave: imposta GEMINI_API_KEY o crea tests/agent/.env con GEMINI_API_KEY=...');
  return k;
}

const isGemma = (model) => /gemma/i.test(model);

// Costruisce una part immagine da un file PNG (per i `contents` multi-turn).
export function imagePart(path) {
  return { inline_data: { mime_type: 'image/png', data: readFileSync(path).toString('base64') } };
}

// Genera contenuto. Due modalità:
//   - one-shot:    { user, imagePath }           → singolo turno utente
//   - multi-turn:  { contents: [{role,parts}] }  → conversazione completa
// `contents` ha precedenza. Se `schema` è dato, vincola l'output (responseSchema)
// → JSON valido sia per Gemini sia per Gemma.
export async function generate({ model, system, user, imagePath, contents, temperature = 0.4, apiKey, schema }) {
  apiKey = apiKey || getApiKey();

  let convo;
  if (Array.isArray(contents) && contents.length) {
    // clone per non mutare il chiamante
    convo = contents.map((t) => ({ role: t.role, parts: t.parts.slice() }));
  } else {
    const parts = [{ text: user || '' }];
    if (imagePath) parts.push(imagePart(imagePath));
    convo = [{ role: 'user', parts }];
  }
  // Gemma non supporta systemInstruction: fondiamo il system nel PRIMO turno utente.
  if (isGemma(model) && system) {
    const firstUser = convo.find((t) => t.role === 'user');
    if (firstUser) {
      const ti = firstUser.parts.findIndex((p) => typeof p.text === 'string');
      if (ti >= 0) firstUser.parts[ti] = { text: `${system}\n\n---\n\n${firstUser.parts[ti].text}` };
      else firstUser.parts.unshift({ text: system });
    }
  }

  const body = {
    contents: convo,
    // Cap moderato: i modelli piccoli a volte degenerano in ripetizioni dentro
    // una stringa; un cap basso fa fallire in fretta e il chiamante ritenta.
    generationConfig: { temperature, maxOutputTokens: 2048 },
  };
  // systemInstruction solo su Gemini (Gemma lo riceve fuso nel testo).
  if (!isGemma(model) && system) body.systemInstruction = { parts: [{ text: system }] };
  // Output strutturato: lo schema vincola il decoder → niente prosa fuori formato.
  if (schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = schema;
  } else if (!isGemma(model)) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const url = `${ENDPOINT}/${model}:generateContent?key=${apiKey}`;
  const MAX = 5;
  let lastErr;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      // Timeout esplicito: meglio fallire e ritentare che restare appesi.
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 60_000);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally { clearTimeout(to); }
      if (res.status === 429 || res.status >= 500) { // rate limit / errore server → ritenta
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
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
      // errori di rete ("fetch failed", abort, ecc.) → backoff e ritenta
      if (attempt < MAX - 1) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
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
