// Raccolta percorsi della sidebar Aiuto: pipeline di sanitizzazione + save.
//
// Il client (sidebar) raccoglie una sessione raw (URL iniziale, sequenza di
// {selector, action, retracted}, messaggi raw dell'utente, esito 👍/👎) e la
// passa qui via MSG.SAVE_PATH. Tutto ciò che finisce nel DB pubblico passa
// prima per due LLM distinti per evitare leak di dati personali:
//
//   1. INTENT_GUESS   — vede SOLO i dati programmatici (dominio, URL, sequenza
//                       azioni con selettori sanitizzati). Produce una frase
//                       di intento "neutra".
//   2. INTENT_JUDGE   — vede l'intento proposto + i messaggi raw dell'utente.
//                       Risponde {ok: true|false}. Solo 1 bit esce da qui.
//
// Se il judge dice ok, il documento viene scritto su Firestore con success
// (true per 👍, false per 👎). I 👎 servono solo a noi per debug — non
// vengono mandati come contesto ad altri agenti.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const Paths = global.SN_PATHS;

  // ------------------------ Sanitizzazione selettori --------------------------
  //
  // I selettori prodotti dall'LLM possono contenere stringhe sensibili (es.
  // [aria-label="Profilo di mario.rossi@x.it"]). Le redaction sotto sostituiscono
  // i pattern sensibili con placeholder generici, in modo che il selettore
  // resti "leggibile" per l'LLM consumer ma non porti dati identificabili.
  //
  // Dopo la redaction lasciamo che il chiamante (sidebar) verifichi sul DOM se
  // il selettore redatto è ancora univoco; qui ci occupiamo solo della stringa.

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const LONG_NUM_RE = /\b\d{6,}\b/g;

  function redactSelector(selector) {
    if (typeof selector !== 'string' || !selector) return '';
    return selector
      .replace(EMAIL_RE, '[EMAIL]')
      .replace(LONG_NUM_RE, '[NUMERO]');
  }

  // Limiti difensivi per non far esplodere il documento Firestore.
  const MAX_STEPS = 30;
  const MAX_SELECTOR_LEN = 500;
  const MAX_USER_MSG_LEN = 1000;
  const MAX_USER_MSGS = 20;

  function sanitizeSteps(rawSteps) {
    if (!Array.isArray(rawSteps)) return [];
    const out = [];
    for (const s of rawSteps) {
      if (!s || typeof s !== 'object') continue;
      const action = (s.action === 'fill' || s.action === 'reveal' || s.action === 'hover')
        ? s.action : 'click';
      let selector = redactSelector(s.selector);
      if (!selector) continue;
      if (selector.length > MAX_SELECTOR_LEN) selector = selector.slice(0, MAX_SELECTOR_LEN);
      out.push({
        selector,
        action,
        retracted: !!s.retracted,
      });
      if (out.length >= MAX_STEPS) break;
    }
    return out;
  }

  function sanitizeUserMessages(raws) {
    if (!Array.isArray(raws)) return [];
    return raws
      .filter((m) => typeof m === 'string' && m.trim())
      .slice(0, MAX_USER_MSGS)
      .map((m) => m.length > MAX_USER_MSG_LEN ? m.slice(0, MAX_USER_MSG_LEN) : m);
  }

  // ------------------------ Normalizzazione URL --------------------------
  //
  // Per il matching futuro vogliamo URL "stabili": teniamo path (no query/hash)
  // perché query e fragment di solito contengono parametri specifici dell'utente
  // o stato di UI. Manteniamo invece il path completo perché spesso identifica
  // la sezione del sito (es. /account/orders).

  function parseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      return new URL(rawUrl);
    } catch (_) {
      return null;
    }
  }

  function domainOf(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    // hostname senza porta. Non strippiamo "www." per restare letterali:
    // chi consuma può fare il matching come preferisce.
    return (u.hostname || '').toLowerCase().slice(0, 253);
  }

  function normalizedPath(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    let path = u.pathname || '/';
    if (path.length > 2000) path = path.slice(0, 2000);
    return path;
  }

  // ------------------------ Estrazione output LLM --------------------------

  // L'intent-guess produce una sola riga di testo. Difese:
  // - tagliamo a 200 char,
  // - togliamo virgolette/backtick/asterischi,
  // - se vuoto o "intento non chiaro" → null.
  function cleanGuessedIntent(text) {
    if (typeof text !== 'string') return null;
    let s = text.trim();
    if (!s) return null;
    // toglie eventuale wrapping markdown / quoting
    s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
    s = s.replace(/^[*_]+|[*_]+$/g, '').trim();
    // prendi solo la prima linea (alcuni modelli sbordano)
    s = s.split(/\r?\n/)[0].trim();
    if (s.length > 200) s = s.slice(0, 200);
    if (!s) return null;
    if (/^intento non chiaro\.?$/i.test(s)) return null;
    return s;
  }

  function parseJudgeOutput(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return false;
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      return obj && obj.ok === true;
    } catch (_) {
      return false;
    }
  }

  // ------------------------ Orchestratore --------------------------
  //
  // Ritorna { saved: bool, reason: string }. Non lancia: i fallimenti sono
  // reportati come reason testuale così il chiamante può loggare senza che
  // l'utente veda errori (è una pipeline best-effort di telemetria).
  async function collectAndSave({ session, invokeAI, userAgent, clientId }) {
    if (!session || typeof session !== 'object') {
      return { saved: false, reason: 'session vuota' };
    }
    const domain = domainOf(session.rawUrl);
    if (!domain) return { saved: false, reason: 'dominio non valido' };
    const initialUrl = normalizedPath(session.rawUrl);
    const sanitizedSteps = sanitizeSteps(session.rawSteps);
    if (!sanitizedSteps.length) return { saved: false, reason: 'nessuno step utile dopo sanitizzazione' };

    const rawUserMessages = sanitizeUserMessages(session.rawUserMessages);
    if (!rawUserMessages.length) return { saved: false, reason: 'nessun messaggio utente raw' };

    // 1. intent guess: vede SOLO dati programmatici già sanitizzati.
    let guessedIntent = null;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_GUESS,
        payload: { domain, initialUrl, steps: sanitizedSteps },
      });
      guessedIntent = cleanGuessedIntent(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_guess fallito: ${e.message || e}` };
    }
    if (!guessedIntent) return { saved: false, reason: 'intento non chiaro' };

    // 2. judge: vede l'intento proposto + messaggi raw. Output: solo 1 bit.
    let ok = false;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_JUDGE,
        payload: { proposedIntent: guessedIntent, userMessages: rawUserMessages },
      });
      ok = parseJudgeOutput(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_judge fallito: ${e.message || e}` };
    }
    if (!ok) return { saved: false, reason: 'judge ha rifiutato l\'intento' };

    // 3. write
    try {
      const { id } = await Paths.submit({
        domain,
        initialUrl,
        intent: guessedIntent,
        steps: sanitizedSteps,
        success: !!session.success,
        userAgent: userAgent || '',
        clientId: clientId || '',
      });
      return { saved: true, id, intent: guessedIntent };
    } catch (e) {
      return { saved: false, reason: `firestore write fallito: ${e.message || e}` };
    }
  }

  global.SN_PATHS_COLLECTOR = {
    collectAndSave,
    // Esposti per test/debug e per riuso in altri moduli.
    _internal: { redactSelector, sanitizeSteps, sanitizeUserMessages, domainOf, normalizedPath, cleanGuessedIntent, parseJudgeOutput },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
