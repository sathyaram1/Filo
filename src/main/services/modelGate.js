// Il cancello dei modelli: ogni chiamata che fa lavorare un fornitore passa di qui, con limite di spesa, costo e chi ha servito.
// Fuori da questo file e da providers/ nessuno tocca i fornitori: la regola la tiene tests/unit/cancelloModelli.test.mjs.
// Le dipendenze le inietta handlers.js (create); le domande gratuite (esiste il fornitore? residuo di una chiave) sono statiche.

(function (global) {
  'use strict';

  const providers = () => global.SN_PROVIDERS;

  // Le chiamate che fanno lavorare un modello, e quindi costano.
  const PAID = new Set(['complete', 'streamComplete', 'synthesizeSpeech', 'transcribe', 'embed', 'decisions']);
  // Gli argomenti di `call` che portano testo al fornitore: passano tutti dall'oscuramento, non solo i messaggi (la voce
  // legge `text`, l'indicizzazione manda `texts`, #1507). Gli altri sono numeri, audio o funzioni: sentinella in
  // tests/unit/usciteSegreti.test.mjs.
  const CAMPI_TESTO = Object.freeze(['messages', 'text', 'texts', 'input', 'prompt']);

  // Cosa fare di un errore di un classificatore che gira su tanti lavori insieme (decideAll). `risposto`: il modello
  // ha già risposto almeno una volta, quindi un 400 è colpa di quella richiesta e non del modello. Prima della prima
  // risposta, con nessun'altra richiesta in volo, un guasto passeggero (server, rete) ha UN nuovo tentativo ad attesa
  // corta: un servizio giù ripiega in un attimo. Un 429 invece è un servizio che risponde: aspetta quanto chiede e si
  // riprova come sempre (#1118). Prove: tests/unit/cancelloDecisioni.test.mjs.
  const TENTATIVI_PRIMA_RISPOSTA = 1;
  const ATTESA_PRIMA_RISPOSTA_MS = 1500;
  function esitoDecisione(err, risposto, tentativo = 0, altriInVolo = false) {
    const s = Number(err && err.status);
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) return 'fatale';
    if (s === 400) return risposto ? 'scarta' : 'fatale';
    let tipo = 'fatale';
    if (s === 429) tipo = 'lento';
    else if (s >= 500 || s === 408) tipo = 'passeggero';
    else if (!s) {
      const W = global.SN_WALLET;
      const rete = W && typeof W.isNetworkError === 'function'
        ? W.isNetworkError(err)
        : /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|socket hang up/i.test(String((err && err.message) || ''));
      if (rete) tipo = 'passeggero';
    }
    if (tipo === 'passeggero' && !risposto && !altriInVolo && tentativo >= TENTATIVI_PRIMA_RISPOSTA) return 'fatale';
    return tipo;
  }

  // Il router rende leggibile una generazione qualche secondo dopo: tre tentativi, poi si lascia perdere.
  const AUDIT_DELAYS_MS = [4000, 10000, 25000];

  function codeError(message, code) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  function providerOf(name) {
    try { return (name && providers() && providers().getProvider(name)) || null; } catch (_) { return null; }
  }

  function hasProvider(name) { return Boolean(providerOf(name)); }

  function supports(name, method) {
    const P = providerOf(name);
    return Boolean(P && typeof P[method] === 'function');
  }

  async function keyInfo({ provider = 'openrouter', apiKey, signal } = {}) {
    const P = providerOf(provider);
    if (!P || typeof P.keyInfo !== 'function') throw codeError(`Il fornitore ${provider} non dice il residuo delle chiavi`, 'NO_KEY_INFO');
    return P.keyInfo({ apiKey, signal });
  }

  // Chi servirebbe il modello è tutto ammesso? Non spende: legge solo l'elenco degli host (#1141).
  async function hostVerdict({ provider = 'openrouter', apiKey, model, providerRouting, filoPays } = {}) {
    const P = providerOf(provider);
    if (!P || typeof P.hostVerdict !== 'function') return { ok: true };
    return P.hostVerdict({ apiKey, model, providerRouting, filoPays });
  }

  function limitError() {
    const I18n = global.SN_I18N;
    return codeError(I18n ? I18n.t('err_limit_reached') : 'Limite di spesa mensile raggiunto.', 'LIMIT_REACHED');
  }

  // Un costo si registra subito solo se la risposta lo porta: voce e dettatura lo dicono dopo, con l'id della generazione.
  function carriesCost(usage) {
    const u = usage || {};
    return Number(u.costUsd) > 0 || Number(u.promptTokens) > 0 || Number(u.completionTokens) > 0;
  }

  function plainNoteServed(settings, action, result) {
    const servedBy = (result && result.servedBy) || null;
    const C = global.SN_CONST;
    const violation = Boolean(servedBy && C && typeof C.servedViolationOf === 'function'
      && C.servedViolationOf(settings, result));
    return { servedBy, violation };
  }

  function create(deps = {}) {
    const {
      getSettings,
      buildChain,
      modelFor,
      routing = () => null,
      noteServed = plainNoteServed,
      costs = global.SN_COSTS,
      auditDelaysMs = AUDIT_DELAYS_MS,
      segreti = async () => [],
      ricordaEsterni = () => {},
      funzioneDi = () => '',
      rimedioDi = () => '',
      contatore = () => null,
      // La durata della cache della parte fissa della chat, dalle impostazioni ('5m' o '1h'); null = quella di serie.
      durataCache = () => null,
    } = deps;

    // I contatori giornalieri (#969): ogni chiamata è un uso della sua funzione, con l'attesa fino alla prima cosa
    // visibile e il guasto di ogni tentativo fallito; il tentativo che ha servito porta i suoi numeri (#1464), e il
    // costo chiesto dopo arriva da sé. Un contatore rotto non ferma mai una risposta.
    const MUTO = { visto() {}, errore() {}, fine() {}, chiamata() {}, tardiva() {} };
    function misura(action) {
      let m = null;
      try { const c = contatore(); m = c && typeof c.apri === 'function' ? c.apri(action) : null; } catch (_) { m = null; }
      if (!m) return MUTO;
      const quieto = (fn) => (...a) => { try { fn.apply(m, a); } catch (_) {} };
      return { visto: quieto(m.visto), errore: quieto(m.errore), fine: quieto(m.fine), chiamata: quieto(m.chiamata), tardiva: quieto(m.tardiva) };
    }

    // Quello che i contatori leggono di una risposta servita: numeri e nome del modello, mai il testo. Senza token
    // detti la risposta non dice niente del contesto; ragionamento e fine ci sono solo nelle risposte di testo.
    function chiamataDi(res, modello, { tentativo, spesa } = {}) {
      const r = res || {};
      const u = r.usage || {};
      const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
      const detto = n(u.promptTokens) > 0 || n(u.completionTokens) > 0;
      const testo = r.finishReason !== undefined;
      return {
        modello,
        ingresso: detto ? n(u.promptTokens) : null,
        cacheLetti: n(u.cachedPromptTokens),
        cacheDetta: u.cacheDetta === undefined ? undefined : Boolean(u.cacheDetta),
        ragionamento: testo && detto && u.reasoningTokens !== undefined ? u.reasoningTokens : undefined,
        uscita: testo && detto ? n(u.completionTokens) : null,
        fine: testo ? r.finishReason : undefined,
        tentativo,
        ricominciata: Boolean(r.ricominciata),
        ragionamentoTolto: Boolean(r.ragionamentoTolto),
        spesa,
      };
    }

    // Il costo in dollari di una risposta: quello detto dal router, o la stima dal listino delle Opzioni.
    function spesaDi(s, model, usage) {
      const u = usage || {};
      const usd = Number(u.costUsd);
      if (Number.isFinite(usd) && usd > 0) return { usd, origine: 'router' };
      const pricing = (s && s.pricing && s.pricing[model]) || null;
      if (!pricing || !costs || typeof costs.estimateCostEur !== 'function') return null;
      let stima = 0;
      // Con un cambio di 1 la stima del listino resta in dollari.
      try { stima = Number(costs.estimateCostEur({ usage: u, pricing, usdToEur: 1 })); } catch (_) { stima = 0; }
      return stima > 0 ? { usd: stima, origine: 'stima' } : null;
    }
    function vedendo(m, fn) {
      return typeof fn === 'function' ? (...a) => { m.visto(); return fn(...a); } : fn;
    }

    // Il «nessun host ammesso» del router (#828) lo legge chi usa una funzione: la frase dice quale, e dove si sceglie
    // un altro modello. Voce, dettatura e classificatori hanno la loro frase, scritta prima di chiamare.
    function conLaFunzione(err, s, action) {
      const CE = global.SN_CHAT_ERRORS;
      if (!err || err.code !== 'NO_ALLOWED_HOST' || !CE || typeof CE.fraseNessunHost !== 'function') return err;
      let funzione = '';
      let rimedio = '';
      try { funzione = funzioneDi(action) || ''; } catch (_) {}
      try { rimedio = rimedioDi(s, action, err) || ''; } catch (_) {}
      err.message = CE.fraseNessunHost({ modello: err.model, funzione, motivo: err.motivo || CE.motivoNessunHost(err), rimedio });
      return err;
    }
    const DAL_ROUTER = new Set(['complete', 'streamComplete', 'embed']);
    // La ritenzione zero (#831) e la regola dei crediti (#830) hanno la frase condivisa su ogni strada; le altre frasi
    // di voce e dettatura restano loro.
    const condivisa = (err) => Boolean(err && /^(zdr|crediti$)/.test(String(err.reason || '')));
    const conLaFrase = (err, s, action, method) => (DAL_ROUTER.has(method) || condivisa(err) ? conLaFunzione(err, s, action) : err);

    // Nessun segreto custodito da Filo entra nel contesto di un modello (#810): quello che non
    // ha, il modello non lo può far uscire. Sentinella: tests/unit/usciteSegreti.test.mjs.
    // Di qui passa anche tutto quello che da fuori arriva a un modello, qualunque strada abbia preso: i segreti che
    // contiene diventano letti, e la porta delle uscite li ferma (#810).
    async function senzaSegreti(messages) {
      try { ricordaEsterni(messages); } catch (_) {}
      const G = global.SN_GUARDIANO_STATICO;
      if (!G || typeof G.oscuraSegreti !== 'function') return messages;
      let lista = [];
      try { lista = await segreti(); } catch (_) { lista = []; }
      return G.oscuraSegreti(messages, lista);
    }

    // Il piano si fa sui messaggi già oscurati: sono quelli che partono, e un taglio a caratteri deve cadere su di loro.
    function pianoCache(action, messages, s) {
      const FC = global.SN_FILO_CONTESTO;
      let durata = null;
      try { durata = durataCache(s); } catch (_) { durata = null; }
      try { return FC && typeof FC.pianoDellaCache === 'function' ? FC.pianoDellaCache(action, messages, { durata }) : null; } catch (_) { return null; }
    }

    async function ensureUnderLimit(settings) {
      if (await costs.isOverLimit(settings && settings.monthlyLimitEur)) throw limitError();
    }

    async function recordCost(settings, action, provider, model, usage) {
      try {
        const eur = await costs.record({
          action, provider, model, usage: usage || {},
          pricing: (settings.pricing && settings.pricing[model]) || null,
          usdToEur: settings.usdToEur,
        });
        return Number(eur) || 0;
      } catch (e) {
        console.warn('[Filo cancello] costo non registrato:', (e && e.message) || e);
        return 0;
      }
    }

    async function chainFor({ action, settings, attempts }) {
      const s = settings || await getSettings();
      const chain = attempts || buildChain(s, modelFor(s, action), action);
      await ensureUnderLimit(s);
      return { s, chain };
    }

    async function settleChain(s, action, chain, r, m = MUTO) {
      const res = r || {};
      const provider = res.provider || (chain[0] && chain[0].provider);
      const model = res.model || (chain[0] && chain[0].model);
      const { servedBy, violation } = noteServed(s, action, { ...res, model });
      const costEur = await recordCost(s, action, provider, model, res.usage);
      m.chiamata(chiamataDi(res, model, { tentativo: res.tentativo, spesa: spesaDi(s, model, res.usage) }));
      return { ...res, provider, model, servedBy, violation, costEur };
    }

    async function complete(opts = {}) {
      const m = misura(opts.action);
      try {
        const r = await completeMisurato(opts, m);
        m.fine(true);
        return r;
      } catch (e) { m.fine(false); throw e; }
    }

    async function completeMisurato({ action, settings, attempts, messages, tools, toolChoice, signal, onFallback } = {}, m) {
      const { s, chain } = await chainFor({ action, settings, attempts });
      let r;
      try {
        const daMandare = await senzaSegreti(messages);
        r = await providers().completeWithFallback({
          attempts: chain, messages: daMandare, cache: pianoCache(action, daMandare, s), tools, toolChoice, signal, onFallback, onTentativoFallito: m.errore,
        });
      } catch (e) {
        throw conLaFunzione(e, s, action);
      }
      return settleChain(s, action, chain, r, m);
    }

    // Un tentativo rotto a metà si è già pagato: il suo costo il router lo dice solo dopo, e lo si chiede come per la voce.
    function auditBroken(s, action, list, m) {
      for (const b of list || []) {
        auditLater({ s, action, provider: b.provider, model: b.model, apiKey: b.apiKey, generationId: b.generationId, withCost: true, keySource: b.keySource, m });
      }
    }

    async function stream(opts = {}) {
      const m = misura(opts.action);
      try {
        const r = await streamMisurato(opts, m);
        m.fine(true);
        return r;
      } catch (e) { m.fine(false); throw e; }
    }

    async function streamMisurato({ action, settings, attempts, messages, tools, toolChoice, signal, onDelta, onReasoning, onToolCall, onFallback, onReset } = {}, m) {
      const { s, chain } = await chainFor({ action, settings, attempts });
      let r;
      try {
        const daMandare = await senzaSegreti(messages);
        r = await providers().streamCompleteWithFallback({
          attempts: chain, messages: daMandare, cache: pianoCache(action, daMandare, s), tools, toolChoice, signal,
          onDelta: vedendo(m, onDelta), onReasoning: vedendo(m, onReasoning), onToolCall: vedendo(m, onToolCall),
          onFallback, onReset, onTentativoFallito: m.errore,
        });
      } catch (e) {
        auditBroken(s, action, e && e.brokenAttempts, m);
        throw conLaFunzione(e, s, action);
      }
      const { brokenAttempts, ...rest } = r || {};
      auditBroken(s, action, brokenAttempts, m);
      return settleChain(s, action, chain, rest, m);
    }

    // Chi chiede solo il testo lo legge come dati (un'etichetta, un giudizio, un JSON): un pezzo tagliato è un errore.
    async function text(opts) {
      const r = await complete(opts);
      const CE = globalThis.SN_CHAT_ERRORS;
      if (r && CE && CE.troncata(r.finishReason)) throw CE.erroreTagliata(r.finishReason);
      return (r && r.text) || '';
    }

    // Chi ha servito e quanto è costato, chiesti a posteriori: best-effort e fuori dal cammino della risposta.
    function auditLater({ s, action, provider, model, apiKey, generationId, withCost, keySource, onServedBy, m = MUTO }) {
      const P = providerOf(provider);
      if (!P || typeof P.lookupServedBy !== 'function') return;
      let i = 0;
      let costDone = !withCost;
      const schedule = () => {
        if (i >= auditDelaysMs.length) return;
        const t = setTimeout(tick, auditDelaysMs[i++]);
        if (t && typeof t.unref === 'function') t.unref();
      };
      const tick = async () => {
        let r = null;
        try { r = await P.lookupServedBy({ apiKey, generationId }); } catch (_) { r = null; }
        if (r && !costDone && Number.isFinite(r.costUsd) && r.costUsd > 0) {
          costDone = true;
          await recordCost(s, action, provider, model, { costUsd: r.costUsd, keySource: keySource || '' });
          m.tardiva(model, r.costUsd);
        }
        if (!r || !r.servedBy) { schedule(); return; }
        const seen = noteServed(s, action, { servedBy: r.servedBy, model, keySource: keySource || '' });
        if (typeof onServedBy === 'function') {
          try { await onServedBy(seen); } catch (_) {}
        }
      };
      schedule();
    }

    // Un tentativo solo, per i mestieri senza ripiego a catena (voce, dettatura, indicizzazione) e per le prove delle Opzioni.
    // `onLateServedBy` riceve { servedBy, violation } quando chi ha servito si sa solo dopo.
    async function call(opts = {}) {
      const m = misura(opts.action);
      try {
        const r = await callMisurato(opts, m);
        m.fine(true);
        return r;
      } catch (e) { m.fine(false); throw e; }
    }

    async function callMisurato({ action, settings, attempt, method, args, onLateServedBy } = {}, m) {
      if (!PAID.has(method)) throw codeError(`Chiamata non prevista dal cancello: ${method}`, 'GATE_METHOD');
      const a = attempt || {};
      const s = settings || await getSettings();
      await ensureUnderLimit(s);
      const P = providerOf(a.provider);
      if (!P || typeof P[method] !== 'function') {
        throw codeError(`Il fornitore ${a.provider || '—'} non sa fare questa chiamata (${method})`, 'PROVIDER_METHOD_MISSING');
      }
      const testi = {};
      for (const k of CAMPI_TESTO) if (args && args[k] != null) testi[k] = args[k];
      const oscurati = Object.keys(testi).length ? await senzaSegreti(testi) : {};
      const input = {
        ...(args || {}),
        ...oscurati,
        apiKey: a.apiKey,
        model: a.model,
        ...(a.reasoning !== undefined ? { reasoning: a.reasoning } : {}),
        providerRouting: a.providerRouting !== undefined ? a.providerRouting : routing(s, a),
      };
      // Il testo passa dal router, che per complete e streamComplete ha già il suo smistamento per nome.
      const router = providers();
      const viaRouter = (method === 'complete' || method === 'streamComplete') && typeof router[method] === 'function';
      let r;
      try {
        r = (await (viaRouter ? router[method]({ ...input, provider: a.provider }) : P[method](input))) || {};
      } catch (e) {
        m.errore(e, { modello: a.model, host: e && e.hostFallito });
        throw conLaFrase(e, s, action, method);
      }
      const usage = r.usage;
      const { servedBy, violation } = noteServed(s, action, { ...r, model: r.model || a.model });
      const later = !servedBy && Boolean(r.generationId);
      const costNow = carriesCost(usage) || (!later && Boolean(usage));
      const costEur = costNow ? await recordCost(s, action, a.provider, a.model, usage) : 0;
      m.chiamata(chiamataDi(r, r.model || a.model, { spesa: costNow ? spesaDi(s, a.model, usage) : null }));
      if (later) {
        auditLater({
          s, action, provider: a.provider, model: a.model,
          // Dopo un ripiego di chiave (#629) la generazione si rilegge con quella che l'ha fatta.
          apiKey: r.keyUsed || a.apiKey,
          generationId: r.generationId,
          withCost: !costNow,
          keySource: r.keySource || (usage && usage.keySource) || '',
          onServedBy: onLateServedBy,
          m,
        });
      }
      return { ...r, servedBy, violation, costEur };
    }

    // Crediti finiti: lo stesso avviso delle chat, una volta, e nessun altro tentativo con la stessa chiave.
    function fineCrediti(err) {
      const W = global.SN_WALLET;
      if (!W || typeof W.isOutOfCredits !== 'function' || !W.isOutOfCredits(err)) return false;
      try { global.SN_WALLET_MAIN?.outOfCreditsNotice(err); } catch (_) {}
      return true;
    }

    // Un classificatore su tante richieste in parallelo (#1118): limite di spesa e segreti come ogni chiamata, ma UN
    // conto per giro invece di uno per richiesta. Il tentativo dopo nella catena parte solo se quello prima non ha
    // mai risposto. `onAnswer(indice, answers)` arriva appena una richiesta ha risposto.
    async function decideAll(opts = {}) {
      const m = misura(opts.action);
      try {
        const r = await decideAllMisurato(opts, m);
        m.fine(true);
        return r;
      } catch (e) { m.fine(false); throw e; }
    }

    async function decideAllMisurato({ action, settings, attempts, requests, parallel, onAnswer, signal } = {}, m) {
      const { s, chain } = await chainFor({ action, settings, attempts });
      const usable = chain.filter((a) => supports(a.provider, 'decisions') && a.model);
      if (!usable.length) throw codeError('Nessun fornitore della catena sa classificare', 'PROVIDER_METHOD_MISSING');
      const Coda = global.SN_CODA_ADATTIVA;
      if (!Coda) throw codeError('Coda dei lavori non caricata', 'GATE_METHOD');
      let lista = [];
      try { lista = await segreti(); } catch (_) { lista = []; }
      const G = global.SN_GUARDIANO_STATICO;
      const oscura = (v) => (G && typeof G.oscuraSegreti === 'function' ? G.oscuraSegreti(v, lista) : v);
      const richieste = (Array.isArray(requests) ? requests : []).map((r) => ({
        state: oscura(r && r.state), questions: oscura(r && r.questions),
      }));
      let ultimo = null;
      for (const [indice, a] of usable.entries()) {
        const P = providerOf(a.provider);
        const somma = { promptTokens: 0, completionTokens: 0, costUsd: 0, keySource: '' };
        let risposte = 0;
        let inVolo = 0;
        let servedBy = null;
        // I numeri di ogni richiesta servita, per i contatori: partono insieme alla fine del giro.
        const servite = [];
        const fai = async (req) => {
          inVolo++;
          let r;
          try {
            r = (await P.decisions({
              apiKey: a.apiKey, model: a.model, state: req.state, questions: req.questions,
              providerRouting: a.providerRouting !== undefined ? a.providerRouting : routing(s, a), signal,
            })) || {};
          } finally { inVolo--; }
          risposte++;
          servite.push(chiamataDi(r, r.model || a.model, { tentativo: indice + 1, spesa: spesaDi(s, a.model, r.usage) }));
          const u = r.usage || {};
          somma.promptTokens += Number(u.promptTokens) || 0;
          somma.completionTokens += Number(u.completionTokens) || 0;
          somma.costUsd += Number(u.costUsd) || 0;
          if (!somma.keySource && u.keySource) somma.keySource = u.keySource;
          if (!servedBy && r.servedBy) servedBy = r.servedBy;
          return r;
        };
        const esito = await Coda.esegui(richieste, fai, {
          parallelo: parallel, signal,
          classifica: (err, tentativo) => esitoDecisione(err, risposte > 0, tentativo, inVolo > 0),
          attesa: (tentativo, err) => {
            const ms = Coda.attesaPredefinita(tentativo, err);
            return risposte > 0 || Number(err && err.status) === 429 ? ms : Math.min(ms, ATTESA_PRIMA_RISPOSTA_MS);
          },
          suEsito: (r, _req, i) => { if (onAnswer) onAnswer(i, (r && r.answers) || {}); },
        });
        if (servite.length) m.chiamata(servite);
        if (esito.fermo) m.errore(esito.fermo, { modello: a.model, host: servedBy || (esito.fermo && esito.fermo.hostFallito) });
        let seen = { servedBy: null, violation: false };
        let costEur = 0;
        if (risposte) {
          seen = noteServed(s, action, { servedBy, model: a.model, keySource: somma.keySource });
          costEur = await recordCost(s, action, a.provider, a.model, somma);
        }
        if (esito.fermo) conLaFrase(esito.fermo, s, action, 'decisions');
        if (esito.fermo && fineCrediti(esito.fermo) && !risposte) throw esito.fermo;
        if (esito.fermo && !risposte && !esito.interrotto) {
          ultimo = esito.fermo;
          continue;
        }
        return {
          provider: a.provider, model: a.model, servedBy: seen.servedBy, violation: seen.violation, costEur,
          answered: esito.fatti, skipped: esito.scartati.map((x) => x.indice),
          error: esito.fermo || null, aborted: esito.interrotto,
        };
      }
      throw ultimo || codeError('Il classificatore non ha risposto', 'DECIDE_FAILED');
    }

    return { complete, stream, text, call, decideAll, ensureUnderLimit, supports, hasProvider, keyInfo, hostVerdict };
  }

  global.SN_MODEL_GATE = { create, hasProvider, supports, keyInfo, hostVerdict, limitError, PAID, CAMPI_TESTO };
})(typeof globalThis !== 'undefined' ? globalThis : self);
