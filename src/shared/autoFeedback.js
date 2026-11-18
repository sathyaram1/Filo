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
  // il segnale vale solo quando voleva che la cosa venisse fatta. Gira sul testo di
  // normalizzaDomanda (senza accenti): una forma per variante, non una per grafia (#474).
  // «non si può…», «non è possibile…» sono lamentele: lì la proposta deve restare.
  const HOWTO_QUESTION_RE = new RegExp('(?<!\\bnon )(?:' + [
    '\\b(come|dove)\\s+(si|posso|puoi|potrei|faccio|fare|far|trovo|attivo|apro|cambio|metto|funziona|configuro|imposto)',
    'come si fa',
    'dove si trova',
    'dove sta',
    'dove sono',
    'in che modo',
    'spiegami',
    'mi spieghi',
    'insegnami',
    '\\b(dimmi|mi dici|mi diresti|(puoi|potresti) dirmi|mi (puoi|potresti) dire) (come|dove|se|qual|quale|quali|cosa|che cosa|in che modo)\\b',
    '\\bsi puo ',
    '\\b(e|sarebbe|sara) possibile',
    '\\bc\'e (un |qualche |il )?(modo|maniera|sistema|verso|comando|tasto|scorciatoia)',
    '\\bci sono (dei |altri )?(modi|sistemi|comandi)',
    '\\bqual(e\\s+|\\s*\'\\s*|\\s+)e\\s+((il|lo|la|un|una)\\s+)?(modo|maniera|sistema|procedura|comando|tasto|scorciatoia)',
    '\\bsai (come|dove|se|quale?|quando|cosa|che cosa|[a-z]+(are|ere|ire)(l[aoie]|mi|ti|ci|vi|si|ne)?)\\b',
    'cosa sai fare',
    'cosa puoi fare',
    'cosa riesci',
    'quali (funzioni|cose|capacit)',
    'che cosa sai',
    'a cosa serve',
  ].join('|') + ')', 'i');

  // Una risposta di sole indicazioni è lunga: sotto la soglia è più probabile un frammento
  // o un errore di parsing.
  const MIN_HOWTO_REPLY_LENGTH = 80;

  // #2348 — si segnala solo se l'utente ha CHIESTO qualcosa: su una riflessione o una discussione ogni proposta è falsa.
  // Un verbo di comando in testa a una frase (imperativo, o seconda persona: «mi salvi la pagina?»), o una richiesta
  // cortese seguita da un infinito. Sentinella: tests/unit/autoFeedbackRichiesta.test.mjs.
  const VERBI_DI_COMANDO = [
    'apri', 'riapri', 'chiudi', 'richiudi', 'metti', 'rimetti', 'togli', 'leva', 'passa', 'passi', 'vai', 'torna', 'torni',
    'salva', 'salvi', 'cerca', 'cerchi', 'trova', 'trovi', 'mostra', 'mostri', 'fai', 'fammi', 'fammelo', 'fammela', 'fallo',
    'falla', 'dammi', 'dammelo', 'dammela', 'cambia', 'cambi',
    'imposta', 'imposti', 'attiva', 'attivi', 'disattiva', 'disattivi', 'accendi', 'spegni', 'sposta', 'sposti', 'aggiungi',
    'rimuovi', 'cancella', 'cancelli', 'elimina', 'elimini', 'scrivi', 'riscrivi', 'manda', 'mandi', 'invia', 'invii',
    'porta', 'porti', 'riporta', 'ingrandisci', 'rimpicciolisci', 'zooma', 'traduci', 'copia', 'copi', 'incolla',
    'scarica', 'scarichi', 'stampa', 'stampi', 'blocca', 'blocchi', 'sblocca', 'ricarica', 'ricarichi', 'riavvia',
    'aggiorna', 'segna', 'ricorda', 'leggi', 'rileggi', 'riassumi', 'prendi', 'crea', 'crei', 'ordina', 'riordina',
    'organizza', 'sistema', 'archivia', 'ripristina', 'annulla', 'rifai', 'ripeti', 'avvia', 'ferma', 'riproduci',
    'riprendi', 'alza', 'abbassa', 'silenzia', 'condividi', 'rinomina', 'sostituisci', 'correggi', 'controlla',
    'calcola', 'converti', 'genera', 'seleziona', 'evidenzia', 'collega', 'scollega', 'accedi', 'esci', 'entra',
    'carica', 'allega', 'usa', 'tieni', 'lascia', 'avvisa', 'sveglia', 'programma', 'svuota', 'pulisci', 'nascondi',
    'fissa', 'sgancia', 'duplica', 'esporta', 'importa', 'installa', 'disinstalla', 'ascolta',
  ];
  const ENCLITICHE = '(?:mi|ti|ci|vi|si|lo|la|li|le|ne|gli|glie(?:lo|la|li|le|ne)|me(?:lo|la|li|le|ne)|te(?:lo|la|li|le|ne)|ce(?:lo|la|li|le|ne))?';
  // Niente «sì», «no» né «si»: un «si passa» impersonale non è un comando.
  const RIEMPITIVI = '(?:(?:ok|okay|dai|allora|ora|adesso|poi|e|ma|ecco|filo|bene|perfetto|grazie|ciao|scusa|ehi|hey|per favore|perfavore|per piacere|ti prego|subito|anche|invece|pure|mi|ci|me lo|me la|ce lo|ce la)\\s+)*';
  const COMANDO_RE = new RegExp(`^${RIEMPITIVI}(?:${VERBI_DI_COMANDO.join('|')})${ENCLITICHE}(?![a-z])`);
  // Un infinito di fare, non di dire o di capire: chi chiede di spiegare vuole parole, non un'azione.
  const INFINITO_DI_FARE = '(?!(?:dir|spiegar|raccontar|descriver|chiarir|capir|saper|conoscer|pensar|parlar|discuter|rifletter|ragionar|creder|esser|aver)[a-z]*(?![a-z]))'
    + '[a-z]{2,}(?:are|ere|ire|(?:ar|er|ir)(?:mi|ti|ci|vi|lo|la|li|le|ne|gli|melo|mela|meli|mele|celo|cela|glielo|gliela))(?![a-z])';
  const RICHIESTA_CORTESE_RE = new RegExp('\\b(?:puoi|potresti|riesci a|riusciresti a|sapresti|ti dispiace(?:rebbe)?|vorrei|voglio|mi serve|mi servirebbe|ho bisogno di)\\s+(?:[a-z\']+\\s+){0,2}?'
    + INFINITO_DI_FARE);
  const RICHIESTA_CHE_RE = /\b(?:vorrei|voglio|mi piacerebbe|ho bisogno|mi serve) che\b/;
  // Senza punto di domanda valgono solo gli attacchi che non aprono mai una riflessione.
  const INTERROGATIVI_RE = /^(?:(?:e|ma|ok|allora|filo|scusa)\s+)*(?:quant[aeio]|qual[ei]|mi dici|dimmi|elenca|elencami)(?![a-z])/;

  function frasiDi(text) {
    return normalizzaDomanda(text).split(/[\n.!;:,]+|\?+/).map((s) => s.trim()).filter(Boolean);
  }

  function chiedeAzione(text) {
    const norm = normalizzaDomanda(text);
    if (RICHIESTA_CORTESE_RE.test(norm) || RICHIESTA_CHE_RE.test(norm)) return true;
    return frasiDi(text).some((f) => COMANDO_RE.test(f));
  }

  // Una domanda che chiede un dato («quanti crediti ho?»): una richiesta anche lei, ma di sapere, non di fare.
  function chiedeInformazione(text) {
    const t = String(text || '');
    if (/\?/.test(t)) return true;
    return frasiDi(t).some((f) => INTERROGATIVI_RE.test(f));
  }

  // La voce del manifesto ha uno strumento della chat che la comanda? (capabilities.js, mappa STRUMENTO: SOLO_A_MANO
  // vuol dire nessuno). Una voce senza dichiarazione conta come senza strumento.
  function haStrumento(cap) {
    if (!cap) return false;
    const Caps = global.SN_CAPABILITIES;
    const s = cap.strumento !== undefined ? cap.strumento : (Caps && Caps.STRUMENTO ? Caps.STRUMENTO[cap.id] : undefined);
    if (!s) return false;
    return !(Caps && s === Caps.SOLO_A_MANO);
  }

  function voceDi(id, capabilities) {
    return Array.isArray(capabilities) ? capabilities.find((c) => c && c.id === id) || null : null;
  }

  function categoriaDi(cap) {
    const Caps = global.SN_CAPABILITIES;
    const cat = cap && cap.category;
    return (Caps && Caps.CATEGORIES && Caps.CATEGORIES[cat]) || cat || '';
  }

  // Parole troppo comuni per identificare una capacità.
  const TITLE_STOPWORDS = new Set([
    'una', 'uno', 'del', 'della', 'delle', 'dei', 'degli', 'dal', 'dalla',
    'nel', 'nella', 'sul', 'sulla', 'per', 'con', 'che', 'come', 'tuo', 'tua',
    'alla', 'allo', 'agli', 'gli', 'non', 'più', 'piu', 'quando', 'dove',
    'anche', 'tutto', 'tutte', 'sono', 'essere', 'fare', 'cosa', 'filo',
  ]);

  // Apostrofi e virgolette tipografici valgono quelli dritti: sulla tastiera del Mac e del
  // telefono «c’è» arriva col tipografico.
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[‘’‚‛ʼ`´“”„"]/g, "'");
  }

  // Per riconoscere una domanda: «è», «e'», «é» ed «e» sono la stessa lettera.
  function normalizzaDomanda(s) {
    return normalize(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/([aeiou])'(?![a-z0-9])/g, '$1');
  }

  function isHowtoQuestion(text) {
    return HOWTO_QUESTION_RE.test(normalizzaDomanda(text));
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
    if (isHowtoQuestion(user)) return null;
    // La risposta deve dare indicazioni manuali, non solo parlare.
    if (!MANUAL_HOWTO_PHRASES.some((p) => replyNorm.includes(p))) return null;
    // …e devono riguardare una capacità che Filo dichiara di avere.
    return matchCapabilityByWords(user, reply, capabilities)
      || guessCapabilityId(replyNorm, capabilities);
  }

  // Una funzione del manifesto senza strumento, spiegata o rifiutata invece di farla.
  function nonAzionabile(cap) {
    const titolo = String(cap.title || cap.id);
    const categoria = categoriaDi(cap);
    return {
      kind: 'capability-uncommandable',
      capabilityId: cap.id,
      capabilityTitle: titolo,
      categoria,
      genericDesc: `Funzione esistente che l'assistente non sa azionare: «${titolo}» (${cap.id}${categoria ? `, ${categoria}` : ''}). `
        + 'L\'utente gli ha chiesto di farla e l\'assistente, senza uno strumento che la comandi, gli ha spiegato come farla a mano.',
    };
  }

  // Ritorna { kind, capabilityId?, capabilityTitle?, categoria?, genericDesc }, kind fra 'capability-gap', 'complaint' e
  // 'capability-uncommandable'. `userMessage` serve ai segnali, mai a finire nel feedback.
  function analyzeReply(textReply, actions, userMessage, capabilities) {
    const reply = String(textReply || '');
    if (reply.length < MIN_REPLY_LENGTH) return { kind: null };
    const user = String(userMessage || '');
    const azione = chiedeAzione(user);
    // Niente richiesta, niente segnalazione: una discussione non ha una cosa mancata da riferire (#2348).
    if (!azione && !chiedeInformazione(user)) return { kind: null };

    const replyNorm = normalize(reply);

    const hasNotCapable = NOT_CAPABLE_PHRASES.some((p) => replyNorm.includes(p));
    if (hasNotCapable) {
      const capabilityId = guessCapabilityId(replyNorm, capabilities);
      const cap = capabilityId ? voceDi(capabilityId, capabilities) : null;
      // La voce c'è nel manifesto: non è una funzione mancante (#2364). Con uno strumento l'assistente poteva farla, e
      // non c'è niente da segnalare; senza, è una funzione che non sa azionare, se l'utente gli aveva chiesto di farla.
      if (cap) return !haStrumento(cap) && azione ? nonAzionabile(cap) : { kind: null };
      return { kind: 'capability-gap', capabilityId: null, genericDesc: 'Richiesta di funzione non disponibile in Filo' };
    }

    const hasComplaint = COMPLAINT_PHRASES.some((p) => replyNorm.includes(p));
    if (hasComplaint) {
      return {
        kind: 'complaint',
        genericDesc: 'Problema riscontrato durante l\'uso di una funzione di Filo',
      };
    }

    if (!azione) return { kind: null };
    const uncommandable = detectUncommandable(reply, replyNorm, user, actions, capabilities);
    const cap = uncommandable ? voceDi(uncommandable, capabilities) : null;
    if (cap && !haStrumento(cap)) return nonAzionabile(cap);

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
    _isHowtoQuestion: isHowtoQuestion,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
