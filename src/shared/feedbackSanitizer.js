// Sanitizzazione dei feedback per la board utente (DD2).
//
// PERCHÉ ESISTE
//   La board (filo://board/) mostra i fix in produzione a TUTTI gli utenti.
//   Il doc feedback originale contiene metadati identificanti (clientId,
//   userAgent, timestamp), testo cifrato (S1) che solo l'owner può decifrare,
//   voti di altri utenti, note tecniche owner. NIENTE di tutto ciò deve uscire
//   verso la superficie pubblica. Questo modulo produce un oggetto sanitizzato
//   pronto per la board: SOLO i campi sicuri, con il testo libero redatto via
//   LLM se necessario.
//
// DESIGN: logica pura, zero I/O, zero dipendenze dal main process.
//   La funzione LLM (llmFn) è iniettata dal chiamante — injectable per unit
//   testing. In produzione il chiamante (main process o backend) passa il
//   modello corrispondente allo slot "sanitizer" di DD1.
//
// DOVE GIRA (raccomandazione — vedi report)
//   La sanitizzazione DEVE girare lato backend (Admin SDK / filo-security) o
//   lato owner-app (che ha la chiave privata per decifrare text/url prima di
//   ridare al sanitizer il testo in chiaro). Il client utente NON può farlo:
//   non ha la chiave privata per decifrare S1, e non deve ricevere il testo
//   grezzo di altri utenti. Il risultato sanitizzato va salvato come campo
//   `sanitized` sul documento Firestore (o in un sub-documento parallelo) e
//   la board lo legge da lì, MAI dal testo grezzo.
//
// API
//   SN_FEEDBACK_SANITIZER.sanitizeMetadata(feedbackDoc) -> sanitizedDoc
//   SN_FEEDBACK_SANITIZER.sanitizeText(text, llmFn) -> Promise<string|null>
//   SN_FEEDBACK_SANITIZER.sanitize(feedbackDoc, llmFn) -> Promise<sanitizedDoc>
//   SN_FEEDBACK_SANITIZER.ALLOWED_FIELDS → array dei campi sopravvissuti
//
// ALLOWLIST
//   Solo questi campi sopravvivono alla sanitizzazione (tutti gli altri vengono
//   scartati, anche se aggiunti in futuro al doc):
//     name        — titolo breve generato da LLM (es. "#22 gestione segreti")
//     seq         — numero progressivo top-level (es. 22)
//     subSeq      — suffisso sub-feedback (es. 0 o 1)
//     statusPublic — enum grossolano sicuro ('open'/'closed')
//     resolvedInVersion — versione rilasciata (usata da isShipped, safe)
//     isShipped   — booleano derivato da DB3 (eventuale campo materializzato)
//     sanitizedText — testo redatto (campo apposito, MAI 'text' grezzo)
//   NON sopravvivono: clientId, userAgent, createdAt, resolvedAt, text, url,
//     title, images, files, status (fine), votes, notes, priority, parentId,
//     archiveOverride, branch, seq delle routine, e qualunque altro campo.
//
// FALLBACK CONSERVATIVO
//   Se llmFn lancia o risponde in modo non valido → NON pubblicare il testo
//   libero. Il campo sanitizedText rimane null. La board mostra solo il titolo
//   (name). Questo è il default sicuro: meglio mostrare meno che rivelare info
//   personali per un errore dell'LLM.

(function (global) {
  'use strict';

  // ── Allowlist dei campi sicuri ──────────────────────────────────────────────
  const ALLOWED_FIELDS = Object.freeze([
    'name',
    'seq',
    'subSeq',
    'statusPublic',
    'resolvedInVersion',
    'isShipped',
    'sanitizedText',
  ]);

  // ── Passo 1: rimozione metadati (deterministica, NO LLM) ───────────────────
  //
  // Proietta il doc sui soli campi ALLOWED_FIELDS. Il campo `sanitizedText` è
  // sempre null qui — lo popola eventualmente il passo 2 (redazione LLM).
  // Accetta sia documenti "applicazione" (oggetti JS piatti) sia documenti
  // Firestore REST (con `.fields`); normalizza sempre a oggetto piatto.
  function sanitizeMetadata(doc) {
    if (!doc || typeof doc !== 'object') return { sanitizedText: null };

    // Se il doc ha la struttura Firestore REST (.fields), non usarla qui: la
    // sanitizzazione lavora su oggetti JS già decodificati (il chiamante usa
    // fromFsValue/fsDocToObject di feedback.js). Supportiamo sia il caso
    // "oggetto piatto" sia il caso in cui il chiamante passa il raw Firestore
    // accidentalmente: in quest'ultimo caso i campi ALLOWED che cerchiamo
    // non ci sono e il risultato sarà quasi vuoto (safe: meglio meno che di più).
    const out = { sanitizedText: null };
    for (const field of ALLOWED_FIELDS) {
      if (field === 'sanitizedText') continue; // lo gestisce passo 2
      if (Object.prototype.hasOwnProperty.call(doc, field) && doc[field] !== undefined) {
        out[field] = doc[field];
      }
    }
    return out;
  }

  // ── Passo 2: redazione LLM (solo se serve) ────────────────────────────────
  //
  // Accetta:
  //   text   — stringa con il testo libero in CHIARO (il chiamante ha già
  //             decifrato S1 prima di passarlo qui; questo modulo non sa
  //             decifrare, né deve farlo).
  //   llmFn  — async (prompt: string) => string — la funzione che chiama il
  //             modello. Il chiamante sceglie il modello ("slot sanitizer" di
  //             DD1, default consigliato: il modello di default dell'app).
  //             Se assente → fallback conservativo (null).
  //
  // Comportamento:
  //   - Se text è vuoto/null → null (niente da redare).
  //   - Se llmFn non è una funzione → null (fallback conservativo).
  //   - Chiede all'LLM SE il testo contiene info personali e di redarlo se sì.
  //   - Se la risposta LLM inizia con "CLEAN:" → testo pulito, usalo invariato.
  //   - Se la risposta LLM inizia con "REDACTED:" → testo redatto; usalo.
  //   - In qualsiasi altro caso (eccezione, timeout, risposta non valida) →
  //     null (fallback conservativo: non pubblicare il testo).
  //
  // Prompt design: il modello riceve istruzioni esplicite sul formato di risposta
  // (CLEAN:/REDACTED:) per facilitare il parsing. È intenzionalmente semplice
  // per ridurre la probabilità di risposte malformate.
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
      // Testo pulito: usa il testo ORIGINALE (non la copia LLM, per sicurezza).
      return cleanText;
    }
    if (resp.startsWith('REDACTED:')) {
      // Testo redatto dal modello.
      const redacted = resp.slice('REDACTED:'.length).trim();
      if (!redacted) return null; // risposta malformata → fallback
      return redacted;
    }

    // Risposta non conforme al formato atteso → fallback conservativo.
    return null;
  }

  // ── API unificata: sanitize(doc, llmFn) ───────────────────────────────────
  //
  // Esegue passo 1 (metadati) + passo 2 (testo) e restituisce l'oggetto pronto.
  //
  // Il chiamante deve passare il testo già decifrato (S1) come `doc.text` — o
  // passare solo i metadati (senza text) se la board mostra solo il titolo.
  //
  // Se `doc.text` è presente e in chiaro, sanitizeText lo passa all'LLM e
  // il risultato va in `sanitizedText`. Se la cifratura S1 è attiva, `doc.text`
  // è un ciphertext FENC1: che l'LLM non può interpretare → il chiamante deve
  // decifrarlo PRIMA di chiamare sanitize(), oppure omettere text (→ board
  // mostra solo il titolo).
  //
  // DOVE SALVARE (guida per il chiamante):
  //   Il risultato di sanitize() va scritto come campo `sanitized` (mapValue)
  //   sul documento Firestore originale, oppure come documento separato nella
  //   sub-collection `feedback/{id}/public`. La board legge da lì, MAI da
  //   `text`/`url`/`userAgent` ecc. del doc principale.
  //   Chi deve chiamarlo: la routine cloud (dopo aver chiuso un feedback con
  //   status 'done' e dopo la verifica avversariale), oppure un trigger Cloud
  //   Function su `status == 'done'`. Il main process dell'owner-app può farlo
  //   localmente se ha la chiave privata per decifrare S1.
  async function sanitize(doc, llmFn) {
    const meta = sanitizeMetadata(doc);

    // Testo libero: solo se presente e in chiaro (non FENC1:).
    const rawText = doc && typeof doc.text === 'string' ? doc.text.trim() : null;
    const isCiphertext = rawText && rawText.startsWith('FENC1:');

    let sanitizedText = null;
    if (rawText && !isCiphertext) {
      // Testo in chiaro: passa all'LLM per la redazione.
      sanitizedText = await sanitizeText(rawText, llmFn);
    }
    // Se è ciphertext (o assente): sanitizedText resta null → solo titolo in board.

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
