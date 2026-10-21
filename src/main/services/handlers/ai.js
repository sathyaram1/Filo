// Handler di dominio AI: richieste one-shot, sintesi vocale, prove dei modelli dalle
// Opzioni, ricerca web e raccolta dei percorsi «Aiuto».

module.exports = function register(on, ctx) {
  const {
    MSG, handleAIRequest, getEffectiveSettings, modelForAction, buildAttemptChain,
    providerRouting, openWeightsBlockReason, modelGate,
    Defaults, isAdmin, broadcastToTabs, controllaUscita, ricordaLettoDallAiuto, segnaLetturaAiuto, winOf,
  } = ctx;
  const { SN_CONST } = globalThis;
  const WebSearch = globalThis.SN_WEB_SEARCH;
  const PathsCollector = globalThis.SN_PATHS_COLLECTOR;
  require('../fontiSegnaposto');

  // Cache audio in memoria: rileggere lo stesso testo con la stessa voce e lo stesso modello
  // è istantaneo invece di rifare la chiamata lenta. Dura quanto la sessione.
  const crypto = require('node:crypto');
  const ttsCache = globalThis.SN_TTS_CACHE
    ? globalThis.SN_TTS_CACHE.createTtsCache({ maxBytes: 64 * 1024 * 1024 })
    : null;
  const ttsKey = (model, voice, text) =>
    crypto.createHash('sha1').update(`${model}\u0000${voice}\u0000${text}`).digest('hex');

  // Una lettura vive nel content script della scheda dov'è partita: il main tiene il set di
  // chi legge e ribroadcast, o «Interrompi lettura» non comparirebbe nelle altre schede.
  const readingWcs = new Set();      // id dei webContents attualmente in lettura
  const readingCleanups = new Map(); // id → funzione che stacca i listener
  let lastGlobalReading = false;
  function broadcastGlobalReading() {
    const active = readingWcs.size > 0;
    if (active === lastGlobalReading) return;
    lastGlobalReading = active;
    broadcastToTabs({ type: MSG.TTS_GLOBAL_READING, active });
  }
  function clearReading(wcId) {
    if (!readingWcs.has(wcId)) return;
    readingWcs.delete(wcId);
    const cleanup = readingCleanups.get(wcId);
    if (cleanup) { readingCleanups.delete(wcId); try { cleanup(); } catch (_) {} }
    broadcastGlobalReading();
  }
  function markReading(wc, reading) {
    if (!wc || typeof wc.id !== 'number') return;
    const id = wc.id;
    if (reading) {
      if (!readingWcs.has(id)) {
        readingWcs.add(id);
        // Se la scheda che legge si chiude o naviga, l'audio muore ma il «reading:false» può non
        // arrivare mai: si ripulisce qui.
        const onNav = (_e, _url, isInPlace, isMainFrame) => { if (isMainFrame) clearReading(id); };
        const onGone = () => clearReading(id);
        try { wc.on('did-start-navigation', onNav); } catch (_) {}
        try { wc.once('destroyed', onGone); } catch (_) {}
        readingCleanups.set(id, () => {
          try { wc.removeListener('did-start-navigation', onNav); } catch (_) {}
          try { wc.removeListener('destroyed', onGone); } catch (_) {}
        });
      }
      broadcastGlobalReading();
    } else {
      clearReading(id);
    }
  }

  on(MSG.TTS_READING_STATE, async (msg, sender) => {
    markReading(sender && sender.wc, !!(msg && msg.reading));
    return { ok: true };
  });

  on(MSG.TTS_READING_STATUS, async () => {
    return { ok: true, active: readingWcs.size > 0 };
  });

  on(MSG.TTS_STOP_READING, async () => {
    // Azzerato subito per reattività: il flag torna coerente al prossimo report.
    broadcastToTabs({ type: MSG.TTS_STOP });
    return { ok: true };
  });

  // Da una pagina delicata non parte niente di automatico (#1004): né la descrizione di uno screenshot o di un'immagine
  // copiata, né la spiegazione preparata alla selezione (#1274). Un'immagine nata lì resta fuori anche incollata su un
  // altro sito: conta la pagina da cui viene. Senza la regola non si sa: nel dubbio vale delicata.
  async function automaticaDaDelicata(msg, sender) {
    const A = SN_CONST.ACTIONS;
    const immagine = Boolean(msg && msg.action === A.DESCRIBE_IMAGE && msg.payload && msg.payload.automatica);
    const preparata = Boolean(msg && msg.action === A.EXPLAIN && msg.suRichiesta !== true);
    if (!immagine && !preparata) return false;
    const url = String(sender?.tab?.url || sender?.url || '');
    let delicata = null;
    try { delicata = await globalThis.SN_DELICATE.filtro(); } catch (_) { return true; }
    const daQui = /^https?:/i.test(url) && Boolean(delicata(url));
    if (!immagine) return daQui;
    const Immagini = require('../immaginiDelicate').perFilo();
    const dataUrl = msg.payload.dataUrl;
    if (daQui) {
      const incognito = Boolean(winOf && winOf(sender)?._filoTabs?.incognito);
      await Immagini.segna(dataUrl, { incognito }).catch(() => {});
      // Al modello va la copia coi campi segreti coperti (#810.7): incollata altrove, l'utente ha la foto vera.
      const originale = msg.payload.originale;
      if (typeof originale === 'string' && originale !== dataUrl) await Immagini.segna(originale, { incognito }).catch(() => {});
      return true;
    }
    if (delicata.attivo === false) return false;
    try { return await Immagini.daDelicata(dataUrl); } catch (_) { return true; }
  }

  // Spenta in Preferenze (#1274), la descrizione di screenshot e immagini copiate non parte: il file prende data e ora.
  async function descrizioneSpenta(msg) {
    if (!msg || msg.action !== SN_CONST.ACTIONS.DESCRIBE_IMAGE || !msg.payload || !msg.payload.automatica) return false;
    let s = null;
    try { s = await globalThis.SN_STORAGE.getSettings(); } catch (_) { s = null; }
    return Boolean(s && s.descriviImmagini && s.descriviImmagini.enabled === false);
  }

  // Il testo di una pagina delicata (#1004) non va a nessun modello da un lavoro automatico: i due controlli del
  // correttore (#1446) partono col solo testo di chi scrive e il nome del sito, e lo dicono alla pagina, che allora non
  // ha citazioni da confrontare.
  const DEL_CORRETTORE = new Set([SN_CONST.ACTIONS.SPELLCHECK_SEMANTIC, SN_CONST.ACTIONS.SPELLCHECK_CONTEXT]);
  const sitoDi = (url) => {
    try { const u = new URL(url); return u.protocol === 'filo:' ? 'Filo' : (u.hostname || ''); } catch (_) { return ''; }
  };
  async function senzaPaginaDelicata(msg, sender) {
    if (!msg || !DEL_CORRETTORE.has(msg.action) || !msg.payload || typeof msg.payload !== 'object') return false;
    const url = String(sender?.tab?.url || sender?.url || '');
    if (!/^https?:/i.test(url)) return false;
    let delicata = true;
    try { delicata = Boolean((await globalThis.SN_DELICATE.filtro())(url)); } catch (_) {}
    if (delicata) {
      const sito = msg.payload.luogo && typeof msg.payload.luogo.sito === 'string' ? msg.payload.luogo.sito : '';
      msg.payload = { ...msg.payload, contesto: {}, luogo: sito ? { sito } : {} };
    }
    return delicata;
  }

  const tettoAutomatiche = require('../tettoAutomatiche').crea();
  const { spingiAllaScheda } = require('../impostazioniPerOrigine');
  // Il tetto avvisa una volta per pausa, nella scheda che l'ha toccato: chi legge sa perché qualcosa si è fermato.
  function fermataDalTetto(msg, sender) {
    const wc = sender && sender.wc;
    const fermo = tettoAutomatiche.passa(msg, wc);
    if (!fermo) return null;
    const I18n = globalThis.SN_I18N;
    const frase = I18n ? I18n.t(`toast_tetto_${fermo.gruppo}`, fermo.tetto) : `${fermo.gruppo}: ${fermo.tetto}`;
    if (fermo.primo) {
      try { spingiAllaScheda(wc, { type: MSG.SHOW_TOAST, text: frase, duration: 9000 }, { inVista: true }); } catch (_) {}
      try { globalThis.SN_CONTATORI_MAIN?.erroreVisto('avviso:tetto_automatiche'); } catch (_) {}
    }
    return { ok: false, code: 'TROPPE_AUTOMATICHE', error: frase };
  }

  // #1448 — la ricerca di un segnaposto del correttore: le fonti le prende il main (Wikipedia e Wikidata, poi il web se
  // è acceso), il modello del controllo ragionato ne legge il valore, e la riga torna con la fonte vera. Da una pagina
  // delicata, o con un dato riservato nella ricerca, non si cerca. Regole: tests/unit/fontiSegnaposto.test.mjs.
  const SENZA_VALORE = '[][][][nessuno]';
  function segnapostoDaPagina(payload) {
    const s = payload && payload.segnaposto;
    if (!s || typeof s !== 'object') return null;
    const R = require('../correttoreRiservati');
    const testo = (v, max) => R.oscura(typeof v === 'string' ? v : '').slice(0, max);
    const dove = typeof s.dove === 'string' && /^(?:web|wiki:[a-z]{2,3})$/.test(s.dove) ? s.dove : 'wiki:en';
    const g = s.giaLette && typeof s.giaLette === 'object' ? s.giaLette : null;
    const giaLette = g && typeof g.domanda === 'string' && typeof g.dove === 'string' ? { domanda: testo(g.domanda, 200), dove: g.dove } : null;
    return { pezzo: testo(s.pezzo, 40), frase: testo(s.frase, 2000), domanda: testo(s.domanda, 200), dove, suRichiesta: s.suRichiesta === true, giaLette };
  }
  // Le fonti da cui un segnaposto ha avuto il suo valore, per sito e domanda: la stessa x richiesta con altre parole, o
  // precisata, si rilegge prima lì e ripaga la ricerca solo se lì il dato non c'è. Dati che cambiano: durano mezz'ora.
  const FONTI_LETTE_MAX = 200;
  const FONTI_LETTE_MS = 30 * 60 * 1000;
  const fontiLette = new Map();
  const chiaveLette = (sito, domanda, dove) => [sito, dove, String(domanda).toLowerCase().replace(/\s+/g, ' ').trim()].join('\u0000');
  async function cercaSegnaposto(sp, { sender, origin, delicata }) {
    const settings = await getEffectiveSettings();
    const corr = settings.correttore || {};
    if (corr.segnaposti === false) return { ok: false, code: 'SEGNAPOSTI_SPENTI' };
    const R = require('../correttoreRiservati');
    if (!sp.domanda.trim()) return { text: SENZA_VALORE };
    // Una ricerca non fatta non è un dato che non c'è: la pagina dice perché. Da una pagina delicata parte solo col
    // clic di chi scrive; con un dato riservato, o fermata dalla porta delle uscite, non parte mai.
    if (sp.domanda.includes(R.SEGNAPOSTO)) return { ok: false, code: 'RICERCA_BLOCCATA' };
    if (delicata && !sp.suRichiesta) return { ok: false, code: 'PAGINA_DELICATA' };
    const u = await controllaUscita({ type: 'CERCA_WEB', query: sp.domanda }, { sender });
    if (u.blocca) return { ok: false, code: 'RICERCA_BLOCCATA' };
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    let ultima = null;
    let fallita = '';
    for (const giro of F.giri(sp.dove, corr.segnapostiWeb !== false)) {
      let fonti = [];
      try {
        fonti = giro === 'web'
          ? await F.web(sp.domanda, settings.apiKeys?.tavily || '')
          : await F.wikipedia(sp.domanda, giro.replace(/^wiki:/, ''));
      } catch (e) {
        fallita = String(e?.message || e);
        console.warn('[SN] segnaposto, fonti:', fallita);
      }
      if (!fonti.length) continue;
      const r = await handleAIRequest({ action: SN_CONST.ACTIONS.SPELLCHECK_CONTEXT, payload: { segnaposto: sp, fonti }, origin });
      ultima = r;
      const riga = F.ricomponi(r && r.text, fonti);
      if (riga) return { ...r, text: riga };
    }
    // Fonti che non hanno risposto non dicono che il dato non c'è: la ricerca è fallita, e si può rifare.
    if (!ultima && fallita) return { ok: false, code: 'FONTI_NON_RAGGIUNTE', error: fallita };
    return { ...(ultima || {}), text: SENZA_VALORE };
  }

  on(MSG.AI_REQUEST, async (msg, sender, origin) => {
    if (await automaticaDaDelicata(msg, sender)) return { ok: false, code: 'PAGINA_DELICATA' };
    if (await descrizioneSpenta(msg)) return { ok: false, code: 'DESCRIZIONE_SPENTA' };
    const fermata = fermataDalTetto(msg, sender);
    if (fermata) return fermata;
    const senzaContesto = await senzaPaginaDelicata(msg, sender);
    const segnaposto = msg && msg.action === SN_CONST.ACTIONS.SPELLCHECK_CONTEXT ? segnapostoDaPagina(msg.payload) : null;
    if (segnaposto) {
      const Cont = globalThis.SN_CONTATORI_MAIN;
      const giro = () => cercaSegnaposto(segnaposto, { sender, origin, delicata: senzaContesto });
      const r = await (msg.parteDiUnUso === true && Cont && Cont.parteDiUnUso ? Cont.parteDiUnUso(msg.action, giro) : giro());
      return r && r.ok === false ? r : { ok: true, ...r };
    }
    // Chiavi, password e carte scritte nel campo restano sul computer (#1446); il sito lo dice chi ha mandato, non la pagina.
    if (msg && DEL_CORRETTORE.has(msg.action) && msg.payload && typeof msg.payload === 'object') {
      msg.payload = require('../correttoreRiservati').richiestaSenzaRiservati(msg.payload);
      const sito = sitoDi(String(sender?.tab?.url || sender?.url || ''));
      msg.payload.luogo = { ...(msg.payload.luogo && typeof msg.payload.luogo === 'object' ? msg.payload.luogo : {}), sito };
    }
    // #947.3 — i documenti che l'Aiuto ha cercato li mette il main, mai la pagina: da lei arriva solo il segno.
    const esterno = msg && msg.action === SN_CONST.ACTIONS.HELP && msg.payload && msg.payload.esterno;
    if (esterno && typeof esterno === 'object' && 'documenti' in esterno) {
      const d = esterno.documenti ? require('../aiutoDocumenti').perIlModello(sender && sender.wc) : null;
      if (d) esterno.documenti = d; else delete esterno.documenti;
    }
    // Quando è stata aperta la scheda lo sa il main (#826): il valore che manda la pagina non conta.
    if (msg && msg.action === SN_CONST.ACTIONS.HELP && msg.payload && typeof msg.payload === 'object') {
      msg.payload.schedaApertaIl = (sender && sender.tab && sender.tab.openedAt) || null;
      msg.payload.paginaDal = (sender && sender.tab && sender.tab.paginaDal) || null;
    }
    // Quello che l'assistente di pagina ha davanti resta noto alla porta delle uscite (#810),
    // anche se poi la pagina cambia. Si legge mentre il modello risponde.
    const lettura = msg && msg.action === SN_CONST.ACTIONS.HELP && /^https?:/i.test(String(sender?.tab?.url || sender?.url || ''))
      ? ricordaLettoDallAiuto(sender, msg.payload).catch(() => {})
      : null;
    // `diceRipiego`: la superficie scrive da sé la riga del ripiego sotto la risposta (#662).
    // La spiegazione partita da sola alla selezione si conta a parte nel diario dei crediti (#818).
    const AC = globalThis.SN_AVVISO_CREDITI_MAIN;
    const daSola = msg && msg.action === SN_CONST.ACTIONS.EXPLAIN && msg.suRichiesta !== true && AC && AC.comeAnticipata;
    // Il correttore ripete una volta la domanda la cui risposta era illeggibile (#1580): la cache la ridarebbe uguale.
    const noCache = Boolean(msg && msg.riprova === true && DEL_CORRETTORE.has(msg.action));
    const chiedi = daSola
      ? () => AC.comeAnticipata(() => handleAIRequest({ action: msg.action, payload: msg.payload, origin, sender }))
      : () => handleAIRequest({ action: msg.action, payload: msg.payload, origin, sender, noCache });
    const K = globalThis.SN_WALLET_MAIN;
    const conRipiego = () => (msg && msg.diceRipiego === true && K && K.conRipiegoDetto ? K.conRipiegoDetto(chiedi) : chiedi());
    // `parteDiUnUso`: un anticipo o un pezzo di una richiesta già contata; per i contatori vale solo se si guasta (#969).
    const Cont = globalThis.SN_CONTATORI_MAIN;
    const r = await (msg && msg.parteDiUnUso === true && Cont && Cont.parteDiUnUso ? Cont.parteDiUnUso(msg.action, conRipiego) : conRipiego());
    // `anticipo`: la risposta preparata prima che la persona la chieda è pronta; se la apre lo dice la pagina (#1461).
    if (msg && msg.anticipo === true && r && typeof r.text === 'string' && Cont && Cont.anticipoPronto) Cont.anticipoPronto(msg.action);
    if (lettura) await lettura;
    return { ok: true, ...r, ...(senzaContesto ? { senzaContesto: true } : {}) };
  });

  // ─── Classificatore della ricerca fra i feedback (#1118) ──────────────────
  // Il giro gira qui e la pagina chiede a che punto è: così il conto si registra una volta per ricerca, e la
  // pagina mostra i risultati mentre arrivano. Un giro per pagina: una ricerca nuova ferma quella di prima.
  const { daFilo, soloFilo } = require('./origine');
  const NON_ADMIN = () => ({ ok: false, code: 'not_admin', error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' });
  const { settingsForOwnerAction } = require('../resolveSupportModel');
  const giriRicerca = new Map(); // jobId → giro
  let giriFatti = 0;
  const GIRO_DIMENTICA_MS = 5 * 60 * 1000;
  // Più dei feedback che la pagina carica, con margine: un elenco più lungo non viene da lei.
  const RICERCA_MAX_CANDIDATI = 50000;

  function fermaGiro(id) {
    const g = giriRicerca.get(id);
    if (!g) return;
    giriRicerca.delete(id);
    try { g.controller.abort(); } catch (_) {}
  }

  // Errori la cui frase è già per chi legge (dicono anche dove si imposta il modello).
  const GIA_SCRITTI = ['NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL', 'NO_API_KEY', 'NO_ALLOWED_HOST', 'LIMIT_REACHED', 'PROVIDER_METHOD_MISSING'];
  function fraseErrore(e) {
    const CE = globalThis.SN_CHAT_ERRORS;
    if (e && GIA_SCRITTI.includes(e.code)) return String(e.message || e.code);
    return CE && typeof CE.sentence === 'function' ? CE.sentence(e) : String((e && e.message) || e || 'errore');
  }

  function candidatiValidi(lista) {
    const out = [];
    const visti = new Set();
    for (const c of Array.isArray(lista) ? lista : []) {
      const id = c && c.id != null ? String(c.id) : '';
      if (!id || visti.has(id)) continue;
      visti.add(id);
      out.push({ id, title: String((c && c.title) || '').slice(0, 500), text: String((c && c.text) || '') });
    }
    return out;
  }

  on(MSG.MANAGE_SEARCH_CLASSIFY, async (msg, sender, origin) => {
    if (!daFilo(origin, sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    if (!isAdmin()) return NON_ADMIN();
    const op = msg && msg.op;
    const jobId = msg && typeof msg.jobId === 'string' ? msg.jobId : '';
    if (op === 'stop') { fermaGiro(jobId); return { ok: true }; }
    if (op === 'status') {
      const g = giriRicerca.get(jobId);
      if (!g) return { ok: false, code: 'NO_JOB', error: 'ricerca non trovata' };
      if (g.finished) giriRicerca.delete(jobId);
      const S = globalThis.SN_MANAGE_SEARCH;
      return {
        ok: true, done: g.done, total: g.total, hits: S.rankHits(g.hits), finished: g.finished,
        skipped: g.skipped, error: g.error, code: g.code, model: g.model,
      };
    }
    if (op !== 'start') return { ok: false, code: 'BAD_OP', error: 'operazione sconosciuta' };

    const S = globalThis.SN_MANAGE_SEARCH;
    const query = String((msg && msg.query) || '').trim();
    if (!query) return { ok: false, code: 'EMPTY_QUERY', error: 'ricerca vuota' };
    const lista = Array.isArray(msg && msg.candidates) ? msg.candidates : [];
    if (lista.length > RICERCA_MAX_CANDIDATI) {
      return { ok: false, code: 'TOO_MANY', error: `Troppi feedback per il classificatore: ${lista.length}, al massimo ${RICERCA_MAX_CANDIDATI}.` };
    }
    const candidati = candidatiValidi(lista);
    const wcId = sender && sender.wc && typeof sender.wc.id === 'number' ? sender.wc.id : null;
    for (const [id, g] of giriRicerca) if (g.wcId === wcId) fermaGiro(id);

    const action = SN_CONST.ACTIONS.MANAGE_SEARCH_CLASSIFY;
    let settings;
    let attempts;
    try {
      settings = await settingsForOwnerAction(await getEffectiveSettings(), action);
      attempts = buildAttemptChain(settings, modelForAction(settings, action), action);
    } catch (e) {
      return { ok: false, code: (e && e.code) || 'NO_MODEL', error: fraseErrore(e) };
    }
    if (!attempts.some((a) => modelGate.supports(a.provider, 'decisions'))) {
      return { ok: false, code: 'NO_DECISION_PROVIDER', error: 'Nessun fornitore del classificatore sa rispondere a domande chiuse.' };
    }

    const requests = S.buildDecisionRequests(query, candidati, S.CLASSIFIER.BATCH);
    const id = `r${Date.now().toString(36)}${(++giriFatti).toString(36)}`;
    const g = {
      wcId, total: candidati.length, done: 0, hits: [], skipped: 0,
      finished: false, error: null, code: null, model: attempts[0].model || '', controller: new AbortController(),
    };
    giriRicerca.set(id, g);
    // La pagina chiusa a metà non paga il resto del giro.
    try { if (sender && sender.wc && typeof sender.wc.once === 'function') sender.wc.once('destroyed', () => fermaGiro(id)); } catch (_) {}
    const conta = (req, senza) => { g.done += req.ids.length; g.skipped += senza; };
    modelGate.decideAll({
      action, settings, attempts, requests, parallel: S.CLASSIFIER.PARALLEL, signal: g.controller.signal,
      onAnswer: (i, answers) => {
        const r = S.hitsFromAnswers(requests[i], answers, S.CLASSIFIER.THRESHOLD);
        g.hits.push(...r.hits);
        conta(requests[i], r.senza);
      },
    }).then((r) => {
      for (const i of r.skipped || []) conta(requests[i], requests[i].ids.length);
      if (r.model) g.model = r.model;
      if (r.error) { g.error = fraseErrore(r.error); g.code = r.error.code || 'PARTIAL'; }
    }).catch((e) => {
      g.error = fraseErrore(e);
      g.code = (e && e.code) || 'DECIDE_FAILED';
      console.warn('[Filo ricerca] classificatore fermo:', (e && e.message) || e);
    }).finally(() => {
      g.finished = true;
      const t = setTimeout(() => { if (giriRicerca.get(id) === g) giriRicerca.delete(id); }, GIRO_DIMENTICA_MS);
      if (t && typeof t.unref === 'function') t.unref();
    });
    return { ok: true, jobId: id, total: g.total };
  });

  // Dedup dell'avviso "lettura a modello non disponibile → voce del browser": un motivo si annuncia
  // una volta (firstFallback:true), un motivo DIVERSO sì (#713: altro modello escluso). Si riarma a ogni sintesi riuscita.
  let ttsFallbackAnnounced = '';

  // Voci che il router ha dichiarato in un errore, per i modelli fuori dai cataloghi noti:
  // dalla seconda richiesta valgono come catalogo, senza pagare un altro 400.
  const learnedVoices = new Map(); // modelId → [voce, …]

  // Sintesi con recupero della voce: se il router rifiuta la voce elencando
  // quelle ammesse, si riprova UNA volta con una della lingua del testo (e la
  // lista si ricorda). Se invece pretende una voce e non ne abbiamo nessuna da
  // dargli, l'errore diventa una frase per l'utente (codice TTS_VOICE_REQUIRED)
  // che dice dove scriverla.
  // `synth(voce)` fa la chiamata vera, passando dal cancello dei modelli.
  async function synthesizeWithVoiceRecovery(synth, { model, voice, lang }) {
    const Voices = globalThis.SN_TTS_VOICES;
    try {
      return await synth(voice);
    } catch (e) {
      const msg = (e && e.message) || '';
      const listed = Voices ? Voices.voicesFromError(msg) : [];
      if (listed.length) {
        learnedVoices.set(model, listed);
        const retry = Voices.pickFromList(listed, lang);
        if (retry && retry !== voice) {
          console.warn(`[SN] TTS: voce "${voice || '(nessuna)'}" rifiutata da ${model}, riprovo con "${retry}"`);
          const r = await synth(retry);
          return { ...r, voice: retry };
        }
      }
      const I18n = globalThis.SN_I18N;
      if (Voices && Voices.isVoiceRequiredError(msg)) {
        const err = new Error(I18n ? I18n.t('err_tts_voice_required', model) : msg);
        err.code = 'TTS_VOICE_REQUIRED';
        throw err;
      }
      // Un nome scritto a mano rifiutato con un 400 è un refuso, non un guasto: va detto così.
      const handWritten = voice && Voices && !Voices.isKnownVoice(voice, model)
        && !(learnedVoices.get(model) || []).includes(voice);
      // Il 400 si legge dallo status o, se manca, dal testo dell'errore.
      const rifiutata = (e && e.status === 400) || /\b400\b/.test(msg);
      if (handWritten && rifiutata) {
        const err = new Error(I18n ? I18n.t('err_tts_voice_unknown', model, voice) : msg);
        err.code = 'TTS_VOICE_UNKNOWN';
        throw err;
      }
      throw e;
    }
  }

  const ttsFallback = (error, errorCode, err = null) => {
    // Chiave rifiutata o crediti finiti (#1344.1): l'avviso dice perché e porta alla pagina Crediti, non «non disponibile ora».
    const W = globalThis.SN_WALLET;
    const keyRefused = Boolean(err && W && typeof W.keyRefusalOf === 'function' && W.keyRefusalOf(err));
    // I guasti tecnici hanno testi che cambiano a ogni frase: contano come un motivo solo.
    const motivo = errorCode ? `${errorCode}|${error}` : (keyRefused ? 'chiave' : 'guasto');
    const firstFallback = ttsFallbackAnnounced !== motivo;
    ttsFallbackAnnounced = motivo;
    // `errorCode` distingue i guasti tecnici (che il content script traduce in
    // una frase generica) dagli errori di CONFIGURAZIONE dei modelli, il cui
    // messaggio è già scritto per l'utente e va mostrato tale e quale.
    return {
      ok: false, error, errorCode: errorCode || '', firstFallback,
      ...(keyRefused ? { keyRefused: true, status: Number(err.status) || 0, provider: err.provider || '' } : {}),
      ...(err && typeof err.userMessage === 'string' && err.userMessage ? { userMessage: err.userMessage } : {}),
      ...(err && err.reason === 'crediti' ? { reason: 'crediti' } : {}),
    };
  };

  // Una lettura coi suoi ripieghi di voce e di fornitore è un uso solo, per i contatori giornalieri (#969); i pezzi
  // dopo il primo di una lettura lunga (`parteDiUnUso`) contano solo se si guastano.
  on(MSG.TTS_SYNTH, (msg) => {
    const C = globalThis.SN_CONTATORI_MAIN;
    const misura = msg && msg.parteDiUnUso === true ? C && C.parteDiUnUso : C && C.unUso;
    return typeof misura === 'function' ? misura(SN_CONST.ACTIONS.TTS, () => sintesiVocale(msg)) : sintesiVocale(msg);
  });
  async function sintesiVocale(msg) {
    // Sintesi vocale via modello. Costruisce la catena per l'azione TTS e
    // prova i fornitori che la implementano (il router, verso un host
    // indipendente). Se nessuno è disponibile o tutti falliscono, torna
    // { ok:false } e il content script ripiega sulla voce del browser (Web
    // Speech). `msg.lang` è la lingua del testo (la dichiara la pagina) e
    // sceglie la voce, salvo una voce scelta a mano in Preferenze.

    // Seam di test OPT-IN: nel CI headless non c'è né chiave né motore vocale, quindi si torna
    // PCM silenzioso. Opt-in per non alterare i test del degrado senza chiave.
    if (process.env.NODE_ENV === 'test' && globalThis.__filoTestTtsCanned) {
      const rate = 8000, seconds = 6;
      const audioBase64 = Buffer.alloc(rate * seconds * 2).toString('base64'); // PCM16 mono
      return { ok: true, audioBase64, mimeType: `audio/L16;rate=${rate}`, provider: 'test', model: 'test-tts' };
    }

    try {
      const settings = await getEffectiveSettings();
      const model = modelForAction(settings, SN_CONST.ACTIONS.TTS);
      let attempts;
      try {
        // Stesso limite di spesa delle altre funzioni: la voce del modello
        // costa, e oltre il limite si legge con quella del sistema.
        attempts = buildAttemptChain(settings, model, SN_CONST.ACTIONS.TTS);
        await modelGate.ensureUnderLimit(settings);
      } catch (e) {
        // Nessun modello di sintesi configurato: si legge col browser, ma il motivo vero passa al
        // content script, così l'avviso dice cosa manca invece di un codice interno.
        return ttsFallback(e?.message || 'no_tts_model', e?.code, e);
      }
      const Voices = globalThis.SN_TTS_VOICES;
      const ttsPrefs = (settings && settings.tts) || {};
      // Voce: quella delle Preferenze, altrimenti la lingua del testo, altrimenti quella dell'app.
      const chosen = String(msg.voice || ttsPrefs.modelVoice || '').trim();
      let locale = '';
      try { locale = require('electron').app.getLocale(); } catch (_) { locale = ''; }
      const lang = msg.lang || locale;
      // La velocità delle Preferenze vale anche per la voce del modello.
      const rate = Number(ttsPrefs.rate);
      const speed = rate >= 0.5 && rate <= 2 ? rate : 1;
      const text = String(msg.text == null ? '' : msg.text);
      let lastErr = null;
      for (const a of attempts) {
        if (!modelGate.supports(a.provider, 'synthesizeSpeech')) continue;
        // La voce dipende dal MODELLO: ogni modello ha i suoi nomi, e una voce
        // scelta per un altro modello va ignorata, non spedita (sarebbe un 400
        // e la lettura ripiegherebbe sul browser senza spiegazioni).
        const voice = Voices
          ? Voices.resolveVoice({ chosen, lang, modelId: a.model, learned: learnedVoices.get(a.model) })
          : chosen;
        const key = ttsCache ? ttsKey(a.model, `${voice}@${speed}`, text) : null;
        if (key) {
          const hit = ttsCache.get(key);
          if (hit) {
            try { globalThis.SN_CONTATORI_MAIN?.servitaDaCache(SN_CONST.ACTIONS.TTS); } catch (_) {}
            ttsFallbackAnnounced = ''; // sintesi disponibile: riarma l'avviso
            return {
              ok: true,
              audioBase64: hit.audioBase64,
              mimeType: hit.mimeType,
              provider: a.provider,
              model: a.model,
              cached: true,
            };
          }
        }
        try {
          // Chi ha servito e quanto è costato il router lo dice solo dopo: lo chiede il cancello, senza far aspettare la lettura.
          const r = await synthesizeWithVoiceRecovery((v) => modelGate.call({
            action: SN_CONST.ACTIONS.TTS, settings, attempt: a, method: 'synthesizeSpeech',
            args: { text, voice: v, speed },
          }), { model: a.model, voice, lang });
          if (key) ttsCache.set(key, { audioBase64: r.audioBase64, mimeType: r.mimeType });
          ttsFallbackAnnounced = ''; // sintesi riuscita: riarma l'avviso
          return {
            ok: true,
            audioBase64: r.audioBase64,
            mimeType: r.mimeType,
            provider: a.provider,
            model: a.model,
          };
        } catch (e) {
          lastErr = e;
          console.warn('[SN] TTS fallito:', e.message || e);
        }
      }
      return ttsFallback((lastErr && lastErr.message) || 'tts_failed', lastErr && lastErr.code, lastErr);
    } catch (e) {
      return ttsFallback(e?.message || String(e), '', e);
    }
  }

  // Per la tendina delle Preferenze: quale modello legge, il suo catalogo per lingua e la
  // voce scelta. `chosen` torna anche fuori catalogo: è scritta a mano e va mostrata.
  on(MSG.TTS_VOICES, async () => {
    const Voices = globalThis.SN_TTS_VOICES;
    let model = '';
    try {
      const settings = await getEffectiveSettings();
      const ref = modelForAction(settings, SN_CONST.ACTIONS.TTS);
      const attempts = buildAttemptChain(settings, ref, SN_CONST.ACTIONS.TTS);
      model = (attempts[0] && attempts[0].model) || '';
    } catch (e) {
      // Nessun modello di lettura: la pagina lo dice invece di fingere che uno scelga da sé.
      return { ok: true, model: '', catalog: '', required: true, groups: [], error: e?.message || String(e) };
    }
    const cat = Voices ? Voices.catalogFor(model) : null;
    let groups = cat ? Voices.groupedByLang(model) : [];
    if (!cat && learnedVoices.has(model)) {
      // Catalogo imparato dal router: nomi nudi, con una lingua solo se il nome la dichiara.
      const list = learnedVoices.get(model);
      const byLang = new Map();
      for (const id of list) {
        const m = /(?:^|-)([a-z]{2})(?:-|$)/i.exec(id);
        const l = m ? m[1].toLowerCase() : '';
        if (!byLang.has(l)) byLang.set(l, []);
        byLang.get(l).push({ id, lang: l, label: id });
      }
      groups = [...byLang.entries()].map(([lang, voices]) => ({
        lang, label: (Voices.LANG_LABELS[lang] || lang || 'voci'), voices,
      }));
    }
    return {
      ok: true,
      model,
      catalog: cat ? cat.id : '',
      catalogName: cat ? cat.name : '',
      required: cat ? cat.required !== false : !learnedVoices.has(model),
      groups,
    };
  });

  // Qui NON si passa da buildAttemptChain: quella scarta i fornitori senza chiave salvata,
  // che è il caso della prova, dove la chiave si sta digitando e arriva nel messaggio.
  async function testModelFor(provider, settings) {
    const s = settings || await getEffectiveSettings();
    const action = SN_CONST.ACTIONS.PROVIDER_TEST;
    const registry = s.modelRegistry || {};
    let refs = SN_CONST.parseModelRefs(modelForAction(s, action));
    // A interruttore acceso la prova parte sull'equivalente aperto, come le richieste vere.
    if (s.openWeightsOnly === true) {
      refs = SN_CONST.applyOpenWeightsPolicy(refs, registry, action).refs;
    }
    for (const ref of refs) {
      const concrete = SN_CONST.resolveModel(ref, provider, registry);
      if (concrete) return concrete;
    }
    return '';
  }

  on(MSG.TEST_PROVIDER, async (msg, sender, origin) => {
    try {
      const provider = msg.provider;
      let apiKey = (msg.apiKey || '').trim();
      // "Solo modelli a pesi aperti" (#461): la prova è una chiamata VERA, quindi
      // passa dallo stesso cancello delle funzioni. Il fornitore si controlla
      // prima del modello: chiedergli quale modello proverebbe non ha senso se
      // comunque non può essere interrogato.
      const s = await getEffectiveSettings();
      if (s.openWeightsOnly === true && SN_CONST.PRODUCER_DIRECT_PROVIDERS.includes(provider)) {
        return { ok: false, error: openWeightsBlockReason(s, { provider }) };
      }
      const model = (msg.model || '').trim() || await testModelFor(provider, s);
      if (!model) {
        return {
          ok: false,
          error: `Nessun modello ${provider} impostato per la prova: scegline uno in «Prova di un fornitore», fra le funzioni delle Opzioni.`,
        };
      }
      // La riga delle Opzioni senza chiave scritta si prova con la chiave con cui la funzione pagherebbe davvero, cioè
      // i crediti di Filo (#598, #830); la sceglie il main, e solo per le pagine di Filo: un sito non spende crediti.
      // Mai quella di fabbrica: su un modello qualunque la spende solo chi amministra (TEST_DEFAULT_MODEL).
      if (!apiKey && msg.chiaveDellUso === true && daFilo(origin, sender)) {
        const dellUso = String((s.apiKeys && s.apiKeys[provider]) || '').trim();
        if (dellUso && await chiaveDellUtente(dellUso)) apiKey = dellUso;
      }
      if (!apiKey) return { ok: false, code: 'NO_API_KEY', error: 'API key mancante' };
      // Modello indicato dalla riga (registry personale): se è proprietario la
      // prova non parte, altrimenti l'unica richiesta che l'interruttore non
      // ferma sarebbe proprio quella che si lancia dalla pagina dove lo si
      // accende.
      const modelBlocked = openWeightsBlockReason(s, { provider, model });
      if (modelBlocked) return { ok: false, error: modelBlocked };
      // Riga di un modello che non è di testo (voce, dettatura, indicizzazione):
      // si prova nel suo mestiere.
      const rowEntry = (s.modelRegistry || {})[msg.nickname] || null;
      // La riga delle Opzioni manda ordinamento e ragionamento già risolti al clic: la misura le verrà attribuita.
      const sortRiga = typeof msg.sort === 'string' ? msg.sort : null;
      const pesiRiga = SN_CONST.pesiDichiaratiPer(rowEntry, model);
      const routing = sortRiga != null
        ? providerRouting({ ...s, providerSort: '' }, sortRiga, pesiRiga)
        : providerRouting(s, rowEntry && rowEntry.sort, pesiRiga);
      const reasoningRiga = typeof msg.reasoning === 'string' ? msg.reasoning : (rowEntry && rowEntry.reasoning);
      const kind = modelKind(provider, model, rowEntry);
      if (kind !== 'text') {
        return await probeNonText({ settings: s, kind, provider, apiKey, model, routing, nickname: msg.nickname || '' });
      }
      const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
      const startMs = performance.now();
      let firstTokenMs = null;
      let charCount = 0;
      // Anche la prova porta con sé chi NON deve servirla, e misura con l'ordinamento degli host e il
      // ragionamento che la voce userebbe davvero: senza, la velocità letta parlerebbe di un'altra chiamata.
      const result = await probe({
        settings: s, provider, apiKey, model, routing, method: 'streamComplete',
        reasoning: SN_CONST.normalizeReasoning(reasoningRiga) || undefined,
        args: {
          messages,
          onDelta: (delta) => {
            if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
            charCount += (delta || '').length;
          },
        },
      });
      const totalMs = performance.now() - startMs;
      // Stream concluso senza contenuto (capita su certi endpoint gratuiti): per l'utente il
      // modello non funziona, quindi è un errore, non un OK.
      if (charCount === 0) return { ok: false, error: 'Il modello ha risposto vuoto' };
      const tokens = (result?.usage?.completionTokens) || Math.max(1, Math.round(charCount / 4));
      const tps = tokens > 0 && totalMs > 0 ? (tokens / (totalMs / 1000)) : 0;
      return {
        ok: true, provider, model,
        ttftMs: firstTokenMs != null ? Math.round(firstTokenMs) : null,
        totalMs: Math.round(totalMs), completionTokens: tokens,
        tokensPerSec: Math.round(tps * 10) / 10,
      };
    } catch (e) {
      return { ok: false, error: provaFallita(e) };
    }
  });

  // Lo stesso verdetto di ensureAllowedHost (openrouter.js), chiesto mentre si sceglie il modello.
  // Da un sito vale solo un nickname del registro: un id qualunque lo mandano solo le pagine di Filo.
  on(MSG.AUDIO_HOST_CHECK, async (msg, sender, origin) => {
    const A = SN_CONST.ACTIONS;
    const fn = msg.action === A.TTS ? 'audio_host_fn_tts' : (msg.action === A.TRANSCRIBE_AUDIO ? 'audio_host_fn_stt' : '');
    if (!fn) return { ok: true, verdict: 'na' };
    const s = await getEffectiveSettings();
    const interna = daFilo(origin, sender);
    let routing = providerRouting(s);
    let filoPays;
    // La pagina dei predefiniti decide la lista di esclusione di tutti: l'avviso usa quella che sta modificando,
    // senza la lista della chiave propria di chi la modifica (#962), e coi vincoli dei crediti di Filo (#831).
    if (interna && Array.isArray(msg.excluded)) {
      routing = providerRouting({ ...s, excludedProviders: msg.excluded.filter((x) => typeof x === 'string'), excludedProvidersOwnKey: null });
      filoPays = true;
    }
    let entry = null;
    if (interna && typeof msg.provider === 'string' && typeof msg.model === 'string') {
      entry = { provider: msg.provider, model: msg.model.trim() };
    } else {
      const raw = (s.modelRegistry || {})[String(msg.nickname || '').trim()];
      if (raw) entry = { ...registryEntryToSingle(raw), weights: raw.weights };
    }
    if (!entry || !entry.model) return { ok: true, verdict: 'na' };
    const apiKey = (s.apiKeys && s.apiKeys[entry.provider]) || '';
    const I18n = globalThis.SN_I18N;
    const label = String((typeof msg.label === 'string' && msg.label.trim()) || msg.nickname || entry.model).slice(0, 120);
    // Un modello che i crediti di Filo non pagano (#830) si dice mentre lo si sceglie, prima di chi lo ospita.
    if (!(await SN_CONST.creditsAllowModelLetto(entry.model, entry.weights)) && (filoPays === true || await pagaFilo(apiKey))) {
      return { ok: true, verdict: 'crediti', hosts: [], warning: I18n ? I18n.t('audio_host_warn_crediti', label, I18n.t(fn)) : 'crediti' };
    }
    const v = await modelGate.hostVerdict({ provider: entry.provider, apiKey, model: entry.model, providerRouting: routing, filoPays });
    if (v.ok) return { ok: true, verdict: 'ok' };
    const many = v.excluded.length > 1 ? '_many' : '';
    const key = v.reason === 'unknown' ? 'audio_host_warn_unknown' : `audio_host_warn_${v.reason}${many}`;
    const nomi = new Intl.ListFormat('it', { type: 'conjunction' }).format(v.excluded);
    const warning = I18n ? I18n.t(key, label, I18n.t(fn), nomi) : key;
    return { ok: true, verdict: v.reason, hosts: v.excluded, warning };
  });

  // La chiave spende i crediti di Filo (la personale o quella di fabbrica)? Senza chi tiene le chiavi non si sa: no.
  async function pagaFilo(apiKey) {
    const K = globalThis.SN_WALLET_MAIN;
    if (!apiKey || !K || typeof K.keySourceOf !== 'function') return false;
    try { return ['personal', 'factory'].includes(await K.keySourceOf(apiKey)); } catch (_) { return false; }
  }

  // La chiave è di chi usa Filo: la sua o la personale dei crediti, non quella di fabbrica.
  async function chiaveDellUtente(apiKey) {
    const K = globalThis.SN_WALLET_MAIN;
    if (!apiKey || !K || typeof K.keySourceOf !== 'function') return false;
    try { return ['own', 'personal'].includes(await K.keySourceOf(apiKey)); } catch (_) { return false; }
  }

  // Normalizza una entry del registry (nuovo schema { provider, model } o
  // vecchio duale { openrouter, … }) in { provider, model } — stessa logica
  // delle pagine Opzioni/admin.
  function registryEntryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Il mestiere decide COME provare un modello: provarli tutti con una chat fallirebbe su
  // tre mestieri su quattro.
  function modelKind(provider, model, entry) {
    const Caps = globalThis.SN_MODEL_CAPS;
    if (!Caps) return 'text';
    const meta = SN_CONST.entryModalities ? SN_CONST.entryModalities(entry || {}, '') : null;
    const caps = Caps.capabilitiesFor(provider, model, meta || undefined);
    if (caps.outputs.includes('embedding')) return 'embedding';
    if (caps.outputs.includes('audio')) return 'tts';
    if (!caps.uncertain && caps.inputs.includes('audio') && !caps.inputs.includes('image')) return 'stt';
    return 'text';
  }

  // Le prove sono chiamate vere, pagate: passano dal cancello come le funzioni (limite, costo, chi ha servito).
  // La prova misura la chiave che l'utente ha davanti: se OpenRouter la
  // rifiuta lo deve dire, non rispondere coi crediti di Filo (#662).
  function probe({ settings, provider, apiKey, model, routing, reasoning, method, args }) {
    const call = () => modelGate.call({
      action: SN_CONST.ACTIONS.PROVIDER_TEST, settings,
      attempt: { provider, apiKey, model, providerRouting: routing, ...(reasoning ? { reasoning } : {}) }, method, args,
    });
    const K = globalThis.SN_WALLET_MAIN;
    return K && typeof K.senzaRipiego === 'function' ? K.senzaRipiego(call) : call();
  }

  // L'errore di una prova, detto all'utente: un rifiuto della chiave col suo perché.
  function provaFallita(e) {
    const W = globalThis.SN_WALLET;
    const st = W ? W.keyRefusalOf(e) : 0;
    if (st) return `OpenRouter ha rifiutato questa chiave (${W.keyRefusalReason(st)}).`;
    return e?.message || String(e);
  }

  async function probeNonText({ settings, kind, provider, apiKey, model, routing, nickname }) {
    const via = (method, args) => probe({ settings, provider, apiKey, model, routing, method, args });
    const startMs = performance.now();
    const done = (extra) => ({
      ok: true, provider, model, nickname, kind,
      ttftMs: Math.round(performance.now() - startMs),
      totalMs: Math.round(performance.now() - startMs),
      completionTokens: null, tokensPerSec: null,
      ...extra,
    });
    if (kind === 'tts') {
      if (!modelGate.supports(provider, 'synthesizeSpeech')) return { ok: false, error: 'Questo fornitore non sa leggere ad alta voce' };
      // La frase di prova è italiana: la voce è quella di partenza per
      // l'italiano nel catalogo del modello (o nessuna, se sceglie da sé).
      const Voices = globalThis.SN_TTS_VOICES;
      const voice = Voices ? Voices.resolveVoice({ chosen: '', lang: 'it', modelId: model, learned: learnedVoices.get(model) }) : '';
      const text = 'Uno, due, tre: prova della voce.';
      const r = await synthesizeWithVoiceRecovery((v) => via('synthesizeSpeech', { text, voice: v, speed: 1 }), { model, voice, lang: 'it' });
      if (!r || !r.audioBase64) return { ok: false, error: 'Il modello ha risposto senza audio' };
      return done({ audioBytes: Math.round(r.audioBase64.length * 3 / 4) });
    }
    if (kind === 'embedding') {
      if (!modelGate.supports(provider, 'embed')) return { ok: false, error: 'Questo fornitore non sa indicizzare' };
      const r = await via('embed', { texts: ['prova'], dim: SN_CONST.EMBED_DIM });
      const v = r && r.vectors && r.vectors[0];
      if (!v || !v.length) return { ok: false, error: 'Il modello ha risposto senza vettori' };
      return done({ dims: v.length });
    }
    if (kind === 'stt') {
      if (!modelGate.supports(provider, 'transcribe')) return { ok: false, error: 'Questo fornitore non sa trascrivere' };
      const Seg = globalThis.SN_DICTATION_SEGMENTER;
      const wav = Seg.pcm16ToWav(new Int16Array(16000), 16000); // un secondo di silenzio
      const r = await via('transcribe', { audioBase64: Seg.bytesToBase64(wav), format: 'wav' });
      if (!r || typeof r.text !== 'string') return { ok: false, error: 'Il modello non ha risposto' };
      return done({});
    }
    return { ok: false, error: 'Tipo di modello non riconosciuto' };
  }

  // Stessa precedenza di withDefaults: prima la chiave predefinita (build o override admin),
  // poi la personale come ripiego; qui si provano i modelli PREDEFINITI.
  async function defaultKeyFor(provider, d) {
    const fromDefaults = ((d && d.apiKeys) || {})[provider] || '';
    if (fromDefaults) return fromDefaults;
    const eff = await getEffectiveSettings();
    return (eff.apiKeys || {})[provider] || '';
  }

  // Le prove spendono le chiavi predefinite: le chiedono solo le Opzioni e l'editor dei predefiniti,
  // mai un sito visitato (#784.2).
  on(MSG.TEST_DEFAULT_MODEL, soloFilo(async (msg) => {
    try {
      const nickname = (msg.nickname || '').trim();
      const explicitModel = (msg.model || '').trim();
      try { await Defaults.refreshIfStale(); } catch (_) {}
      const d = Defaults.get();
      let provider; let modelId; let regEntry = null;
      // Riga non ancora salvata: ordinamento e reasoning sono quelli scritti lì.
      let tuning = { sort: msg.sort, reasoning: msg.reasoning };
      if (explicitModel) {
        // Riga dell'editor admin, testata così com'è scritta (anche non ancora
        // salvata). Spende le chiavi predefinite su un modello arbitrario →
        // riservato agli amministratori.
        if (!isAdmin()) return NON_ADMIN();
        provider = 'openrouter';
        modelId = explicitModel;
      } else {
        // Il nickname si risolve nel registry PREDEFINITO, non nei settings personali: deve
        // trovarsi anche quando l'utente gestisce i propri modelli.
        if (!nickname) return { ok: false, error: 'Nickname mancante' };
        // Se un nickname non c'è più, «Prova» deve dirlo invece di provare un modello del codice.
        const registry = d.modelRegistry || {};
        const entry = registry[nickname];
        if (!entry) return { ok: false, error: `Modello "${nickname}" non trovato` };
        regEntry = entry;
        tuning = { sort: entry.sort, reasoning: entry.reasoning };
        const single = registryEntryToSingle(entry);
        provider = single.provider || 'openrouter';
        modelId = single.model || '';
        if (!modelId) return { ok: false, error: 'Stringa modello vuota' };
      }
      // Prove pagate con le chiavi predefinite: stesso cancello (vedi openWeightsBlockReason).
      const eff = await getEffectiveSettings();
      // Si passa la voce intera: se l'owner ha classificato a mano quel modello come aperto,
      // la prova lo rispetta come fanno le richieste vere.
      const blocked = openWeightsBlockReason(eff, { ...(regEntry || {}), provider, model: modelId });
      if (blocked) return { ok: false, error: blocked };
      const apiKey = await defaultKeyFor(provider, d);
      if (!apiKey) return { ok: false, error: `Chiave ${provider} non configurata` };
      const model = modelId;
      const kind = modelKind(provider, model, regEntry);
      // L'editor e le Opzioni mandano l'ordinamento già risolto dalla pagina (al clic: la misura va a quello, anche se
      // la tendina cambia intanto). Senza, una voce predefinita si prova con la scelta personale di questo utente.
      const sortDelClic = !explicitModel && typeof msg.sort === 'string' ? msg.sort : null;
      const pesi = SN_CONST.pesiDichiaratiPer(regEntry, modelId);
      const routing = explicitModel || sortDelClic != null
        ? providerRouting({ ...eff, providerSort: '' }, explicitModel ? tuning.sort : sortDelClic, pesi)
        : providerRouting(eff, SN_CONST.ordinamentoPerUtente(eff.ordineHost, tuning.sort, ''), pesi);
      if (kind !== 'text') {
        return await probeNonText({ settings: eff, kind, provider, apiKey, model, routing, nickname });
      }
      const messages = [{ role: 'user', content: 'Conta da 1 a 20 separando con virgole, senza testo extra.' }];
      const startMs = performance.now();
      let firstTokenMs = null;
      let charCount = 0;
      // Come per le richieste vere: chi è escluso non serve nemmeno una prova.
      const result = await probe({
        settings: eff, provider, apiKey, model, routing, method: 'streamComplete',
        reasoning: SN_CONST.normalizeReasoning(tuning.reasoning) || undefined,
        args: {
          messages,
          onDelta: (delta) => {
            if (firstTokenMs == null) firstTokenMs = performance.now() - startMs;
            charCount += (delta || '').length;
          },
        },
      });
      const totalMs = performance.now() - startMs;
      if (charCount === 0) return { ok: false, error: 'Il modello ha risposto vuoto' };
      const tokens = (result?.usage?.completionTokens) || Math.max(1, Math.round(charCount / 4));
      const tps = tokens > 0 && totalMs > 0 ? (tokens / (totalMs / 1000)) : 0;
      return {
        ok: true, provider, model: modelId, nickname,
        ttftMs: firstTokenMs != null ? Math.round(firstTokenMs) : null,
        totalMs: Math.round(totalMs), completionTokens: tokens,
        tokensPerSec: Math.round(tps * 10) / 10,
      };
    } catch (e) {
      return { ok: false, error: provaFallita(e) };
    }
  }));

  // Catalogo modelli di un provider, recuperato dal main con le chiavi
  // predefinite: la pagina admin non vede mai le chiavi vere, quindi non può
  // interrogare le API da sola (a differenza delle Opzioni, che usano le
  // chiavi dell'utente). Solo metadati, nessuna inferenza. Ritorna
  // { ok, items: [{ id, label }] } già ordinati dal più recente e con
  // l'etichetta di categoria (Testo / Multimodale / Sintesi vocale / …).
  on(MSG.DEFAULT_MODELS_LIST, soloFilo(async () => {
    try {
      if (!isAdmin()) return NON_ADMIN();
      const provider = 'openrouter';
      try { await Defaults.refreshIfStale(); } catch (_) {}
      const apiKey = await defaultKeyFor(provider, Defaults.get());
      // Il catalogo OpenRouter è pubblico: la chiave è facoltativa. La lista semplice ha solo
      // i modelli di testo; voce, dettatura e indicizzazione si chiedono per modalità.
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const queries = ['', '?output_modalities=speech', '?output_modalities=transcription', '?output_modalities=embeddings'];
      const lists = await Promise.all(queries.map(async (q) => {
        const res = await fetch('https://openrouter.ai/api/v1/models' + q, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data.data || []).map((m) => ({ id: m.id, meta: m })).filter((it) => it.id);
      }));
      const raw = lists.flat();
      const Caps = globalThis.SN_MODEL_CAPS;
      const items = Caps.sortByRecency(raw.map((it) => ({ ...it, provider })))
        .map((it) => ({ id: it.id, label: Caps.categoryLabel(provider, it.id, it.meta) }));
      return { ok: true, provider, items };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Le stime di costo accanto ai modelli (#819): la pagina le calcola col contesto che solo il main ha.
  on(MSG.STIMA_COSTO_MODELLI, soloFilo(async (msg) => {
    try {
      const contesto = await require('../costoModelli').contesto({ Defaults, forzaListino: Boolean(msg && msg.forzaListino) });
      return { ok: true, contesto };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Fornitori che lo smistatore conosce: riempiono il menu dei fornitori
  // esclusi e fanno scoprire un nome che non esclude nessuno (un refuso).
  on(MSG.DEFAULT_PROVIDERS_LIST, soloFilo(async () => {
    try {
      if (!isAdmin()) return NON_ADMIN();
      const res = await fetch('https://openrouter.ai/api/v1/providers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (Array.isArray(data && data.data) ? data.data : [])
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        .map((p) => ({ name: p.name.trim(), slug: typeof p.slug === 'string' ? p.slug : '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // La domanda esce verso il motore di ricerca: passa dalla porta delle uscite come la
  // ricerca della chat (#810). Solo il blocco: qui non c'è un popup per l'OK in più.
  // La ricerca dell'Aiuto è una lettura del suo compito come CERCA_WEB in chat (#530): la stessa fonte.
  on(MSG.WEB_SEARCH, async (msg, sender) => {
    try {
      const parole = (Array.isArray(msg && msg.parole) ? msg.parole : [])
        .filter((x) => typeof x === 'string').join('\n').slice(-200000);
      const u = await controllaUscita({ type: 'CERCA_WEB', query: msg && msg.query }, { sender, parole });
      if (u.blocca) return { ok: false, blocked: 'segreto', frase: u.frase, results: [] };
      const settings = await getEffectiveSettings();
      const tavilyKey = settings.apiKeys?.tavily || '';
      const r = await WebSearch.search({ query: msg.query, tavilyKey, maxResults: 5 });
      segnaLetturaAiuto(sender, { type: 'CERCA_WEB', query: msg.query, _output: r });
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message || String(e), results: [] };
    }
  });

  // Non ha potere: dice solo, su un indirizzo che chi chiede ha già davanti, se una risposta
  // servirebbe a qualcosa. Risponde la stessa porta della raccolta (#584).
  on(MSG.PATH_COLLECTABLE, async (msg) => {
    try {
      const r = await PathsCollector.raccoglibile(msg?.payload?.url);
      return { ok: true, raccoglibile: !!r.ok, reason: r.reason || '' };
    } catch (e) {
      // Nel dubbio non si promette niente: meglio non chiedere che chiedere per niente.
      return { ok: true, raccoglibile: false, reason: e?.message || String(e) };
    }
  });

  on(MSG.SAVE_PATH, async (msg, sender, origin) => {
    (async () => {
      try {
        const settings = await getEffectiveSettings();
        if (!SN_CONST.canServeAction(settings, SN_CONST.ACTIONS.HELP_INTENT_GUESS)) return;
        // Niente user agent e nessun identificativo del mittente (#584): nel
        // documento non ci entrano, e sistema operativo più versione più lingua
        // bastavano a rimettere insieme i percorsi della stessa installazione su
        // domini diversi. Il `clientId` del contratto della callable resta un
        // ripiego del server e Filo non ne genera nessuno: portarselo dietro
        // vuoto, fin dentro la coda sul disco, era solo l'invito a riempirlo.
        //
        // L'identità per i limiti di frequenza NON si prende qui: il percorso
        // non parte adesso, entra in una coda e parte ore dopo (#584, secondo
        // giro), e un token preso adesso a quel punto è scaduto. Chi manda se
        // lo fa dare al momento dell'invio, da `ottieniIdToken` (vedi l'init
        // della coda in handlers/misc.js).
        const invokeAI = ({ action, payload }) => handleAIRequest({ action, payload, origin, intera: true });
        const r = await PathsCollector.collectAndSave({ session: msg.payload?.session, invokeAI });
        if (r?.saved) console.info('[Filo] percorso in coda:', r.id, r.intent);
      } catch (e) { console.warn('[Filo] save_path failed', e); }
    })();
    return { ok: true };
  });
};
