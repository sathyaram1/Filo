// Router multi-provider con fallback in catena: si provano gli attempts in ordine, vince il
// primo che risponde OK; se nessuno funziona si rilancia l'ultimo errore.

(function (global) {
  'use strict';

  // Un solo fornitore, il router: l'API diretta di un produttore non è ammessa dalla politica
  // sui modelli. Un fornitore nuovo si registra su globalThis, senza toccare questo elenco.
  function getProvider(name) {
    const key = 'SN_PROVIDER_' + String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const p = name && global[key];
    if (p) return p;
    throw new Error(`Provider non supportato: ${name}`);
  }

  // Un buco di rete di un istante non deve diventare un errore per l'utente: si ritenta
  // LO STESSO tentativo. Solo sui guasti passeggeri: un 400 o un 401 tornerebbero identici.
  const RETRY_NETWORK_MAX = 1;      // ritentativi extra per tentativo
  const RETRY_NETWORK_DELAY_MS = 700;

  function isTransientNetwork(err) {
    const CE = global.SN_CHAT_ERRORS;
    if (CE && typeof CE.isTransientNetwork === 'function') return CE.isTransientNetwork(err);
    // Ripiego se il modulo condiviso non è caricato (contesti di test isolati).
    const m = String((err && err.message) || '');
    return !Number(err && err.status) && /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|socket hang up/i.test(m);
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // `canRetry()`: in streaming il ritentativo non è lecito se sono già usciti dei delta e il
  // chiamante non sa azzerare il buffer.
  async function withNetworkRetry(once, canRetry) {
    let lastErr = null;
    for (let t = 0; t <= RETRY_NETWORK_MAX; t++) {
      try {
        return await once();
      } catch (err) {
        lastErr = err;
        const again = t < RETRY_NETWORK_MAX
          && isTransientNetwork(err)
          && (!canRetry || canRetry());
        if (!again) throw err;
        console.warn('[SN] guasto di rete passeggero, ritento tra', RETRY_NETWORK_DELAY_MS, 'ms:', err.message || err);
        await sleep(RETRY_NETWORK_DELAY_MS);
      }
    }
    throw lastErr;
  }

  // Crediti finiti: il router risponde 402 finché il tetto non sale. Non si ritenta e non si
  // passa al tentativo dopo, che userebbe la stessa chiave: si avvisa una volta e si esce.
  function stopOnOutOfCredits(err) {
    const W = global.SN_WALLET;
    if (!W || !W.isOutOfCredits(err)) return false;
    try { global.SN_WALLET_MAIN?.outOfCreditsNotice(); } catch (_) {}
    return true;
  }

  // `tools`, `toolChoice` e `onToolCall` (chiamato appena si conosce il nome, in streaming)
  // passano tali e quali al provider.
  async function complete({ provider, apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, signal }) {
    return getProvider(provider).complete({ apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, signal });
  }

  async function streamComplete({ provider, apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal }) {
    return getProvider(provider).streamComplete({ apiKey, model, messages, reasoning, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal });
  }

  async function listModels({ provider, apiKey }) {
    return getProvider(provider).listModels(apiKey);
  }

  // Ogni attempt può portare il proprio `model`, l'id risolto dal nickname; se manca vale
  // quello globale.
  async function completeWithFallback({ attempts, model, messages, tools, toolChoice, signal, onFallback }) {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      try {
        const r = await withNetworkRetry(() => getProvider(a.provider).complete({
          apiKey: a.apiKey, model: aModel, reasoning: a.reasoning,
          providerRouting: a.providerRouting, messages, tools, toolChoice, signal,
        }));
        // `...r` porta con sé `servedBy`: il chiamante lo registra e ci verifica la politica.
        return { ...r, provider: a.provider, model: aModel };
      } catch (err) {
        lastErr = err;
        if (stopOnOutOfCredits(err)) throw err;
        console.warn(`[SN] provider ${a.provider} fallito (${i + 1}/${attempts.length}):`, err.message || err);
        if (onFallback && i + 1 < attempts.length) {
          try { onFallback({ failed: a.provider, next: attempts[i + 1].provider, error: err }); } catch (_) {}
        }
      }
    }
    throw lastErr || new Error('Nessun provider disponibile');
  }

  // In streaming un attempt può fallire dopo aver emesso dei delta: prima del provider dopo si
  // emette `onReset`, così il chiamante butta il buffer parziale.
  async function streamCompleteWithFallback({ attempts, model, messages, tools, toolChoice, signal, onDelta, onReasoning, onToolCall, onFallback, onReset }) {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      let emitted = false;
      try {
        // Ritentativo sui guasti di rete passeggeri: se lo stream era partito il buffer va azzerato
        // prima di ricominciare. Se il chiamante non sa farlo, non si ritenta.
        const r = await withNetworkRetry(
          () => getProvider(a.provider).streamComplete({
            apiKey: a.apiKey, model: aModel, reasoning: a.reasoning,
            providerRouting: a.providerRouting, messages, tools, toolChoice, signal,
            onDelta: onDelta ? (d) => { emitted = true; onDelta(d); } : onDelta,
            onReasoning: onReasoning ? (t) => { emitted = true; onReasoning(t); } : onReasoning,
            onToolCall: onToolCall ? (c) => { emitted = true; onToolCall(c); } : onToolCall,
          }),
          () => {
            if (!emitted) return true;
            if (!onReset) return false;
            try { onReset({ failed: a.provider, next: a.provider }); } catch (_) {}
            emitted = false;
            return true;
          },
        );
        return { ...r, provider: a.provider, model: aModel };
      } catch (err) {
        lastErr = err;
        if (stopOnOutOfCredits(err)) throw err;
        console.warn(`[SN] provider ${a.provider} streaming fallito (${i + 1}/${attempts.length}):`, err.message || err);
        const hasNext = i + 1 < attempts.length;
        if (onReset && hasNext && emitted) {
          try { onReset({ failed: a.provider, next: attempts[i + 1].provider }); } catch (_) {}
        }
        if (onFallback && hasNext) {
          try { onFallback({ failed: a.provider, next: attempts[i + 1].provider, error: err }); } catch (_) {}
        }
      }
    }
    throw lastErr || new Error('Nessun provider disponibile');
  }

  global.SN_PROVIDERS = {
    complete,
    streamComplete,
    listModels,
    getProvider,
    completeWithFallback,
    streamCompleteWithFallback,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
