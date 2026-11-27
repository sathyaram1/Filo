// Le chiamate ai modelli: buildMessages, handleAIRequest, handleStream, la trascrizione, lezioni e compattazione.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const Defaults = require('./defaultsStore');
const { settingsForOwnerAction } = require('./resolveSupportModel');
const ContatoriServizio = require('./contatoriServizio');
const ContestoFilo = require('./contestoFilo');
const Compattazione = require('./compattazioneFilo');
const Foto = require('./fotoDellaPagina');
const Trascrizione = require('./trascrizioneYoutube');
const { SN_CONST } = globalThis;
const { ACTIONS, PROMPTS } = SN_CONST;
const Storage = globalThis.SN_STORAGE;
const History = globalThis.SN_HISTORY;
const AICache = globalThis.SN_AI_CACHE;
const Fx = globalThis.SN_FX;
const Paths = globalThis.SN_PATHS;
const LlmsTxt = globalThis.SN_LLMS_TXT;
const FiloMem = globalThis.SN_FILO_MEMORY;
const { unUsoContato } = require('./handlersComuni');
const { Gate, getEffectiveSettings, modelForAction, buildAttemptChain } = require('./impostazioniEffettive');
const { decisioneAutonomia } = require('./autonomiaFonti');
const { lettureDellAiuto, storiaAiutoConLetture, notaDeiGettoni } = require('./osservazioniPerModello');

// ─── helpers (identici al background.js originale) ──────────────────────────

// I percorsi condivisi li impacchetta SN_PATHS_SAFETY (src/shared/pathsSafety.js):
// li ripulisce di nuovo in lettura e li chiude fra le due marcature che il
// prompt dichiara «contenuto esterno». Il perché sta lì in testa (#585).
function formatKnownPathsForPrompt(rawPaths) {
  return globalThis.SN_PATHS_SAFETY.formatKnownPathsForPrompt(rawPaths);
}

// L'esito del controllo locale delle etichette di origine delle immagini allegate (#711).
// La nota è voce di Filo, la frase del file viaggia imbustata: i nomi li scrive chi ha fatto l'immagine.
async function noteProvenienzaImmagini(dataUrls) {
  const P = globalThis.SN_PROVENIENZA;
  const E = globalThis.SN_ESTERNO;
  if (!P || !E || !Array.isArray(dataUrls) || !dataUrls.length) return '';
  const { analizzaImmagine, origineDellaCopia } = require('./firmatariC2pa');
  const blocchi = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const m = /^data:[^,]*;base64,(.*)$/s.exec(String(dataUrls[i] || ''));
    if (!m) continue;
    let nota;
    try {
      const byte = Buffer.from(m[1], 'base64');
      const res = await analizzaImmagine(byte);
      const copia = res.trovato ? null : origineDellaCopia(byte);
      nota = P.notaPerModello(copia || res, { daCopia: !!copia });
    } catch (_) { continue; }
    const quale = dataUrls.length > 1 ? ` (immagine ${i + 1})` : '';
    const testa = `(Sistema${quale}: ${E.perCanaleSistema(nota.sistema)}.)`;
    blocchi.push(nota.etichetta
      ? `${testa}\n${E.imbusta({ tipo: 'ETICHETTA_FILE', testo: nota.etichetta, conIntestazione: true, unaRiga: true })}`
      : testa);
  }
  return blocchi.join('\n\n');
}

// Le etichette di origine stanno nel file, non nei pixel che tornano al modello: senza, «ed è fatta con l'AI?» al
// messaggio seguente non aveva più l'esito (#946).
const MAX_CHAT_CON_ORIGINE = 200;
const MAX_ESITI_PER_CHAT = 20;
const origineDelleChat = new Map();
function ricordaOrigineInChat(chatId, blocco) {
  if (!chatId || !blocco) return;
  const lista = origineDelleChat.get(chatId) || [];
  lista.push(blocco);
  if (lista.length > MAX_ESITI_PER_CHAT) lista.shift();
  origineDelleChat.delete(chatId);
  origineDelleChat.set(chatId, lista);
  while (origineDelleChat.size > MAX_CHAT_CON_ORIGINE) origineDelleChat.delete(origineDelleChat.keys().next().value);
}
function origineGiaLettaInChat(chatId) {
  return chatId ? PROMPTS.origineGiaLettaInChat(origineDelleChat.get(chatId)) : '';
}

// #593 — IL TURNO AUTOMATICO DELL'AGENTE AIUTO, E LE DUE COSE CHE CI STANNO
// DENTRO.
//
// Dopo un'azione (un click dell'utente, una ricerca web, un comando eseguito)
// l'agente riparte da solo, e il turno che gli arriva ha due parti che non
// vanno confuse:
//
//   • LA NOTA DI FILO — «l'utente ha cliccato», «ho eseguito la ricerca che
//     avevi chiesto». È la voce di Filo, e il modello la legge come tale:
//     arriva come «(Sistema: …)», e le istruzioni gli dicono che quello è il
//     canale fidato. Ci passa SOLO testo che nasce qui dentro. Non lo dà per
//     scontato: `perCanaleSistema` la riduce a una riga sola e le toglie
//     qualunque marcatura, così una nota scritta domani interpolandoci
//     qualcosa non può forgiare una recinzione.
//
//   • IL CONTENUTO ESTERNO — i risultati della ricerca, l'etichetta di un
//     elemento. Prima veniva impastato dentro la nota, e chi controllava una
//     pagina fra i primi risultati parlava all'agente con l'autorità del canale
//     di Filo, senza bisogno di nessuna chiave. Adesso viaggia a parte e entra
//     imbustato: intestazione che lo dichiara dati, due marcature, e la
//     pulizia che gli impedisce di scriversele da sé.
//
// A comporre il testo è `SN_CONST.PROMPTS.turnoAutomaticoAiuto`, e non questo
// file: la sidebar scrive la stessa cosa nella propria cronologia, che tornerà
// al modello nei turni dopo, e due composizioni a mano divergerebbero in
// silenzio. La cronologia è proprio il posto dove un testo avvelenato
// resterebbe per tutta la sessione.
function testoDelTurnoAutomatico(payload) {
  return PROMPTS.turnoAutomaticoAiuto({
    nota: payload.userAction || '',
    dati: payload.esterno || null,
  });
}

// `sender`: la scheda per conto della quale si legge quello che serve al prompt (l'llms.txt dell'Aiuto).
async function buildMessages(action, payload, { sender = null } = {}) {
  if (payload && Array.isArray(payload.messages) && payload.messages.length) {
    return payload.messages;
  }
  if (action === ACTIONS.EXPLAIN) {
    const fx = await Fx.get().catch(() => null);
    const fxLine = fx ? Fx.formatForPrompt(fx) : '';
    return [{ role: 'user', content: PROMPTS.explain({ selection: payload.selection, sentence: payload.sentence || payload.selection, fxLine }) }];
  }
  if (action === ACTIONS.EXPLAIN_DEEP) {
    const fx = await Fx.get().catch(() => null);
    const fxLine = fx ? Fx.formatForPrompt(fx) : '';
    return [{ role: 'user', content: PROMPTS.explainDeep({ selection: payload.selection, sentence: payload.sentence || payload.selection, fxLine }) }];
  }
  if (action === ACTIONS.TRANSLATE_SELECTION) {
    return [{ role: 'user', content: PROMPTS.translateSelection({ selection: payload.selection }) }];
  }
  if (action === ACTIONS.TRANSLATE_PAGE) {
    return [{ role: 'user', content: PROMPTS.translatePageChunk({ chunk: payload.chunk }) }];
  }
  if (action === ACTIONS.HELP) {
    // L'llms.txt e i percorsi condivisi sono dei siti: una pagina di Filo (filo://editor) non ne ha.
    const domain = (() => {
      try { const u = new URL(payload.url || ''); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''; }
      catch (_) { return ''; }
    })();
    const [llmsRes, pathsRes, video] = await Promise.all([
      domain ? LlmsTxt.get(domain, { sender }).catch(() => null) : Promise.resolve(null),
      // Dove il livello di privacy chiede prima (#1589) il sito non va al server.
      domain && payload.percorsiNoti !== false ? Paths.listByDomain(domain, { onlySuccess: true }).catch(() => []) : Promise.resolve([]),
      // #1977 — su un video di YouTube la trascrizione: l'indirizzo è quello della scheda, non quello che dice la pagina.
      Trascrizione.perLAiuto(sender && sender.wc).catch(() => ''),
    ]);
    const siteKnowledge = (llmsRes && llmsRes.present && llmsRes.text) ? llmsRes.text : '';
    const knownPaths = formatKnownPathsForPrompt(pathsRes || []);
    const sys = { role: 'system', content: PROMPTS.help({
      url: payload.url, title: payload.title, outline: payload.outline,
      viewport: payload.viewport, siteKnowledge, knownPaths,
      apertaIl: payload.schedaApertaIl, paginaDal: payload.paginaDal, adesso: Date.now(), documento: payload.documento || null,
      valuta: payload.valuta === true ? await memoriaPerValuta() : null,
    }) };
    const parts = [];
    // «Valuta» (#1449): il testo del campo arriva grezzo, e qui diventa la richiesta (o la coda della domanda) imbustata.
    const campo = payload.esterno && payload.esterno.testoDaValutare;
    const userText = campo && typeof campo.testo === 'string'
      ? PROMPTS.richiestaValuta({ testo: campo.testo, domanda: payload.userMessage || '' })
      : (payload.userMessage || testoDelTurnoAutomatico(payload));
    if (userText) parts.push({ type: 'text', text: userText });
    if (video) parts.push({ type: 'text', text: video });
    // #2085 — le schede lasciate nel messaggio, lette come LEGGI_PAGINA.
    const G = globalThis.SN_SCHEDE_IN_CHAT;
    if (G && payload.userMessage && Array.isArray(payload.schede) && payload.schede.length) {
      const nota = notaDeiGettoni(await lettureDellAiuto(G.allinea(String(payload.userMessage), payload.schede).filter(Boolean), sender));
      if (nota) parts.push({ type: 'text', text: nota });
    }
    const origine = PROMPTS.origineImmaginiAiuto(payload.origineImmagini);
    if (origine) parts.push({ type: 'text', text: origine });
    if (payload.screenshot) parts.push({ type: 'image_url', image_url: { url: payload.screenshot } });
    else if (Foto.perche(payload.fotoMancante)) parts.push({ type: 'text', text: PROMPTS.fotoMancanteAiuto(Foto.perche(payload.fotoMancante)) });
    const userMsg = parts.length === 1 && parts[0].type === 'text'
      ? { role: 'user', content: parts[0].text }
      : { role: 'user', content: parts };
    return [sys, ...await storiaAiutoConLetture(payload.history, sender), userMsg];
  }
  if (action === ACTIONS.CATEGORIZE) {
    return [{ role: 'user', content: PROMPTS.categorize(payload) }];
  }
  if (action === ACTIONS.DESCRIBE_IMAGE) {
    return [{ role: 'user', content: [
      { type: 'text', text: PROMPTS.describeImage() },
      { type: 'image_url', image_url: { url: payload.dataUrl } },
    ] }];
  }
  if (action === ACTIONS.TRANSCRIBE_IMAGE) {
    return [{ role: 'user', content: [
      { type: 'text', text: PROMPTS.transcribeImage() },
      { type: 'image_url', image_url: { url: payload.dataUrl } },
    ] }];
  }

  // I due controlli del correttore (#1446): il rapido trova gli errori, il ragionato i suggerimenti e i fatti. Le regole
  // nel messaggio di sistema, che va in cache (#1580); il testo che cambia in quello dell'utente.
  if (action === ACTIONS.SPELLCHECK_SEMANTIC) {
    return [
      { role: 'system', content: PROMPTS.spellcheckErroriSistema() },
      { role: 'user', content: PROMPTS.spellcheckErrori(payload || {}) },
    ];
  }
  if (action === ACTIONS.SPELLCHECK_CONTEXT) {
    const p = payload || {};
    // La data la dà l'orologio di qui, non la pagina. Le fonti di un segnaposto (#1448) le mette il main, mai la pagina.
    if (p.segnaposto) return [{ role: 'user', content: PROMPTS.spellcheckSegnaposto({ ...p, oggi: new Date() }) }];
    return [
      {
        role: 'system',
        content: PROMPTS.spellcheckSuggerimentiSistema({ ripetizioni: p.ripetizioni !== false, segnaposti: !!p.segnaposti, soloSegnaposti: !!p.soloSegnaposti }),
      },
      { role: 'user', content: PROMPTS.spellcheckSuggerimenti({ ...p, oggi: new Date() }) },
    ];
  }
  if (action === ACTIONS.EDIT_TEXT) {
    return [{ role: 'user', content: PROMPTS.editText({ original: payload.original, instruction: payload.instruction }) }];
  }
  if (action === ACTIONS.EXPLAIN_LINK) {
    return [{ role: 'user', content: PROMPTS.explainLink({
      url: payload.url, anchorText: payload.anchorText,
      ogTitle: payload.ogTitle, ogDescription: payload.ogDescription,
      suspiciousFlags: payload.suspiciousFlags,
    }) }];
  }
  if (action === ACTIONS.HELP_INTENT_GUESS) {
    return [{ role: 'user', content: PROMPTS.helpIntentGuess({
      domain: payload.domain, initialUrl: payload.initialUrl, steps: payload.steps,
    }) }];
  }
  if (action === ACTIONS.HELP_INTENT_JUDGE) {
    // domain, initialUrl e steps li guarda solo il giudice prima che finiscano in una raccolta
    // pubblica: la pulizia per forme non li ripulisce fino in fondo (#584).
    return [{ role: 'user', content: PROMPTS.helpIntentJudge({
      proposedIntent: payload.proposedIntent, userMessages: payload.userMessages,
      domain: payload.domain, initialUrl: payload.initialUrl, steps: payload.steps,
    }) }];
  }
  if (action === ACTIONS.FILO_CHAT) {
    // SPEC-CONTESTO § La richiesta: la parte fissa, uguale per tutti, poi il CONTESTO dell'utente che il turno ha
    // fotografato (src/main/services/contestoFilo.js), poi il tratto vivo che finisce con la domanda, poi il giro.
    const FC = globalThis.SN_FILO_CONTESTO;
    const sistema = `${PROMPTS.filoChatStatic()}${payload.parteUtente || ''}`;
    if (!Array.isArray(payload.filoTratto)) {
      // Senza filo la domanda non ha l'ora in testa: il turno la dice in fondo al system, con l'intervista.
      return [
        { role: 'system', content: `${sistema}\n\n${PROMPTS.filoChatContext({ ...payload, adesso: FC.quando(Date.now()) })}` },
        ...(payload.threadMessages || []),
      ];
    }
    const giro = payload.threadMessages || [];
    const i = Math.max(0, Math.min(giro.length, Number(payload.indiceDomanda) || 0));
    return FC.richiesta({ sistema, tratto: payload.filoTratto, scheda: giro.slice(0, i), domanda: giro[i] || null, giro: giro.slice(i + 1) });
  }
  if (action === ACTIONS.FILO_DASHBOARD) {
    return [{ role: 'user', content: PROMPTS.filoDashboard(payload) }];
  }
  if (action === ACTIONS.FILO_LESSON) {
    return [{ role: 'user', content: PROMPTS.filoLesson(payload) }];
  }
  if (action === ACTIONS.FILO_COMPACT) {
    return [{ role: 'user', content: PROMPTS.filoCompact(payload) }];
  }
  // I messaggi li compone src/shared/filoCompattazione.js: il tratto è già fatto di righe scritte dal codice.
  if (action === ACTIONS.FILO_COMPATTAZIONE) {
    return (Array.isArray(payload.daCompattare) ? payload.daCompattare : []).map((m) => ({ role: m.role, content: String(m.content || '') }));
  }
  throw new Error(`Action sconosciuta: ${action}`);
}

// ─── Dettatura ───────────────────────────────────────────────────────────────
// Non è una chat: l'audio va all'endpoint di trascrizione, che risponde col
// testo. Stessa catena di modelli, stesso limite di spesa, stesso riscontro su
// chi ha servito. `payload`: { audioBase64, format, lang, interim } — oppure,
// nella forma vecchia, { dataUrl, lang }.
function handleTranscription(args) {
  return unUsoContato(ACTIONS.TRANSCRIBE_AUDIO, () => trascrivi(args));
}

// I tentativi che sanno trascrivere, o l'errore che dice cosa manca: la trascrizione di un audio intero (#1815) lo
// chiede prima di scaricare e decodificare, la dettatura a ogni spezzone.
async function catenaDiTrascrizione(settings) {
  const model = modelForAction(settings, ACTIONS.TRANSCRIBE_AUDIO);
  const attempts = buildAttemptChain(settings, model, ACTIONS.TRANSCRIBE_AUDIO);
  await Gate.ensureUnderLimit(settings);
  const utili = attempts.filter((a) => Gate.supports(a.provider, 'transcribe') && a.model);
  if (!utili.length) {
    const e = new Error('Nessun fornitore ammesso sa trascrivere col modello scelto per la dettatura: scegline un altro in Opzioni → Modelli per azione.');
    e.code = 'NO_TRANSCRIBE_HOST';
    throw e;
  }
  return { attempts, model: utili[0].model, provider: utili[0].provider };
}

async function controllaTrascrizione() {
  return catenaDiTrascrizione(await settingsForOwnerAction(await getEffectiveSettings(), ACTIONS.TRANSCRIBE_AUDIO));
}

async function trascrivi({ settings, payload, origin, signal }) {
  const p = payload || {};
  const { attempts } = await catenaDiTrascrizione(settings);
  ContatoriServizio.misura('catena', ACTIONS.TRANSCRIBE_AUDIO, attempts);
  let audioBase64 = typeof p.audioBase64 === 'string' ? p.audioBase64 : '';
  let format = typeof p.format === 'string' && p.format ? p.format : 'wav';
  if (!audioBase64 && typeof p.dataUrl === 'string') {
    const m = /^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,(.*)$/i.exec(p.dataUrl);
    if (m) {
      const sub = m[1].toLowerCase();
      format = sub === 'mpeg' ? 'mp3' : (sub === 'x-wav' || sub === 'wave' ? 'wav' : sub);
      audioBase64 = m[2];
    }
  }
  if (!audioBase64) {
    const e = new Error('Audio mancante');
    e.code = 'NO_AUDIO';
    throw e;
  }
  const Voices = globalThis.SN_TTS_VOICES;
  const language = Voices ? Voices.langOf(p.lang) : '';
  let lastErr = null;
  for (const a of attempts) {
    if (!Gate.supports(a.provider, 'transcribe') || !a.model) continue;
    try {
      // Chi ha servito può arrivare dopo la voce di cronologia: la si marchia allora.
      let historyId = null;
      const r = await Gate.call({
        action: ACTIONS.TRANSCRIBE_AUDIO, settings, attempt: a, method: 'transcribe',
        args: { audioBase64, format, language: language || undefined, signal },
        onLateServedBy: ({ servedBy, violation }) => (historyId
          ? History.patch(historyId, { servedBy, policyViolation: violation }) : null),
      });
      const text = String(r.text || '').trim();
      const { servedBy, violation, costEur } = r;
      // Le trascrizioni PROVVISORIE della dettatura in diretta non vanno in
      // cronologia: ne arriverebbe una al secondo, tutte sostituite dalla
      // definitiva. Il costo però si registra sempre.
      if (!p.interim) {
        try {
          const h = await History.append({
            action: ACTIONS.TRANSCRIBE_AUDIO, provider: a.provider, model: a.model, servedBy,
            policyViolation: violation,
            input: { lang: p.lang || '', seconds: (r.usage && r.usage.seconds) || 0 },
            output: text, origin, costEur, usage: r.usage,
          });
          historyId = h && h.id;
        } catch (_) {}
      }
      return { text, model: a.model, provider: a.provider, costEur, usage: r.usage };
    } catch (e) {
      if (e && e.code === 'LIMIT_REACHED') throw e;
      lastErr = e;
      console.warn(`[SN] dettatura ${a.provider}/${a.model} fallita:`, e.message || e);
    }
  }
  throw lastErr || new Error('Nessun modello di dettatura disponibile');
}

// Il campo «text» dentro il JSON è il formato vecchio: chi risponde in prosa — il caso
// normale con gli strumenti nativi — va passato com'è. Decide la prima riga: { o recinto.
function createAnswerStreamer(onText) {
  const StreamJson = globalThis.SN_STREAM_JSON;
  let mode = null; // null = indeciso, 'json' | 'plain'
  let held = '';
  let jsonStreamer = null;
  const decide = (force) => {
    const t = held.replace(/^\s+/, '');
    if (!t && !force) return;
    if (/^(```(?:json)?\s*)?\{/.test(t)) {
      mode = 'json';
      jsonStreamer = StreamJson ? StreamJson.createTextStreamer('text') : null;
    } else if (t.length >= 8 || force || !/^(`{1,3}(j(s(o(n)?)?)?)?\s*)?$/.test(t)) {
      mode = 'plain';
    } else {
      return; // potrebbe essere l'inizio di un recinto: aspetta
    }
    const buf = held;
    held = '';
    emit(buf);
  };
  const emit = (chunk) => {
    if (!chunk) return;
    if (mode === 'json') {
      if (!jsonStreamer) return;
      try {
        const { delta } = jsonStreamer.push(chunk);
        if (delta) onText({ delta });
      } catch (_) {}
    } else {
      onText({ delta: chunk });
    }
  };
  return {
    push(chunk) {
      if (mode) { emit(chunk); return; }
      held += chunk;
      decide(false);
    },
    // Fine dello stream: quello che era rimasto in attesa esce comunque.
    flush() { if (!mode) decide(true); },
    reset() { mode = null; held = ''; jsonStreamer = null; },
  };
}

// Gli strumenti si passano all'istante e i tempi si MISURANO (idee «Latenza
// della chat», punto 1): senza numeri per turno ogni scelta sui modelli è a
// occhio. `timing` finisce nella cronologia AI accanto al costo.
// `intera`: chi legge la risposta come dati (JSON, memoria, etichette) non riceve mai un pezzo tagliato, ma un errore.
// Un taglio senza niente da mostrare è un errore, salvo `conSeguito` (la superficie ha «Continua») col tetto finito nel
// ragionamento: «qualcosa è andato storto» non direbbe del tetto, la nota col seguito sì (#1302).
async function handleAIRequest({ intera = false, conSeguito = false, ...opts }) {
  let r;
  try {
    r = await chiamaIlModello(opts);
  } catch (e) {
    // Chiave, modello o margine di spesa mancanti fermano la chiamata prima del cancello: la conta chi l'ha chiesta (#1472).
    ContatoriServizio.misura('maiPartita', opts.action, e);
    throw e;
  }
  const taglio = globalThis.SN_CHAT_ERRORS.erroreDelTaglio(r, { intera, senzaSeguito: !conSeguito });
  if (taglio) throw taglio;
  return r;
}

async function chiamaIlModello({ action, payload, origin, sender = null, onReasoning = null, onText = null, onToolCall = null, tools = null, toolChoice = null, signal = null, noCache = false, tempiPrima = null, modelloDi = null }) {
  const settings = await settingsForOwnerAction(await getEffectiveSettings(), action);
  if (action === ACTIONS.TRANSCRIBE_AUDIO) return handleTranscription({ settings, payload, origin, signal });
  // NIENTE payload.modelOverride: il modello di una funzione viene SOLO dalla configurazione
  // effettiva, o un chiamante potrebbe imporne uno scritto nel codice. `modelloDi` nomina
  // un'altra funzione di cui prendere il modello («Valuta» usa quello della chat, #1449): lo decide il main.
  const configurata = modelloDi || action;
  const model = modelForAction(settings, configurata);
  // Nome CONCRETO del modello primario, non il nickname: l'assistente deve poter dire che
  // modello è (#158). Un problema di configurazione invece ferma tutto subito.
  let modelName = model;
  try {
    const ch = buildAttemptChain(settings, model, configurata);
    if (ch[0] && ch[0].model) modelName = ch[0].model;
  } catch (e) {
    if (e && e.code === 'NO_MODEL_FOR_ACTION') throw e;
  }
  let messages = await buildMessages(action, { ...payload, modelName }, { sender });
  messages = SN_CONST.injectAgentStyle(messages, action, settings.agentStyle);

  // `noCache` salta la LETTURA, non la scrittura: serve ai ritentativi sul JSON illeggibile,
  // dove la chiave è identica. Con gli strumenti la cache si salta: conserva solo il testo.
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const skipCache = hasTools || AICache.esclusa(action);
  const cached = (noCache || skipCache) ? null : await AICache.get({ provider: settings.provider, model, messages, action });
  if (cached) {
    try { globalThis.SN_CONTATORI_MAIN?.servitaDaCache(action); } catch (_) {}
    return { text: cached.text, toolCalls: [], reasoningDetails: [], model, provider: settings.provider, costEur: 0, usage: cached.usage || {}, cached: true };
  }

  const attempts = buildAttemptChain(settings, model, configurata);

  const inCronologia = action !== ACTIONS.TRANSLATE_PAGE && action !== ACTIONS.CATEGORIZE
    && action !== ACTIONS.SPELLCHECK_SEMANTIC && action !== ACTIONS.SPELLCHECK_CONTEXT
    && action !== ACTIONS.HELP_INTENT_GUESS && action !== ACTIONS.HELP_INTENT_JUDGE
    // Passaggio interno di una ricerca, non una richiesta dell'utente: fuori dalla cronologia.
    && action !== ACTIONS.MANAGE_SEARCH
    // Il giudice delle carte è il passaggio interno di una ricerca nel deck builder, fino a venti chiamate a ricerca
    // col prompt intero: in cronologia buttava fuori tutto il resto in una dozzina di ricerche (#382).
    && action !== ACTIONS.DECKS_SEARCH_FILTER;
  const voce = voceDelTurno(inCronologia ? History : null);

  // Col ragionamento o la risposta in diretta si usa lo streaming: la risposta finale è
  // identica, accumulata dai delta. I tempi del turno si contano dalla partenza.
  const t0 = Date.now();
  const timing = { firstReasoningMs: null, firstTextMs: null, firstToolMs: null, totalMs: 0 };
  const mark = (k) => { if (timing[k] == null) timing[k] = Date.now() - t0; };
  const textStreamer = onText ? createAnswerStreamer(onText) : null;
  let result;
  try {
    result = (onReasoning || onText || onToolCall)
      ? await (async () => {
          let acc = '';
          const r = await Gate.stream({
            action, settings, attempts, messages, tools, toolChoice, signal, onCostoTardivo: voce.costo,
            onDelta: (d) => {
              acc += d;
              mark('firstTextMs');
              if (textStreamer) textStreamer.push(d);
            },
            onReasoning: (t) => { mark('firstReasoningMs'); try { onReasoning && onReasoning(t); } catch (_) {} },
            onToolCall: (c) => { mark('firstToolMs'); try { onToolCall && onToolCall(c); } catch (_) {} },
            // Provider caduto a metà stream: il buffer ha testo parziale del tentativo fallito e va
            // azzerato, e anche il testo già in chat va riscritto, non accodato: si segnala il reset.
            onReset: () => {
              acc = '';
              if (textStreamer) { textStreamer.reset(); try { onText({ reset: true }); } catch (_) {} }
            },
          });
          if (textStreamer) textStreamer.flush();
          return { ...r, text: r.text != null ? r.text : acc };
        })()
      : await Gate.complete({ action, settings, attempts, messages, tools, toolChoice, signal });
  } catch (e) {
    timing.totalMs = Date.now() - t0;
    voce.fallito({ action, provider: settings.provider, model: modelName, input: payload, output: `[${(e && e.message) || 'nessuna risposta'}]`, origin, timing });
    throw e;
  }
  timing.totalMs = Date.now() - t0;
  // Quanto il turno ha aspettato prima di chiamare il modello (stato del computer, saldo, contesto): `preparazioneMs`.
  if (tempiPrima && typeof tempiPrima === 'object') Object.assign(timing, tempiPrima);
  const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
  const reasoningDetails = Array.isArray(result.reasoningDetails) ? result.reasoningDetails : [];
  const { provider: usedProvider, model: concreteModel, servedBy, violation, costEur } = result;

  if (inCronologia) {
    // Un giro fatto solo di chiamate non è una risposta vuota: le azioni entrano nell'output.
    const calledOut = toolCalls.length
      ? `${result.text ? `${result.text}\n\n` : ''}[Azioni: ${toolCalls.map((c) => c.name).join(', ')}]`
      : result.text;
    await voce.scrivi({
      action, provider: usedProvider, model: concreteModel, servedBy,
      policyViolation: violation,
      input: payload, output: calledOut, origin, costEur, usage: result.usage, timing,
    });
  }

  // Una risposta tagliata (tetto o errore a metà flusso) non si rilegge dalla cache: chi riprova deve poterla avere intera (#1097.3).
  if (!skipCache && !globalThis.SN_CHAT_ERRORS.troncata(result.finishReason)) AICache.set({ provider: settings.provider, model, messages, text: result.text, usage: result.usage, action }).catch(() => {});
  return {
    text: result.text, toolCalls, reasoningDetails, finishReason: result.finishReason || null,
    model: concreteModel, provider: usedProvider, costEur, usage: result.usage, timing,
    // La chiave propria è stata rifiutata e ha risposto la personale (#629):
    // chi mostra la risposta lo dice all'utente.
    keyFallback: ripiegoDaDire(result.keyFallback),
  };
}

// La voce di Cronologia di un turno coi costi che il router dice dopo (tentativi rotti, risposta senza conto, #1302):
// entrano nella voce già scritta; un turno finito senza risposta ha la sua voce solo se qualcosa si è pagato.
function voceDelTurno(H) {
  let base = 0;
  let tardivi = 0;
  let scritta = null;
  let daScrivere = null;
  const scrivi = (entry) => {
    base = Number(entry.costEur) || 0;
    scritta = Promise.resolve(H.append({ ...entry, costEur: base + tardivi })).catch(() => null);
    return scritta;
  };
  return {
    costo(eur) {
      tardivi += Number(eur) || 0;
      if (scritta) scritta.then((h) => (h && h.id ? H.patch(h.id, { costEur: base + tardivi }) : null)).catch(() => {});
      else if (daScrivere) scrivi(daScrivere);
    },
    scrivi: (entry) => (H ? scrivi(entry) : Promise.resolve(null)),
    fallito(entry) {
      if (!H) return;
      if (tardivi > 0) scrivi(entry);
      else daScrivere = entry;
    },
  };
}

// Il ripiego dalla chiave propria ai crediti di Filo, con la riga già scritta:
// ogni superficie che mostra una risposta la mette sotto, uguale a quella della chat (#662).
function ripiegoDaDire(kf) {
  if (!kf || kf.failed) return null;
  const W = global.SN_WALLET;
  return { ...kf, line: W ? W.ownKeyFallbackLine(kf.status) : '' };
}

// ─── Streaming via Electron IPC ─────────────────────────────────────────────
// L'API è simile a Chrome port: il renderer invia "start" via ipcRenderer.invoke
// e riceve delta/done/error via ipcRenderer.on('ai-stream:<requestId>', ...).
// Il main side è in src/main/ipc.js, qui esponiamo handleStream.

async function handleStream({ action, payload, origin, onDelta, onMeta, onReset, signal }) {
  // «Trascrivi» su un audio (#1660): il riquadro della risposta riceve la trascrizione a pezzi, non una chat.
  if (action === ACTIONS.TRANSCRIBE_AUDIO) return require('./trascriviMedia').inStreaming({ payload, origin, signal, onDelta, onMeta });
  const settings = await getEffectiveSettings();
  const model = modelForAction(settings, action);
  let messages = await buildMessages(action, payload);
  messages = SN_CONST.injectAgentStyle(messages, action, settings.agentStyle);
  // Quando il prompt l'ha composto il main (chi chiama ha mandato il dato
  // grezzo, non i messaggi) glielo si restituisce: è l'unico che ha i cambi del
  // giorno, e le domande successive devono partire dallo stesso testo. #724
  const compostoQui = !(payload && Array.isArray(payload.messages) && payload.messages.length);
  if (onMeta) onMeta({ model, provider: settings.provider, messages: compostoQui ? messages : null });

  const cached = await AICache.get({ provider: settings.provider, model, messages, action });
  if (cached) {
    try { globalThis.SN_CONTATORI_MAIN?.servitaDaCache(action); } catch (_) {}
    if (onDelta) onDelta(cached.text);
    return { costEur: 0, usage: cached.usage || {}, cached: true, provider: settings.provider, model };
  }

  const voce = voceDelTurno(History);
  let result;
  try {
    result = await Gate.stream({
      action, settings, messages, signal, onCostoTardivo: voce.costo,
      onDelta: (delta) => { if (onDelta) onDelta(delta); },
      // Provider caduto dopo i primi delta: il renderer butta il parziale prima del ripiego.
      onReset: (info) => { if (onReset) onReset(info); },
    });
  } catch (e) {
    voce.fallito({ action, provider: settings.provider, model, input: payload, output: `[${(e && e.message) || 'nessuna risposta'}]`, origin });
    throw e;
  }
  const { provider: usedProvider, model: concreteModel, servedBy, violation, costEur } = result;

  await voce.scrivi({
    action, provider: usedProvider, model: concreteModel, servedBy,
    policyViolation: violation,
    input: payload, output: result.text, origin, costEur, usage: result.usage,
  });

  if (!globalThis.SN_CHAT_ERRORS.troncata(result.finishReason)) AICache.set({ provider: settings.provider, model, messages, text: result.text, usage: result.usage, action }).catch(() => {});
  const taglio = globalThis.SN_CHAT_ERRORS.erroreDelTaglio(result);
  if (taglio) throw taglio;
  return {
    costEur, usage: result.usage, provider: usedProvider, model: concreteModel, keyFallback: ripiegoDaDire(result.keyFallback),
    finishReason: result.finishReason || null,
  };
}

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  try { return JSON.parse(t); } catch (_) {}
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(t.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

async function lessonsBufferText() {
  const buf = await FiloMem.getLessonsBuffer();
  if (!buf.length) return '';
  return buf.map((l) => `- ${l.text}`).join('\n');
}

// La memoria come la vede il modello della chat: la usano il CONTESTO, memoria(leggi) (#2536.1) e «Valuta» (#1449).
async function memoriaPerModello() {
  const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(await FiloMem.getMemory());
  return { profilo, preferenze, espansioni, lezioni: await lessonsBufferText() };
}

// Senza memoria il parere di «Valuta» parte lo stesso.
async function memoriaPerValuta() {
  try {
    return await memoriaPerModello();
  } catch (e) {
    console.warn('[Filo] memoria per «Valuta»:', e?.message || e);
    return {};
  }
}

// Le lezioni che Filo si scrive da solo dopo un turno passano dalla regola di SALVA_LEZIONE: se a questo livello,
// con quello che il compito ha letto, una lezione non partirebbe da sola, l'agente non la scrive (#530).
async function lezioniAutomaticheConsentite({ sender = null, contesto = null, fontiLette = null } = {}) {
  try {
    const ing = globalThis.SN_ACTION_LEVELS.ingressi({ type: 'SALVA_LEZIONE', testo: 'lezione' }, {});
    let impostazioni = {};
    try { impostazioni = await Storage.getSettings(); } catch (_) {}
    if (!ing) return false;
    const d = decisioneAutonomia(ing, { sender, contesto, fontiLette, impostazioni });
    return globalThis.SN_AUTONOMIA.parteSenzaChiedere(d, d.stato.stato);
  } catch (_) { return false; }
}

// Le righe che l'utente ha tolto dal quaderno: lezioni e compattatore le vedono per non riscriverle (#872).
async function testoRigheTolte() {
  const tolte = (await FiloMem.righeTolte()).filter((t) => t.testo);
  return tolte.map((t) => `- ${t.testo}`).join('\n');
}

// `fonti`: gli eventi del filo di questo scambio (la domanda e la risposta), che le lezioni ricordano (#872).
async function maybeRunLessonAgent({ userMessage, filoReply, stateText, fonti = [] }) {
  try {
    const settings = await getEffectiveSettings();
    if (!SN_CONST.canServeAction(settings, ACTIONS.FILO_LESSON)) return;
    const memory = await FiloMem.getMemory();
    const { profilo, preferenze } = FiloMem.renderMemoryForPrompt(memory);
    const lezioniText = await lessonsBufferText();
    const interazione = `UTENTE: ${userMessage || ''}\nFILO: ${filoReply || ''}`;
    const tolte = await testoRigheTolte();
    const r = await handleAIRequest({
      action: ACTIONS.FILO_LESSON,
      payload: { profilo, preferenze, lezioni: lezioniText, interazione, stato: stateText, tolte },
      origin: 'filo:lesson',
      intera: true,
    });
    const text = (r?.text || '').trim();
    const contaLezione = (esito) => { try { globalThis.SN_CONTATORI_MAIN?.attivita('lezioni', esito); } catch (_) {} };
    if (!text || /^NULLA DA IMPARARE/i.test(text)) { contaLezione({ nulla: true }); return; }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let scritte = 0;
    let scartate = 0;
    for (const line of lines) {
      const m = line.match(/^LEZIONE:\s*(.+)$/i);
      if (!m) continue;
      // Il tetto vale anche per le lezioni che Filo si scrive da solo (#592); una che ripete una riga tolta dalla persona
      // non si scrive (#872): per i contatori è scartata.
      const w = await FiloMem.scriviLezione(m[1], { fonti });
      if (w.vuota) continue;
      if (w.rifiuto) console.warn('[Filo] lezione automatica scartata:', w.rifiuto);
      if (w.scritta) scritte += 1; else scartate += 1;
    }
    contaLezione({ scritte, scartate });
    if (await FiloMem.lessonsBufferShouldCompact()) {
      maybeRunCompactor().catch((e) => console.warn('[Filo] compact failed', e));
    }
  } catch (e) {
    console.warn('[Filo] lesson agent failed', e);
  }
}

// Compatta il buffer delle lezioni nei moduli di memoria. runCompactor() la forza subito:
// alla fine dell'intervista le lezioni devono già essere in memoria per la prima home.
// `rilancia`: chi l'ha chiesta a mano riceve l'errore (un riordino fermato dal tetto non avviene, e lo si dice: #1302).
async function maybeRunCompactor({ rilancia = false } = {}) {
  try {
    const settings = await getEffectiveSettings();
    if (!SN_CONST.canServeAction(settings, ACTIONS.FILO_COMPACT)) return false;
    const inizio = new Date().toISOString();
    // Le fonti per prime: la loro versione dice se l'utente ha cambiato qualcosa dopo questa lettura (#872).
    const meta = await FiloMem.getFonti();
    const memory = await FiloMem.getMemory();
    const buf = await FiloMem.getLessonsBuffer();
    if (!buf.length) return false;
    // Ogni riga e ogni lezione col suo segno: il compattatore cita i segni, e le fonti passano alle note (#872).
    const Q = globalThis.SN_QUADERNO;
    const { moduli, lezioni, rif } = Q.perCompattatore(memory, meta, buf);
    const r = await handleAIRequest({
      action: ACTIONS.FILO_COMPACT,
      payload: { moduli, lezioni, tolte: await testoRigheTolte() },
      origin: 'filo:compact',
      intera: true,
    });
    const text = (r?.text || '').trim();
    const versione = meta.versione || 0;
    let applicata;
    const nessuna = !text || /^NESSUNA MODIFICA/i.test(text);
    let nonRimesse = 0;
    if (nessuna) {
      applicata = await FiloMem.applicaCompattazione({ patch: {}, usate: buf, versione });
    } else {
      const letto = Q.leggiCompattatore(FiloMem.parseCompactorOutput(text), {
        rif, meta, tolte: meta.nascoste, ora: inizio,
      });
      nonRimesse = letto.scartate.length;
      if (letto.scartate.length) console.warn(`[Filo] compattatore: ${letto.scartate.length} righe tolte dall'utente non rimesse`);
      applicata = await FiloMem.applicaCompattazione({ patch: letto.patch, righe: letto.righe, usate: buf, versione });
    }
    if (!applicata) console.warn('[Filo] compattatore: l\'utente ha cambiato la memoria mentre lavorava, riparte al giro dopo');
    try {
      globalThis.SN_CONTATORI_MAIN?.attivita('compattazioni', { esito: !applicata ? 'rimandata' : nessuna ? 'nessuna' : 'applicata', nonRimesse });
    } catch (_) {}
    return applicata;
  } catch (e) {
    console.warn('[Filo] compactor failed', e);
    if (rilancia) throw e;
    return false;
  }
}

// Fermo da più della durata della cache, col tratto grande, il tratto si compatta senza aspettare il prossimo messaggio:
// la cache è comunque fredda, e riscriverlo costa uguale (SPEC-CONTESTO § La compattazione).
function compattaDaFermo(incognito, tetti) {
  if (!tetti) return;
  const cacheMs = ContestoFilo.durataMs(tetti.cache);
  Compattazione.programmaFermo(async () => {
    const l = await Compattazione.limiti(incognito, { tetti });
    const motivo = globalThis.SN_FILO_COMPATTAZIONE.motivo({
      soglia: tetti.soglia, base: l.base, turno: l.turno, tokenTratto: l.tokenTratto, ultimoUso: Date.now() - cacheMs - 1, cacheMs,
    });
    if (motivo === 'fermo') await Compattazione.compatta({ incognito, motivo, tetti });
  }, cacheMs + 60 * 1000, incognito);
}

const parteFissaChat = (tools, parteUtente) => globalThis.SN_FILO_COMPATTAZIONE.parteFissa(tools, parteUtente || '');
// La parte fissa prima che il turno la misuri: quella dell'ultimo turno; prima del primo, gli stessi pezzi con la parte
// dell'utente fotografata (o quella tipica, se non c'è ancora). Soglia e tetto del tratto partono da qui.
function baseDellaChat(incognito) {
  const Tools = globalThis.SN_ACTION_TOOLS;
  const foto = ContestoFilo.ultimaFotografia(incognito);
  return Compattazione.base(incognito)
    || globalThis.SN_FILO_COMPATTAZIONE.parteFissa(Tools ? Tools.definitions() : [], foto ? foto.testo : null);
}

// La frase accanto alla soglia: costo al mese e attesa, coi prezzi di OpenRouter di adesso per i modelli scelti.
async function stimaSogliaCompattazione(valore) {
  const FC = globalThis.SN_FILO_CONTESTO;
  const S = globalThis.SN_STIMA_COSTO;
  const settings = await getEffectiveSettings();
  const tetti = FC.tetti(settings.contestoFilo, Defaults.get().contestoFilo);
  const soglia = FC.numeroIn(valore, FC.LIMITI.soglia) ?? tetti.soglia;
  const ctxCosto = await require('./costoModelli').contesto({ Defaults });
  const primo = (action) => {
    try { return (buildAttemptChain(settings, modelForAction(settings, action), action)[0] || {}).model || ''; } catch (_) { return ''; }
  };
  const chat = primo(ACTIONS.FILO_CHAT);
  const comp = primo(modelloCheCompatta(settings));
  const base = baseDellaChat(false);
  const r = globalThis.SN_FILO_COMPATTAZIONE.stimaSoglia({
    soglia, base, prezzoChat: S.prezzoDi(ctxCosto.listino, chat), prezzoCompattazione: S.prezzoDi(ctxCosto.listino, comp), prezzoPer: S.prezzoPer,
  });
  return r ? r.testo : 'Il listino di OpenRouter adesso non dice il prezzo dei modelli scelti: Filo non stima il costo senza.';
}

// La compattazione del filo (SPEC-CONTESTO fase 4) chiama il modello scelto per lei, o quello della chat se nessuno l'ha
// scelto: lo stesso modello che legge il tratto lo riassume. La stima accanto alla soglia prende il prezzo dallo stesso.
function modelloCheCompatta(settings) {
  return SN_CONST.canServeAction(settings, ACTIONS.FILO_COMPATTAZIONE) ? ACTIONS.FILO_COMPATTAZIONE : ACTIONS.FILO_CHAT;
}
Compattazione.imposta({
  chiama: async ({ messages, motivo }) => {
    const settings = await getEffectiveSettings();
    const di = modelloCheCompatta(settings);
    const r = await handleAIRequest({
      action: ACTIONS.FILO_COMPATTAZIONE, payload: { daCompattare: messages, motivo }, origin: 'filo:compattazione', intera: true,
      modelloDi: di === ACTIONS.FILO_COMPATTAZIONE ? null : di,
    });
    return r && r.text;
  },
  applicaMemoria: async (testo, fonti) => {
    const w = await FiloMem.scriviLezione(testo, fonti);
    if (w.scritta && await FiloMem.lessonsBufferShouldCompact()) maybeRunCompactor().catch(() => {});
    return w;
  },
});

module.exports = {
  noteProvenienzaImmagini,
  ricordaOrigineInChat,
  origineGiaLettaInChat,
  buildMessages,
  handleAIRequest,
  handleStream,
  controllaTrascrizione,
  extractJson,
  lessonsBufferText,
  memoriaPerModello,
  lezioniAutomaticheConsentite,
  maybeRunLessonAgent,
  maybeRunCompactor,
  compattaDaFermo,
  parteFissaChat,
  baseDellaChat,
  stimaSogliaCompattazione,
};
