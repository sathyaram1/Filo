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

  // `nome`: la categoria nuova scritta a mano; se ne esiste già una con quel nome si usa quella.
  soloFilo(MSG.MOVE_PAGE_CATEGORY, async (msg) => {
    let categoryId = msg.categoryId || null;
    if (msg.nome !== undefined) {
      const nome = String(msg.nome || '').trim();
      const max = globalThis.SN_CONST.CATEGORY_NAME_MAX;
      if (!nome) return { ok: false, error: 'empty_name' };
      if (nome.length > max) return { ok: false, error: 'name_too_long', max };
      // Senza la pagina non si crea niente: una categoria vuota resterebbe nelle Opzioni senza averla chiesta.
      if (!(await SavedPages.list()).some((p) => p.id === msg.pageId)) return { ok: false, error: 'not_found' };
      categoryId = (await Categorizer.ensureCategory({ name: nome })).id;
    }
    const p = await Categorizer.movePageToCategory(msg.pageId, categoryId);
    return p ? { ok: true, page: p } : { ok: false, error: 'not_found' };
  });

  soloFilo(MSG.GET_SAVED_PAGES, async () => ({ ok: true, pages: await SavedPages.list() }));

  soloFilo(MSG.REMOVE_SAVED_PAGE, async (msg) => ({ ok: true, pages: await SavedPages.remove(msg.id) }));

  soloFilo(MSG.RESTORE_SAVED_PAGE, async (msg) => {
    const { pages, entry } = await SavedPages.rimetti(msg.id, await Categorizer.listCategories());
    return { ok: !!entry, pages };
  });

  soloFilo(MSG.CONSUME_SAVED_PAGE, async (msg) => ({ ok: true, pages: await SavedPages.consume(msg.id) }));

  // Il bottone di una pagina salvata in chat (#845): l'indirizzo è quello in elenco, non uno che manda la pagina.
  soloFilo(MSG.APRI_PAGINA_SALVATA, async (msg, sender) => {
    const r = await ctx.apriPaginaSalvata(msg.id, { sender, tieni: msg.tieni === true, confermato: msg.confermato === true });
    return r.ok ? { ok: true, tolta: r.tolta } : { ok: false, ...(r.conferma ? { conferma: r.conferma, parti: r.parti } : {}), ...(r.frase ? { frase: r.frase } : {}) };
  });

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
