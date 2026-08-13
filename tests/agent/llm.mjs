// Client minimale per i modelli usati dagli strumenti di test agentici.
//
// PERCHÉ NON GOOGLE (#461)
//   Prima questo file parlava con Google AI Studio. Gemma ha i pesi aperti,
//   quindi il MODELLO andava bene: era il fornitore a essere escluso dalla
//   politica sui modelli di Filo, che vale anche per lo sviluppo di Filo stesso.
//   Ora si passa da OpenRouter — che smista e non produce modelli — con la lista
//   di esclusione dei produttori allegata a ogni richiesta, e si controlla chi ha
//   DAVVERO servito la risposta: senza quel riscontro l'esclusione è una
//   speranza. Di Gemini non resta niente: è proprietario e non ha sostituto
//   ammesso.
//
// La chiave si legge da OPENROUTER_API_KEY. NON committarla: passala via env o
// mettila in tests/agent/.env (gitignorato).
//
// Modelli utili (tutti a pesi aperti, serviti da fornitori indipendenti):
//   google/gemma-4-31b-it        default — vede le immagini, buon compromesso
//   google/gemma-4-26b-a4b-it    più economico, quota alta → run lunghi
//   qwen/qwen3-vl-32b-instruct   alternativa vision

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// La politica sui fornitori è UNA SOLA e vive nel codice dell'app: qui la
// importiamo invece di ricopiarla, così se l'owner aggiunge un escluso vale
// subito anche per gli strumenti di test.
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;
// Gli strumenti di test lavorano solo con modelli a pesi aperti: la lista
// include quindi anche Anthropic (che quei modelli non li servirebbe comunque,
// ma dichiararlo rende la regola leggibile).
const EXCLUDED = C.effectiveExcludedProviders(C.DEFAULT_EXCLUDED_PROVIDERS, true);

// Legge la chiave da env oppure da tests/agent/.env (gitignorato).
// Formato .env: OPENROUTER_API_KEY=...
export function getApiKey() {
  let k = process.env.OPENROUTER_API_KEY || process.env.FILO_DEFAULT_OPENROUTER_KEY;
  if (!k) {
    const envPath = join(__dirname, '.env');
    if (existsSync(envPath)) {
      const m = readFileSync(envPath, 'utf8')
        .match(/^\s*(?:OPENROUTER_API_KEY|FILO_DEFAULT_OPENROUTER_KEY)\s*=\s*(.+)\s*$/m);
      if (m) k = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!k) {
    throw new Error('Manca la chiave: imposta OPENROUTER_API_KEY o crea tests/agent/.env con OPENROUTER_API_KEY=...');
  }
  return k;
}

// Costruisce una part immagine da un file PNG (per i `contents` multi-turn).
// Il formato interno resta quello "a parti" già usato dai chiamanti; la
// traduzione nel formato del fornitore avviene in toApiMessages.
export function imagePart(path) {
  return { inline_data: { mime_type: 'image/png', data: readFileSync(path).toString('base64') } };
}

// Traduce la conversazione interna ({role:'user'|'model', parts:[{text}|{inline_data}]})
// nel formato messaggi standard, con le immagini come data URL.
function toApiMessages(convo, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const turn of convo) {
    const role = turn.role === 'model' ? 'assistant' : 'user';
    const parts = turn.parts || [];
    const hasImage = parts.some((p) => p.inline_data);
    if (!hasImage) {
      out.push({ role, content: parts.map((p) => p.text || '').filter(Boolean).join('\n') });
      continue;
    }
    const content = [];
    for (const p of parts) {
      if (p.inline_data) {
        const mime = p.inline_data.mime_type || 'image/png';
        content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${p.inline_data.data}` } });
      } else if (p.text) {
        content.push({ type: 'text', text: p.text });
      }
    }
    out.push({ role, content });
  }
  return out;
}

// Chi ha DAVVERO servito la risposta. OpenRouter lo riporta nel campo
// `provider`: è la controprova della lista di esclusione.
function servedBy(json) {
  return (json && (json.provider || json.served_by)) || '';
}

// Genera contenuto. Due modalità:
//   - one-shot:    { user, imagePath }           → singolo turno utente
//   - multi-turn:  { contents: [{role,parts}] }  → conversazione completa
// `contents` ha precedenza. Se `schema` è dato, si chiede output strutturato
// (JSON Schema); se il modello/fornitore non lo supporta si ripiega su JSON
// libero, che il chiamante sa comunque estrarre.
export async function generate({ model, system, user, imagePath, contents, temperature = 0.4, apiKey, schema }) {
  apiKey = apiKey || getApiKey();

  let convo;
  if (Array.isArray(contents) && contents.length) {
    convo = contents.map((t) => ({ role: t.role, parts: t.parts.slice() }));
  } else {
    const parts = [{ text: user || '' }];
    if (imagePath) parts.push(imagePart(imagePath));
    convo = [{ role: 'user', parts }];
  }

  const baseBody = {
    model,
    messages: toApiMessages(convo, system),
    temperature,
    // Cap moderato: i modelli piccoli a volte degenerano in ripetizioni dentro
    // una stringa; un cap basso fa fallire in fretta e il chiamante ritenta.
    max_tokens: 2048,
    // Politica sui fornitori: i produttori esclusi non devono servire la
    // richiesta nemmeno quando il modello è a pesi aperti.
    provider: { ignore: EXCLUDED },
  };

  const withFormat = schema
    ? { ...baseBody, response_format: { type: 'json_schema', json_schema: { name: 'risposta', strict: false, schema } } }
    : { ...baseBody, response_format: { type: 'json_object' } };

  const MAX = 5;
  let lastErr;
  let body = withFormat;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      // Timeout esplicito: meglio fallire e ritentare che restare appesi.
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 60_000);
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://github.com/sathyaram1/Filo',
            'X-Title': 'Filo agent tests',
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally { clearTimeout(to); }

      if (res.status === 429 || res.status >= 500) { // rate limit / errore server → ritenta
        lastErr = new Error(`HTTP ${res.status} (quota/limite) su ${model}`);
        lastErr.status = res.status;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        // Output strutturato non supportato da questo modello/fornitore: si
        // riprova senza, invece di rinunciare al run.
        if (body.response_format && /response_format|json_schema|structured/i.test(t)) {
          body = { ...baseBody };
          lastErr = new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }

      const json = await res.json();
      // Controprova: se a servire è stato un escluso, il run si ferma. Un test
      // che gira comunque su un fornitore escluso non è un test, è la politica
      // aggirata con più passaggi.
      const host = servedBy(json);
      if (host && C.isProviderExcluded(host, EXCLUDED)) {
        const e = new Error(`Fornitore ESCLUSO dalla politica sui modelli: "${host}". Richiesta annullata.`);
        // Non è un guasto passeggero: ritentare rifarebbe lo stesso errore
        // pagandolo di nuovo. Si ferma subito e si guarda perché è passato.
        e.policy = true;
        throw e;
      }
      const text = json.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('risposta vuota: ' + JSON.stringify(json).slice(0, 300));
      return text;
    } catch (e) {
      lastErr = e;
      if (e && e.policy) throw e; // violazione della politica: mai ritentata
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

// Esportata per i test: la lista di esclusione allegata a ogni richiesta.
export const excludedProviders = EXCLUDED;
