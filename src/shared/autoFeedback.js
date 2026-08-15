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

  // ── #419 — il "buco muto": la capacità c'è, l'assistente non sa azionarla ───
  //
  // Il caso peggiore non è quello in cui Filo ammette di non saper fare una
  // cosa (lì l'ammissione stessa fa scattare la rete di sicurezza qui sopra):
  // è quello in cui la funzione ESISTE nel manifesto, l'utente chiede di
  // farla, e l'assistente — che non ha un'azione per comandarla — si limita a
  // spiegare a parole dove cliccare. Quella risposta non contiene nessuna
  // ammissione: è indistinguibile da una risposta riuscita, e senza rete di
  // sicurezza il buco resta invisibile a tutti.
  //
  // Segnale = risposta che dà INDICAZIONI MANUALI ("clicca", "tasto destro",
  // "in alto a destra"…) su una capacità riconoscibile nel manifesto, senza
  // che nel turno sia stata eseguita nessuna azione.
  const MANUAL_HOWTO_PHRASES = [
    'clicca',
    'cliccando',
    'fai clic',
    'tasto destro',
    'menu contestuale',
    'vai su ',
    'vai in ',
    'vai nella',
    'vai alla',
    'vai alle',
    'apri le impostazioni',
    'apri le opzioni',
    'apri il menu',
    'dal menu',
    'nel menu',
    'dalla barra',
    'nella barra',
    'in alto a destra',
    'in alto a sinistra',
    'in basso a destra',
    'in basso a sinistra',
    'premi ',
    'premendo',
    'scorciatoia',
    'ctrl+',
    'cmd+',
    'lo trovi',
    'la trovi',
    'li trovi',
    'le trovi',
    'puoi farlo da',
    'puoi farlo dal',
    'devi andare',
    'basta andare',
    'basta cliccare',
    'seleziona la voce',
  ];

  // Se l'utente ha chiesto ISTRUZIONI ("come faccio a…", "dove si trova…",
  // "cosa sai fare?"), spiegargliele è la risposta GIUSTA, non un buco: qui la
  // proposta di segnalazione sarebbe rumore. Il segnale vale solo quando
  // l'utente voleva che la cosa venisse fatta.
  const HOWTO_QUESTION_RE = new RegExp([
    '\\b(come|dove)\\s+(si|posso|puoi|potrei|faccio|fare|far|trovo|attivo|apro|cambio|metto|funziona|configuro|imposto)',
    'come si fa',
    'dove si trova',
    'dove sta',
    'dove sono',
    'in che modo',
    'spiegami',
    'mi spieghi',
    'insegnami',
    'mi dici come',
    'si pu(o|ò) ',
    '(e|è)\' ?possibile',
    'cosa sai fare',
    'cosa puoi fare',
    'cosa riesci',
    'quali (funzioni|cose|capacit)',
    'che cosa sai',
    'a cosa serve',
  ].join('|'), 'i');

  // Una risposta di sole indicazioni è lunga: sotto questa soglia è più
  // probabile un frammento o un errore di parsing che una spiegazione.
  const MIN_HOWTO_REPLY_LENGTH = 80;

  // Parole troppo comuni per identificare una capacità.
  const TITLE_STOPWORDS = new Set([
    'una', 'uno', 'del', 'della', 'delle', 'dei', 'degli', 'dal', 'dalla',
    'nel', 'nella', 'sul', 'sulla', 'per', 'con', 'che', 'come', 'tuo', 'tua',
    'alla', 'allo', 'agli', 'gli', 'non', 'più', 'piu', 'quando', 'dove',
    'anche', 'tutto', 'tutte', 'sono', 'essere', 'fare', 'cosa', 'filo',
  ]);

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

  // Radici (prime 6 lettere) delle parole significative di una frase: basta a
  // far combaciare "ingrandisci" del manifesto con "ingrandire" della risposta
  // senza tirare dentro un analizzatore morfologico.
  function stems(phrase) {
    const out = [];
    const words = normalize(phrase).replace(/[^a-zà-ÿ0-9\s]/g, ' ').split(/\s+/);
    for (const w of words) {
      if (w.length < 4 || TITLE_STOPWORDS.has(w)) continue;
      const s = w.slice(0, 6);
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  // Riconosce di QUALE capacità del manifesto parla un testo, anche quando il
  // titolo non compare alla lettera ("ingrandire la pagina" ↔ "Ingrandisci o
  // rimpicciolisci la pagina"). Serve almeno il combaciare di due radici, di
  // cui una lunga: una parola sola (es. "pagina") non identifica niente.
  function matchCapabilityByWords(text, capabilities) {
    if (!capabilities || !Array.isArray(capabilities)) return null;
    const hay = ` ${normalize(text).replace(/[^a-zà-ÿ0-9\s]/g, ' ')} `;
    let best = null;
    let bestScore = 0;
    for (const cap of capabilities) {
      const st = stems(cap.title || '');
      if (st.length < 2) continue; // titolo troppo generico per decidere
      const hit = st.filter((s) => hay.includes(s));
      if (hit.length < 2) continue;
      if (!hit.some((s) => s.length >= 5)) continue;
      if (hit.length > bestScore) { best = cap.id; bestScore = hit.length; }
    }
    return best;
  }

  // #419 — il buco muto. Ritorna l'id della capacità che l'assistente ha
  // spiegato a parole invece di azionare, o null.
  function detectUncommandable(reply, replyNorm, userMessage, actions, capabilities) {
    // Un turno in cui qualcosa è stato fatto non è un turno a mani vuote.
    if (Array.isArray(actions) && actions.length) return null;
    if (reply.length < MIN_HOWTO_REPLY_LENGTH) return null;
    const user = String(userMessage || '').trim();
    if (!user) return null;
    // Chi chiede istruzioni le istruzioni le vuole: nessun buco da segnalare.
    if (HOWTO_QUESTION_RE.test(user)) return null;
    // La risposta deve dare indicazioni manuali, non solo parlare.
    if (!MANUAL_HOWTO_PHRASES.some((p) => replyNorm.includes(p))) return null;
    // …e devono riguardare una capacità che Filo dichiara di avere.
    return matchCapabilityByWords(`${user} ${reply}`, capabilities)
      || guessCapabilityId(replyNorm, capabilities);
  }

  // Analizza la risposta dell'agente e il messaggio utente per rilevare un
  // segnale di auto-feedback. Ritorna:
  //   { kind: null }                                          — nessun segnale
  //   { kind: 'capability-gap', capabilityId?, genericDesc } — fuori capacità
  //   { kind: 'complaint', genericDesc }                     — lamentela su bug
  //   { kind: 'capability-uncommandable', capabilityId, genericDesc } — #419:
  //       la capacità esiste, l'assistente l'ha spiegata a mano invece di farla
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

    // ── Segnale 3 (#419): capacità esistente spiegata a mano ──────────────────
    const uncommandable = detectUncommandable(reply, replyNorm, userMessage, actions, capabilities);
    if (uncommandable) {
      return {
        kind: 'capability-uncommandable',
        capabilityId: uncommandable,
        genericDesc: `Funzione esistente che l'assistente non sa azionare: ${uncommandable}`,
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

    // #419 — stessa famiglia di dedup dei gap (l'id resta estraibile dal
    // clientId), ma con un prefisso che tiene distinti i due casi: "non esiste"
    // e "esiste ma l'assistente non la sa azionare" si risolvono in modi diversi.
    if (analysis.kind === 'capability-uncommandable') {
      const capId = `uncommandable-${String(analysis.capabilityId || 'unknown')}`
        .replace(/[^a-z0-9-]/g, '-');
      return {
        text: String(analysis.genericDesc || 'Funzione esistente che l\'assistente non sa azionare').slice(0, 500),
        name: `Non azionabile dall'assistente: ${analysis.capabilityId || 'sconosciuta'}`.slice(0, 100),
        clientId: `auto:capability-gap:${capId}`,
        capabilityGapId: capId,
        source: 'auto:capability-uncommandable',
      };
    }

    return null;
  }

  // ── Proposta di segnalazione da mostrare in chat (#360) ─────────────────────
  // Quando Filo ammette una mancanza, l'utente non deve chiedergli "mandane una
  // segnalazione": la segnalazione compare GIÀ SCRITTA con il tasto di conferma.
  // Qui componiamo il contenuto dell'azione INVIA_FEEDBACK; è il sistema che poi
  // mostra l'anteprima e chiede l'OK (livello 2), quindi niente parte da solo.
  //
  // A differenza di compose() questo testo CITA la richiesta dell'utente: la
  // legge prima di autorizzare l'invio, ed è ciò che rende la segnalazione utile.

  // Prima frase "sensata" di un testo, per citare l'ammissione di Filo senza
  // trascinarsi dietro tutta la risposta.
  function firstSentence(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const m = /^(.{20,}?[.!?])(\s|$)/.exec(t);
    const out = m ? m[1] : t;
    return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
  }

  // Titolo breve (2-6 parole) ricavato dalla richiesta dell'utente.
  function shortTitle(userMessage, fallback) {
    const words = String(userMessage || '')
      .replace(/\s+/g, ' ')
      .replace(/["“”'`]/g, '')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 6);
    if (!words.length) return fallback;
    let t = words.join(' ').replace(/[,;:.!?]+$/, '');
    if (t.length > 60) t = `${t.slice(0, 59).trimEnd()}…`;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function composeProposal(analysis, options) {
    if (!analysis || !analysis.kind) return null;
    const opts = options || {};
    const userMessage = String(opts.userMessage || '').replace(/\s+/g, ' ').trim();
    // Senza la richiesta dell'utente la segnalazione non dice nulla di
    // azionabile: meglio nessuna proposta che una proposta vuota.
    if (!userMessage) return null;
    const asked = userMessage.length > 400 ? `${userMessage.slice(0, 399).trimEnd()}…` : userMessage;
    const admitted = firstSentence(opts.textReply, 260);

    if (analysis.kind === 'capability-gap') {
      const parts = [`Ho chiesto a Filo: "${asked}"`];
      parts.push(admitted
        ? `Filo mi ha risposto che non può farlo: "${admitted}"`
        : 'Filo mi ha risposto che non può farlo.');
      parts.push('Mi piacerebbe che Filo sapesse fare questa cosa.');
      return {
        type: 'INVIA_FEEDBACK',
        testo: parts.join('\n').slice(0, 1500),
        titolo: shortTitle(userMessage, 'Funzione mancante'),
      };
    }

    if (analysis.kind === 'capability-uncommandable') {
      const parts = [`Ho chiesto a Filo: "${asked}"`];
      parts.push(admitted
        ? `Filo sa fare questa cosa, ma l'assistente non l'ha fatta: mi ha spiegato come farla a mano ("${admitted}")`
        : 'Filo sa fare questa cosa, ma l\'assistente non l\'ha fatta: mi ha spiegato come farla a mano.');
      parts.push('Mi piacerebbe poterla chiedere all\'assistente e basta.');
      return {
        type: 'INVIA_FEEDBACK',
        testo: parts.join('\n').slice(0, 1500),
        titolo: shortTitle(userMessage, 'Funzione non azionabile'),
      };
    }

    if (analysis.kind === 'complaint') {
      const parts = [`Stavo facendo questo in Filo: "${asked}"`];
      parts.push(admitted
        ? `Qualcosa non ha funzionato: "${admitted}"`
        : 'Qualcosa non ha funzionato.');
      return {
        type: 'INVIA_FEEDBACK',
        testo: parts.join('\n').slice(0, 1500),
        titolo: shortTitle(userMessage, 'Qualcosa non funziona'),
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
    composeProposal,
    calcAutoFeedbackBonus,
    applyAutoFeedbackBonus,
    // Esposti per i test
    _NOT_CAPABLE_PHRASES: NOT_CAPABLE_PHRASES,
    _COMPLAINT_PHRASES: COMPLAINT_PHRASES,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
