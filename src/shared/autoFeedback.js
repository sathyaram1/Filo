// F4 — Feedback autonomo di Filo.
//
// Logica PURA (nessun I/O): composizione di un auto-feedback sanitizzato
// quando l'agente di chat rileva con ALTA CONFIDENZA:
//   a) una richiesta FUORI CAPACITÀ — usando il manifest SN_CAPABILITIES
//   b) una LAMENTELA "di sfuggita" su qualcosa di rotto
//
// Privacy: il feedback è GENERICO — nessun URL, nessun testo utente verbatim.
// Il contesto allegato è solo l'id strutturale del gap (capabilityGapId) e
// una descrizione derivata dalle voci del manifesto, non dai messaggi raw.
//
// API:
//   SN_AUTO_FEEDBACK.analyzeReply(textReply, actions, userMessage, capabilities)
//     → { kind: null } | { kind: 'capability-gap', capabilityId?, genericDesc }
//                       | { kind: 'complaint', genericDesc }
//
//   SN_AUTO_FEEDBACK.compose(analysis, options?)
//     → { text, name, clientId, capabilityGapId? } | null
//
// I campi ritornati da compose() vanno passati direttamente a SN_FEEDBACK.submit()
// nel main process.
//
//   SN_AUTO_FEEDBACK.composeProposal(analysis, { userMessage, textReply })
//     → { type: 'INVIA_FEEDBACK', testo, titolo } | null      (#360)
//
// La PROPOSTA è l'altra faccia del feedback autonomo: invece di partire di
// nascosto (compose, generico), Filo mette in chat una segnalazione GIÀ SCRITTA
// con il tasto di conferma — l'utente la legge e decide. Siccome la vede prima
// che parta, qui il testo dell'utente può essere citato per intero: è la stessa
// cosa che scriverebbe a mano nel box feedback, e senza la sua richiesta la
// segnalazione sarebbe inutile per chi sviluppa.

(function (global) {
  'use strict';

  // ── Segnali testuali che indicano "fuori capacità" nella risposta dell'agente ─
  // Frammenti in italiano che l'agente usa quando si trova senza una capacità.
  // Sono pattern nelle sue risposte (non nell'input utente: evita injection).
  const NOT_CAPABLE_PHRASES = [
    'non posso fare',
    'non so fare',
    'non sono in grado di',
    'filo non sa fare',
    'filo non può',
    'questa funzione non esiste',
    'questa capacità non è disponibile',
    'non è tra le mie capacità',
    'non fa parte delle mie capacità',
    'non è una funzione di filo',
    'non dispongo di',
    'non ho la capacità',
    'non supporto',
    'non è supportato',
    'al momento non è possibile',
    'per ora non è possibile',
    'questa funzionalità non è disponibile',
    // #360 — "quanti crediti ho?": Filo ha ammesso di non saperlo, ma con parole
    // che nessuna frase qui sopra intercettava ("non ho accesso al saldo"), così
    // il gap è passato inosservato e nessuna segnalazione è stata proposta.
    // Queste sono le formulazioni con cui ammette di non AVERE un dato o un
    // canale per ottenerlo: tenute strette (serve il "non ho/non posso/non
    // riesco" attaccato) per non scattare su una frase qualunque.
    'non ho accesso',
    'non posso accedere',
    'non ho modo di',
    'non ho la possibilità di',
    'non ho a disposizione',
    'non ho visibilità',
    'non ho questa informazione',
    'non ho informazioni su',
    'non riesco a vedere',
    'non riesco a recuperare',
    'non posso vedere',
    'non posso mostrarti',
    'non posso mostrare',
    'non posso recuperare',
    'non posso leggere',
    'non posso controllare',
    'non sono in possesso',
    'non mi è possibile',
    'non è previsto',
  ];

  // Segnali di lamentela: l'utente o l'agente usa queste frasi per indicare
  // che qualcosa non funziona. SOLO nella risposta dell'agente (non input).
  const COMPLAINT_PHRASES = [
    'sembra che non funzioni',
    'non funziona correttamente',
    'sembra rotto',
    'c\'è un problema con',
    'si è verificato un errore',
    'ho riscontrato un problema',
    'non risponde come previsto',
    'si comporta in modo inatteso',
    'non sta funzionando',
  ];

  // Alta confidenza = la risposta contiene almeno una frase segnale ED è
  // relativamente lunga (l'agente ha spiegato il rifiuto, non è un errore di
  // parsing). Soglia caratteri: abbastanza per distinguere una risposta reale
  // da un "(vuoto)" o un errore di parsing.
  const MIN_REPLY_LENGTH = 30;

  // ── Analisi della risposta dell'agente ──────────────────────────────────────

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/['''"""]/g, "'");
  }

  // Trova nella risposta la capacità di Filo più probabilmente menzionata
  // confrontando con i titoli/descrizioni del manifesto (match semplice, puro,
  // senza eseguire nulla). Ritorna l'id stabile della voce o null.
  function guessCapabilityId(replyNorm, capabilities) {
    if (!capabilities || !Array.isArray(capabilities)) return null;
    // Cerca la voce il cui titolo compare nella risposta (corrispondenza parziale
    // normalizzata). Sceglie la più lunga (più specifica) tra le corrispondenze.
    let best = null;
    let bestLen = 0;
    for (const cap of capabilities) {
      const titleNorm = normalize(cap.title || '');
      if (titleNorm.length >= 4 && replyNorm.includes(titleNorm)) {
        if (titleNorm.length > bestLen) {
          best = cap.id;
          bestLen = titleNorm.length;
        }
      }
    }
    return best;
  }

  // Analizza la risposta dell'agente e il messaggio utente per rilevare un
  // segnale di auto-feedback. Ritorna:
  //   { kind: null }                                          — nessun segnale
  //   { kind: 'capability-gap', capabilityId?, genericDesc } — fuori capacità
  //   { kind: 'complaint', genericDesc }                     — lamentela su bug
  //
  // Parametri:
  //   textReply    — testo della risposta dell'agente (non dell'utente: più sicuro)
  //   actions      — array delle azioni nella risposta (per context extra)
  //   userMessage  — messaggio utente (usato SOLO per rilevare segnali di lamentela
  //                  nelle sue parole, non per includere nel feedback)
  //   capabilities — array SN_CAPABILITIES.all() per il match del capabilityId
  function analyzeReply(textReply, actions, userMessage, capabilities) {
    const reply = String(textReply || '');
    if (reply.length < MIN_REPLY_LENGTH) return { kind: null };

    const replyNorm = normalize(reply);

    // ── Segnale 1: fuori capacità ──────────────────────────────────────────────
    const hasNotCapable = NOT_CAPABLE_PHRASES.some((p) => replyNorm.includes(p));
    if (hasNotCapable) {
      const capabilityId = guessCapabilityId(replyNorm, capabilities);
      // Descrizione generica derivata dall'id (non dal testo utente):
      const genericDesc = capabilityId
        ? `Richiesta di funzione non disponibile: ${capabilityId}`
        : 'Richiesta di funzione non disponibile in Filo';
      return { kind: 'capability-gap', capabilityId, genericDesc };
    }

    // ── Segnale 2: lamentela su bug ────────────────────────────────────────────
    const hasComplaint = COMPLAINT_PHRASES.some((p) => replyNorm.includes(p));
    if (hasComplaint) {
      return {
        kind: 'complaint',
        genericDesc: 'Problema riscontrato durante l\'uso di una funzione di Filo',
      };
    }

    return { kind: null };
  }

  // ── Composizione del feedback auto ──────────────────────────────────────────

  // Compone il payload da passare a SN_FEEDBACK.submit() in modo sanitizzato:
  //   - nessun URL, nessun testo verbatim dell'utente
  //   - descrizione generica derivata dal manifesto o dal tipo di segnale
  //   - clientId strutturato per il dedup di F5
  //
  // Ritorna { text, name, clientId, capabilityGapId? } oppure null se il kind
  // non è un segnale valido.
  function compose(analysis, options) {
    if (!analysis || !analysis.kind) return null;
    const opts = options || {};

    if (analysis.kind === 'capability-gap') {
      const capId = String(analysis.capabilityId || 'unknown').replace(/[^a-z0-9-]/g, '-');
      // clientId strutturato per il dedup F5 (extractCapabilityGapId).
      const clientId = `auto:capability-gap:${capId}`;
      const text = analysis.genericDesc || 'Richiesta di funzione non disponibile in Filo';
      const name = analysis.capabilityId
        ? `Funzione mancante: ${analysis.capabilityId}`
        : 'Funzione richiesta non disponibile';
      return {
        text: text.slice(0, 500),
        name: name.slice(0, 100),
        clientId,
        capabilityGapId: capId,
        source: 'auto:capability-gap',
      };
    }

    if (analysis.kind === 'complaint') {
      const text = analysis.genericDesc || 'Problema riscontrato durante l\'uso di Filo';
      return {
        text: text.slice(0, 500),
        name: 'Problema segnalato automaticamente',
        clientId: 'auto:complaint',
        source: 'auto:complaint',
      };
    }

    return null;
  }

  // ── Bonus giornaliero crediti (puro) ────────────────────────────────────────
  // Ritorna +AUTO_FEEDBACK_BONUS se il setting è ON e il bonus non è già stato
  // concesso OGGI. Idempotente: un secondo refill nello stesso giorno non ripaga.
  //
  // Questa funzione è PURA (testabile): prende lo stato e la data, ritorna il
  // delta. L'applicazione concreta (write storage, emitChange) spetta a applyRefill
  // in creditStore.js che chiama questa funzione.
  //
  // Lo stato crediti porta `lastAutoFeedbackBonusDate` (string 'YYYY-MM-DD')
  // per il tracking idempotente.
  function calcAutoFeedbackBonus(state, today, autoFeedbackEnabled) {
    if (!autoFeedbackEnabled) return 0;
    const last = String(state.lastAutoFeedbackBonusDate || '');
    if (last === today) return 0; // già dato oggi
    return 10; // AUTO_FEEDBACK_DAILY_BONUS
  }

  // Applica il bonus al stato (mutazione): aggiorna saldo e lastAutoFeedbackBonusDate.
  // Ritorna { state, bonusAdded }.
  function applyAutoFeedbackBonus(state, today, autoFeedbackEnabled) {
    const bonus = calcAutoFeedbackBonus(state, today, autoFeedbackEnabled);
    if (bonus <= 0) return { state, bonusAdded: 0 };
    state.balance += bonus;
    state.lastAutoFeedbackBonusDate = today;
    if (Array.isArray(state.rewards)) {
      state.rewards.push({ ts: Date.now(), kind: 'auto_feedback_bonus', credits: bonus });
    }
    return { state, bonusAdded: bonus };
  }

  global.SN_AUTO_FEEDBACK = {
    analyzeReply,
    compose,
    calcAutoFeedbackBonus,
    applyAutoFeedbackBonus,
    // Esposti per i test
    _NOT_CAPABLE_PHRASES: NOT_CAPABLE_PHRASES,
    _COMPLAINT_PHRASES: COMPLAINT_PHRASES,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
