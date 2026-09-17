// Sanitizzazione dei feedback per la bacheca: pura, con l'LLM iniettato dal chiamante.
// La parte deterministica è passata alla VISTA PUBBLICA (feedbackPublicView.js): qui resta
// solo la redazione LLM del testo libero, che gira dove c'è la chiave privata.

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

  // Proietta sui soli ALLOWED_FIELDS e scarta il resto, compresi i campi futuri.
  // `sanitizedText` resta null: lo popola semmai il passo 2.
  function sanitizeMetadata(doc) {
    if (!doc || typeof doc !== 'object') return { sanitizedText: null };

    // Oggetti JS già decodificati: col raw Firestore i campi non ci sono e l'esito esce
    // quasi vuoto, che è la direzione giusta — meglio meno che di più.
    const out = { sanitizedText: null };
    for (const field of ALLOWED_FIELDS) {
      if (field === 'sanitizedText') continue; // lo gestisce passo 2
      if (Object.prototype.hasOwnProperty.call(doc, field) && doc[field] !== undefined) {
        out[field] = doc[field];
      }
    }
    return out;
  }

  // `text` è il testo libero già in CHIARO: questo modulo non sa decifrare, né deve.
  // Risposta CLEAN: → originale, REDACTED: → redatto, qualsiasi altra cosa → null.
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

    return null;
  }

  // Il chiamante passa il testo GIÀ decifrato, o lo omette e la bacheca mostra il titolo:
  // un ciphertext FENC1: l'LLM non lo interpreta.
  async function sanitize(doc, llmFn) {
    const meta = sanitizeMetadata(doc);

    // Testo libero: solo se presente e in chiaro.
    const rawText = doc && typeof doc.text === 'string' ? doc.text.trim() : null;
    const isCiphertext = rawText && rawText.startsWith('FENC1:');

    let sanitizedText = null;
    if (rawText && !isCiphertext) {
      sanitizedText = await sanitizeText(rawText, llmFn);
    }

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
