// Persistenza schede "Salva per dopo".

(function (global) {
  'use strict';

  const { STORAGE_KEYS, SAVED_PAGES_LIMIT } = global.SN_CONST;
  // Nel file dei dati entra solo un'anteprima già piccola, da qualunque strada arrivi (#839).
  const { accettabile } = require('./miniature');

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
    // Dalla pagina d'errore di Filo si mette da parte il sito che non si è caricato, non la pagina interna (#839).
    const sito = global.SN_NET_ERROR?.targetOf?.(page.url);
    if (sito) page = { ...page, url: sito, favicon: '' };
    const thumbnail = accettabile(page.thumbnail);
    const pages = await list();

    // Dedupe per URL: salvare di nuovo una pagina già in "Aperti per dopo"
    // NON deve creare un doppione. Aggiorna la voce esistente (rinfresca titolo,
    // favicon, anteprima e data) e la riporta in cima, preservando id e categoria
    // già assegnata. Così ri-salvare = "aggiorna e riporta su", senza attrito.
    const idx = pages.findIndex((p) => p.url === page.url);
    if (idx >= 0) {
      const existing = pages[idx];
      existing.title = page.title || existing.title || page.url;
      if (page.favicon) existing.favicon = page.favicon;
      if (thumbnail) existing.thumbnail = thumbnail;
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
      thumbnail,
      savedAt: new Date().toISOString(),
      category: page.category || null,
      categoryConfidence: page.categoryConfidence || null,
    };
    pages.unshift(entry);
    const fuori = pages.length > SAVED_PAGES_LIMIT ? pages.splice(SAVED_PAGES_LIMIT) : [];
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    if (fuori.length) dichiaraUscite(fuori);
    return entry;
  }

  // L'elenco vive in storage.json, che si riscrive intero: il tetto resta, ma chi esce lo si dice (#1088).
  // In fondo stanno le più vecchie: save() mette in cima e l'importazione ordina per data.
  function dichiaraUscite(fuori) {
    const nome = (p) => `«${String((p && (p.title || p.url)) || '').slice(0, 80)}»`;
    const testo = fuori.length === 1
      ? `Le pagine salvate per dopo sono al massimo ${SAVED_PAGES_LIMIT}. ${nome(fuori[0])}, la più vecchia, è uscita dall’elenco.`
      : `Le pagine salvate per dopo sono al massimo ${SAVED_PAGES_LIMIT}. Le ${fuori.length} più vecchie sono uscite dall’elenco.`;
    try { require('./avvisoFinestra').avvisoNellaFinestra(testo, { chiave: 'pagine-salvate-tetto' }); } catch (_) {}
  }

  // Aggiorna SOLO la miniatura di una scheda già salvata (per id). Serve al
  // flusso "Salva per dopo": il salvataggio viene committato subito col testo,
  // la miniatura arriva dopo (cattura ~120ms) ed è opzionale. Se la scheda non
  // esiste più (rimossa nel frattempo) l'update è un no-op.
  async function setThumbnail(id, thumbnail) {
    thumbnail = accettabile(thumbnail);
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

  // "Consuma": rimuove dalla lista. Usato quando l'utente apre una scheda.
  async function consume(id) {
    return remove(id);
  }

  global.SN_SAVED_PAGES = { list, save, setThumbnail, remove, consume, rimpicciolisciMiniature: require('./miniature').rimpicciolisciSalvate };
})(typeof globalThis !== 'undefined' ? globalThis : self);
