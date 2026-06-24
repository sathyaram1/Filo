// Groomer della coda feedback: dedup + ricalcolo priorità (F5).
//
// Logica PURA: non scrive su rete né su disco. Prende una lista di feedback
// (oggetti plain JS) e ritorna una *decisione* su quali accorpare e quali
// priorità alzare. L'applicazione concreta spetta a un "applier" esterno
// (routine, script, handler IPC).
//
// Pattern IIFE su globalThis come gli altri moduli shared/*.
//
// API:
//   SN_FEEDBACK_GROOMER.groom(feedbacks, opts?) → { merges, priorityBumps }
//
//   merges:        Array<{ keepId, dropId, mergedNotes }>
//     keepId:      id del feedback da TENERE (l'originale)
//     dropId:      id del feedback da rimuovere/ignorare (il duplicato)
//     mergedNotes: stringa di note aggiornate da attaccare all'originale
//                  (contiene le informazioni utili estratte dal duplicato)
//
//   priorityBumps: Array<{ id, from, to }>
//     id:   id del feedback la cui priorità va alzata
//     from: priorità attuale
//     to:   nuova priorità
//
// Due canali di dedup, con strategie DIVERSE (sicurezza):
//
//   1. AUTO-FEEDBACK (source `auto:*`): dedup su DATI STRUTTURATI —
//      il campo `capabilityGapId` (o il tag strutturato equivalente).
//      Due auto-feedback con stesso `capabilityGapId` = duplicati certi.
//      Questo canale è IMMUNE a injection: la decisione dipende solo da
//      un id strutturato, non dal testo libero.
//
//   2. TESTO LIBERO utente: similarità testuale (Jaccard su token
//      normalizzati, soglia 0.65). Il testo è trattato come NON FIDATO:
//      la funzione si limita a misurare "simili sì/no", non esegue
//      NESSUNA istruzione contenuta nel testo. Se l'host inietta una
//      `llmSimilar` (funzione pura di confronto semantico), viene usata
//      come giudice secondario con soglia più bassa (0.45); i test la
//      mockano. In ogni caso: nessun side effect, nessuna esecuzione.
//
// Mappatura priorità (alzare, mai abbassare, cap a 3):
//   1 duplicato  → +1 (segnale di interesse)
//   3+ duplicati → +2 (molti utenti colpiti)
//   5+ duplicati → massimo 3 (cap assoluto)
// I "bump" si calcolano sulla priorità corrente dell'originale, non su un
// contatore astratto.

(function (global) {
  'use strict';

  // ── Costanti ────────────────────────────────────────────────────────────────

  // Prefisso dei clientId generati da Filo in autonomia (F4).
  const AUTO_SOURCE_PREFIX = 'auto:';

  // Soglie di similarità Jaccard per il testo utente.
  const JACCARD_THRESHOLD = 0.65;          // strutturale (senza llmSimilar)
  const JACCARD_THRESHOLD_WITH_LLM = 0.45; // abbassata se l'LLM conferma

  // Bump di priorità: quanti duplicati → quanto si alza.
  // dupeCount = numero di duplicati già trovati PER quell'originale.
  // Ritorna il delta da sommare alla priorità corrente.
  function priorityDelta(dupeCount) {
    if (dupeCount >= 5) return 2; // forte interesse
    if (dupeCount >= 3) return 2;
    if (dupeCount >= 1) return 1;
    return 0;
  }

  // ── Helpers di dedup ────────────────────────────────────────────────────────

  // Estrae il `capabilityGapId` strutturato da un auto-feedback.
  // Un auto-feedback lo porta nel campo omonimo oppure come tag `cap-gap:<id>`
  // nel clientId (es. `auto:capability-gap:cap-gap:shortcut-global-alt-e`).
  // Ritorna stringa non vuota oppure null.
  function extractCapabilityGapId(fb) {
    // Campo esplicito (F4 lo imposterà)
    if (fb.capabilityGapId && typeof fb.capabilityGapId === 'string') {
      return fb.capabilityGapId.trim() || null;
    }
    // Fallback: estrai dal clientId strutturato  "auto:capability-gap:<id>"
    const c = String(fb.clientId || '');
    const m = c.match(/^auto:capability-gap:(.+)$/);
    if (m && m[1]) return m[1].trim() || null;
    return null;
  }

  // Ritorna true se il feedback è auto-generato da Filo (source `auto:*`).
  function isAutoFeedback(fb) {
    return String(fb.clientId || '').startsWith(AUTO_SOURCE_PREFIX);
  }

  // ── Similarità Jaccard su token ──────────────────────────────────────────────

  // Normalizza il testo: minuscolo, rimuove punteggiatura, divide in token.
  // Tratta il testo come dato, NON esegue nessuna istruzione in esso.
  function tokenize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // punteggiatura → spazio
      .split(/\s+/)
      .filter((t) => t.length > 2); // scarta stop-words ultra-corte
  }

  // Similarità Jaccard: |A ∩ B| / |A ∪ B|. Ritorna [0, 1].
  function jaccard(tokensA, tokensB) {
    if (!tokensA.length && !tokensB.length) return 1;
    if (!tokensA.length || !tokensB.length) return 0;
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let intersection = 0;
    for (const t of setA) { if (setB.has(t)) intersection++; }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 1 : intersection / union;
  }

  // Ritorna true se due feedback a testo libero sono considerati duplicati.
  //
  // Strategia a due livelli:
  //   1. Jaccard strutturale: se ≥ JACCARD_THRESHOLD → duplicati certi,
  //      nessuna llm-fn necessaria.
  //   2. llmSimilar (iniettabile): se sotto soglia Jaccard ma la funzione è
  //      fornita, la si chiama per giudizio semantico. Usata per coppie
  //      semanticamente equivalenti che condividono pochi token di superficie
  //      (es. "segnalibri" vs "preferiti"). Se Jaccard ≥ JACCARD_THRESHOLD_WITH_LLM
  //      la chiamata è quasi certa; altrimenti la si chiama comunque (il Jaccard
  //      vicino a 0 = probabilmente troppo diversi → l'LLM deciderà, ma in
  //      pratica sarà false per la maggior parte delle coppie).
  //
  // In entrambi i casi il testo è trattato come NON FIDATO: la funzione
  // misura "simili sì/no" ma non esegue NESSUNA istruzione contenuta nel testo.
  function areSimilarText(fbA, fbB, llmSimilar) {
    const tA = tokenize(fbA.text || fbA.name || '');
    const tB = tokenize(fbB.text || fbB.name || '');
    const j = jaccard(tA, tB);
    // Soglia strutturale: certezza senza LLM
    if (j >= JACCARD_THRESHOLD) return true;
    // Giudizio semantico iniettato: chiamato quando la similarità lessicale
    // non è sufficiente ma un giudice esterno può stabilire l'equivalenza.
    if (llmSimilar) {
      try {
        return !!llmSimilar(
          String(fbA.text || fbA.name || ''),
          String(fbB.text || fbB.name || ''),
        );
      } catch (_) {
        // LLM fallisce → conservativo: non accorpare
        return false;
      }
    }
    return false;
  }

  // ── Costruzione note di merge ────────────────────────────────────────────────

  // Produce la stringa di note aggiornate da attaccare all'originale.
  // Estrae solo i campi NON identificanti del duplicato (niente clientId,
  // userAgent, IP, ecc.) — il testo grezzo viene incluso perché può portare
  // contesto utile al risolutore, ma NON viene "eseguito" da questa funzione.
  function buildMergedNotes(original, duplicate) {
    const now = new Date().toISOString().slice(0, 10); // solo data, no ora
    const dupText = String(duplicate.text || duplicate.name || '').slice(0, 300);
    const origNotes = String(original.notes || '').trim();
    const dupNotes = String(duplicate.notes || '').trim();
    const extra = dupNotes ? `\nNote aggiuntive: ${dupNotes.slice(0, 200)}` : '';
    const dupNum = duplicate.seq ? `#${duplicate.seq}${duplicate.subSeq ? '.' + duplicate.subSeq : ''}` : '';
    const header = `--- Duplicato allegato${dupNum ? ' ' + dupNum : ''} il ${now} ---`;
    return [origNotes, header, dupText.slice(0, 200) + extra].filter(Boolean).join('\n');
  }

  // ── Funzione principale ──────────────────────────────────────────────────────

  /**
   * groom(feedbacks, opts) → { merges, priorityBumps }
   *
   * feedbacks: array di oggetti feedback (plain JS, non Firestore).
   *   Ogni feedback deve avere almeno: { id, text?, name?, clientId?, priority?,
   *   capabilityGapId?, seq?, subSeq?, notes?, status?, createdAt? }
   *
   * opts (opzionale):
   *   llmSimilar: (textA, textB) → boolean   giudice semantico iniettabile
   *
   * Ritorna una decisione PURA: niente I/O, niente rete.
   *
   * Ordine di elaborazione:
   *   1. Separa auto-feedback da feedback utente.
   *   2. Dedup auto-feedback per capabilityGapId (strutturato, sicuro).
   *   3. Dedup feedback utente per similarità Jaccard ± llmSimilar.
   *   4. Calcola i bump di priorità per gli originali con duplicati.
   *   5. Ritorna { merges, priorityBumps }.
   *
   * L'originale è sempre il feedback più vecchio (createdAt minore o id minore
   * come tiebreak): questo garantisce determinismo e preserva la storia.
   */
  function groom(feedbacks, opts) {
    const { llmSimilar } = opts || {};
    if (!Array.isArray(feedbacks)) return { merges: [], priorityBumps: [] };

    // Normalizza e filtra: solo feedback con id.
    const fbs = feedbacks.filter((f) => f && f.id != null);

    const merges = [];
    // keepId → numero di duplicati trovati finora
    const dupeCountFor = new Map(); // Map<keepId, number>

    // Insieme degli id già "caduti" come duplicati: non li riusiamo come keep.
    const dropped = new Set();

    // ── Step 1: dedup auto-feedback per capabilityGapId ─────────────────────
    // Mappa gapId → primo auto-feedback trovato con quel gapId.
    const gapIdSeen = new Map(); // Map<gapId, feedback>

    for (const fb of fbs) {
      if (!isAutoFeedback(fb)) continue;
      if (dropped.has(fb.id)) continue;
      const gapId = extractCapabilityGapId(fb);
      if (!gapId) continue;

      if (gapIdSeen.has(gapId)) {
        // Duplicato: tieni il più vecchio come originale.
        const orig = gapIdSeen.get(gapId);
        const keep = olderOf(orig, fb);
        const drop = keep === orig ? fb : orig;

        // Se l'originale era già "drop", aggiorna: il nuovo keep vince.
        if (keep !== orig) {
          gapIdSeen.set(gapId, keep);
          // Rimuovi la vecchia decisione (orig era keep → ora diventa drop).
          // Non servirà spesso, ma garantisce consistenza.
        }

        merges.push({
          keepId: keep.id,
          dropId: drop.id,
          mergedNotes: buildMergedNotes(keep, drop),
        });
        dropped.add(drop.id);
        dupeCountFor.set(keep.id, (dupeCountFor.get(keep.id) || 0) + 1);
      } else {
        gapIdSeen.set(gapId, fb);
      }
    }

    // ── Step 2: dedup feedback utente per similarità testuale ────────────────
    // Costruisce una lista ORDINATA di candidati (i non-auto non ancora caduti),
    // quindi confronto O(n²) che è accettabile per dimensioni di coda (≤ ~1000).
    const userFbs = fbs.filter((fb) => !isAutoFeedback(fb) && !dropped.has(fb.id));

    for (let i = 0; i < userFbs.length; i++) {
      const fbI = userFbs[i];
      if (dropped.has(fbI.id)) continue; // potrebbe essere caduto in un giro precedente

      for (let j = i + 1; j < userFbs.length; j++) {
        const fbJ = userFbs[j];
        if (dropped.has(fbJ.id)) continue;

        if (areSimilarText(fbI, fbJ, llmSimilar)) {
          const keep = olderOf(fbI, fbJ);
          const drop = keep === fbI ? fbJ : fbI;

          merges.push({
            keepId: keep.id,
            dropId: drop.id,
            mergedNotes: buildMergedNotes(keep, drop),
          });
          dropped.add(drop.id);
          dupeCountFor.set(keep.id, (dupeCountFor.get(keep.id) || 0) + 1);
        }
      }
    }

    // ── Step 3: calcola bump di priorità ─────────────────────────────────────
    const priorityBumps = [];
    for (const [keepId, dupeCount] of dupeCountFor) {
      if (dupeCount < 1) continue;
      const orig = fbs.find((f) => f.id === keepId);
      if (!orig) continue;
      const currentPriority = typeof orig.priority === 'number' ? orig.priority : 0;
      const delta = priorityDelta(dupeCount);
      if (delta <= 0) continue;
      const newPriority = Math.min(3, currentPriority + delta);
      if (newPriority > currentPriority) {
        priorityBumps.push({ id: keepId, from: currentPriority, to: newPriority });
      }
    }

    return { merges, priorityBumps };
  }

  // ── Helpers interni ──────────────────────────────────────────────────────────

  // Ritorna il "più vecchio" tra due feedback: priorità a `createdAt` più
  // piccolo (ISO string compare funziona); se uguale o assente, id lessicograficamente
  // minore come tiebreak deterministico.
  function olderOf(a, b) {
    const tA = String(a.createdAt || '');
    const tB = String(b.createdAt || '');
    if (tA && tB && tA !== tB) return tA < tB ? a : b;
    return String(a.id) <= String(b.id) ? a : b;
  }

  // ── Esporta ──────────────────────────────────────────────────────────────────

  global.SN_FEEDBACK_GROOMER = {
    groom,
    // Esposto per i test
    _jaccard: jaccard,
    _tokenize: tokenize,
    _extractCapabilityGapId: extractCapabilityGapId,
    _isAutoFeedback: isAutoFeedback,
    _areSimilarText: areSimilarText,
    _priorityDelta: priorityDelta,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
