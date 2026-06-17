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

  function getProvider(name) {
    if (name === 'openrouter') return global.SN_PROVIDER_OPENROUTER;
    if (name === 'gemini') return global.SN_PROVIDER_GEMINI;
    throw new Error(`Provider non supportato: ${name}`);
  }

  async function complete({ provider, apiKey, model, messages, signal }) {
    return getProvider(provider).complete({ apiKey, model, messages, signal });
  }

  async function streamComplete({ provider, apiKey, model, messages, onDelta, onReasoning, signal }) {
    return getProvider(provider).streamComplete({ apiKey, model, messages, onDelta, onReasoning, signal });
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
        const r = await getProvider(a.provider).complete({
          apiKey: a.apiKey, model: aModel, messages, signal,
        });
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

  async function streamCompleteWithFallback({ attempts, model, messages, signal, onDelta, onReasoning, onFallback }) {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const aModel = a.model || model;
      try {
        const r = await getProvider(a.provider).streamComplete({
          apiKey: a.apiKey, model: aModel, messages, signal, onDelta, onReasoning,
        });
        return { ...r, provider: a.provider, model: aModel };
      } catch (err) {
        lastErr = err;
        console.warn(`[SN] provider ${a.provider} streaming fallito (${i + 1}/${attempts.length}):`, err.message || err);
        if (onFallback && i + 1 < attempts.length) {
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
