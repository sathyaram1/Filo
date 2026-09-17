// Persistenza delle tab archiviate (§3.1): alla chiusura i metadati finiscono qui e la
// scheda resta riapribile da filo://archive. Riassunto ed embedding (§3.2) sono rimandati.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, ARCHIVED_TABS_LIMIT, ARCHIVED_EMBED_LIMIT } = global.SN_CONST;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function list() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.ARCHIVED_TABS);
    const arr = res[STORAGE_KEYS.ARCHIVED_TABS];
    return Array.isArray(arr) ? arr : [];
  }

  async function archive(meta) {
    if (!meta || !meta.url) return null;
    const items = await list();
    const entry = {
      id: uuid(),
      url: meta.url,
      title: meta.title || meta.url,
      favicon: meta.favicon || '',
      // Colore identità del sito (§1.2): serve all'ordine cromatico in archivio.
      identityColor: meta.identityColor || null,
      openedAt: meta.openedAt || null,
      closedAt: meta.closedAt || new Date().toISOString(),
      // Perché è stata chiusa: per ora sempre 'manual' (chiusura dell'utente).
      // L'auto-archiviazione (§2.1) userà altri valori (es. 'inactive').
      reason: meta.reason || 'manual',
      // URL delle altre tab aperte nello stesso momento (contesto di lavoro).
      coOpenUrls: Array.isArray(meta.coOpenUrls) ? meta.coOpenUrls.slice(0, 30) : [],
      // Posizione di scroll: rimandata (la consuma §2.1). Campo riservato.
      scrollPosition: typeof meta.scrollPosition === 'number' ? meta.scrollPosition : null,
      // Proxy alla chiusura: riaprendo dalla cronologia la tab rinasce sulla stessa location.
      proxy: meta.proxy && meta.proxy.country
        ? { country: String(meta.proxy.country), tier: meta.proxy.tier || null }
        : null,
    };
    items.unshift(entry);
    if (items.length > ARCHIVED_TABS_LIMIT) items.length = ARCHIVED_TABS_LIMIT;
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: items });
    return entry;
  }

  // Senza embedding: al renderer non vanno spediti MB di vettori a ogni apertura dell'archivio.
  async function listMeta() {
    const items = await list();
    return items.map(({ embedding, ...rest }) => rest);
  }

  // Gli embedding restano solo sulle tab più recenti (in testa) per non sforare la quota;
  // muta l'array in place.
  function capEmbeddings(items) {
    let changed = false;
    for (let i = ARCHIVED_EMBED_LIMIT; i < items.length; i++) {
      if (items[i] && items[i].embedding) { items[i].embedding = null; changed = true; }
    }
    return changed;
  }

  async function update(id, patch) {
    if (!id || !patch) return null;
    const items = await list();
    const idx = items.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    items[idx] = { ...items[idx], ...patch };
    capEmbeddings(items);
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: items });
    return items[idx];
  }

  async function remove(id) {
    const items = await list();
    const filtered = items.filter((t) => t.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: filtered });
    return filtered;
  }

  // Cancellazione multipla (§5 pulizia retroattiva).
  async function removeMany(ids) {
    const set = new Set(Array.isArray(ids) ? ids : []);
    if (!set.size) return { removed: 0, remaining: (await list()).length };
    const items = await list();
    const filtered = items.filter((t) => !set.has(t.id));
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: filtered });
    return { removed: items.length - filtered.length, remaining: filtered.length };
  }

  async function clear() {
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: [] });
    return [];
  }

  global.SN_ARCHIVED_TABS = { list, listMeta, archive, update, remove, removeMany, clear };
})(typeof globalThis !== 'undefined' ? globalThis : self);
