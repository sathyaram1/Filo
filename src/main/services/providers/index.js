// Router multi-provider con fallback in catena.
//
// Concetto: il chiamante passa una lista di "attempts" — ciascuno con
// { provider, apiKey } — e il router prova in ordine, catturando l'errore di
// quelli che falliscono e ripiegando sul successivo. Il primo che risponde OK
// vince e ritorna il risultato (con info su quale provider è stato usato).
//
// Se nessuno funziona, viene rilanciato l'ultimo errore con prefisso.

(function (global) {
  'use strict';

  // Un solo fornitore: il router (OpenRouter), che smista verso host
  // indipendenti secondo la lista di esclusione. L'API diretta di Google, che
  // qui c'era, è stata tolta: era l'API del produttore, e la politica sui
  // modelli non la ammette. Lettura ad alta voce, dettatura e indicizzazione,
  // che erano le tre funzioni rimaste solo lì, passano ora dal router.
  function getProvider(name) {
    if (name === 'openrouter') return global.SN_PROVIDER_OPENROUTER;
    throw new Error(`Provider non supportato: ${name}`);
  }

  // #360 — un buco di rete di un istante (WiFi che salta, DNS lento) non deve
  // diventare un errore in faccia all'utente: prima di ripiegare sul provider
  // successivo ritentiamo LO STESSO tentativo dopo una breve pausa. Solo per i
  // guasti PASSEGGERI (nessuna risposta HTTP arrivata): un 400 o un 401
  // ritornerebbero identici, ritentarli sarebbe solo attesa buttata.
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

  // Esegue `once()` ritentandolo sui guasti di rete passeggeri. `canRetry()`
  // decide se il ritentativo è ancora lecito (in streaming non lo è più una
  // volta che dei delta sono usciti, se il chiamante non sa azzerare il buffer).
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

  async function complete({ provider, apiKey, model, messages, reasoning, providerRouting, signal }) {
    return getProvider(provider).complete({ apiKey, model, messages, reasoning, providerRouting, signal });
  }

  async function streamComplete({ provider, apiKey, model, messages, reasoning, providerRouting, onDelta, onReasoning, signal }) {
    return getProvider(provider).streamComplete({ apiKey, model, messages, reasoning, providerRouting, onDelta, onReasoning, signal });
  }

  async function listModels({ provider, apiKey }) {
    return getProvider(provider).listModels(apiKey);
  }

  // Prova ogni attempt in ordine. Aggiunge `provider` e `model` (concreto
  // usato) al risultato. Ogni attempt può portare il proprio `model` (id
  // provider-specifico risolto dal nickname): se assente si usa il `model`
  // globale per retro-compatibilità.
  async function completeWithFallback({ attempts, model, messages, signal, onFallback }) {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      try {
        const r = await withNetworkRetry(() => getProvider(a.provider).complete({
          apiKey: a.apiKey, model: aModel, reasoning: a.reasoning,
          providerRouting: a.providerRouting, messages, signal,
        }));
        // `...r` porta con sé `servedBy` (chi ha davvero servito, se il provider
        // lo riporta): il chiamante lo usa per registrare e verificare la politica.
        return { ...r, provider: a.provider, model: aModel };
      } catch (err) {
        lastErr = err;
        console.warn(`[SN] provider ${a.provider} fallito (${i + 1}/${attempts.length}):`, err.message || err);
        if (onFallback && i + 1 < attempts.length) {
          try { onFallback({ failed: a.provider, next: attempts[i + 1].provider, error: err }); } catch (_) {}
        }
      }
    }
    throw lastErr || new Error('Nessun provider disponibile');
  }

  // In streaming un attempt può fallire DOPO aver già emesso dei delta (es. il
  // reader SSE si interrompe a metà risposta): in quel caso il chiamante ha già
  // accumulato testo parziale del tentativo fallito. Prima di ripartire col
  // provider successivo emettiamo `onReset` così il chiamante butta il buffer
  // parziale e riparte pulito (#273). onReset viene chiamato SOLO se l'attempt
  // fallito aveva già emesso qualcosa (delta o reasoning) e c'è un attempt dopo.
  async function streamCompleteWithFallback({ attempts, model, messages, signal, onDelta, onReasoning, onFallback, onReset }) {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      let emitted = false;
      try {
        // Ritentativo sui guasti di rete passeggeri (#360). Se lo stream era già
        // partito (delta o reasoning usciti) il buffer del chiamante va azzerato
        // prima di ricominciare, esattamente come nel ripiego su un altro
        // provider (#273): se non sa farlo, non ritentiamo.
        const r = await withNetworkRetry(
          () => getProvider(a.provider).streamComplete({
            apiKey: a.apiKey, model: aModel, reasoning: a.reasoning,
            providerRouting: a.providerRouting, messages, signal,
            onDelta: onDelta ? (d) => { emitted = true; onDelta(d); } : onDelta,
            onReasoning: onReasoning ? (t) => { emitted = true; onReasoning(t); } : onReasoning,
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
