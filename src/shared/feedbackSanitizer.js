// Sanitizzazione dei feedback per la bacheca pubblica (DD2): logica pura, zero I/O, con la funzione LLM iniettata dal chiamante (slot «sanitizer» di DD1).
// La parte deterministica — quali campi di un feedback possono stare sotto gli occhi di chiunque — è diventata la VISTA PUBBLICA (#583): decide feedbackPublicView.js e la contiene `feedback-public/{id}`. Qui resta solo il passo che quella vista non fa, redigere con un LLM il TESTO libero; finché non servirà, la bacheca mostra solo il titolo.
// Deve girare lato backend o owner-app, che hanno la chiave privata per decifrare S1: il client non ce l'ha e non deve ricevere il testo grezzo di altri utenti. Il risultato si salva in un campo a parte e la bacheca legge da lì, mai dal testo grezzo.

(function (global) {
  'use strict';

  const ALLOWED_FIELDS = Object.freeze([
    'name',
    'seq',
    'subSeq',
    'statusPublic',
    'resolvedInVersion',
    'isShipped',
    'sanitizedText',
  ]);

  // Passo 1, deterministico: proietta il doc sui soli ALLOWED_FIELDS e scarta tutto il resto, compresi i campi aggiunti in futuro. `sanitizedText` resta null: lo popola eventualmente il passo 2.
  function sanitizeMetadata(doc) {
    if (!doc || typeof doc !== 'object') return { sanitizedText: null };

    // Si lavora su oggetti JS già decodificati. Se per sbaglio arriva il raw Firestore (.fields), i campi cercati non ci sono e il risultato esce quasi vuoto: meglio meno che di più.
    const out = { sanitizedText: null };
    for (const field of ALLOWED_FIELDS) {
      if (field === 'sanitizedText') continue; // lo gestisce passo 2
      if (Object.prototype.hasOwnProperty.call(doc, field) && doc[field] !== undefined) {
        out[field] = doc[field];
      }
    }
    return out;
  }

  // Passo 2, redazione LLM. `text` è il testo libero già in CHIARO: questo modulo non sa decifrare, né deve. `llmFn` è async (prompt) => string e la sceglie il chiamante.
  // Si chiede all'LLM se il testo contiene informazioni personali: risposta che comincia con CLEAN: → testo pulito, con REDACTED: → si usa il redatto. Il formato è volutamente semplice per ridurre le risposte malformate.
  // In ogni altro caso — testo vuoto, llmFn assente, eccezione, timeout, risposta non conforme — si torna null: meglio mostrare meno che rivelare dati personali per un errore dell'LLM.
  async function sanitizeText(text, llmFn) {
    if (text == null || String(text).trim() === '') return null;
    if (typeof llmFn !== 'function') return null; // fallback conservativo

    const cleanText = String(text).trim();

    const prompt = [
      'Sei un filtro di privacy per una bacheca pubblica di miglioramenti software.',
      'Il seguente testo è stato scritto da un utente durante un test. Devi:',
      '1. Verificare se contiene informazioni personali identificabili (PII): email, telefoni, nomi propri, indirizzi fisici, URL personali, username, ID utente, o qualsiasi altra info che identifichi una persona.',
      '2. Se NON contiene PII → rispondi ESATTAMENTE con: CLEAN:<testo originale invariato>',
      '3. Se contiene PII → rispondi ESATTAMENTE con: REDACTED:<testo con le PII sostituite da [RIMOSSO]>',
      '4. Non aggiungere nulla prima di CLEAN: o REDACTED:. Niente spiegazioni.',
      '',
      'Testo da analizzare:',
      cleanText,
    ].join('\n');

    let raw;
    try {
      raw = await llmFn(prompt);
    } catch (_) {
      // llmFn ha lanciato (timeout, rete, quota): fallback conservativo.
      return null;
    }

    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const resp = raw.trim();

    if (resp.startsWith('CLEAN:')) {
      // Testo pulito: si usa l'ORIGINALE, non la copia rimandata dall'LLM.
      return cleanText;
    }
    if (resp.startsWith('REDACTED:')) {
      const redacted = resp.slice('REDACTED:'.length).trim();
      if (!redacted) return null; // risposta malformata → fallback
      return redacted;
    }

    // Risposta fuori formato: fallback conservativo.
    return null;
  }

  // Passo 1 più passo 2, oggetto pronto. Il chiamante passa il testo GIÀ decifrato come `doc.text`, oppure omette il testo e la bacheca mostra solo il titolo: un ciphertext FENC1: l'LLM non lo interpreta.
  // Chi lo chiama: la routine dopo aver chiuso un feedback e superato la verifica avversariale, un trigger su `status == 'done'`, oppure il main dell'owner, che ha la chiave privata.
  async function sanitize(doc, llmFn) {
    const meta = sanitizeMetadata(doc);

    // Testo libero: solo se presente e in chiaro.
    const rawText = doc && typeof doc.text === 'string' ? doc.text.trim() : null;
    const isCiphertext = rawText && rawText.startsWith('FENC1:');

    let sanitizedText = null;
    if (rawText && !isCiphertext) {
      sanitizedText = await sanitizeText(rawText, llmFn);
    }
    // Ciphertext o testo assente: `sanitizedText` resta null e in bacheca va solo il titolo.

    meta.sanitizedText = sanitizedText;
    return meta;
  }

  global.SN_FEEDBACK_SANITIZER = {
    ALLOWED_FIELDS,
    sanitizeMetadata,
    sanitizeText,
    sanitize,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_SANITIZER;
}
