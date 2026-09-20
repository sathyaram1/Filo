// SN_MODEL_GATE — il passaggio obbligato per ogni chiamata a un fornitore di
// modelli (#591).
//
// Il problema che risolve. Il limite di spesa, il conteggio dei costi e la
// registrazione di chi ha servito vivevano nei due cammini principali della
// chat. Ogni altro chiamante li ripeteva a mano — e chi se li dimenticava
// (giudizio anti-phishing, classificatore del blocco geografico, titolo del
// feedback, sintesi vocale) faceva partire chiamate che nessun tetto fermava e
// che in nessun conto comparivano. Quattro istanze, un solo difetto: mancava il
// punto unico. Questo è quel punto.
//
// La regola: nessun file fuori da qui e da `providers/` nomina SN_PROVIDERS.
// La sentinella `tests/unit/modelGate.test.mjs` diventa rossa se succede, e
// prova anche il comportamento — ogni via d'ingresso del cancello si ferma
// PRIMA di toccare il fornitore quando il limite è esaurito.
//
// Le dipendenze arrivano da `configure()`, che chiama handlers.js al
// caricamento: così il cancello resta provabile senza Electron.

(function (global) {
  'use strict';

  let wiring = null;

  // handlers.js passa qui ciò che sa fare lui: costruire la catena di tentativi
  // per un'azione, leggere il modello configurato, le istruzioni di routing e
  // il riscontro su chi ha servito.
  function configure(w) {
    wiring = { ...(wiring || {}), ...(w || {}) };
    return wiring;
  }

  function deps() {
    if (!wiring) throw new Error('SN_MODEL_GATE: configure() non è stato chiamato');
    return wiring;
  }

  function providers() {
    const P = global.SN_PROVIDERS;
    if (!P) throw new Error('SN_MODEL_GATE: nessun fornitore caricato');
    return P;
  }

  function costs() { return global.SN_COSTS || null; }

  function limitMessage() {
    try {
      const t = global.SN_I18N && global.SN_I18N.t('err_limit_reached');
      if (t && t !== 'err_limit_reached') return t;
    } catch (_) {}
    return 'Limite di spesa mensile raggiunto';
  }

  // ─── Limite di spesa ───────────────────────────────────────────────────────
  // Oltre il limite nessun tentativo parte: non esiste un fornitore "gratuito"
  // su cui ripiegare. Vale per OGNI via d'ingresso qui sotto, comprese quelle
  // che non sono una chat (voce, dettatura, indicizzazione, prove).
  async function ensureUnderLimit(settings) {
    const C = costs();
    if (!C) return;
    if (await C.isOverLimit(settings && settings.monthlyLimitEur)) {
      const e = new Error(limitMessage());
      e.code = 'LIMIT_REACHED';
      throw e;
    }
  }

  // Catena di tentativi per un'azione, col limite già applicato. La catena si
  // costruisce PRIMA del controllo del limite di proposito: un problema di
  // configurazione dei modelli è un'altra cosa e deve restare leggibile anche
  // quando il mese è esaurito.
  async function chain({ settings, action, modelRef }) {
    const d = deps();
    const ref = modelRef !== undefined && modelRef !== null
      ? modelRef
      : d.modelForAction(settings, action);
    const attempts = d.buildAttemptChain(settings, ref, action);
    await ensureUnderLimit(settings);
    return attempts;
  }

  // ─── Dopo la risposta: chi ha servito, e quanto è costata ─────────────────
  async function settle({ settings, action, provider, model, result, pricing, record }) {
    const d = deps();
    let servedBy = null;
    let violation = false;
    try {
      const noted = d.noteServedProvider(settings, action, result) || {};
      servedBy = noted.servedBy || null;
      violation = Boolean(noted.violation);
    } catch (_) {}
    let costEur = 0;
    if (record !== false) {
      const C = costs();
      if (C) {
        const listino = pricing !== undefined
          ? pricing
          : (settings && settings.pricing ? settings.pricing[model] : undefined);
        try {
          costEur = await C.record({
            action, provider, model,
            usage: result && result.usage,
            pricing: listino,
            usdToEur: settings && settings.usdToEur,
          });
        } catch (_) { costEur = 0; }
      }
    }
    return { servedBy, violation, costEur: costEur || 0 };
  }

  // ─── Completamento non in streaming ───────────────────────────────────────
  async function complete({
    settings, action, messages, modelRef, tools, toolChoice, signal, pricing, record,
  }) {
    const attempts = await chain({ settings, action, modelRef });
    const result = await providers().completeWithFallback({
      attempts, messages, tools, toolChoice, signal,
    });
    const provider = result.provider || attempts[0].provider;
    const model = result.model || attempts[0].model;
    const after = await settle({ settings, action, provider, model, result, pricing, record });
    return { ...result, provider, model, ...after };
  }

  // ─── Completamento in streaming ───────────────────────────────────────────
  // I callback passano tali e quali al router: il testo accumulato resta affare
  // del chiamante, il limite/costo/riscontro restano affare del cancello.
  async function stream({
    settings, action, messages, modelRef, tools, toolChoice, signal, pricing, record,
    onDelta, onReasoning, onToolCall, onFallback, onReset,
  }) {
    const attempts = await chain({ settings, action, modelRef });
    const result = await providers().streamCompleteWithFallback({
      attempts, messages, tools, toolChoice, signal,
      onDelta, onReasoning, onToolCall, onFallback, onReset,
    });
    const provider = result.provider || attempts[0].provider;
    const model = result.model || attempts[0].model;
    const after = await settle({ settings, action, provider, model, result, pricing, record });
    return { ...result, provider, model, ...after };
  }

  // ─── Capacità che non sono una chat (voce, dettatura, indicizzazione) ─────
  // Il router non le sa servire in catena: il chiamante deve invocare il metodo
  // giusto del fornitore. Passa da qui lo stesso, così il limite e il conteggio
  // restano in un posto solo: il cancello sceglie i tentativi, tiene il ciclo di
  // ripiego e registra; `run(P, attempt)` fa la sola chiamata vera.
  // `record: false` per la voce, il cui costo il router lo dice dopo (lo
  // registra auditServedByLater).
  async function capability({
    settings, action, modelRef, method, run,
    requireModel = true, record, pricing, onAttemptError, noneError,
  }) {
    const attempts = await chain({ settings, action, modelRef });
    const P0 = providers();
    let lastErr = null;
    for (const a of attempts) {
      let P = null;
      try { P = P0.getProvider(a.provider); } catch (_) { P = null; }
      if (!P || typeof P[method] !== 'function') continue;
      if (requireModel && !a.model) continue;
      try {
        const result = await run(P, a);
        if (result === undefined) continue;
        const after = await settle({
          settings, action, provider: a.provider, model: a.model, result, pricing, record,
        });
        return { result, attempt: a, ...after };
      } catch (e) {
        lastErr = e;
        if (onAttemptError) { try { onAttemptError(e, a); } catch (_) {} }
      }
    }
    throw lastErr || new Error(noneError || 'Nessun modello disponibile');
  }

  // ─── Prove dalle Opzioni e dalla pagina di amministrazione ────────────────
  // Un pulsante «Prova» manda una richiesta VERA, pagata con le chiavi vere —
  // il codice lo diceva già nei commenti, ma quelle chiamate non passavano dal
  // limite e non comparivano nel conteggio. Il modello e la chiave qui NON
  // vengono da una catena (la chiave si sta ancora digitando), quindi la catena
  // non si costruisce: il resto del cancello vale identico.
  async function probe({ settings, action, provider, apiKey, model, run, pricing, record }) {
    await ensureUnderLimit(settings);
    const P = providers().getProvider(provider);
    const result = await run(P);
    if (result && record !== false) {
      const C = costs();
      if (C) {
        const listino = pricing !== undefined
          ? pricing
          : (settings && settings.pricing ? settings.pricing[model] : undefined);
        try {
          await C.record({
            action, provider, model,
            usage: result.usage,
            pricing: listino,
            usdToEur: settings && settings.usdToEur,
          });
        } catch (_) {}
      }
    }
    return result;
  }

  // ─── Riscontro a posteriori su chi ha servito ─────────────────────────────
  // Non è una chiamata al modello (nessun token, nessun costo nuovo): è la
  // rilettura dell'id di generazione. Passa da qui perché il fornitore non si
  // raggiunge da nessun'altra parte.
  function canLookupServedBy(provider) {
    try {
      const P = providers().getProvider(provider);
      return Boolean(P && typeof P.lookupServedBy === 'function');
    } catch (_) { return false; }
  }

  async function lookupServedBy({ provider, apiKey, generationId }) {
    const P = providers().getProvider(provider);
    if (!P || typeof P.lookupServedBy !== 'function') return null;
    return await P.lookupServedBy({ apiKey, generationId });
  }

  const API = {
    configure,
    ensureUnderLimit,
    chain,
    settle,
    complete,
    stream,
    capability,
    probe,
    canLookupServedBy,
    lookupServedBy,
  };

  global.SN_MODEL_GATE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : self);
