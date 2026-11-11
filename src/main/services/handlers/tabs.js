// Handler di dominio: ciclo di vita dei tab via shim chrome.tabs, segnali
// colore/attività dal content script, triage manuale e schede archiviate.

const { soloFilo, filoNegatoAllaPagina } = require('./origine');
const { daArchivio } = require('../../tabs/schedeChiuse');
const { LIMITE_CORPO } = require('../testoInviato');

module.exports = function register(on, ctx) {
  const { MSG, winOf, searchArchivedTabs, archivioDaCancellare, contattabilePrimaDelClic } = ctx;
  const ArchivedTabs = globalThis.SN_ARCHIVED_TABS;

  on('_tabs:create', async (msg, sender, origin) => {
    const win = winOf(sender);
    if (!win || !win._filoTabs) return { ok: false };
    // chrome.tabs.create c'è anche nei content script dei siti.
    if (filoNegatoAllaPagina(msg.url, sender, origin)) return { ok: false, code: 'forbidden' };
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

  // Arriva dai content script di Filo, che la pagina non può chiamare: «Incolla» legge qui, e il sito resta senza permesso.
  on(MSG.APPUNTI_DI_FILO, async (_msg, sender) => {
    if (!sender || !sender.tab || !sender.wc) return { ok: false };
    const { clipboard } = require('electron');
    let immagine = '';
    try {
      const voci = await clipboard.read();
      for (const prima of [true, false]) {
        for (const v of voci) {
          const t = v.types.find((x) => (prima ? x === 'image/png' : /^image\//.test(x)));
          if (!t || immagine) continue;
          const b = Buffer.from(await (await v.getType(t)).arrayBuffer());
          if (b.length) immagine = `data:${t};base64,${b.toString('base64')}`;
        }
      }
    } catch (_) {}
    let testo = '';
    try { testo = String((await clipboard.readText()) || ''); } catch (_) {}
    return { ok: true, testo, immagine };
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
    // `riserva`: la home pronta per la scheda nuova (#1128), che aspetta di diventarlo.
    return { ok: true, inVista: tabs.inVista(sender.tab.id), riserva: !!sender.riserva };
  });

  on(MSG.CASELLE_IN_SOSPESO, soloFilo(async (msg, sender) => {
    if (sender && sender.wc) require('../../tabs/chiusuraConCaselle').segna(sender.wc, Boolean(msg && msg.inSospeso));
    return { ok: true };
  }));

  on(MSG.TAB_IDENTITY_COLOR, async (msg, sender) => {
    // Colore identità del sito (§1.2) → cachato per dominio dal TabManager e
    // mescolato col fondo della barra nelle tab inattive.
    const win = winOf(sender);
    if (win && win._filoTabs && sender?.tab?.id) {
      win._filoTabs.setTabIdentityColor(sender.tab.id, msg.color || null);
    }
    return { ok: true };
  });

  on(MSG.RIAPRI_PULIZIA_SCHEDE, soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    if (!win || !win._filoTabs || !Number.isInteger(msg && msg.pulizia)) return { ok: false, error: 'scaduta' };
    return win._filoTabs.riapriPulizia(msg.pulizia);
  }));

  // Il riordino chiude schede, le manda al modello e costa una chiamata: lo chiede solo un gesto su una pagina di Filo (#589.15).
  on(MSG.RUN_TAB_TRIAGE, soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    if (win && win._filoTabs) {
      // Il bottone del riordino in chat dice `da: 'chat'`, come la stessa azione partita senza chiedere.
      const res = await win._filoTabs.runAutoTriage({ trigger: 'manual', da: msg && msg.da === 'chat' ? 'chat' : '' });
      return {
        ok: true,
        archived: (res && res.archived) || 0,
        // Chi ha chiesto il riordino deve poter distinguere «non c'era niente
        // da archiviare» da «il riordino non è partito».
        giudizioMancato: !!(res && res.giudizioMancato),
        giaInCorso: !!(res && res.giaInCorso),
        incognito: !!(res && res.incognito),
        error: globalThis.SN_TAB_TRIAGE ? globalThis.SN_TAB_TRIAGE.riordinoNonRiuscito({ ...(res || {}), ok: !!res }) : '',
      };
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

  // Porta in primo piano una scheda già aperta, invece di aprire un doppione.
  // Solo pagine filo://: spostare il primo piano non è mai legittimo per un sito esterno.
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

  // #2084 — una scheda trascinata sopra un riquadro incorporato in un sito: il frame di sopra dice dove, il main la porta.
  on(MSG.SCHEDA_NEL_RIQUADRO, async (msg, sender) => {
    if (!sender || sender.strato || !sender.frame) return { ok: false };
    const win = winOf(sender);
    return { ok: require('../../schedaTrascinata').nelRiquadro(win, sender.wc, sender.frame, msg) };
  });

  // #2085 — il gettone di una scheda in una chat (home, Aiuto anche nello strato sopra un sito): la carta dell'anteprima
  // sotto il gettone, e il clic che porta davanti la scheda se è ancora aperta, o ne riapre l'indirizzo.
  on(MSG.GETTONE_SCHEDA, async (msg, sender) => {
    const win = winOf(sender);
    const tm = win && win._filoTabs;
    if (!tm || !msg) return { ok: false };
    const Carta = require('../../popup-anteprima');
    if (msg.op === 'nascondi') { Carta.nascondi(win); return { ok: true }; }
    const s = globalThis.SN_SCHEDE_IN_CHAT && globalThis.SN_SCHEDE_IN_CHAT.normalizza(msg.scheda);
    if (!s) return { ok: false };
    const stessa = (t) => !!t && String(t.url || '') === s.url;
    const perId = s.id ? tm.tabs.find((t) => t.id === s.id) : null;
    const viva = (stessa(perId) ? perId : null) || tm.tabs.find(stessa) || null;
    if (msg.op === 'apri') {
      Carta.nascondi(win);
      if (viva) tm.activate(viva.id);
      else tm.openTab(s.url);
      return { ok: true, riaperta: !viva };
    }
    if (msg.op !== 'anteprima') return { ok: false };
    const r = msg.rect && typeof msg.rect === 'object' ? msg.rect : null;
    const vista = vistaDelMittente(tm, sender);
    if (!r || !vista) return { ok: false };
    const x = vista.b.x + Number(r.x) * vista.zoom;
    const y = vista.b.y + (Number(r.y) + Number(r.h)) * vista.zoom + 4;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
    const dati = { x, y, misura: 'media', titolo: s.titolo };
    Carta.mostra(win, viva ? { ...dati, id: viva.id } : { ...dati, id: s.id, chiusa: { titolo: s.titolo, url: s.url } });
    return { ok: true };
  });

  // La vista da cui parla una pagina, nella finestra: la scheda, o lo strato dei riquadri sopra di lei.
  function vistaDelMittente(tm, sender) {
    const wc = sender && sender.wc;
    const tab = wc && tm.tabs.find((t) => t.view && t.view.webContents === wc);
    if (!tab) return null;
    return require('../../schedaTrascinata').cornice(tm, tab, !!sender.strato);
  }

  on(MSG.TAB_ACTIVITY, async (msg, sender) => {
    // Segnali di attività della tab (§2.1) → merge sullo snapshot.
    const win = winOf(sender);
    if (win && win._filoTabs && sender?.tab?.id) {
      win._filoTabs.setTabActivity(sender.tab.id, {
        lastInteractionAt: msg.lastInteractionAt,
        scrollPct: msg.scrollPct,
        formDirty: msg.formDirty,
        impronte: msg.impronte,
        invioPagina: msg.invioPagina === true,
        pwPrima: msg.pwPrima === true,
        invioRiquadro: typeof msg.invioRiquadro === 'string' ? msg.invioRiquadro.slice(0, 4096) : '',
        titoloPrima: typeof msg.titoloPrima === 'string' ? msg.titoloPrima.slice(0, 512) : '',
        collegamento: typeof msg.collegamento === 'string' ? msg.collegamento.slice(0, LIMITE_CORPO) : '',
        collegamentoRespinto: typeof msg.collegamentoRespinto === 'string' ? msg.collegamentoRespinto.slice(0, LIMITE_CORPO) : '',
      }, sender.frame);
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
    tutto: !!(msg && msg.tutto === true),
    avanzamento: (fatte, totali) => {
      const wc = sender && sender.wc;
      if (!wc || wc.isDestroyed()) return;
      wc.send('filo:broadcast', { type: MSG.ARCHIVIO_DA_CANCELLARE_AVANZAMENTO, richiesta: msg && msg.richiesta, fatte, totali });
    },
  })));

  // Una scheda chiusa eliminata se ne va anche dal filo, o la home la mostrerebbe ancora e la sua ricerca la ritroverebbe (#869).
  const ancheDalFilo = async (scelta) => {
    const schede = (await ArchivedTabs.list()).filter(scelta);
    return async () => { try { await require('../codaFilo').togliSchedeChiuse(schede); } catch (_) {} };
  };

  on(MSG.DELETE_ARCHIVED_TABS, soloFilo(async (msg) => {
    const ids = new Set(Array.isArray(msg.ids) ? msg.ids : []);
    const poi = await ancheDalFilo((t) => ids.has(t.id));
    const r = await ArchivedTabs.removeMany([...ids]);
    await poi();
    return { ok: true, removed: r.removed, remaining: r.remaining };
  }));

  // Come GET_ARCHIVED_TABS, l'elenco torna senza vettori: con migliaia di schede sarebbero megabyte a ogni cancellazione.
  on(MSG.REMOVE_ARCHIVED_TAB, soloFilo(async (msg) => {
    const poi = await ancheDalFilo((t) => t.id === msg.id);
    await ArchivedTabs.remove(msg.id);
    await poi();
    return { ok: true, tabs: await ArchivedTabs.listMeta() };
  }));

  on(MSG.CLEAR_ARCHIVED_TABS, soloFilo(async () => {
    const poi = await ancheDalFilo(() => true);
    const tabs = await ArchivedTabs.clear();
    await poi();
    return { ok: true, tabs };
  }));

  // Solo le pagine di Filo: a un sito direbbe quali siti hai aperto, salvato o archiviato, e gli farebbe chiedere al main un indirizzo qualunque.
  on(MSG.ICONA_SITO, soloFilo(async (msg, sender) => {
    const { BrowserWindow, session } = require('electron');
    const incognito = !!(sender && sender.isIncognito);
    const schede = [];
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs && !!w._filoIncognito === incognito) schede.push(...w._filoTabs.tabs);
    }
    const voci = async () => [...await globalThis.SN_SAVED_PAGES.list(), ...await ArchivedTabs.list()];
    const ses = (sender && sender.wc && sender.wc.session) || session.defaultSession;
    // Un indirizzo che al clic chiede l'OK (#848, #1505): né il suggerimento né la sua icona contattano il sito prima.
    const url = msg && msg.url;
    const soloCopie = (msg && msg.soloCopie === true) || !(await contattabilePrimaDelClic(url, { daFilo: true, proposta: !!(msg && msg.proposta === true) }));
    const dato = await require('../iconeSiti').cercaIconaSito(msg && msg.url, { ses, schede, voci, incognito, soloCopie });
    return { ok: true, dato };
  }));

  // Riapre una scheda chiusa com'era: lo scroll e il paese da cui passava. Dal #872 la chiede la ricerca del filo con
  // l'id della voce d'archivio, e indirizzo, scroll e paese li legge il main; solo le pagine di Filo.
  function contaRiaperta(voce, win) {
    try { globalThis.SN_CONTATORI_MAIN?.riaperta(voce, { incognito: !!(win && win._filoIncognito) }); } catch (_) {}
  }
  on(MSG.REOPEN_ARCHIVED_TAB, soloFilo(async (msg, sender) => {
    const win = winOf(sender);
    let voce = null;
    if (msg && typeof msg.id === 'string' && msg.id) {
      try { voce = (await ArchivedTabs.list()).find((t) => t.id === msg.id) || null; } catch (_) {}
      if (!voce) return { ok: false, error: 'not_found' };
      // Un indirizzo tagliato alla misura (#1525) porterebbe altrove: chi chiede apre il sito, e la riapertura conta.
      if (voce.urlTagliato) { contaRiaperta(voce, win); return { ok: false, error: 'url_tagliato' }; }
    } else if (msg && msg.perIndirizzo === true) {
      // Una pagina del filo senza la sua voce (una visita): se è una scheda chiusa, si riapre da lì.
      try { voce = await ArchivedTabs.ultimaPer(msg.url); } catch (_) {}
      if (!voce) return { ok: false, error: 'not_found' };
    }
    const url = voce ? voce.url : msg.url;
    if (win && win._filoTabs && typeof url === 'string' && /^(https?|file):/i.test(url)) {
      // Scroll e paese come li aveva: la stessa porta di Ctrl+Shift+T, che dopo questa non la riapre di nuovo.
      if (voce) await win._filoTabs.riapriDallArchivio(voce);
      else await win._filoTabs.riapri(daArchivio({ url, scrollPosition: msg.scrollPct, proxy: msg && msg.proxy }));
    }
    return { ok: true };
  }));
};
