// F4 — feedback autonomo di Filo, logica PURA: compone una segnalazione quando l'agente
// rileva un buco fra ciò che gli chiedono e il manifesto delle capacità.
// compose() non porta URL né testo utente; composeProposal() cita, ma l'utente legge prima.

(function (global) {
  'use strict';

  // Frammenti che l'AGENTE usa quando si trova senza una capacità. Si guardano solo le sue
  // risposte, mai l'input dell'utente: così non c'è injection.
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
    // #360 — formulazioni con cui l'agente ammette di non avere un dato o un canale: le frasi
    // sopra non le prendevano. Strette (serve «non ho/non posso») per non scattare a caso.
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

  // Frasi che indicano qualcosa di rotto, cercate SOLO nella risposta dell'agente.
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

  // Alta confidenza = una frase segnale E una risposta lunga: l'agente ha spiegato il rifiuto,
  // non è un errore di parsing o un «(vuoto)».
  const MIN_REPLY_LENGTH = 30;

  // #419 — il buco muto: la funzione esiste nel manifesto ma l'assistente, senza un'azione,
  // la spiega a parole: quella risposta sembra riuscita e il buco resta invisibile a tutti.
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

  // Se l'utente ha chiesto ISTRUZIONI («come faccio a…»), spiegargliele è la risposta giusta:
  // il segnale vale solo quando voleva che la cosa venisse fatta.
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

  // Una risposta di sole indicazioni è lunga: sotto la soglia è più probabile un frammento
  // o un errore di parsing.
  const MIN_HOWTO_REPLY_LENGTH = 80;

  // Parole troppo comuni per identificare una capacità.
  const TITLE_STOPWORDS = new Set([
    'una', 'uno', 'del', 'della', 'delle', 'dei', 'degli', 'dal', 'dalla',
    'nel', 'nella', 'sul', 'sulla', 'per', 'con', 'che', 'come', 'tuo', 'tua',
    'alla', 'allo', 'agli', 'gli', 'non', 'più', 'piu', 'quando', 'dove',
    'anche', 'tutto', 'tutte', 'sono', 'essere', 'fare', 'cosa', 'filo',
  ]);

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/['''"""]/g, "'");
  }

  // Match puro coi titoli e le descrizioni del manifesto: l'id stabile della voce, o null.
  function guessCapabilityId(replyNorm, capabilities) {
    if (!capabilities || !Array.isArray(capabilities)) return null;
    // Fra le corrispondenze vince la più lunga, cioè la più specifica.
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

  // Radici (prime 6 lettere) delle parole significative: bastano a far combaciare
  // «ingrandisci» con «ingrandire» senza tirare dentro un analizzatore morfologico.
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

  // Servono almeno due radici in comune, di cui una lunga: una parola sola non identifica
  // niente. La RICHIESTA pesa il doppio: la risposta nomina di passaggio anche cose vicine.
  function matchCapabilityByWords(userText, replyText, capabilities) {
    if (!capabilities || !Array.isArray(capabilities)) return null;
    const hayOf = (t) => ` ${normalize(t).replace(/[^a-zà-ÿ0-9\s]/g, ' ')} `;
    const hayUser = hayOf(userText);
    const hayReply = hayOf(replyText);
    let best = null;
    let bestScore = 0;
    for (const cap of capabilities) {
      const st = stems(cap.title || '');
      if (st.length < 2) continue; // titolo troppo generico per decidere
      const hit = st.filter((s) => hayUser.includes(s) || hayReply.includes(s));
      if (hit.length < 2) continue;
      if (!hit.some((s) => s.length >= 5)) continue;
      const score = hit.reduce((n, s) => n + (hayUser.includes(s) ? 2 : 1), 0);
      if (score > bestScore) { best = cap.id; bestScore = score; }
    }
    return best;
  }

  // #419 — l'id della capacità spiegata a parole invece di azionarla, o null.
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
    return matchCapabilityByWords(user, reply, capabilities)
      || guessCapabilityId(replyNorm, capabilities);
  }

  // Ritorna { kind, capabilityId?, genericDesc }, kind fra 'capability-gap', 'complaint' e
  // 'capability-uncommandable'. `userMessage` serve ai segnali, mai a finire nel feedback.
  function analyzeReply(textReply, actions, userMessage, capabilities) {
    const reply = String(textReply || '');
    if (reply.length < MIN_REPLY_LENGTH) return { kind: null };

    const replyNorm = normalize(reply);

    const hasNotCapable = NOT_CAPABLE_PHRASES.some((p) => replyNorm.includes(p));
    if (hasNotCapable) {
      const capabilityId = guessCapabilityId(replyNorm, capabilities);
      // Descrizione generica derivata dall'id, non dal testo utente:
      const genericDesc = capabilityId
        ? `Richiesta di funzione non disponibile: ${capabilityId}`
        : 'Richiesta di funzione non disponibile in Filo';
      return { kind: 'capability-gap', capabilityId, genericDesc };
    }

    const hasComplaint = COMPLAINT_PHRASES.some((p) => replyNorm.includes(p));
    if (hasComplaint) {
      return {
        kind: 'complaint',
        genericDesc: 'Problema riscontrato durante l\'uso di una funzione di Filo',
      };
    }

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

  // Payload sanitizzato per submit(): nessun URL né testo verbatim, descrizione derivata dal
  // manifesto, clientId strutturato per il dedup. Null se il kind non è un segnale valido.
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

    // #419: stessa famiglia di dedup dei gap ma con un prefisso a parte, perché «non esiste» ed
    // «esiste ma l'assistente non la sa azionare» si risolvono in modi diversi.
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

  // Proposta in chat (#360): a differenza di compose() questo testo CITA la richiesta
  // dell'utente, che la legge prima di autorizzare — è ciò che la rende utile.

  // Prima frase sensata: cita l'ammissione senza trascinarsi dietro tutta la risposta.
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
    // Senza la richiesta dell'utente la segnalazione non dice niente di azionabile: meglio
    // nessuna proposta che una vuota.
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

  // Bonus giornaliero crediti, PURO: il delta se il setting è ON e il bonus non è già stato
  // dato oggi, così un secondo refill nello stesso giorno non ripaga.
  function calcAutoFeedbackBonus(state, today, autoFeedbackEnabled) {
    if (!autoFeedbackEnabled) return 0;
    const last = String(state.lastAutoFeedbackBonusDate || '');
    if (last === today) return 0; // già dato oggi
    return 10; // AUTO_FEEDBACK_DAILY_BONUS
  }

  // Muta lo stato (saldo e data) e ritorna { state, bonusAdded }.
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
    _MANUAL_HOWTO_PHRASES: MANUAL_HOWTO_PHRASES,
    _matchCapabilityByWords: matchCapabilityByWords,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
