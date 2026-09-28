// Il cancello dei modelli: ogni chiamata che fa lavorare un fornitore passa di qui, con limite di spesa, costo e chi ha servito.
// Fuori da questo file e da providers/ nessuno tocca i fornitori: la regola la tiene tests/unit/cancelloModelli.test.mjs.
// Le dipendenze le inietta handlers.js (create); le domande gratuite (esiste il fornitore? residuo di una chiave) sono statiche.

(function (global) {
  'use strict';

  const providers = () => global.SN_PROVIDERS;

  // Le chiamate che fanno lavorare un modello, e quindi costano.
  const PAID = new Set(['complete', 'streamComplete', 'synthesizeSpeech', 'transcribe', 'embed']);

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
    const violation = Boolean(servedBy && C && typeof C.isProviderExcluded === 'function'
      && C.isProviderExcluded(servedBy, (settings && settings.excludedProviders) || []));
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
    } = deps;

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

    async function settleChain(s, action, chain, r) {
      const res = r || {};
      const provider = res.provider || (chain[0] && chain[0].provider);
      const model = res.model || (chain[0] && chain[0].model);
      const { servedBy, violation } = noteServed(s, action, res);
      const costEur = await recordCost(s, action, provider, model, res.usage);
      return { ...res, provider, model, servedBy, violation, costEur };
    }

    async function complete({ action, settings, attempts, messages, tools, toolChoice, signal, onFallback } = {}) {
      const { s, chain } = await chainFor({ action, settings, attempts });
      const r = await providers().completeWithFallback({ attempts: chain, messages, tools, toolChoice, signal, onFallback });
      return settleChain(s, action, chain, r);
    }

    async function stream({ action, settings, attempts, messages, tools, toolChoice, signal, onDelta, onReasoning, onToolCall, onFallback, onReset } = {}) {
      const { s, chain } = await chainFor({ action, settings, attempts });
      const r = await providers().streamCompleteWithFallback({
        attempts: chain, messages, tools, toolChoice, signal, onDelta, onReasoning, onToolCall, onFallback, onReset,
      });
      return settleChain(s, action, chain, r);
    }

    async function text(opts) {
      const r = await complete(opts);
      return (r && r.text) || '';
    }

    // Chi ha servito e quanto è costato, chiesti a posteriori: best-effort e fuori dal cammino della risposta.
    function auditLater({ s, action, provider, model, apiKey, generationId, withCost, keySource, onServedBy }) {
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
        }
        if (!r || !r.servedBy) { schedule(); return; }
        const seen = noteServed(s, action, { servedBy: r.servedBy });
        if (typeof onServedBy === 'function') {
          try { await onServedBy(seen); } catch (_) {}
        }
      };
      schedule();
    }

    // Un tentativo solo, per i mestieri senza ripiego a catena (voce, dettatura, indicizzazione) e per le prove delle Opzioni.
    // `onLateServedBy` riceve { servedBy, violation } quando chi ha servito si sa solo dopo.
    async function call({ action, settings, attempt, method, args, onLateServedBy } = {}) {
      if (!PAID.has(method)) throw codeError(`Chiamata non prevista dal cancello: ${method}`, 'GATE_METHOD');
      const a = attempt || {};
      const s = settings || await getSettings();
      await ensureUnderLimit(s);
      const P = providerOf(a.provider);
      if (!P || typeof P[method] !== 'function') {
        throw codeError(`Il fornitore ${a.provider || '—'} non sa fare questa chiamata (${method})`, 'PROVIDER_METHOD_MISSING');
      }
      const input = {
        ...(args || {}),
        apiKey: a.apiKey,
        model: a.model,
        ...(a.reasoning !== undefined ? { reasoning: a.reasoning } : {}),
        providerRouting: a.providerRouting !== undefined ? a.providerRouting : routing(s),
      };
      // Il testo passa dal router, che per complete e streamComplete ha già il suo smistamento per nome.
      const router = providers();
      const viaRouter = (method === 'complete' || method === 'streamComplete') && typeof router[method] === 'function';
      const r = (await (viaRouter ? router[method]({ ...input, provider: a.provider }) : P[method](input))) || {};
      const usage = r.usage;
      const { servedBy, violation } = noteServed(s, action, r);
      const later = !servedBy && Boolean(r.generationId);
      const costNow = carriesCost(usage) || (!later && Boolean(usage));
      const costEur = costNow ? await recordCost(s, action, a.provider, a.model, usage) : 0;
      if (later) {
        auditLater({
          s, action, provider: a.provider, model: a.model,
          // Dopo un ripiego di chiave (#629) la generazione si rilegge con quella che l'ha fatta.
          apiKey: r.keyUsed || a.apiKey,
          generationId: r.generationId,
          withCost: !costNow,
          keySource: r.keySource || (usage && usage.keySource) || '',
          onServedBy: onLateServedBy,
        });
      }
      return { ...r, servedBy, violation, costEur };
    }

    return { complete, stream, text, call, ensureUnderLimit, supports, hasProvider, keyInfo };
  }

  global.SN_MODEL_GATE = { create, hasProvider, supports, keyInfo, limitError, PAID };
})(typeof globalThis !== 'undefined' ? globalThis : self);
