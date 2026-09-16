// Persistenza schede "Salva per dopo".

(function (global) {
  'use strict';

  const { STORAGE_KEYS, SAVED_PAGES_LIMIT } = global.SN_CONST;

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function list() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SAVED_PAGES);
    return res[STORAGE_KEYS.SAVED_PAGES] || [];
  }

  async function save(page) {
    const pages = await list();

    // Dedupe per URL: ri-salvare una pagina già in "Aperti per dopo" NON crea un doppione — aggiorna la voce (titolo, favicon, anteprima, data) e la riporta in cima, preservando id e categoria già assegnata.
    const idx = pages.findIndex((p) => p.url === page.url);
    if (idx >= 0) {
      const existing = pages[idx];
      existing.title = page.title || existing.title || page.url;
      if (page.favicon) existing.favicon = page.favicon;
      if (page.thumbnail) existing.thumbnail = page.thumbnail;
      existing.savedAt = new Date().toISOString();
      pages.splice(idx, 1);
      pages.unshift(existing);
      await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
      return existing;
    }

    const entry = {
      id: uuid(),
      url: page.url,
      title: page.title || page.url,
      favicon: page.favicon || '',
      thumbnail: page.thumbnail || '',
      savedAt: new Date().toISOString(),
      category: page.category || null,
      categoryConfidence: page.categoryConfidence || null,
    };
    pages.unshift(entry);
    if (pages.length > SAVED_PAGES_LIMIT) pages.length = SAVED_PAGES_LIMIT;
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    return entry;
  }

  // Aggiorna SOLO la miniatura di una scheda salvata: il salvataggio è committato subito col testo e la cattura arriva dopo (~120ms), quindi è opzionale. Se la scheda non esiste più è un no-op.
  async function setThumbnail(id, thumbnail) {
    if (!id || !thumbnail) return null;
    const pages = await list();
    const entry = pages.find((p) => p.id === id);
    if (!entry) return null;
    entry.thumbnail = thumbnail;
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    return entry;
  }

  async function remove(id) {
    const pages = await list();
    const filtered = pages.filter((p) => p.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: filtered });
    return filtered;
  }

  // "Consuma": rimuove dalla lista, quando l'utente apre una scheda.
  async function consume(id) {
    return remove(id);
  }

  global.SN_SAVED_PAGES = { list, save, setThumbnail, remove, consume };
})(typeof globalThis !== 'undefined' ? globalThis : self);
