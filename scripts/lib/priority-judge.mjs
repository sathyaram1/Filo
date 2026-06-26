// Giudice di priorità LLM per i feedback (P3).
//
// DESIGN
//   Il giudice riceve il TESTO di un feedback (in chiaro, già decifrato) +
//   il numero di duplicati noti, e produce { isSecurity, priority: 0..2 }.
//
//   Un wrapper deterministico (`applyClamp`) applica la REGOLA DURA:
//     - isSecurity === true  →  priorità finale = 3 (sicurezza SOLO via questo flag)
//     - altrimenti           →  clamp(priority, 0, 2) — anche se l'LLM dicesse 3
//   Il 3 è riservato alla sicurezza per CODICE, non per prompt.
//
// OVERRIDE OWNER
//   Il giudice NON deve essere chiamato su feedback con priorità impostata
//   manualmente dall'owner. Segnale di override: il campo `priorityManual`
//   (booleano `true`) sul doc feedback. Se il campo non esiste (tutti i doc
//   attuali), il giudice viene comunque chiamato perché:
//     - il pattern in uso è "il giudice assegna la priority; l'owner può
//       spostare la manopola" → il campo non esiste ancora nello schema.
//     - L'applier (`groom-apply.mjs`) salta il giudice se `fb.priorityManual === true`,
//       rendendo il comportamento già corretto non appena Firestore espone il campo.
//   (Vedi sezione "Override owner" in groom-apply.mjs.)
//
// INIETTABILITÀ
//   La funzione che chiama il modello (`llmCall`) è un parametro/dipendenza:
//   negli unit test si sostituisce con un mock sincrono. Il default in produzione
//   usa `tests/agent/llm.mjs` (o la tua impl equivalente) tramite fetch.
//
// MODELLO
//   Slot `judgePriority` di `resolveSupportModel`; fallback al nickname 'flash'.
//   Il giudice gira come script autonomo (routine cloud / main process): non
//   ha accesso a `buildAttemptChain`/settings Electron. La chiave API arriva
//   da `GEMINI_API_KEY` (o dal file `tests/agent/.env`).
//
// USO TIPICO (routine cloud, integrato in groom-apply.mjs)
//   import { makePriorityJudge, applyClamp } from './lib/priority-judge.mjs';
//
//   // Giudice con LLM reale (Gemini via env):
//   const judge = makePriorityJudge();
//   const raw = await judge(feedbackText, dupeCount);
//   const final = applyClamp(raw);   // { isSecurity, priority: 0..3 }
//
//   // Giudice con mock (test):
//   const mockJudge = makePriorityJudge((_text, _dupes) => ({ isSecurity: false, priority: 1 }));
//   const raw2 = await mockJudge('...', 0);
//   const final2 = applyClamp(raw2);

// ── Prompt di sistema per il giudice ─────────────────────────────────────────

const SYSTEM_PROMPT = `Sei un classificatore di priorità per i feedback utente di Filo (browser AI-native).
Il tuo compito è assegnare una priorità 0-2 e valutare se il feedback riguarda la SICUREZZA.

Scala indicativa (non rigida: sei libero di pesare liberamente i segnali):
  2 = bug di funzionalità esistente, regressione, problema che blocca l'utente
  1 = nuova feature richiesta, miglioramento
  0 = problema estetico, cosmetic, preferenza
L'LLM può assegnare 2 a un bug estetico segnalato da molti utenti.

Sicurezza (isSecurity = true): SOLO se il feedback descrive una vulnerabilità di sicurezza,
esposizione di dati, privilege escalation, XSS, injection, autenticazione compromessa o simili.
NON classificare come security problemi normali di bug o UX.

Rispondi SOLO con JSON valido:
{ "isSecurity": boolean, "priority": number }

dove priority è un intero 0, 1 o 2.`;

// ── Prompt utente (composto dall'applier) ─────────────────────────────────────

/**
 * Costruisce il prompt utente per il giudice.
 * @param {string} text     - Testo del feedback (in chiaro, max 2000 char).
 * @param {number} dupeCount - Numero di duplicati noti.
 * @returns {string}
 */
export function buildUserPrompt(text, dupeCount) {
  const truncated = String(text || '').slice(0, 2000);
  const dupeNote = dupeCount > 0
    ? `\n[Duplicati noti: ${dupeCount} — altri utenti hanno segnalato lo stesso problema]`
    : '';
  return `Feedback da classificare:
"""
${truncated}
"""${dupeNote}

Rispondi con JSON: { "isSecurity": boolean, "priority": 0|1|2 }`;
}

// ── Wrapper deterministico (regola dura) ──────────────────────────────────────

/**
 * Applica la regola dura di clamp al verdetto LLM.
 *
 * Regola dura (in codice, NON nel prompt):
 *   - Se isSecurity === true  → priority forzata a 3 (sicurezza, riservato).
 *   - Altrimenti              → clamp(priority, 0, 2).
 *     Anche se l'LLM avesse detto 3, viene tagliato a 2.
 *
 * @param {{ isSecurity: boolean, priority: number }} raw - Verdetto grezzo dell'LLM.
 * @returns {{ isSecurity: boolean, priority: number }}   - Verdetto clamped (0..3).
 */
export function applyClamp(raw) {
  const isSecurity = !!raw.isSecurity;
  if (isSecurity) return { isSecurity: true, priority: 3 };
  // Clamp a 0..2: l'LLM non può assegnare 3 (riservato alla sicurezza).
  const p = Number.isInteger(raw.priority) ? raw.priority : 0;
  return { isSecurity: false, priority: Math.max(0, Math.min(2, p)) };
}

// ── Fabbrica del giudice ──────────────────────────────────────────────────────

/**
 * Crea un giudice di priorità.
 *
 * @param {Function|null} [llmCallOverride]
 *   Funzione opzionale che sostituisce la chiamata LLM reale.
 *   Firma: (text: string, dupeCount: number) => Promise<{ isSecurity: boolean, priority: number }>
 *   oppure lo stesso valore in modo sincrono (nei test).
 *   Se null/undefined → usa la chiamata Gemini reale via tests/agent/llm.mjs.
 *
 * @returns {Function} giudice: (text: string, dupeCount: number) → Promise<{ isSecurity: boolean, priority: number }>
 *   Ritorna il verdetto RAW (non clamped). Chiama `applyClamp` su questo per
 *   ottenere la priorità finale garantita 0..3.
 */
export function makePriorityJudge(llmCallOverride) {
  if (typeof llmCallOverride === 'function') {
    // Modalità test / mock: delega direttamente all'override.
    return async (text, dupeCount) => {
      const result = await llmCallOverride(text, dupeCount);
      return normalizeRaw(result);
    };
  }

  // Modalità produzione: usa Gemini via fetch (pattern tests/agent/llm.mjs).
  return async (text, dupeCount) => {
    const { generate, getApiKey, extractJson } = await import('../tests/agent/llm.mjs'
      // eslint-disable-next-line no-undef
    ).catch(() => null) || await import('../../tests/agent/llm.mjs').catch(() => null);

    if (!generate) throw new Error('[priority-judge] impossibile importare tests/agent/llm.mjs');

    const apiKey = getApiKey(); // lancia se manca GEMINI_API_KEY / .env

    // Risolve il modello dallo slot `judgePriority` (lato cloud: resolveSupportModel
    // non è disponibile direttamente, usiamo il nickname dal suo SLOT_DEFAULTS).
    // Se l'owner ha configurato lo slot su Firestore, il giudice lo leggerà nella
    // prossima versione quando resolveSupportModel sarà disponibile anche negli script.
    // Per ora: fallback deterministico = 'gemini-3.1-flash-lite' (stesso del daily).
    // TODO: integrare resolveSupportModel quando sarà un modulo ESM stand-alone.
    const model = process.env.FILO_JUDGE_MODEL || 'gemini-3.1-flash-lite';

    const userPrompt = buildUserPrompt(text, dupeCount);

    const schema = {
      type: 'object',
      properties: {
        isSecurity: { type: 'boolean' },
        priority:   { type: 'integer', enum: [0, 1, 2] },
      },
      required: ['isSecurity', 'priority'],
    };

    let rawText;
    try {
      rawText = await generate({ model, system: SYSTEM_PROMPT, user: userPrompt, schema, apiKey, temperature: 0.1 });
    } catch (e) {
      throw new Error(`[priority-judge] chiamata LLM fallita: ${e.message}`);
    }

    let parsed;
    try {
      // `generate` con schema torna già JSON; extractJson gestisce il caso Gemma
      // che non supporta responseSchema e torna prosa con JSON embedded.
      parsed = typeof rawText === 'string' ? (extractJson ? extractJson(rawText) : JSON.parse(rawText)) : rawText;
    } catch (e) {
      throw new Error(`[priority-judge] risposta LLM non JSON: ${String(rawText).slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`[priority-judge] parsed non è un oggetto: ${JSON.stringify(parsed)}`);
    }

    return normalizeRaw(parsed);
  };
}

// ── Helpers interni ───────────────────────────────────────────────────────────

/**
 * Normalizza il verdetto grezzo: garantisce che { isSecurity, priority } siano
 * di tipo corretto (boolean + integer 0..2). Non applica la regola dura (quella
 * è in applyClamp). Usata sia dalla modalità mock che da quella produzione.
 * @param {any} raw
 * @returns {{ isSecurity: boolean, priority: number }}
 */
function normalizeRaw(raw) {
  if (!raw || typeof raw !== 'object') {
    return { isSecurity: false, priority: 0 };
  }
  const isSecurity = !!raw.isSecurity;
  // priority: accetta 0, 1, 2 (o 3 se l'LLM lo dà — applyClamp lo taglierà).
  const p = Number(raw.priority);
  const priority = Number.isFinite(p) && Number.isInteger(p) ? Math.max(0, p) : 0;
  return { isSecurity, priority };
}
