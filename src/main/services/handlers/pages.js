// Handler di dominio: pagine salvate ("salva per dopo") e categorie.

module.exports = function register(on, ctx) {
  const { MSG, maybeCategorizeAsync } = ctx;
  const SavedPages = globalThis.SN_SAVED_PAGES;
  const Categorizer = globalThis.SN_CATEGORIZER;

  on(MSG.SAVE_PAGE, async (msg) => {
    const entry = await SavedPages.save(msg.page);
    maybeCategorizeAsync(entry, msg.page).catch((e) => console.warn('[Filo] categorize failed', e));
    return { ok: true, entry };
  });

  on(MSG.SAVE_LINK, async (msg) => {
    const entry = await SavedPages.save({ url: msg.url, title: msg.title });
    maybeCategorizeAsync(entry, { url: msg.url, title: msg.title }).catch((e) => console.warn('[Filo] categorize failed', e));
    return { ok: true, entry };
  });

  on(MSG.GET_CATEGORIES, async () => ({ ok: true, categories: await Categorizer.listCategories() }));

  on(MSG.RENAME_CATEGORY, async (msg) => {
    const c = await Categorizer.renameCategory(msg.id, msg.name);
    return { ok: true, category: c };
  });

  on(MSG.DELETE_CATEGORY, async (msg) => {
    const cats = await Categorizer.deleteCategory(msg.id);
    return { ok: true, categories: cats };
  });

  on(MSG.MERGE_CATEGORIES, async (msg) => {
    await Categorizer.mergeCategories(msg.fromId, msg.toId);
    return { ok: true, categories: await Categorizer.listCategories() };
  });

  on(MSG.MOVE_PAGE_CATEGORY, async (msg) => {
    const p = await Categorizer.movePageToCategory(msg.pageId, msg.categoryId);
    return { ok: true, page: p };
  });

  on(MSG.GET_SAVED_PAGES, async () => ({ ok: true, pages: await SavedPages.list() }));

  on(MSG.REMOVE_SAVED_PAGE, async (msg) => ({ ok: true, pages: await SavedPages.remove(msg.id) }));

  on(MSG.CONSUME_SAVED_PAGE, async (msg) => ({ ok: true, pages: await SavedPages.consume(msg.id) }));
};
