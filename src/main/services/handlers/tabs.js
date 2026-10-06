// Handler di dominio: ciclo di vita dei tab via shim chrome.tabs, segnali
// colore/attività dal content script, triage manuale e schede archiviate.

const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG, winOf, searchArchivedTabs, archivioDaCancellare } = ctx;
  const ArchivedTabs = globalThis.SN_ARCHIVED_TABS;

  on('_tabs:create', async (msg, sender) => {
    const win = winOf(sender);
    if (!win || !win._filoTabs) return { ok: false };
    const id = win._filoTabs.openTab(msg.url || 'filo://newtab/');
    return { ok: true, id };
  });

  // Chiude QUALSIASI scheda per id: un sito non ha mai motivo di chiudere quelle degli altri (la propria passa da CLOSE_TAB).
  on('_tabs:remove', soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    if (win && win._filoTabs) win._filoTabs.closeTab(msg.id);
    return { ok: true };
  }));

  on(MSG.TAB_DOMINANT_COLOR, async (msg, sender) => {
    // Colore dominante campionato dalla pagina → tinge la tab attiva (§1.1).
    const win = winOf(sender);
    if (win && win._filoTabs && sender?.tab?.id) {
      win._filoTabs.setTabColor(sender.tab.id, msg.color || null);
    }
    return { ok: true };
  });

  // Arriva dai content script di Filo, che la pagina non può chiamare: vale solo per la scheda che l'ha mandato.
  on(MSG.PERMESSO_FILO, async (msg, sender) => {
    if (!sender || !sender.tab || !sender.wc) return { ok: false };
    return { ok: require('../permessiPagine').lasciapassare(sender.wc, msg && msg.tipo) };
  });

  // Le scelte ricordate stanno solo nelle pagine di Filo: un sito non le legge e non le cambia.
  on(MSG.PERMESSI_SITI_GET, soloFilo(async () => ({ ok: true, scelte: require('../permessiPagine').scelteRicordate() })));
  on(MSG.PERMESSI_SITI_TOGLI, soloFilo(async (msg) => ({
    ok: require('../permessiPagine').togliScelta(String((msg && msg.origine) || ''), String((msg && msg.parte) || '')),
  })));

  on(MSG.TAB_IN_VISTA_GET, async (msg, sender) => {
    const win = winOf(sender);
    const tabs = win && win._filoTabs;
    if (!tabs || !sender?.tab?.id) return { ok: true, inVista: true };
    return { ok: true, inVista: tabs.inVista(sender.tab.id) };
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

  // Il riordino chiude schede, le manda al modello e costa una chiamata: lo chiede solo un gesto su una pagina di Filo (#589.15).
  on(MSG.RUN_TAB_TRIAGE, soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    if (win && win._filoTabs) {
      const res = await win._filoTabs.runAutoTriage({ trigger: 'manual' });
      return { ok: true, archived: (res && res.archived) || 0 };
    }
    return { ok: false, archived: 0 };
  }));

  // "/riordina" sposta tutta la striscia: stessa porta del riordino con archivio.
  on(MSG.REORDER_TABS, soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    if (win && win._filoTabs) {
      const res = win._filoTabs.reorderTabs();
      return { ok: true, reordered: !!(res && res.reordered) };
    }
    return { ok: false, reordered: false };
  }));

  // #376 — porta in primo piano una scheda già aperta. La usa il riferimento in
  // chat quando Filo ha aperto qualcosa in secondo piano (un brano da
  // ascoltare): cliccarlo deve PORTARCI, non aprire un doppione.
  // Confine d'origine come su nav.js: solo le pagine interne filo:// possono
  // spostare il primo piano — per un sito esterno non è mai legittimo.
  on(MSG.FOCUS_TAB, async (msg, sender, origin) => {
    if (!String(origin || '').startsWith('filo://')) return { ok: false };
    const win = winOf(sender);
    const tm = win && win._filoTabs;
    const id = String(msg?.id || '');
    if (!tm || !id) return { ok: false };
    const exists = (tm.tabs || []).some((t) => t.id === id);
    if (!exists) return { ok: false };
    tm.activate(id);
    return { ok: true };
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

  // L'archivio è la cronologia dell'utente e la cancellazione è definitiva: lo leggono e lo toccano solo le pagine di Filo.
  on(MSG.GET_ARCHIVED_TABS, soloFilo(async () => {
    // listMeta: senza embedding (non spediamo i vettori al renderer).
    return { ok: true, tabs: await ArchivedTabs.listMeta() };
  }));

  on(MSG.SEARCH_ARCHIVED_TABS, soloFilo(async (msg) => searchArchivedTabs(msg.query)));

  // Spende una chiamata al modello per ogni blocco di schede: solo dalle pagine di Filo.
  // L'avanzamento torna solo alla pagina che ha chiesto, col numero della sua richiesta.
  on(MSG.ARCHIVIO_DA_CANCELLARE, soloFilo(async (msg, sender) => archivioDaCancellare(msg && msg.query, {
    avanzamento: (fatte, totali) => {
      const wc = sender && sender.wc;
      if (!wc || wc.isDestroyed()) return;
      wc.send('filo:broadcast', { type: MSG.ARCHIVIO_DA_CANCELLARE_AVANZAMENTO, richiesta: msg && msg.richiesta, fatte, totali });
    },
  })));

  on(MSG.DELETE_ARCHIVED_TABS, soloFilo(async (msg) => {
    const r = await ArchivedTabs.removeMany(msg.ids || []);
    return { ok: true, removed: r.removed, remaining: r.remaining };
  }));

  // Come GET_ARCHIVED_TABS, l'elenco torna senza vettori: con migliaia di schede sarebbero megabyte a ogni cancellazione.
  on(MSG.REMOVE_ARCHIVED_TAB, soloFilo(async (msg) => {
    await ArchivedTabs.remove(msg.id);
    return { ok: true, tabs: await ArchivedTabs.listMeta() };
  }));

  on(MSG.CLEAR_ARCHIVED_TABS, soloFilo(async () => ({ ok: true, tabs: await ArchivedTabs.clear() })));

  on(MSG.REOPEN_ARCHIVED_TAB, async (msg, sender) => {
    // Riapre la scheda archiviata, ripristinando lo scroll registrato.
    const win = winOf(sender);
    if (win && win._filoTabs && msg.url) {
      const pct = typeof msg.scrollPct === 'number' ? msg.scrollPct : null;
      const id = win._filoTabs.openTab(msg.url, { activate: true, restoreScrollPct: pct });
      // Se la tab archiviata era instradata "da un altro paese", riaprila
      // proxata sulla stessa location: setTabProxy ricrea la view nella
      // partition proxata e ricarica l'URL attraverso l'endpoint del paese.
      const px = msg.proxy;
      if (id && px && px.country) {
        try { await win._filoTabs.setTabProxy(id, px.country, { tier: px.tier || undefined }); } catch (_) {}
      }
    }
    return { ok: true };
  });
};
