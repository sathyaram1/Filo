// Categorizer (Fase 2): assegna automaticamente una categoria a una scheda salvata.
// Storage categorie persistente in chrome.storage.local sotto STORAGE_KEYS.CATEGORIES.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, ACTIONS, PROMPTS } = global.SN_CONST;

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function listCategories() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.CATEGORIES);
    return res[STORAGE_KEYS.CATEGORIES] || [];
  }

  async function setCategories(cats) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: cats });
  }

  function findByName(cats, name) {
    if (!name) return null;
    const norm = name.trim().toLowerCase();
    return cats.find((c) => c.name.trim().toLowerCase() === norm) || null;
  }

  async function ensureCategory({ name, isNew, thumbnailUrl }) {
    const cats = await listCategories();
    let cat = findByName(cats, name);
    if (!cat) {
      cat = {
        id: uuid(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
        thumbnailUrl: thumbnailUrl || '',
      };
      cats.push(cat);
      await setCategories(cats);
    } else if (thumbnailUrl) {
      cat.thumbnailUrl = thumbnailUrl;
      await setCategories(cats);
    }
    return cat;
  }

  async function renameCategory(id, newName) {
    const cats = await listCategories();
    const c = cats.find((x) => x.id === id);
    if (!c) return null;
    // Se il nuovo nome esiste già, fa merge (sposta tutte le pagine)
    const existing = findByName(cats, newName);
    if (existing && existing.id !== id) {
      await mergeCategories(id, existing.id);
      return existing;
    }
    c.name = newName.trim();
    await setCategories(cats);
    return c;
  }

  async function deleteCategory(id) {
    const cats = await listCategories();
    const filtered = cats.filter((c) => c.id !== id);
    await setCategories(filtered);
    // Le pagine con quella categoria diventano "non categorizzate" (category=null)
    const sp = await chrome.storage.local.get(STORAGE_KEYS.SAVED_PAGES);
    const pages = sp[STORAGE_KEYS.SAVED_PAGES] || [];
    let changed = false;
    for (const p of pages) {
      if (p.categoryId === id) { p.categoryId = null; p.category = null; changed = true; }
    }
    if (changed) await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    return filtered;
  }

  async function mergeCategories(fromId, toId) {
    if (fromId === toId) return;
    const cats = await listCategories();
    const filtered = cats.filter((c) => c.id !== fromId);
    await setCategories(filtered);
    const sp = await chrome.storage.local.get(STORAGE_KEYS.SAVED_PAGES);
    const pages = sp[STORAGE_KEYS.SAVED_PAGES] || [];
    const target = filtered.find((c) => c.id === toId);
    let changed = false;
    for (const p of pages) {
      if (p.categoryId === fromId) {
        p.categoryId = toId;
        p.category = target?.name || null;
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
  }

  async function movePageToCategory(pageId, categoryId) {
    const sp = await chrome.storage.local.get(STORAGE_KEYS.SAVED_PAGES);
    const pages = sp[STORAGE_KEYS.SAVED_PAGES] || [];
    const cats = await listCategories();
    const cat = categoryId ? cats.find((c) => c.id === categoryId) : null;
    const p = pages.find((x) => x.id === pageId);
    if (!p) return null;
    p.categoryId = categoryId || null;
    p.category = cat?.name || null;
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    return p;
  }

  // Robust JSON parse: il modello a volte aggiunge ```json ... ``` o testo extra.
  function extractJSON(text) {
    if (!text) return null;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }

  // Chiama l'LLM per categorizzare. invokeAI è una funzione passata da background.js
  // per evitare dipendenze circolari con il routing dei messaggi.
  async function categorize({ invokeAI, page }) {
    const cats = await listCategories();
    const existing = cats.map((c) => c.name);
    const payload = {
      url: page.url,
      title: page.title || '',
      description: page.description || '',
      excerpt: page.excerpt || '',
      existing,
    };
    const result = await invokeAI({ action: ACTIONS.CATEGORIZE, payload });
    const parsed = extractJSON(result.text) || {};
    const name = (parsed.category || '').trim();
    if (!name) return null;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null;
    const cat = await ensureCategory({ name, isNew: !!parsed.isNew, thumbnailUrl: page.thumbnail });
    return { category: cat, confidence, raw: result.text };
  }

  global.SN_CATEGORIZER = {
    listCategories,
    setCategories,
    ensureCategory,
    renameCategory,
    deleteCategory,
    mergeCategories,
    movePageToCategory,
    categorize,
    extractJSON,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
