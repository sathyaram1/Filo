// Errore tecnico → frase per l'utente, in chat (#331, #360).
//
// PERCHÉ ESISTE
//   Una chat non è un log. Quando una chiamata fallisce, il messaggio grezzo
//   dell'eccezione ("fetch failed", "OpenRouter 400: …", "ETIMEDOUT") non dice
//   NIENTE all'utente: gli va mostrata una frase che spiega cosa non ha
//   funzionato e cosa può fare, mentre il dettaglio tecnico resta nei log del
//   main. La logica era nata dentro la chat dei mazzi (#331) e la chat della
//   home continuava a mostrare "fetch failed" nudo (#360): ora vive qui, una
//   sola volta, per tutte le chat.
//
// API
//   SN_CHAT_ERRORS.friendly(err, { dataSource })
//     → PROPOSIZIONE con iniziale minuscola, pensata per essere incastonata in
//       una frase ("Non ha funzionato: <…>"), come fa la chat dei mazzi.
//   SN_CHAT_ERRORS.sentence(err, { dataSource })
//     → la stessa cosa come FRASE A SÉ (iniziale maiuscola), per chi mostra
//       l'errore da solo nella bolla, come la chat della home.
//
//   `dataSource` è il nome (per l'utente) dell'archivio esterno che quella chat
//   interroga oltre al servizio AI, es. { dataSource: 'Scryfall (l\'archivio
//   delle carte)' }. Serve per attribuire correttamente un errore HTTP "nudo"
//   (senza marcatore di provider AI). Se la chat non interroga nient'altro,
//   ometti l'opzione: l'errore diventa una frase generica.
//
//   `offline` (opzionale, bool) dice se il computer è senza rete; senza, lo si
//   chiede al lettore del sistema nel main o al browser in una pagina.
//
//   SN_CHAT_ERRORS.fromResponse(res, fallback)
//     → la risposta d'errore dell'IPC ({ error, code, status }) ricomposta in un
//       Error che le due funzioni qui sopra sanno leggere.
//
//   SN_CHAT_ERRORS.isTransientNetwork(err) → bool
//     Vero per i guasti di rete PASSEGGERI (connessione caduta, DNS, timeout,
//     socket chiusa): quelli per cui vale la pena riprovare da soli.
//
//   SN_CHAT_ERRORS.rimedio(code) → 'crediti' | 'opzioni' | 'preferenze' | 'voce' | ''
//     La pagina dove l'utente può togliere l'ostacolo, per chi affianca un
//     collegamento al «Riprova» (che su questi codici non porta da nessuna
//     parte finché non si cambia qualcosa).
//   SN_CHAT_ERRORS.rimedioPagina(code) → { dove, url, label } | null
//     La stessa cosa già pronta da mostrare: ogni superficie usa questa, così
//     l'indirizzo e l'etichetta non vengono riscritti uno per riquadro.
//   SN_CHAT_ERRORS.fraseNessunHost({ modello, funzione, motivo, rimedio })
//     → la frase di un modello che nessun host ammesso serve (#828), la stessa ovunque; anche quella di un modello
//       che coi crediti di Filo non si usa (#830: motivoCrediti, rimedioCrediti).
//
// Logica PURA: niente I/O, niente Electron → unit-testabile.

(function (global) {
  'use strict';

  // Nessuna risposta HTTP è arrivata, quindi ritentare ha senso: un 400 tornerebbe uguale.
  // Due forme: «failed to fetch» nel renderer, «fetch failed» nel main. Stessa classifica.
  const TRANSIENT_NETWORK_RE =
    /fetch failed|failed to fetch|load failed|network error|networkerror|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed|timed out|timeout/i;

  function messageOf(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    // Il vero motivo sta spesso nella `cause`: «fetch failed» ← «ENOTFOUND».
    const own = String(e.message || '');
    const causeMsg = e.cause ? String(e.cause.message || e.cause.code || e.cause) : '';
    return causeMsg ? `${own} ${causeMsg}` : own;
  }

  function isTransientNetwork(e) {
    if (!e) return false;
    // Annullato da noi (cambio pagina, reinvio): non è un guasto, e ritentare sarebbe
    // sbagliato.
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return false;
    // Un errore con status HTTP è una RISPOSTA del server, non un guasto di rete:
    // ritentarlo alla cieca non serve.
    if (Number(e.status) > 0) return false;
    const code = String(e.code || (e.cause && e.cause.code) || '');
    if (code && TRANSIENT_NETWORK_RE.test(code)) return true;
    return TRANSIENT_NETWORK_RE.test(messageOf(e));
  }

  // Offline davvero, non una chiamata andata storta (#873): nel main lo dice il lettore del sistema, in una
  // pagina il browser. `opts.offline` vince su entrambi.
  function pareOffline(o) {
    if (typeof o.offline === 'boolean') return o.offline;
    try {
      const M = global.SN_SISTEMA_MAIN;
      if (M && typeof M.offline === 'function') return M.offline() === true;
    } catch (_) {}
    try { return !!(global.navigator && global.navigator.onLine === false); } catch (_) { return false; }
  }

  // I codici il cui messaggio è GIÀ scritto per l'utente e dice dove si
  // rimedia: passano invariati. La lista sta qui una volta sola e una
  // sentinella la confronta con gli errori che il main solleva, perché un
  // codice nuovo dimenticato qui diventa «qualcosa è andato storto» (#663).
  const CODICI_GIA_SCRITTI = [
    'NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL',
    'NO_ALLOWED_HOST', 'FEEDBACK_READ_DENIED',
  ];

  // Dove chi usa Filo cambia il modello di una funzione. «Modelli predefiniti» è una scheda della Gestione: chi non
  // gestisce Filo non ce l'ha (#1344.1).
  const DOVE_ALTRO_MODELLO = 'in Opzioni → Modelli per azione';
  const FRASE_CONTESTO_PIENO = 'c\'è più testo di quanto il modello riesca a leggere insieme: chiedimi meno pagine alla volta, '
    + 'accorcia il messaggio o ricomincia in una chat nuova.';

  // Il tipo di contenuto che il modello non legge (#1345), dal testo del rifiuto: il 404 del router («No endpoints found
  // that support image input») o un host che dice di non accettarlo. '' per ogni altro rifiuto, «troppe immagini» compreso.
  const INGRESSI = [['immagini', /imag|vision/i], ['audio', /audio/i], ['video', /video/i], ['pdf', /pdf|file|document/i]];
  const ROUTER_INGRESSO = /no endpoints? found that supports? ([^.,;]+)/i;
  // «Unable to process input image» è una foto che quel modello, che le legge, non è riuscito ad aprire: non è un rifiuto.
  const HOST_INGRESSO = new RegExp([
    /(?:does ?n[o']t|do not|can ?not) (?:support|accept|process|handle|read)s? (?:the |an? )?(?:input )?(image_url|input_audio|input_file|images?|vision|audio|video|pdfs?|files?|documents?)/,
    /unable to (?:support|accept) (?:the |an? )?(?:input )?(image_url|input_audio|input_file|images?|vision|audio|video|pdfs?|files?|documents?)/,
    /(image_url|input_audio|input_file|images?|audio|video|pdfs?|files?|documents?)(?: inputs?| content)? (?:is|are) (?:not|only) supported/,
    /unsupported (?:content type|input|modality)[^.]{0,30}?(image|audio|video|pdf|file)/,
  ].map((r) => r.source).join('|'), 'i');
  function ingressoRifiutato(testo) {
    const t = String(testo || '');
    const router = ROUTER_INGRESSO.exec(t);
    const parola = router
      ? (/tool|parameter/i.test(router[1]) ? '' : router[1])
      : ((HOST_INGRESSO.exec(t) || []).slice(1).find(Boolean) || '');
    const hit = parola ? INGRESSI.find(([, re]) => re.test(parola)) : null;
    return hit ? hit[0] : '';
  }
  const FRASI_INGRESSO = {
    immagini: `il modello scelto non legge le immagini, e questa richiesta ne porta: scegline uno che le legga ${DOVE_ALTRO_MODELLO}.`,
    audio: `il modello scelto non ascolta l'audio, e questa richiesta ne porta: scegline uno che lo ascolti ${DOVE_ALTRO_MODELLO}.`,
    pdf: `il modello scelto non legge i PDF, e questa richiesta ne porta: scegline uno che li legga ${DOVE_ALTRO_MODELLO}.`,
    video: `il modello scelto non guarda i video, e questa richiesta ne porta: scegline uno che li guardi ${DOVE_ALTRO_MODELLO}.`,
  };
  const FRASE_INGRESSO_IGNOTO = `il modello scelto non legge un tipo di contenuto che questa richiesta porta: scegline un altro ${DOVE_ALTRO_MODELLO}.`;

  // Dove si rimedia, per chi mostra l'errore: «Riprova» da solo, su questi
  // codici, è un vicolo cieco (la risposta sarà identica finché non si cambia
  // qualcosa), quindi accanto ci va il collegamento al posto giusto.
  const RIMEDIO = {
    NO_API_KEY: 'crediti',
    NO_MODEL_FOR_ACTION: 'opzioni',
    NO_OPEN_WEIGHTS_MODEL: 'opzioni',
    NO_ALLOWED_HOST: 'opzioni',
    LIMIT_REACHED: 'opzioni',
    // Errori la cui cura è un altro modello: la frase dice DOVE_ALTRO_MODELLO, il tasto porta lì.
    NO_TOOL_HOST: 'opzioni',
    MODEL_UNAVAILABLE: 'opzioni',
    DATA_POLICY: 'opzioni',
    NO_PROVIDER_ALLOWED: 'opzioni',
    PARAMETRI_HOST: 'opzioni',
    INGRESSO_NON_LETTO: 'opzioni',
    ALTRO_MODELLO: 'opzioni',
    TETTO_RISPOSTA: 'preferenze',
    RISPOSTA_TAGLIATA: 'preferenze',
    // Il modello di lettura vuole il nome di una voce, o non conosce quello scritto: si scrive in Preferenze.
    TTS_VOICE_REQUIRED: 'voce',
    TTS_VOICE_UNKNOWN: 'voce',
  };
  // Accetta il codice da solo o la risposta intera. Con la risposta si sa anche
  // se il servizio ha rifiutato la CHIAVE (credito finito compreso): lì la
  // strada è la pagina Crediti, e il codice da solo non lo direbbe.
  function rimedio(x) {
    if (x && typeof x === 'object') {
      if (x.keyRefused) return 'crediti';
      if (x.code === 'NO_TOOL_HOST' && Number(x.maxTokens) > 0) return 'preferenze';
      // Un modello che i crediti di Filo non pagano (#830): la frase propone prima la chiave propria.
      if (x.code === 'NO_ALLOWED_HOST' && x.reason === 'crediti') return 'crediti';
      if (x.code === 'RISPOSTA_TAGLIATA' && x.finishReason === 'error') return '';
      return RIMEDIO[String(x.code || '')] || '';
    }
    return RIMEDIO[String(x || '')] || '';
  }

  // La pagina che toglie l'ostacolo, già pronta da mostrare. Sta qui e non in
  // ogni superficie perché una frase che nomina una pagina e non ci porta è
  // muta per chi la legge da un sito qualunque (#663).
  const RIMEDIO_PAGINE = {
    crediti: { url: 'filo://credits/credits.html', label: 'Apri Crediti', title: 'Controlla o togli la chiave OpenRouter' },
    opzioni: { url: 'filo://options/options.html', label: 'Apri Opzioni', title: 'Scegli il modello per questa funzione' },
    preferenze: { url: 'filo://preferences/preferences.html#sec-lunghezza', label: 'Apri Preferenze', title: 'Cambia quanto può essere lunga una risposta' },
    voce: { url: 'filo://preferences/preferences.html#sec-lettura', label: 'Apri Preferenze', title: 'Scegli o scrivi la voce di lettura' },
  };
  function rimedioPagina(x) {
    const dove = rimedio(x);
    return dove ? { dove, ...RIMEDIO_PAGINE[dove] } : null;
  }

  // «Nessun host ammesso per questo modello» (#828): la frase la compone solo fraseNessunHost, e chi ha un altro
  // motivo o un altro posto dove si rimedia li passa. Senza «riprova»: finché il modello resta quello, non cambia niente.
  const NESSUN_HOST_MOTIVO = 'nessun fornitore ammesso lo ospita';
  const RIMEDI_NESSUN_HOST = {
    opzioni: 'Scegline un altro in Opzioni → Modelli per azione.',
    predefiniti: 'Per sceglierne un altro togli «Usa modelli predefiniti» in Opzioni e impostalo in Modelli per azione.',
    gestione: 'Scegline un altro in Gestione → Automazioni, fra i Modelli di supporto.',
    // In coda agli altri quando la richiesta l'ha pagata la chiave propria con l'interruttore spento (#962).
    chiavePropria: 'Visto che paghi con la tua chiave, puoi anche accendere «Con la mia chiave, usa anche i fornitori esclusi» in Opzioni.',
  };
  const NOMI_MOSTRATI = 5;
  const breve = (s, max = 120) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  function elencoNomi(nomi) {
    const visti = [];
    for (const n of Array.isArray(nomi) ? nomi : []) {
      const b = breve(n, 60);
      if (b && !visti.some((v) => v.toLowerCase() === b.toLowerCase())) visti.push(b);
    }
    const mostrati = visti.slice(0, NOMI_MOSTRATI);
    const altri = visti.length - mostrati.length;
    if (altri > 0) mostrati.push(altri === 1 ? 'un altro' : `altri ${altri}`);
    if (mostrati.length < 2) return { testo: mostrati.join(''), quanti: visti.length };
    return { testo: `${mostrati.slice(0, -1).join(', ')} e ${mostrati[mostrati.length - 1]}`, quanti: visti.length };
  }
  function motivoHostEsclusi(hosts) {
    const { testo, quanti } = elencoNomi(hosts);
    if (!quanti) return NESSUN_HOST_MOTIVO;
    return `${NESSUN_HOST_MOTIVO}. ${quanti > 1 ? 'Lo servono' : 'Lo serve'} solo ${testo}, che Filo esclude`;
  }
  // Coi crediti di Filo si chiedono solo host a ritenzione zero (#831): quando sono loro a mancare il motivo è questo.
  const NESSUN_HOST_ZDR = 'nessun fornitore ammesso lo ospita senza conservare i dati, e coi crediti di Filo è una condizione';
  // Voce e dettatura sanno anche quali host conservano, e se il router potrebbe sceglierne uno fra altri che no.
  function motivoNessunHost(err) {
    const reason = err && err.reason;
    if (reason === 'crediti') return motivoCrediti(!!err.chiaveRifiutata);
    const { testo, quanti } = elencoNomi(err && err.hosts);
    const loro = quanti > 1 ? ['Lo servono', 'si impegnano', 'loro'] : ['Lo serve', 'si impegna', 'lui'];
    if (reason === 'zdr') return quanti ? `${NESSUN_HOST_ZDR}. ${loro[0]} solo ${testo}, che non ${loro[1]} a non conservarli` : NESSUN_HOST_ZDR;
    if (reason === 'zdrmixed') {
      return quanti ? `${loro[0].toLowerCase()} anche ${testo}, che non ${loro[1]} a non conservare i dati, e con l'audio non posso impedire che tocchi a ${loro[2]}. Coi crediti di Filo è una condizione` : NESSUN_HOST_ZDR;
    }
    if (reason === 'zdrunknown') return 'non so quali dei suoi fornitori si impegnano a non conservare i dati, e coi crediti di Filo è una condizione';
    return motivoHostEsclusi(err && err.hosts);
  }
  // Un modello da comprare solo dal produttore (#904) che il produttore adesso non serve (#829): nessun altro host lo può.
  function motivoProduttoreGiu(nome) {
    const n = breve(nome, 60);
    return `questo modello lo serve solo ${n || 'il suo produttore'}, e adesso non risponde`;
  }
  // Coi crediti di Filo girano solo i modelli della politica (#830): `ripiego` quando la chiave propria è stata
  // rifiutata e i crediti non possono subentrare. Il rimedio offre prima la chiave, poi un altro modello.
  const MOTIVO_CREDITI = 'coi crediti di Filo questo modello non si usa';
  function motivoCrediti(ripiego) {
    return ripiego ? `OpenRouter ha rifiutato la tua chiave, e ${MOTIVO_CREDITI}` : MOTIVO_CREDITI;
  }
  const ALTRO_MODELLO_CREDITI = {
    opzioni: ', o scegline un altro in Opzioni → Modelli per azione.',
    predefiniti: '; per sceglierne un altro togli «Usa modelli predefiniti» in Opzioni e impostalo in Modelli per azione.',
    gestione: ', o scegline un altro in Gestione → Automazioni, fra i Modelli di supporto.',
  };
  function rimedioCrediti(dove, ripiego) {
    const chiave = ripiego ? 'Controlla la tua chiave nella pagina Crediti' : 'Per usarlo metti una tua chiave OpenRouter nella pagina Crediti';
    return chiave + (ALTRO_MODELLO_CREDITI[dove] || ALTRO_MODELLO_CREDITI.opzioni);
  }
  // Il rimedio per dove si sceglie il modello ('opzioni' | 'predefiniti' | 'gestione'); se l'ha pagata la chiave
  // propria con l'interruttore dei fornitori esclusi spento (#962), anche la strada di accenderlo.
  function rimedioNessunHost(dove, err, effettive) {
    if (err && err.reason === 'crediti') return rimedioCrediti(dove, !!err.chiaveRifiutata);
    const base = RIMEDI_NESSUN_HOST[dove] || RIMEDI_NESSUN_HOST.opzioni;
    // Il vincolo del produttore vale anche con la chiave propria: accendere i fornitori esclusi non lo scioglie.
    const spento = Boolean(err && err.keySource === 'own') && err.reason !== 'produttore'
      && !Array.isArray(effettive && effettive.excludedProvidersOwnKey);
    return spento ? `${base} ${RIMEDI_NESSUN_HOST.chiavePropria}` : base;
  }
  function fraseNessunHost({ modello, funzione, motivo, rimedio: dove } = {}) {
    const m = breve(modello);
    const f = breve(funzione);
    const chi = f ? `La funzione «${f}»` : 'Filo';
    const perche = String(motivo == null ? '' : motivo).trim().replace(/[.\s]+$/, '') || NESSUN_HOST_MOTIVO;
    let cosaFare = String(dove == null ? '' : dove).trim() || RIMEDI_NESSUN_HOST.opzioni;
    if (!/[.!?]$/.test(cosaFare)) cosaFare += '.';
    return `${chi} non può usare ${m ? `«${m}»` : 'il modello scelto'} perché ${perche}. ${cosaFare}`;
  }

  // Chi mostra un errore venuto dall'IPC lo ricompone da qui: un `new Error`
  // a mano perde il codice, e la frase già scritta torna generica (#663).
  // Quello che di un errore viaggia verso le pagine perché fromResponse ricomponga frase e tasto: un posto solo, per
  // ogni canale (ipc, chat della home).
  function dettagliDelTetto(err) {
    if (!err) return {};
    return {
      ...(Number(err.maxTokens) > 0 ? { maxTokens: Number(err.maxTokens) } : {}),
      ...(Number(err.finestra) > 0 ? { finestra: Number(err.finestra) } : {}),
      ...(err.memoria ? { memoria: true } : {}),
      ...(err.code === 'RISPOSTA_TAGLIATA' ? { finishReason: err.finishReason || null, vuota: !!err.vuota } : {}),
      ...(err.reason === 'crediti' ? { reason: 'crediti' } : {}),
    };
  }

  function fromResponse(res, fallbackMessage) {
    const e = new Error(String((res && res.error) || fallbackMessage || ''));
    if (res && res.code && res.code !== 'UNKNOWN') e.code = res.code;
    if (res && Number(res.status) > 0) e.status = Number(res.status);
    if (res && res.provider) e.provider = res.provider;
    // La frase che il main ha già scritto sapendo quale chiave ha pagato e
    // quanti crediti arrivano domani: vale più di qualsiasi ricostruzione.
    if (res && typeof res.userMessage === 'string' && res.userMessage) e.userMessage = res.userMessage;
    if (res && res.keyRefused) e.keyRefused = true;
    if (res && res.reason === 'crediti') e.reason = 'crediti';
    if (res && Number(res.maxTokens) > 0) e.maxTokens = Number(res.maxTokens);
    if (res && Number(res.finestra) > 0) e.finestra = Number(res.finestra);
    if (res && res.memoria) e.memoria = true;
    if (res && typeof res.finishReason === 'string' && res.finishReason) e.finishReason = res.finishReason;
    if (res && res.vuota) e.vuota = true;
    return e;
  }

  // Errore → proposizione per l'utente. Mai un codice HTTP nudo, mai un nome di
  // endpoint.
  function friendly(e, opts) {
    const o = opts || {};
    const raw = String((e && e.message) || (typeof e === 'string' ? e : ''));
    if (e && CODICI_GIA_SCRITTI.includes(e.code)) return raw;

    if (e && e.code === 'RISPOSTA_TAGLIATA') return fraseTagliata(e.finishReason, { vuota: !!e.vuota });
    // #1596 — la chat ha già accorciato pagine e conversazione e ancora non ci sta: cambiare modello non è il rimedio.
    if (e && e.code === 'CONTESTO_PIENO') return FRASE_CONTESTO_PIENO;
    // Guasto di rete: la prima cosa da controllare è la connessione. Va PRIMA
    // dell'analisi HTTP perché qui non c'è nessuna risposta da interpretare.
    if (isTransientNetwork(e)) {
      if (pareOffline(o)) return 'il computer è offline, non è collegato a nessuna rete. Riprova quando torna la connessione.';
      return 'problema di rete: non sono riuscito a raggiungere il servizio. Controlla la connessione e riprova.';
    }

    // Errore del SERVIZIO AI, riconosciuto dal marcatore `err.provider` o, per quelli non
    // marcati, dalla forma del messaggio.
    const pm = /^(OpenRouter|Gemini)(?:\s+\S+)?\s+(\d{3})\b/.exec(raw);
    if ((e && e.provider) || pm) {
      const st = Number(e && e.status) || (pm ? Number(pm[2]) : 0);
      // #700: gli host li ha scartati la politica sui dati dell'account OpenRouter, non gli strumenti.
      // Con la chiave dell'utente la rimedia lui; con quella di Filo resta solo un altro modello.
      if ((e && e.code === 'DATA_POLICY') || (st === 404 && /data policy/i.test(raw))) {
        return e && e.keySource === 'own'
          ? `nessun fornitore di questo modello rispetta le impostazioni sulla privacy del tuo account OpenRouter: allentale su openrouter.ai/settings/privacy, o scegli un altro modello ${DOVE_ALTRO_MODELLO}.`
          : `nessun fornitore di questo modello rispetta le regole sulla privacy dei dati: scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      // #1345: non è la politica sui fornitori, è il modello che non legge quel contenuto.
      const ingresso = e && (e.code === 'INGRESSO_NON_LETTO' || (!e.code && [400, 404, 415, 422].includes(st)))
        ? (e.ingresso || ingressoRifiutato(raw)) : '';
      if (ingresso || (e && e.code === 'INGRESSO_NON_LETTO')) return FRASI_INGRESSO[ingresso] || FRASE_INGRESSO_IGNOTO;
      // #700: gli altri «nessun host» del router hanno ciascuno il suo rimedio, e nessuno riguarda gli strumenti.
      if (e && e.code === 'NO_PROVIDER_ALLOWED') {
        return e.keySource === 'own'
          ? `nessun fornitore di questo modello è fra quelli ammessi, dalle regole sui fornitori di Filo o dalle impostazioni del tuo account OpenRouter: allarga i fornitori ammessi nel tuo account, o scegli un altro modello ${DOVE_ALTRO_MODELLO}.`
          : `nessun fornitore di questo modello è fra quelli ammessi dalle regole sui fornitori: scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      // #1097.3: fra gli host ammessi nessuno regge il tetto di lunghezza della risposta di questa funzione.
      if (e && e.code === 'TETTO_RISPOSTA') {
        const n = Number(e.maxTokens);
        const tetto = Number.isFinite(n) && n > 0 ? ` di ${n.toLocaleString('it-IT', { useGrouping: true })} token` : '';
        // Testo più tetto oltre la memoria del modello: il testo da solo ci stava, o il fornitore non dà le misure.
        const f = Number(e.finestra);
        if ((Number.isFinite(f) && f > 0) || e.memoria) {
          const misura = Number.isFinite(f) && f > 0 ? ` (${f.toLocaleString('it-IT', { useGrouping: true })} token)` : '';
          return `la richiesta, insieme al tetto${tetto} per la risposta, supera la memoria del modello scelto${misura}: accorcia il testo, abbassa il tetto in Preferenze, «Quanto può essere lunga una risposta», o scegli un modello con più memoria ${DOVE_ALTRO_MODELLO}.`;
        }
        return `nessun fornitore ammesso per il modello scelto regge risposte lunghe quanto il tetto${tetto}: abbassalo in Preferenze, «Quanto può essere lunga una risposta», o scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      // #1302: un host regge strumenti e tetto, eppure il router non ne trova uno per questa richiesta.
      if (e && e.code === 'PARAMETRI_HOST') {
        return `nessun fornitore ammesso per il modello scelto accetta tutte le opzioni di questa richiesta (il tetto di lunghezza non c'entra): scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      if (e && e.code === 'MODEL_UNAVAILABLE') {
        return `il modello scelto non è più disponibile sul servizio AI: scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      // #700: fra gli host ammessi per quel modello nessuno regge gli strumenti, e riprovare non serve.
      if (e && e.code === 'NO_TOOL_HOST') {
        const n = Number(e.maxTokens);
        if (Number.isFinite(n) && n > 0) {
          return `per il modello scelto nessun fornitore ammesso regge insieme gli strumenti della chat (cercare, leggere, impostare) e risposte lunghe quanto il tetto di ${n.toLocaleString('it-IT', { useGrouping: true })} token: abbassa il tetto in Preferenze, «Quanto può essere lunga una risposta», o scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
        }
        return `per il modello scelto nessun fornitore ammesso sa usare gli strumenti (cercare, leggere, impostare), e la chat di Filo ne ha bisogno. Scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      // Il router non ha trovato un host che accetti gli strumenti (tool
      // calling) per il modello scelto: la chat della home non funziona senza.
      // Non è un guasto passeggero, è una scelta di modello da cambiare.
      if (/tool/i.test(raw) && (st === 404 || st === 400)) {
        return `il modello scelto nelle Impostazioni non sa usare gli strumenti (cercare, leggere, impostare): la chat di Filo ne ha bisogno. Scegli un altro modello ${DOVE_ALTRO_MODELLO}.`;
      }
      // Chiave rifiutata (#629): se c'era un portafoglio, il ripiego sui
      // crediti di Filo è già scattato prima di arrivare qui; se l'errore
      // arriva in chat, di portafoglio non ce n'è, e la strada è la pagina
      // Crediti (dove la chiave si mette, si vede e si toglie).
      // Un 403 di moderazione non è la chiave: è il testo della richiesta,
      // che il modello scelto fa passare da una moderazione (secondo giro di
      // verifica del ramo: dava la colpa alla chiave, che era a posto).
      const W = globalThis.SN_WALLET;
      if (st === 403 && W && W.isModerationBlock(raw)) {
        return `OpenRouter ha bloccato questa richiesta per la moderazione dei contenuti (la tua chiave è a posto): cambia il testo, o scegli un modello senza moderazione ${DOVE_ALTRO_MODELLO}.`;
      }
      if (st === 401 || st === 403) {
        return 'il servizio AI ha rifiutato la tua chiave API: controlla che sia giusta (e ancora valida) nella pagina Crediti.';
      }
      // 402 (#598): il tetto della chiave è esaurito. Con la chiave personale
      // di Filo sono i crediti finiti; con una chiave propria è il conto
      // OpenRouter dell'utente. Non si ritenta: OpenRouter rifiuta finché il
      // tetto non sale (i crediti del giorno dopo, o una ricarica).
      // Chi tiene le chiavi (nel main) sa quale chiave è stata rifiutata, se
      // c'era un portafoglio e quanti crediti arrivano domani, e lascia la
      // frase già scritta sull'errore (userMessage). Senza, si ragiona con
      // quello che l'errore porta: la chiave con cui si era partiti e se il
      // ripiego sulla personale c'è stato e ha fallito (#629).
      if (st === 402) {
        if (e && typeof e.userMessage === 'string' && e.userMessage) return e.userMessage;
        const src = e && e.keySource;
        const fb = e && e.keyFallback;
        if (fb && fb.failed) {
          return 'OpenRouter ha rifiutato la tua chiave (il suo credito è finito) e anche i crediti di Filo sono finiti: ricarica il tuo conto OpenRouter, oppure aspetta i crediti di domani.';
        }
        if (src === 'own') {
          return 'la tua chiave OpenRouter non ha più credito: ricarica il tuo conto OpenRouter, oppure riscatta un invito nella pagina Crediti per usare i crediti di Filo.';
        }
        if (src === 'personal') {
          return 'i crediti di Filo sono finiti: puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nella pagina Crediti.';
        }
        return 'i crediti sono finiti: puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nella pagina Crediti. Se usi già una chiave tua, è il suo credito a essere esaurito.';
      }
      if (st === 429 || st >= 500) {
        return 'il servizio AI è momentaneamente sovraccarico o non disponibile. Riprova tra qualche minuto.';
      }
      return 'il servizio AI non è riuscito a rispondere: potrebbe esserci un problema con il modello scelto nelle Impostazioni. Riprova, o prova con un altro modello.';
    }

    // Errore HTTP nudo, senza marcatore di provider AI: se la chat interroga anche un archivio
    // esterno, quasi sempre è lui.
    const status = Number(e && e.status);
    if (Number.isFinite(status) && status > 0) {
      const src = String(o.dataSource || '').trim();
      if (src) {
        return status >= 500 || status === 429
          ? `${src} al momento non risponde. Riprova tra qualche minuto.`
          : `${src} ha rifiutato la ricerca. Riprova riformulando la richiesta con parole diverse.`;
      }
      return status >= 500 || status === 429
        ? 'il servizio non risponde al momento. Riprova tra qualche minuto.'
        : 'la richiesta non è stata accettata. Riprova riformulandola con parole diverse.';
    }

    // Ogni altro errore è tecnico e non aiuterebbe: frase generica in chat, dettaglio nei log.
    return 'qualcosa è andato storto. Riprova.';
  }

  function sentence(e, opts) {
    const s = friendly(e, opts);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Una risposta che il modello ha dovuto fermare al tetto di lunghezza (finish_reason 'length', #1097.3): non è un
  // errore, ma chi la legge deve sapere che non è intera. La stessa frase su ogni superficie; '' se la risposta è intera.
  // Un 'error' a metà flusso è lo stesso taglio con un'altra causa: mai in cache, mai presentato come intero.
  // `tetto_ragionamento`: il tetto è finito quasi tutto nel ragionamento (#1302). La frase non promette più spazio: compare
  // anche dove «Continua» non c'è, e un host già al suo massimo fa ripartire il seguito col tetto di prima.
  const FRASI_INTERROTTA = {
    length: 'La risposta si è interrotta qui: ha raggiunto la lunghezza massima.',
    tetto_ragionamento: 'La risposta si è interrotta qui: il modello ha speso quasi tutta la lunghezza massima ragionando.',
    error: 'La risposta si è interrotta qui: il servizio AI si è fermato a metà.',
  };
  const troncata = (finishReason) => Object.prototype.hasOwnProperty.call(FRASI_INTERROTTA, String(finishReason || ''));
  // Il motivo della fine come lo legge Filo: un 'length' speso per più di metà nel ragionamento lo dice a parte.
  function motivoFine(finishReason, usage) {
    if (finishReason !== 'length') return finishReason || null;
    const u = usage || {};
    const pensati = Number(u.reasoningTokens);
    const scritti = Number(u.completionTokens);
    return Number.isFinite(pensati) && pensati > 0 && Number.isFinite(scritti) && scritti > 0 && pensati >= scritti / 2
      ? 'tetto_ragionamento' : 'length';
  }
  function rispostaInterrotta(finishReason) {
    return troncata(finishReason) ? FRASI_INTERROTTA[finishReason] : '';
  }
  // Una risposta interrotta dentro un blocco di codice: il blocco si chiude, o la frase che lo dice finisce nel codice.
  function chiudiRecinto(t) {
    const s = String(t || '');
    return (s.match(/^\s*```/gm) || []).length % 2 ? `${s.replace(/\s+$/, '')}\n\`\`\`` : s;
  }
  // Il messaggio con cui ogni chat chiede il seguito di una risposta interrotta.
  const CHIEDI_SEGUITO = 'Continua da dove ti sei interrotto, senza ripetere quello che hai già scritto.';
  // La home lo chiede con un messaggio interno, che l'utente non vede.
  const CHIEDI_SEGUITO_HOME = '[L\'utente ti ha chiesto di continuare la tua ultima risposta, che si è interrotta perché era più lunga del '
    + 'tetto. Riprendi esattamente da dove si è fermata, senza ripetere quello che hai già scritto.]';
  // L'ultima domanda dell'utente in `messages` è la richiesta del seguito: il giro ha più spazio (#1302).
  function chiedeIlSeguito(messages) {
    const lista = Array.isArray(messages) ? messages : [];
    for (let i = lista.length - 1; i >= 0; i--) {
      const m = lista[i];
      if (!m || m.role !== 'user') continue;
      const c = m.content;
      const testo = typeof c === 'string' ? c : (Array.isArray(c) ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n') : '');
      return testo.includes(CHIEDI_SEGUITO) || testo.includes(CHIEDI_SEGUITO_HOME);
    }
    return false;
  }
  // Il tetto ha tagliato i dati di un'azione della chat (#1302): la frase resta nella risposta salvata, e al turno dopo il
  // modello sa che l'azione non è partita e come rifarla, invece di ripeterla uguale a ogni «Continua».
  const FRASE_AZIONE_TAGLIATA = 'La risposta si è interrotta qui: i dati di un\'azione erano più lunghi della lunghezza massima, '
    + 'e l\'azione non è partita. Continuando la rifaccio più corta, o divisa in più parti.';
  const eFraseInterrotta = (s) => [...Object.values(FRASI_INTERROTTA), FRASE_AZIONE_TAGLIATA].includes(String(s || '').trim());
  // Per chi legge la risposta come dati (JSON, memoria riscritta, un nome): un pezzo non si usa, si dice.
  // `vuota`: il tetto è finito prima di una sola parola da mostrare, di solito nel ragionamento.
  function fraseTagliata(finishReason, { vuota = false } = {}) {
    if (finishReason === 'error') return 'il servizio AI si è fermato a metà della risposta, e un pezzo non basta a questa funzione. Riprova.';
    return vuota || finishReason === 'tetto_ragionamento'
      ? 'il modello ha speso tutta la lunghezza massima prima di scrivere la risposta, di solito ragionando: alza il tetto in Preferenze, «Quanto può essere lunga una risposta», e riprova.'
      : 'la risposta del modello ha raggiunto la lunghezza massima prima di finire, e un pezzo non basta a questa funzione: alza il tetto in Preferenze, «Quanto può essere lunga una risposta», e riprova.';
  }
  function erroreTagliata(finishReason, { vuota = false } = {}) {
    const f = fraseTagliata(finishReason, { vuota });
    const e = new Error(f.charAt(0).toUpperCase() + f.slice(1));
    e.code = 'RISPOSTA_TAGLIATA';
    e.finishReason = finishReason;
    if (vuota) e.vuota = true;
    return e;
  }
  // Una risposta tagliata che non si può mostrare: chi la legge come dati (`intera`) non ne usa un pezzo, e un taglio
  // senza testo né azioni non ha niente da mostrare a nessuno. null se la risposta si può usare.
  function erroreDelTaglio(r, { intera = false } = {}) {
    if (!r || !troncata(r.finishReason)) return null;
    const vuota = !String(r.text || '').trim() && !(Array.isArray(r.toolCalls) && r.toolCalls.length);
    return intera || vuota ? erroreTagliata(r.finishReason, { vuota }) : null;
  }

  // Il testo di un campo di una risposta JSON tagliata a metà (l'involucro dell'Aiuto o dei mazzi): quello che il
  // modello aveva scritto, senza graffe né sequenze di escape. null se il campo non c'è.
  function campoDaJsonTagliato(raw, campi) {
    const s = String(raw || '');
    let inizio = -1;
    for (const c of campi || []) {
      const m = new RegExp(`"${c}"\\s*:\\s*"`).exec(s);
      if (m && (inizio < 0 || m.index + m[0].length < inizio)) inizio = m.index + m[0].length;
    }
    if (inizio < 0) return null;
    const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
    let out = '';
    for (let i = inizio; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') break;
      if (ch !== '\\') { out += ch; continue; }
      const nx = s[i + 1];
      if (nx === undefined) break;
      if (nx === 'u') {
        const hex = s.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
      } else {
        out += Object.prototype.hasOwnProperty.call(ESC, nx) ? ESC[nx] : nx;
        i += 1;
      }
    }
    return out;
  }

  // Il blocco di codice dentro cui una risposta interrotta si era fermata, da riaprire in testa al seguito (#1302): la
  // riga d'apertura (```js), o ''. `prima` è la risposta com'era, o com'è salvata nella home: chiusa da chiudiRecinto e
  // con la frase dell'interruzione in fondo.
  function recintoDaRiaprire(prima) {
    let s = String(prima || '').replace(/\s+$/, '');
    const paragrafi = s.split(/\n{2,}/);
    const conNota = paragrafi.length > 1 && eFraseInterrotta(paragrafi[paragrafi.length - 1]);
    if (conNota) s = paragrafi.slice(0, -1).join('\n\n').replace(/\s+$/, '');
    let recinti = s.match(/^[ \t]*```.*$/gm) || [];
    if (conNota && recinti.length && recinti.length % 2 === 0 && /\n[ \t]*```[ \t]*$/.test(s)) recinti = recinti.slice(0, -1);
    return recinti.length % 2 ? recinti[recinti.length - 1].trim() : '';
  }
  function seguitoNelRecinto(prima, seguito) {
    const r = recintoDaRiaprire(prima);
    const t = String(seguito == null ? '' : seguito);
    return r && !/^\s*```/.test(t) ? `${r}\n${t}` : t;
  }

  // Il testo da mostrare di una risposta che doveva essere un involucro JSON e non si legge (#1302). Solo se il tetto
  // l'ha fermata e la risposta comincia dall'involucro: una risposta intera ma scritta male, o della prosa con un esempio
  // fra graffe, si mostra com'è (null). Fermata prima del campo del testo: niente da mostrare (''), mai la graffa.
  function testoDaInvolucro(raw, campi, finishReason) {
    if (!troncata(finishReason)) return null;
    const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '');
    if (!s.startsWith('{')) return null;
    const t = campoDaJsonTagliato(s, campi);
    return t == null ? '' : t;
  }

  global.SN_CHAT_ERRORS = {
    friendly, sentence, fromResponse, dettagliDelTetto, isTransientNetwork, rimedio, rimedioPagina, rispostaInterrotta, troncata, motivoFine, eFraseInterrotta, erroreTagliata, erroreDelTaglio, campoDaJsonTagliato, testoDaInvolucro, chiudiRecinto, recintoDaRiaprire, seguitoNelRecinto, FRASE_AZIONE_TAGLIATA, CHIEDI_SEGUITO, CHIEDI_SEGUITO_HOME, chiedeIlSeguito, CODICI_GIA_SCRITTI,
    fraseNessunHost, motivoHostEsclusi, motivoNessunHost, motivoProduttoreGiu, NESSUN_HOST_MOTIVO, NESSUN_HOST_ZDR, RIMEDI_NESSUN_HOST, rimedioNessunHost,
    MOTIVO_CREDITI, motivoCrediti, rimedioCrediti, DOVE_ALTRO_MODELLO, ingressoRifiutato,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
