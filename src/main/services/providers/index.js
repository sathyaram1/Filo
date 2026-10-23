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

  // #1097.3 — un 429 o un 5xx è un servizio che risponde: prima del ripiego si riprova una volta lo stesso tentativo,
  // dopo l'attesa che chiede (Retry-After) o una breve. Mai un 402 (crediti finiti), mai dopo che il testo ha
  // cominciato ad arrivare; un'attesa più lunga del tetto non si fa: c'è il ripiego apposta.
  const RETRY_SERVIZIO_MAX = 1;
  const ATTESA_SERVIZIO_MS = 1000;
  const ATTESA_SERVIZIO_MAX_MS = 10000;
  function attesaServizio(err) {
    const s = Number(err && err.status);
    if (!(s === 429 || (s >= 500 && s <= 599))) return null;
    const chiesta = Number(err.retryAfterMs);
    const ms = Number.isFinite(chiesta) && chiesta >= 0 ? chiesta : ATTESA_SERVIZIO_MS;
    return ms <= ATTESA_SERVIZIO_MAX_MS ? ms : null;
  }

  // L'attesa finisce prima se chi aspetta ha fermato la richiesta.
  const sleep = (ms, signal) => new Promise((res) => {
    if (signal && signal.aborted) { res(); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', fine); res(); }, ms);
    function fine() { clearTimeout(t); res(); }
    if (signal) signal.addEventListener('abort', fine, { once: true });
  });

  // Esegue `once()` ritentandolo sui guasti di rete passeggeri e, una volta, su un 429/5xx. `canRetry(tipo)` decide se
  // il ritentativo è ancora lecito ('rete' | 'servizio'): in streaming non lo è più una volta che dei delta sono usciti,
  // se il chiamante non sa azzerare il buffer, e per 'servizio' mai.
  async function withNetworkRetry(once, canRetry, signal) {
    let rete = 0;
    let servizio = 0;
    for (;;) {
      try {
        return await once();
      } catch (err) {
        let tipo = null;
        let ms = null;
        if (isTransientNetwork(err) && rete < RETRY_NETWORK_MAX) { tipo = 'rete'; ms = RETRY_NETWORK_DELAY_MS; }
        else if (servizio < RETRY_SERVIZIO_MAX) { ms = attesaServizio(err); if (ms != null) tipo = 'servizio'; }
        if (!tipo || (signal && signal.aborted) || (canRetry && !canRetry(tipo))) throw err;
        if (tipo === 'rete') rete++; else servizio++;
        console.warn(`[SN] ${tipo === 'rete' ? 'guasto di rete passeggero' : `servizio ${err.status}`}, ritento tra`, ms, 'ms:', err.message || err);
        await sleep(ms, signal);
        if (signal && signal.aborted) throw err;
      }
    }
  }

  // Crediti finiti: il router risponde 402 finché il tetto non sale. Non si ritenta e non si
  // passa al tentativo dopo, che userebbe la stessa chiave: si avvisa una volta e si esce.
  function stopOnOutOfCredits(err) {
    const W = global.SN_WALLET;
    if (!W || !W.isOutOfCredits(err)) return false;
    try { global.SN_WALLET_MAIN?.outOfCreditsNotice(err); } catch (_) {}
    return true;
  }

  // `tools` / `toolChoice` (tool calling nativo, vedi src/shared/actionTools.js)
  // e `onToolCall` (una chiamata appena il modello ne pronuncia il nome, in
  // streaming) passano tali e quali al provider.
  // `cache`: il piano dei punti di cache (SN_FILO_CONTESTO.pianoDellaCache); ogni fornitore lo scrive nel suo formato.
  async function complete({ provider, apiKey, model, messages, cache, reasoning, maxTokens, providerRouting, tools, toolChoice, signal }) {
    return getProvider(provider).complete({ apiKey, model, messages, cache, reasoning, maxTokens, providerRouting, tools, toolChoice, signal });
  }

  async function streamComplete({ provider, apiKey, model, messages, cache, reasoning, maxTokens, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal }) {
    return getProvider(provider).streamComplete({ apiKey, model, messages, cache, reasoning, maxTokens, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal });
  }

  async function listModels({ provider, apiKey }) {
    return getProvider(provider).listModels(apiKey);
  }

  // Prova ogni attempt in ordine. Aggiunge `provider` e `model` (concreto
  // usato) al risultato. Ogni attempt può portare il proprio `model` (id
  // provider-specifico risolto dal nickname): se assente si usa il `model`
  // globale per retro-compatibilità.
  // `onTentativoFallito(err, { modello, host })` arriva per OGNI tentativo fallito, anche l'ultimo: lo leggono i
  // contatori giornalieri (#969), che contano i guasti per modello e host.
  function tentativoFallito(fn, err, aModel) {
    if (typeof fn !== 'function') return;
    try { fn(err, { modello: aModel, host: (err && err.hostFallito) || '' }); } catch (_) {}
  }

  async function completeWithFallback({ attempts, model, messages, cache, tools, toolChoice, signal, onFallback, onTentativoFallito }) {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      try {
        const r = await withNetworkRetry(() => getProvider(a.provider).complete({
          apiKey: a.apiKey, model: aModel, reasoning: a.reasoning, maxTokens: a.maxTokens,
          providerRouting: a.providerRouting, messages, cache, tools, toolChoice, signal,
        }), null, signal);
        // `...r` porta con sé `servedBy` (chi ha davvero servito, se il provider
        // lo riporta): il chiamante lo usa per registrare e verificare la politica.
        // `tentativo` (da 1): quale della catena ha risposto, per i contatori (#1464).
        return { ...r, provider: a.provider, model: aModel, tentativo: i + 1 };
      } catch (err) {
        lastErr = err;
        tentativoFallito(onTentativoFallito, err, aModel);
        if (stopOnOutOfCredits(err)) throw err;
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
  async function streamCompleteWithFallback({ attempts, model, messages, cache, tools, toolChoice, signal, onDelta, onReasoning, onToolCall, onFallback, onReset, onTentativoFallito }) {
    let lastErr = null;
    // I tentativi rotti dopo che il modello aveva già scritto: il fornitore li fa pagare, chi tiene il conto li deve vedere.
    const broken = [];
    // La risposta ricominciata a metà: un tentativo aveva già scritto, o si è rotto dopo essere partito (#1464).
    let ricominciata = false;
    const noteBroken = (err, a, aModel) => {
      if (err && err.generationId) {
        broken.push({ provider: a.provider, model: aModel, generationId: err.generationId, apiKey: err.keyUsed || a.apiKey, keySource: err.keySource || '' });
      }
    };
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      let emitted = false;
      try {
        // Ritentativo sui guasti di rete passeggeri: se lo stream era partito il buffer va azzerato
        // prima di ricominciare. Se il chiamante non sa farlo, non si ritenta.
        const r = await withNetworkRetry(
          () => Promise.resolve(getProvider(a.provider).streamComplete({
            apiKey: a.apiKey, model: aModel, reasoning: a.reasoning, maxTokens: a.maxTokens,
            providerRouting: a.providerRouting, messages, cache, tools, toolChoice, signal,
            onDelta: onDelta ? (d) => { emitted = true; onDelta(d); } : onDelta,
            onReasoning: onReasoning ? (t) => { emitted = true; onReasoning(t); } : onReasoning,
            onToolCall: onToolCall ? (c) => { emitted = true; onToolCall(c); } : onToolCall,
          })).catch((err) => { noteBroken(err, a, aModel); throw err; }),
          (tipo) => {
            if (!emitted) return true;
            if (tipo !== 'rete' || !onReset) return false;
            try { onReset({ failed: a.provider, next: a.provider }); } catch (_) {}
            emitted = false;
            ricominciata = true;
            return true;
          },
          signal,
        );
        return {
          ...r, provider: a.provider, model: aModel, tentativo: i + 1, ricominciata: ricominciata || broken.length > 0,
          ...(broken.length ? { brokenAttempts: broken } : {}),
        };
      } catch (err) {
        lastErr = err;
        if (emitted) ricominciata = true;
        // Porta le chiavi usate: non enumerabile, un errore si stampa e si serializza.
        if (broken.length && err && typeof err === 'object') Object.defineProperty(err, 'brokenAttempts', { value: broken, enumerable: false, configurable: true });
        tentativoFallito(onTentativoFallito, err, aModel);
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
    attesaServizio,
    complete,
    streamComplete,
    listModels,
    getProvider,
    completeWithFallback,
    streamCompleteWithFallback,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
