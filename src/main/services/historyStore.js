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

  // Via i campi voluminosi che non hanno valore storico: la quota di chrome.storage.local è ~10 MB e lo screenshot del flusso Aiuto è un data URL da centinaia di KB per turno.
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
      // Chi ha DAVVERO servito la risposta upstream (#421), quando il provider lo riporta: è la controprova della politica sui fornitori. null se il dato non è arrivato (per voce e dettatura arriva dopo, via patch).
      servedBy: entry.servedBy || null,
      // Chi ha servito era fra i fornitori esclusi dalla politica: la voce resta marchiata, così la prova di cosa è successo non vive solo in un log che nessuno riapre.
      policyViolation: entry.policyViolation === true,
      input: sanitizeInput(entry.input),
      output: entry.output || '',
      origin: entry.origin || '',
      costEur: entry.costEur || 0,
      usage: entry.usage || null,
      // Tempi del turno (ms dalla partenza): primo pezzo di ragionamento, prima parola, prima azione, fine. Senza questi numeri ogni scelta sui modelli è a occhio.
      timing: (entry.timing && typeof entry.timing === 'object') ? entry.timing : null,
    };
    items.unshift(full);
    if (items.length > HISTORY_ITEMS_HARD_CAP) items.length = HISTORY_ITEMS_HARD_CAP;
    // Oltre il limite di byte si ruota cancellando i più vecchi.
    while (approximateBytes(items) > HISTORY_LIMIT_BYTES && items.length > 10) {
      items.pop();
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: items });
    return full;
  }

  // Simmetrica ad append: se l'utente può aggiungere una voce deve poter togliere quella singola (testo privato, risultato sbagliato) senza svuotare tutto lo storico. Ritorna la lista aggiornata, così il chiamante riallinea la vista senza rileggere.
  async function remove(id) {
    const items = await list();
    const next = items.filter((it) => it && it.id !== id);
    if (next.length !== items.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: next });
    }
    return next;
  }

  // Serve al riscontro "chi ha servito" delle chiamate audio, che arriva qualche secondo DOPO la risposta: la voce nasce senza e viene marchiata quando il dato c'è.
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

  // Migrazione one-shot: ripulisce le voci dagli screenshot salvati prima del fix. Idempotente: se non c'è nulla da ripulire e la dimensione è entro soglia, non scrive.
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

    // Lo storage può essere già pieno per colpa di altri consumer: se la scrittura fallisce per quota si dimezza progressivamente.
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
