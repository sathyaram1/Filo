// Persistenza history interazioni AI. Rotazione automatica oltre soglia byte.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, HISTORY_LIMIT_BYTES, HISTORY_ITEMS_HARD_CAP } = global.SN_CONST;

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function list() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
    return res[STORAGE_KEYS.HISTORY] || [];
  }

  function approximateBytes(items) {
    // Approssimazione conservativa: lunghezza JSON
    try { return JSON.stringify(items).length; } catch (_) { return 0; }
  }

  // Rimuove dall'input campi voluminosi che non hanno valore storico ma
  // farebbero esplodere la quota di chrome.storage.local (≈10 MB senza
  // "unlimitedStorage"). Lo screenshot del flusso Aiuto è un data URL
  // tipicamente da centinaia di KB per turno: non lo salviamo.
  function sanitizeInput(input) {
    if (!input || typeof input !== 'object') return input || {};
    const out = { ...input };
    delete out.screenshot;
    return out;
  }

  async function append(entry) {
    const items = await list();
    const full = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      action: entry.action,
      provider: entry.provider,
      model: entry.model,
      // Chi ha DAVVERO servito la risposta upstream (#421), quando il provider lo
      // riporta (OpenRouter). È la controprova della politica sui fornitori: null
      // per il provider diretto (Gemini) o se il dato non è arrivato.
      servedBy: entry.servedBy || null,
      // Chi ha servito risultava fra i fornitori esclusi dalla politica: la voce
      // resta marchiata, così la prova di cosa è successo non vive solo in un
      // log che nessuno riapre.
      policyViolation: entry.policyViolation === true,
      input: sanitizeInput(entry.input),
      output: entry.output || '',
      origin: entry.origin || '',
      costEur: entry.costEur || 0,
      usage: entry.usage || null,
    };
    items.unshift(full);
    // Hard cap items
    if (items.length > HISTORY_ITEMS_HARD_CAP) items.length = HISTORY_ITEMS_HARD_CAP;
    // Hard cap byte: ruota cancellando i più vecchi
    while (approximateBytes(items) > HISTORY_LIMIT_BYTES && items.length > 10) {
      items.pop();
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: items });
    return full;
  }

  // Rimuove UNA sola voce dalla cronologia AI per id. Simmetrica a append:
  // se l'utente può aggiungere una voce (di fatto ogni richiesta AI) deve poter
  // togliere quella singola voce senza svuotare tutto lo storico (es. contiene
  // testo privato o un risultato sbagliato). Restituisce la lista aggiornata,
  // così il chiamante riallinea la vista senza una seconda lettura.
  async function remove(id) {
    const items = await list();
    const next = items.filter((it) => it && it.id !== id);
    if (next.length !== items.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: next });
    }
    return next;
  }

  async function clear() {
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  }

  // Migrazione one-shot: ripulisce le entry esistenti dagli screenshot
  // (data URL pesanti salvati in input prima del fix). Idempotente: se non
  // trova nulla da ripulire e la dimensione è entro soglia, non scrive.
  // Se la scrittura iniziale fallisce per quota, dimezza progressivamente
  // gli item finché non passa o restano solo gli ultimi 10.
  async function cleanupScreenshots() {
    let items;
    try { items = await list(); } catch (_) { return { changed: false }; }
    if (!Array.isArray(items) || !items.length) return { changed: false };

    let stripped = 0;
    const cleaned = items.map((it) => {
      if (it && it.input && typeof it.input === 'object' && 'screenshot' in it.input) {
        stripped++;
        const { screenshot, ...rest } = it.input;
        return { ...it, input: rest };
      }
      return it;
    });

    const overLimit = approximateBytes(cleaned) > HISTORY_LIMIT_BYTES;
    if (stripped === 0 && !overLimit) return { changed: false };

    // Applica anche la rotazione per rientrare nel limite.
    let trimmed = cleaned;
    if (trimmed.length > HISTORY_ITEMS_HARD_CAP) trimmed.length = HISTORY_ITEMS_HARD_CAP;
    while (approximateBytes(trimmed) > HISTORY_LIMIT_BYTES && trimmed.length > 10) {
      trimmed.pop();
    }

    // Se la scrittura fallisce per quota (lo storage può essere già pieno
    // a causa di altri consumer), dimezziamo progressivamente.
    while (trimmed.length > 0) {
      try {
        await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: trimmed });
        return { changed: true, stripped, kept: trimmed.length };
      } catch (err) {
        const msg = String(err?.message || err || '');
        const quota = /quota|kQuotaBytes/i.test(msg);
        if (!quota || trimmed.length <= 1) {
          // Errore non-quota o lista già minima: prova a svuotare tutto.
          try {
            await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
            return { changed: true, stripped, kept: 0, fallbackCleared: true };
          } catch (_) {
            return { changed: false, error: msg };
          }
        }
        trimmed = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)));
      }
    }
    return { changed: false };
  }

  global.SN_HISTORY = { list, append, remove, clear, cleanupScreenshots };
})(typeof globalThis !== 'undefined' ? globalThis : self);
