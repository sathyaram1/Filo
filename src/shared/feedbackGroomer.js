// Groomer della coda feedback: dedup più ricalcolo priorità (F5). Logica PURA — ritorna { merges, priorityBumps }, l'applicazione spetta a un applier esterno (routine, script, handler IPC).
// Due canali di dedup, con strategie diverse per sicurezza. Gli auto-feedback (`auto:*`) si deduplicano sul DATO STRUTTURATO `capabilityGapId`: stesso id = duplicati certi, e il canale è immune a injection perché non guarda il testo. Il testo libero degli utenti si deduplica per similarità (Jaccard, con un giudice semantico iniettabile come secondo livello) ed è trattato come NON FIDATO: si misura «simili sì/no», non si esegue niente di ciò che contiene.
// Le priorità si alzano e basta, mai si abbassano, con cap a 3: un duplicato +1 (segnale di interesse), tre o più +2 (molti utenti colpiti). I bump partono dalla priorità corrente dell'originale, non da un contatore astratto.

(function (global) {
  'use strict';

  // Prefisso dei clientId generati da Filo in autonomia (F4).
  const AUTO_SOURCE_PREFIX = 'auto:';

  // Soglia Jaccard per il testo utente; sotto questa, se è iniettata, interviene la giudice semantica.
  const JACCARD_THRESHOLD = 0.65;

  // dupeCount = duplicati già trovati per quell'originale. Ritorna il delta da sommare alla priorità corrente.
  function priorityDelta(dupeCount) {
    if (dupeCount >= 5) return 2; // forte interesse
    if (dupeCount >= 3) return 2;
    if (dupeCount >= 1) return 1;
    return 0;
  }

  // Un auto-feedback lo porta nel campo omonimo oppure come tag `cap-gap:<id>` dentro il clientId. Stringa non vuota, o null.
  function extractCapabilityGapId(fb) {
    if (fb.capabilityGapId && typeof fb.capabilityGapId === 'string') {
      return fb.capabilityGapId.trim() || null;
    }
    const c = String(fb.clientId || '');
    const m = c.match(/^auto:capability-gap:(.+)$/);
    if (m && m[1]) return m[1].trim() || null;
    return null;
  }

  function isAutoFeedback(fb) {
    return String(fb.clientId || '').startsWith(AUTO_SOURCE_PREFIX);
  }

  // Il testo è un dato: normalizzarlo non esegue niente di ciò che contiene.
  function tokenize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // punteggiatura → spazio
      .split(/\s+/)
      .filter((t) => t.length > 2); // scarta stop-words ultra-corte
  }

  // Jaccard: |A ∩ B| / |A ∪ B|, in [0, 1].
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

  // Due livelli: sopra JACCARD_THRESHOLD sono duplicati certi e nessuna LLM serve; sotto, se `llmSimilar` è fornita, la si chiama per le coppie semanticamente equivalenti che condividono pochi token di superficie («segnalibri» contro «preferiti»).
  // In entrambi i casi il testo resta NON FIDATO: si misura «simili sì/no», non si esegue nessuna istruzione contenuta nel testo.
  function areSimilarText(fbA, fbB, llmSimilar) {
    const tA = tokenize(fbA.text || fbA.name || '');
    const tB = tokenize(fbB.text || fbB.name || '');
    const j = jaccard(tA, tB);
    // Certezza senza LLM.
    if (j >= JACCARD_THRESHOLD) return true;
    // Giudizio iniettato, per quando la similarità lessicale non basta ma un giudice esterno può stabilire l'equivalenza.
    if (llmSimilar) {
      try {
        return !!llmSimilar(
          String(fbA.text || fbA.name || ''),
          String(fbB.text || fbB.name || ''),
        );
      } catch (_) {
        // LLM fallisce → conservativo: non accorpare.
        return false;
      }
    }
    return false;
  }

  // Solo i campi NON identificanti del duplicato (mai clientId, userAgent, IP). Il testo grezzo entra perché porta contesto utile a chi risolve, ma questa funzione non lo esegue.
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

  /**
  * Decisione PURA, niente I/O. feedbacks: oggetti plain JS con almeno { id, text?, name?, clientId?, priority?, capabilityGapId?, seq?, subSeq?, notes?, status?, createdAt? }; opts.llmSimilar è il giudice semantico iniettabile.
  * Ordine: separa auto da utente, dedup auto per capabilityGapId, dedup utente per similarità, bump di priorità per gli originali con duplicati.
  * L'originale è sempre il feedback più vecchio (createdAt minore, id minore come tiebreak): determinismo, e la storia si preserva.
  */
  function groom(feedbacks, opts) {
    const { llmSimilar } = opts || {};
    if (!Array.isArray(feedbacks)) return { merges: [], priorityBumps: [] };

    const fbs = feedbacks.filter((f) => f && f.id != null);

    const merges = [];
    // keepId → duplicati trovati finora.
    const dupeCountFor = new Map(); // Map<keepId, number>

    // Id già caduti come duplicati: non li riusiamo come keep.
    const dropped = new Set();

    // Mappa gapId → primo auto-feedback con quel gapId.
    const gapIdSeen = new Map(); // Map<gapId, feedback>

    for (const fb of fbs) {
      if (!isAutoFeedback(fb)) continue;
      if (dropped.has(fb.id)) continue;
      const gapId = extractCapabilityGapId(fb);
      if (!gapId) continue;

      if (gapIdSeen.has(gapId)) {
        // Duplicato: si tiene il più vecchio come originale.
        const orig = gapIdSeen.get(gapId);
        const keep = olderOf(orig, fb);
        const drop = keep === orig ? fb : orig;

        // Se l'originale era già caduto, il nuovo keep vince.
        if (keep !== orig) {
          gapIdSeen.set(gapId, keep);
          // Si toglie la vecchia decisione: non servirà spesso, ma tiene tutto consistente.
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

    // Lista ORDINATA dei non-auto non ancora caduti, poi confronto O(n²): accettabile per code di qualche centinaio di elementi.
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

  // Più vecchio = `createdAt` minore (il confronto fra stringhe ISO funziona); a parità o in assenza, id minore come tiebreak deterministico.
  function olderOf(a, b) {
    const tA = String(a.createdAt || '');
    const tB = String(b.createdAt || '');
    if (tA && tB && tA !== tB) return tA < tB ? a : b;
    return String(a.id) <= String(b.id) ? a : b;
  }

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
