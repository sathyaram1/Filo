// Handler di dominio: pagine salvate ("salva per dopo") e categorie.

module.exports = function register(on, ctx) {
  const { MSG, maybeCategorizeAsync, winOf } = ctx;
  const SavedPages = globalThis.SN_SAVED_PAGES;
  const Categorizer = globalThis.SN_CATEGORIZER;

  // Conferma di salvataggio CLICCABILE (#252). "Salva per dopo" chiude la
  // scheda: la conferma non può vivere nella pagina (sparisce con la scheda),
  // quindi la mostriamo come notifica della shell, che sopravvive alla chiusura.
  // Renderla cliccabile — apre "Aperti per dopo" evidenziando la scheda appena
  // salvata — è ciò che fa scoprire la lista a chi salva per la prima volta,
  // proprio nel momento in cui gli serve, senza aggiungere voci di menu.
  function notifySaved(sender, entry) {
    try {
      const win = winOf(sender);
      if (!win) return;
      const I18n = globalThis.SN_I18N;
      const label = (entry && entry.category) || I18n.t('category_default');
      win.webContents.send('shell:toast', {
        text: I18n.t('toast_saved', label),
        opts: {
          // Azione dichiarativa: la shell la traduce in "apri questa pagina
          // interna" (vedi shell.js onToast → clickOpen).
          clickOpen: `filo://home/home.html?highlight=${encodeURIComponent(entry.id)}`,
        },
      });
    } catch (_) { /* la conferma è best-effort: mai far fallire il salvataggio */ }
  }

  on(MSG.SAVE_PAGE, async (msg, sender) => {
    const entry = await SavedPages.save(msg.page);
    maybeCategorizeAsync(entry, msg.page).catch((e) => console.warn('[Filo] categorize failed', e));
    notifySaved(sender, entry);
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

  on(MSG.SET_SAVED_PAGE_THUMB, async (msg) => ({ ok: true, entry: await SavedPages.setThumbnail(msg.id, msg.thumbnail) }));
};
