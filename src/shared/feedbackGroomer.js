// Groomer della coda feedback: dedup più ricalcolo priorità. PURA, ritorna il piano.
// Gli auto-feedback si deduplicano sul dato strutturato, immune a injection; il testo utente
// per similarità, ed è NON FIDATO: si misura «simili sì/no», non si esegue nulla.

(function (global) {
  'use strict';

  // Prefisso dei clientId generati da Filo in autonomia (F4).
  const AUTO_SOURCE_PREFIX = 'auto:';

  // Soglia Jaccard; sotto, se è iniettata, interviene la giudice semantica.
  const JACCARD_THRESHOLD = 0.65;

  // dupeCount = duplicati già trovati per quell'originale.
  // Ritorna il delta da sommare alla priorità corrente, che non si abbassa mai.
  function priorityDelta(dupeCount) {
    if (dupeCount >= 5) return 2; // forte interesse
    if (dupeCount >= 3) return 2;
    if (dupeCount >= 1) return 1;
    return 0;
  }

  // Nel campo omonimo oppure come tag `cap-gap:<id>` dentro il clientId.
  // Stringa non vuota, o null.
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
      .replace(/[^\w\s]/g, ' ')
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

  // Sopra la soglia sono duplicati certi; sotto, `llmSimilar` prende le coppie equivalenti
  // con pochi token in comune («segnalibri» contro «preferiti»).
  function areSimilarText(fbA, fbB, llmSimilar) {
    const tA = tokenize(fbA.text || fbA.name || '');
    const tB = tokenize(fbB.text || fbB.name || '');
    const j = jaccard(tA, tB);
    if (j >= JACCARD_THRESHOLD) return true;
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

  // Solo i campi NON identificanti del duplicato: mai clientId, userAgent, IP.
  // Il testo grezzo entra perché serve a chi risolve, e qui non viene eseguito.
  function buildMergedNotes(original, duplicate) {
    const now = new Date().toISOString().slice(0, 10);
    const dupText = String(duplicate.text || duplicate.name || '').slice(0, 300);
    const origNotes = String(original.notes || '').trim();
    const dupNotes = String(duplicate.notes || '').trim();
    const extra = dupNotes ? `\nNote aggiuntive: ${dupNotes.slice(0, 200)}` : '';
    const dupNum = duplicate.seq ? `#${duplicate.seq}${duplicate.subSeq ? '.' + duplicate.subSeq : ''}` : '';
    const header = `--- Duplicato allegato${dupNum ? ' ' + dupNum : ''} il ${now} ---`;
    return [origNotes, header, dupText.slice(0, 200) + extra].filter(Boolean).join('\n');
  }

  // Decisione PURA, niente I/O; `opts.llmSimilar` è il giudice semantico iniettabile.
  // L'originale è sempre il più vecchio (id minore come tiebreak): determinismo.
  function groom(feedbacks, opts) {
    const { llmSimilar } = opts || {};
    if (!Array.isArray(feedbacks)) return { merges: [], priorityBumps: [] };

    const fbs = feedbacks.filter((f) => f && f.id != null);

    const merges = [];
    // keepId → duplicati trovati finora.
    const dupeCountFor = new Map();

    // Id già caduti come duplicati: non li riusiamo come keep.
    const dropped = new Set();

    // Mappa gapId → primo auto-feedback con quel gapId.
    const gapIdSeen = new Map();

    for (const fb of fbs) {
      if (!isAutoFeedback(fb)) continue;
      if (dropped.has(fb.id)) continue;
      const gapId = extractCapabilityGapId(fb);
      if (!gapId) continue;

      if (gapIdSeen.has(gapId)) {
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

    // Confronto O(n²): accettabile per code di qualche centinaio di elementi.
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

  // Il confronto fra stringhe ISO funziona; a parità, id minore come tiebreak.
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
