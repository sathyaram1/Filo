// Handler di dominio: pagine salvate ("salva per dopo") e categorie.
// Elenco, miniature e categorie le leggono e le cambiano solo le pagine di Filo (#589.12); sentinella:
// tests/unit/pagineSalvateVersoSiti.test.mjs.

module.exports = function register(on, ctx) {
  const { MSG, maybeCategorizeAsync } = ctx;
  const SavedPages = globalThis.SN_SAVED_PAGES;
  const Categorizer = globalThis.SN_CATEGORIZER;
  const { dallaScheda } = require('../miniature');
  const { isFilo } = require('../impostazioniPerOrigine');

  // Una categoria porta la miniatura della pagina che l'ha creata: anche lei è roba dell'elenco.
  const soloFilo = (type, fn) => on(type, (msg, sender, origin) => (
    isFilo(origin) ? fn(msg, sender, origin) : { ok: false, error: 'forbidden' }));
  // A un sito torna solo ciò che il content script usa: la voce con lo stesso indirizzo può essere già salvata da un altro sito.
  const voceVerso = (entry, origin) => (!entry || isFilo(origin) ? entry : { id: entry.id, category: entry.category || null });

  on(MSG.SAVE_PAGE, async (msg, sender, origin) => {
    const entry = await SavedPages.save(msg.page);
    maybeCategorizeAsync(entry, msg.page).catch((e) => console.warn('[Filo] categorize failed', e));
    return { ok: true, entry: voceVerso(entry, origin) };
  });

  on(MSG.SAVE_LINK, async (msg, sender, origin) => {
    const entry = await SavedPages.save({ url: msg.url, title: msg.title });
    maybeCategorizeAsync(entry, { url: msg.url, title: msg.title }).catch((e) => console.warn('[Filo] categorize failed', e));
    return { ok: true, entry: voceVerso(entry, origin) };
  });

  soloFilo(MSG.GET_CATEGORIES, async () => ({ ok: true, categories: await Categorizer.listCategories() }));

  soloFilo(MSG.RENAME_CATEGORY, async (msg) => {
    // Un nome non confermato (`unisci: false`) uguale a un'altra categoria non le fonde: la fusione non si disfa (#590.5).
    if (msg.unisci === false) {
      const omonima = Categorizer.findByName(await Categorizer.listCategories(), String(msg.name || ''));
      if (omonima && omonima.id !== msg.id) return { ok: false, error: 'name_taken', category: omonima };
    }
    const c = await Categorizer.renameCategory(msg.id, msg.name);
    return { ok: true, category: c };
  });

  soloFilo(MSG.DELETE_CATEGORY, async (msg) => {
    const cats = await Categorizer.deleteCategory(msg.id);
    return { ok: true, categories: cats };
  });

  soloFilo(MSG.MERGE_CATEGORIES, async (msg) => {
    await Categorizer.mergeCategories(msg.fromId, msg.toId);
    return { ok: true, categories: await Categorizer.listCategories() };
  });

  soloFilo(MSG.MOVE_PAGE_CATEGORY, async (msg) => {
    const p = await Categorizer.movePageToCategory(msg.pageId, msg.categoryId);
    return { ok: true, page: p };
  });

  soloFilo(MSG.GET_SAVED_PAGES, async () => ({ ok: true, pages: await SavedPages.list() }));

  soloFilo(MSG.REMOVE_SAVED_PAGE, async (msg) => ({ ok: true, pages: await SavedPages.remove(msg.id) }));

  soloFilo(MSG.CONSUME_SAVED_PAGE, async (msg) => ({ ok: true, pages: await SavedPages.consume(msg.id) }));

  // La miniatura la scatta il main dalla scheda di chi la chiede: un'immagine mandata dalla pagina qui non si decodifica (#839).
  on(MSG.SET_SAVED_PAGE_THUMB, async (msg, sender, origin) => {
    const tab = sender?.win?._filoTabs?.tabs?.find((t) => t.id === sender?.tab?.id);
    if (!tab || !msg?.id) return { ok: false };
    const thumbnail = await dallaScheda(tab.view.webContents);
    const entry = thumbnail ? await SavedPages.setThumbnail(msg.id, thumbnail) : null;
    return { ok: !!entry, entry: voceVerso(entry, origin) };
  });

  on(MSG.SHORTCUT_RECEIPT, async (msg, sender) => ({
    ok: require('../../shortcuts').riceviRicevuta(msg.ricevuta, sender?.tab?.id, msg.presa),
  }));
};
