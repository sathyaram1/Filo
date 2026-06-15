// Handler di dominio: ciclo di vita dei tab via shim chrome.tabs, segnali
// colore/attività dal content script, triage manuale e schede archiviate.

module.exports = function register(on, ctx) {
  const { MSG, winOf, searchArchivedTabs } = ctx;
  const ArchivedTabs = globalThis.SN_ARCHIVED_TABS;

  on('_tabs:create', async (msg, sender) => {
    const win = winOf(sender);
    if (!win || !win._filoTabs) return { ok: false };
    const id = win._filoTabs.openTab(msg.url || 'filo://newtab/');
    return { ok: true, id };
  });

  on('_tabs:remove', async (msg, sender) => {
    const win = winOf(sender);
    if (win && win._filoTabs) win._filoTabs.closeTab(msg.id);
    return { ok: true };
  });

  on(MSG.TAB_DOMINANT_COLOR, async (msg, sender) => {
    // Colore dominante campionato dalla pagina → tinge la tab attiva (§1.1).
    const win = winOf(sender);
    if (win && win._filoTabs && sender?.tab?.id) {
      win._filoTabs.setTabColor(sender.tab.id, msg.color || null);
    }
    return { ok: true };
  });

  on(MSG.TAB_IDENTITY_COLOR, async (msg, sender) => {
    // Colore identità del sito (§1.2) → cachato per dominio dal TabManager e
    // applicato attenuato alle tab inattive.
    const win = winOf(sender);
    if (win && win._filoTabs && sender?.tab?.id) {
      win._filoTabs.setTabIdentityColor(sender.tab.id, msg.color || null);
    }
    return { ok: true };
  });

  on(MSG.RUN_TAB_TRIAGE, async (msg, sender) => {
    // Pulizia/riordino su richiesta esplicita (l'utente ha confermato nel
    // bottone dell'agente). Gira sul TabManager della finestra del mittente.
    const win = winOf(sender);
    if (win && win._filoTabs) {
      const res = await win._filoTabs.runAutoTriage({ trigger: 'manual' });
      return { ok: true, archived: (res && res.archived) || 0 };
    }
    return { ok: false, archived: 0 };
  });

  on(MSG.TAB_ACTIVITY, async (msg, sender) => {
    // Segnali di attività della tab (§2.1) → merge sullo snapshot.
    const win = winOf(sender);
    if (win && win._filoTabs && sender?.tab?.id) {
      win._filoTabs.setTabActivity(sender.tab.id, {
        lastInteractionAt: msg.lastInteractionAt,
        scrollPct: msg.scrollPct,
        formDirty: msg.formDirty,
      });
    }
    return { ok: true };
  });

  on(MSG.GET_ARCHIVED_TABS, async () => {
    // listMeta: senza embedding (non spediamo i vettori al renderer).
    return { ok: true, tabs: await ArchivedTabs.listMeta() };
  });

  on(MSG.SEARCH_ARCHIVED_TABS, async (msg) => searchArchivedTabs(msg.query));

  on(MSG.DELETE_ARCHIVED_TABS, async (msg) => {
    const r = await ArchivedTabs.removeMany(msg.ids || []);
    return { ok: true, removed: r.removed, remaining: r.remaining };
  });

  on(MSG.REMOVE_ARCHIVED_TAB, async (msg) => ({ ok: true, tabs: await ArchivedTabs.remove(msg.id) }));

  on(MSG.CLEAR_ARCHIVED_TABS, async () => ({ ok: true, tabs: await ArchivedTabs.clear() }));

  on(MSG.REOPEN_ARCHIVED_TAB, async (msg, sender) => {
    // Riapre la scheda archiviata, ripristinando lo scroll registrato.
    const win = winOf(sender);
    if (win && win._filoTabs && msg.url) {
      const pct = typeof msg.scrollPct === 'number' ? msg.scrollPct : null;
      const px = msg.proxy;
      // Se la tab archiviata aveva una sua location salvata, la applichiamo noi
      // qui sotto: disattiviamo l'auto-proxy per dominio così la view non viene
      // ricreata due volte (la location salvata vince su un'eventuale regola).
      const id = win._filoTabs.openTab(msg.url, {
        activate: true, restoreScrollPct: pct, applyDomainRule: !(px && px.country),
      });
      // Se la tab archiviata era instradata "da un altro paese", riaprila
      // proxata sulla stessa location: setTabProxy ricrea la view nella
      // partition proxata e ricarica l'URL attraverso l'endpoint del paese.
      if (id && px && px.country) {
        try { await win._filoTabs.setTabProxy(id, px.country, { tier: px.tier || undefined }); } catch (_) {}
      }
    }
    return { ok: true };
  });
};
