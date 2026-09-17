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
    // Approssimazione conservativa: lunghezza del JSON.
    try { return JSON.stringify(items).length; } catch (_) { return 0; }
  }

  // Via i campi voluminosi senza valore storico: la quota di chrome.storage.local è ~10 MB e
  // uno screenshot del flusso Aiuto è un data URL da centinaia di KB per turno.
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
      // Chi ha DAVVERO servito la risposta, quando il provider lo riporta: è la controprova della
      // politica sui fornitori. null se non è arrivato (voce e dettatura lo mandano dopo).
      servedBy: entry.servedBy || null,
      // Servita da un fornitore escluso: la voce resta marchiata, così la prova non vive solo in
      // un log che nessuno riapre.
      policyViolation: entry.policyViolation === true,
      input: sanitizeInput(entry.input),
      output: entry.output || '',
      origin: entry.origin || '',
      costEur: entry.costEur || 0,
      usage: entry.usage || null,
      // Tempi del turno in ms: senza questi numeri ogni scelta sui modelli è a occhio.
      timing: (entry.timing && typeof entry.timing === 'object') ? entry.timing : null,
    };
    items.unshift(full);
    if (items.length > HISTORY_ITEMS_HARD_CAP) items.length = HISTORY_ITEMS_HARD_CAP;
    while (approximateBytes(items) > HISTORY_LIMIT_BYTES && items.length > 10) {
      items.pop();
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: items });
    return full;
  }

  // Simmetrica ad append: chi aggiunge una voce deve poter togliere quella singola (testo
  // privato, risultato sbagliato). Torna la lista aggiornata, così il chiamante non rilegge.
  async function remove(id) {
    const items = await list();
    const next = items.filter((it) => it && it.id !== id);
    if (next.length !== items.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: next });
    }
    return next;
  }

  // Il riscontro «chi ha servito» delle chiamate audio arriva secondi DOPO la risposta: la
  // voce nasce senza e viene marchiata quando il dato c'è.
  async function patch(id, fields) {
    if (!id || !fields || typeof fields !== 'object') return null;
    const items = await list();
    const idx = items.findIndex((it) => it && it.id === id);
    if (idx < 0) return null;
    items[idx] = { ...items[idx], ...fields };
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: items });
    return items[idx];
  }

  async function clear() {
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  }

  // Ripulisce le voci dagli screenshot salvati. Idempotente: se non c'è niente da togliere e
  // la dimensione è entro soglia, non scrive.
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

    let trimmed = cleaned;
    if (trimmed.length > HISTORY_ITEMS_HARD_CAP) trimmed.length = HISTORY_ITEMS_HARD_CAP;
    while (approximateBytes(trimmed) > HISTORY_LIMIT_BYTES && trimmed.length > 10) {
      trimmed.pop();
    }

    // Lo storage può essere già pieno per altri: se la scrittura fallisce per quota si dimezza.
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

  global.SN_HISTORY = { list, append, patch, remove, clear, cleanupScreenshots };
})(typeof globalThis !== 'undefined' ? globalThis : self);
