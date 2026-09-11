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
// Se il judge dice ok, il percorso viene INVIATO AL SERVER (callable
// `pathSubmit`), che riapplica la stessa pulizia deterministica e scrive lui.
// Nessun client scrive più nella raccolta (firestore.rules → match /paths):
// i due LLM qui sopra vivono sulla macchina di chi naviga e nessuna regola
// poteva provare che fossero passati.
//
// La pulizia deterministica (redaction dei selettori, tetti, forma del dominio
// e dell'URL, intento su una riga) NON sta più qui: è in
// `src/shared/pathsSafety.js`, da dove la incorpora anche il server. Qui resta
// la parte che può vivere solo sul client: i due LLM e i messaggi raw
// dell'utente, che non escono dalla sua macchina.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const Paths = global.SN_PATHS;
  const Safety = global.SN_PATHS_SAFETY;

  // Limiti difensivi sui messaggi raw dell'utente: non escono dalla macchina
  // (li vede solo il judge, che risponde 1 bit), ma un prompt non deve poter
  // esplodere.
  const MAX_USER_MSG_LEN = 1000;
  const MAX_USER_MSGS = 20;

  function sanitizeUserMessages(raws) {
    if (!Array.isArray(raws)) return [];
    return raws
      .filter((m) => typeof m === 'string' && m.trim())
      .slice(0, MAX_USER_MSGS)
      .map((m) => m.length > MAX_USER_MSG_LEN ? m.slice(0, MAX_USER_MSG_LEN) : m);
  }

  // ------------------------ Estrazione output LLM --------------------------

  // L'intent-guess produce una sola riga di testo. La ripuliamo con la pulizia
  // condivisa (una riga, niente marcature, tetto ai caratteri) e in più
  // riconosciamo la risposta "intento non chiaro", che significa: non salvare.
  function cleanGuessedIntent(text) {
    const s = Safety._internal.sanitizeIntent(typeof text === 'string' ? text : '');
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
  async function collectAndSave({ session, invokeAI, userAgent, clientId, idToken }) {
    if (!session || typeof session !== 'object') {
      return { saved: false, reason: 'session vuota' };
    }
    const domain = Safety._internal.domainOf(session.rawUrl);
    if (!domain) return { saved: false, reason: 'dominio non valido' };
    const initialUrl = Safety._internal.normalizedPath(session.rawUrl);
    const sanitizedSteps = Safety._internal.sanitizeSteps(session.rawSteps);
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

    // 3. invio al server, che ripulisce di nuovo e scrive.
    try {
      const { id } = await Paths.submit({
        domain,
        initialUrl,
        intent: guessedIntent,
        steps: sanitizedSteps,
        success: !!session.success,
        userAgent: userAgent || '',
        clientId: clientId || '',
        idToken: idToken || '',
      });
      return { saved: true, id, intent: guessedIntent };
    } catch (e) {
      return { saved: false, reason: `invio al server fallito: ${e.message || e}` };
    }
  }

  global.SN_PATHS_COLLECTOR = {
    collectAndSave,
    // Esposti per test/debug e per riuso in altri moduli. La pulizia
    // deterministica è quella condivisa col server: qui è solo ri-esportata,
    // non riscritta.
    _internal: {
      sanitizeUserMessages, cleanGuessedIntent, parseJudgeOutput,
      redactSelector: Safety._internal.redactSelector,
      sanitizeSteps: Safety._internal.sanitizeSteps,
      domainOf: Safety._internal.domainOf,
      normalizedPath: Safety._internal.normalizedPath,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
