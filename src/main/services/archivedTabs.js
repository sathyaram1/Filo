// Persistenza tab archiviate (§3.1). "Chiudere una tab non è perdere — è
// salvare": quando una scheda web viene chiusa, i suoi metadati finiscono qui e
// restano consultabili (e riapribili) dalla pagina archivio (filo://archive).
//
// Per ora salviamo SOLO i metadati (~1-2 KB/tab). Il riassunto LLM e l'embedding
// per la ricerca semantica (§3.2) sono rimandati: questo store è la base su cui
// si appoggeranno.

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

  // Archivia una tab chiusa. `meta` contiene i campi catturati al momento della
  // chiusura (vedi tabs.js _archiveClosedTab). Ritorna l'entry creata, o null se
  // la tab non è archiviabile (manca l'URL).
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
    };
    items.unshift(entry);
    if (items.length > ARCHIVED_TABS_LIMIT) items.length = ARCHIVED_TABS_LIMIT;
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: items });
    return entry;
  }

  async function remove(id) {
    const items = await list();
    const filtered = items.filter((t) => t.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: filtered });
    return filtered;
  }

  async function clear() {
    await chrome.storage.local.set({ [STORAGE_KEYS.ARCHIVED_TABS]: [] });
    return [];
  }

  global.SN_ARCHIVED_TABS = { list, archive, remove, clear };
})(typeof globalThis !== 'undefined' ? globalThis : self);
