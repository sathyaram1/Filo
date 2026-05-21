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

  async function remove(id) {
    const pages = await list();
    const filtered = pages.filter((p) => p.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: filtered });
    return filtered;
  }

  // "Consuma": rimuove dalla lista. Usato quando l'utente apre una scheda.
  async function consume(id) {
    return remove(id);
  }

  global.SN_SAVED_PAGES = { list, save, remove, consume };
})(typeof globalThis !== 'undefined' ? globalThis : self);
