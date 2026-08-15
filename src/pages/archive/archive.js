// Pagina archivio tab (§3.3): le schede chiuse, raggruppate per giorno e
// ordinate per colore (ordine cromatico), mostrate come chip orizzontali.
// Riapri / elimina via menu contestuale (tasto destro) su ogni chip; svuota
// l'intero archivio dalla toolbar.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  let tabs = [];
  // Quando valorizzato, mostriamo i risultati della ricerca semantica (lista
  // piatta ordinata per pertinenza) invece dell'archivio raggruppato per giorno.
  let semanticResults = null;

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    const r = await chrome.runtime.sendMessage({ type: MSG.GET_ARCHIVED_TABS });
    tabs = (r && r.tabs) || [];
    render();
  }

  // Hue (0..360) del colore identità, per l'ordine cromatico. Le tab senza
  // colore vanno in fondo (hue = Infinity), così i siti colorati guidano l'occhio.
  function hueOf(rgbStr) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
    if (!m) return Infinity;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return Infinity;
    const r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return Infinity; // grigio → niente identità cromatica
    const d = mx - mn;
    let h;
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h / 6) * 360;
  }

  // Tinta identità ATTENUATA per lo sfondo della chip: stessa logica delle tab
  // in alto (§1.2, shell.js) — riduciamo la saturazione al ~18% dell'originale
  // e lasciamo che il CSS (color-mix col neutro di superficie) sposti la
  // luminosità verso il tema. Così una scheda molto satura (es. YouTube rosso)
  // non diventa un blocco acceso ma una tinta sobria e riconoscibile. Ritorna
  // null per grigi/valori non parsabili → la chip usa il neutro.
  function tintOf(rgbStr) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
    if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    const r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    s *= 0.18; // saturazione ridotta al ~18% dell'originale (come §1.2)
    const hue2rgb = (pp, qq, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return pp + (qq - pp) * 6 * t;
      if (t < 1 / 2) return qq;
      if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6;
      return pp;
    };
    let nr, ng, nb;
    if (s === 0) {
      nr = ng = nb = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const pq = 2 * l - q;
      nr = hue2rgb(pq, q, h + 1 / 3);
      ng = hue2rgb(pq, q, h);
      nb = hue2rgb(pq, q, h - 1 / 3);
    }
    return `rgb(${Math.round(nr * 255)}, ${Math.round(ng * 255)}, ${Math.round(nb * 255)})`;
  }

  function dayKey(iso) {
    const d = iso ? new Date(iso) : new Date();
    // Chiave locale YYYY-MM-DD per raggruppare per giorno nel fuso dell'utente.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayLabel(iso) {
    const d = iso ? new Date(iso) : new Date();
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (dayKey(iso) === dayKey(today.toISOString())) return 'Oggi';
    if (dayKey(iso) === dayKey(yest.toISOString())) return 'Ieri';
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function timeLabel(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  // Stato vuoto: il testo di default vale solo per "archivio realmente vuoto".
  // Quando c'è una ricerca attiva senza risultati mostriamo un messaggio
  // dedicato, altrimenti l'elenco svuotato sembra un archivio cancellato.
  const EMPTY_DEFAULT = 'Nessuna tab archiviata, per ora.';
  function showEmpty() {
    const rawQ = ($('search').value || '').trim();
    const el = $('empty');
    el.textContent = tabs.length && rawQ ? `Nessun risultato per "${rawQ}".` : EMPTY_DEFAULT;
    el.hidden = false;
  }

  // Ricerca semantica: embeddizza la query e ordina per pertinenza (lato main).
  async function runSemanticSearch() {
    const q = ($('search').value || '').trim();
    const note = $('searchNote');
    if (!q) { semanticResults = null; note.hidden = true; render(); return; }
    note.hidden = false;
    note.textContent = 'Cerco nei contenuti…';
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.SEARCH_ARCHIVED_TABS, query: q }); } catch (_) {}
    if (!r || !Array.isArray(r.results)) {
      // Niente embedding disponibile (manca la chiave o nessuna tab indicizzata):
      // ripiego sul filtro per sottostringa.
      semanticResults = null;
      note.textContent = 'Ricerca nei contenuti non disponibile: mostro i risultati per testo.';
      render();
      return;
    }
    semanticResults = r.results;
    note.textContent = semanticResults.length
      ? `${semanticResults.length} risultati per pertinenza · "${q}"`
      : `Nessun risultato per "${q}"`;
    render();
  }

  function renderSemantic() {
    const list = $('list');
    list.innerHTML = '';
    if (!semanticResults.length) { showEmpty(); return; }
    $('empty').hidden = true;
    const wrap = document.createElement('div');
    // Risultati per pertinenza: chip compatte che vanno a capo (classe dedicata),
    // non la riga singola scorrevole usata per il raggruppamento per giorno.
    wrap.className = 'arc-results';
    for (const t of semanticResults) wrap.appendChild(renderTab(t, { showScore: true }));
    list.appendChild(wrap);
  }

  function render() {
    if (semanticResults) { renderSemantic(); return; }
    const q = ($('search').value || '').trim().toLowerCase();
    const list = $('list');
    list.innerHTML = '';

    let filtered = tabs;
    if (q) {
      filtered = filtered.filter((t) =>
        `${t.title || ''} ${t.url || ''} ${t.snippet || ''}`.toLowerCase().includes(q));
    }

    if (!filtered.length) {
      showEmpty();
      return;
    }
    $('empty').hidden = true;

    // Raggruppa per giorno (chiave locale), mantenendo i giorni in ordine
    // cronologico decrescente (più recenti in alto).
    const groups = new Map();
    for (const t of filtered) {
      const k = dayKey(t.closedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const orderedDays = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1));

    for (const k of orderedDays) {
      const items = groups.get(k);
      // Ordine cromatico dentro il giorno (arcobaleno); i senza colore in fondo.
      items.sort((a, b) => hueOf(a.identityColor) - hueOf(b.identityColor));

      const day = document.createElement('div');
      day.className = 'arc-day';
      const label = document.createElement('div');
      label.className = 'arc-day-label';
      label.textContent = dayLabel(items[0] && items[0].closedAt);
      day.appendChild(label);

      const wrap = document.createElement('div');
      wrap.className = 'arc-tabs';
      for (const t of items) wrap.appendChild(renderTab(t));
      day.appendChild(wrap);
      list.appendChild(day);
    }
  }

  // Riapre una tab archiviata ripristinando lo scroll registrato (§3.1).
  function reopenTab(t) {
    try {
      chrome.runtime.sendMessage({
        type: MSG.REOPEN_ARCHIVED_TAB,
        url: t.url,
        scrollPct: typeof t.scrollPosition === 'number' ? t.scrollPosition : null,
        // Se la tab era stata aperta "da un altro paese", riaprila proxata
        // sulla stessa location.
        proxy: t.proxy && t.proxy.country ? t.proxy : null,
      });
    } catch (_) {
      try { chrome.tabs.create({ url: t.url }); } catch (_) {}
    }
  }

  async function removeTab(t) {
    await chrome.runtime.sendMessage({ type: MSG.REMOVE_ARCHIVED_TAB, id: t.id });
    tabs = tabs.filter((x) => x.id !== t.id);
    if (semanticResults) semanticResults = semanticResults.filter((x) => x.id !== t.id);
    render();
  }

  // Menu contestuale (tasto destro) con "Riapri"/"Elimina": sostituisce i
  // bottoni sempre visibili, coerente con le chip orizzontali compatte.
  // Riusa le classi .sn-select-pop/.sn-select-option (stesso look degli altri
  // menu di Filo, vedi PATTERNS.md § "Controlli UI custom").
  let openMenu = null;
  function closeCtxMenu() {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onMenuKeydown, true);
    window.removeEventListener('scroll', closeCtxMenu, true);
    window.removeEventListener('resize', closeCtxMenu);
  }
  function onOutsideClick(e) {
    if (openMenu && !openMenu.contains(e.target)) closeCtxMenu();
  }
  function onMenuKeydown(e) {
    if (e.key === 'Escape') closeCtxMenu();
  }
  function openCtxMenu(x, y, t) {
    closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop arc-ctxmenu';
    menu.setAttribute('role', 'menu');

    const reopenOpt = document.createElement('div');
    reopenOpt.className = 'sn-select-option';
    reopenOpt.setAttribute('role', 'menuitem');
    reopenOpt.textContent = 'Riapri';
    reopenOpt.addEventListener('click', () => { closeCtxMenu(); reopenTab(t); });
    menu.appendChild(reopenOpt);

    const delOpt = document.createElement('div');
    delOpt.className = 'sn-select-option';
    delOpt.setAttribute('role', 'menuitem');
    delOpt.textContent = 'Elimina';
    delOpt.addEventListener('click', () => { closeCtxMenu(); removeTab(t); });
    menu.appendChild(delOpt);

    document.body.appendChild(menu);

    // Clamp alla viewport (il menu non deve uscire dal bordo destro/basso).
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;

    openMenu = menu;
    // setTimeout: evita che il mousedown/click che ha aperto il menu lo chiuda
    // subito tramite il listener "outside click".
    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick, true);
      document.addEventListener('keydown', onMenuKeydown, true);
      window.addEventListener('scroll', closeCtxMenu, true);
      window.addEventListener('resize', closeCtxMenu);
    }, 0);
  }

  function renderTab(t, { showScore = false } = {}) {
    const row = document.createElement('div');
    row.className = 'arc-tab';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    if (t.identityColor) {
      row.style.setProperty('--arc-color', t.identityColor);
      // Sfondo della chip = tinta identità attenuata, come le tab in alto.
      const tint = tintOf(t.identityColor);
      if (tint) row.style.setProperty('--arc-tint', tint);
    }

    const titleText = t.title || t.url || '';
    // Tooltip: conserva URL/orario/snippet, non più sempre visibili nella
    // chip compatta ma comunque consultabili al passaggio del mouse.
    const tipParts = [titleText, t.url, timeLabel(t.closedAt)];
    if (t.snippet) tipParts.push(t.snippet);
    row.title = tipParts.filter(Boolean).join('\n');

    const fav = document.createElement('div');
    fav.className = 'arc-fav';
    if (t.favicon) fav.style.backgroundImage = `url("${t.favicon}")`;
    row.appendChild(fav);

    const title = document.createElement('div');
    title.className = 'arc-title';
    title.textContent = titleText;
    row.appendChild(title);

    if (showScore && typeof t.score === 'number') {
      const sc = document.createElement('div');
      sc.className = 'arc-score';
      sc.textContent = `${Math.round(Math.max(0, Math.min(1, t.score)) * 100)}%`;
      row.appendChild(sc);
    }

    // Click sinistro = azione primaria "Riapri" (la chip ha role=button e ne
    // ha l'aspetto: deve rispondere al click come le card di "Aperti per dopo").
    row.addEventListener('click', () => { reopenTab(t); });
    // Tasto destro = menu contestuale (Riapri/Elimina), coerente con la
    // centralità del tasto destro in Filo.
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, t);
    });
    // Tastiera, parità piena con il mouse:
    //  - Invio/Spazio = azione primaria "Riapri" (come il click sinistro);
    //  - Shift+F10 o il tasto Menu = menu contestuale (come il tasto destro).
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        reopenTab(t);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = row.getBoundingClientRect();
        openCtxMenu(r.left, r.bottom, t);
      }
    });

    return row;
  }

  // La rotellina verticale del mouse scrolla in orizzontale la riga di un
  // giorno (le righe .arc-tabs non hanno scroll verticale) — stessa logica
  // della barra delle tab in alto (shell.js §6). Senza questo, con molte schede
  // in un giorno le eccedenti restavano irraggiungibili col solo mouse. Handler
  // delegato su #list: trova la riga sotto il puntatore e scrolla solo se c'è
  // davvero overflow. I risultati della ricerca (.arc-results) vanno a capo e
  // non hanno .arc-tabs, quindi non vengono intercettati.
  function onListWheel(e) {
    const row = e.target.closest && e.target.closest('.arc-tabs');
    if (!row) return;
    if (row.scrollWidth <= row.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!delta) return;
    row.scrollLeft += delta;
    e.preventDefault();
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    // Ripristino da backup: l'archivio del backup compare senza riaprire la
    // scheda. Si esce dai risultati della ricerca semantica, che erano
    // calcolati sull'archivio di prima.
    window.SN_PAGE_BOOTSTRAP.onDataImported(() => {
      semanticResults = null;
      $('searchNote').hidden = true;
      load();
    });
    $('list').addEventListener('wheel', onListWheel, { passive: false });
    // Digitare = filtro testuale immediato (e si esce dalla modalità semantica).
    $('search').addEventListener('input', () => {
      semanticResults = null;
      $('searchNote').hidden = true;
      render();
    });
    // Invio o bottone = ricerca semantica nei contenuti.
    $('search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSemanticSearch(); }
    });
    $('semantic').addEventListener('click', runSemanticSearch);
    $('clear').addEventListener('click', async () => {
      if (!tabs.length) return;
      const text = 'Cancella per sempre tutte le tab archiviate. '
        + 'L’operazione non si può annullare.';
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: 'Svuota archivio', text, okLabel: 'Svuota' })
        : window.confirm(`${text} Procedo?`); // fallback se il modulo non è caricato
      if (!ok) return;
      await chrome.runtime.sendMessage({ type: MSG.CLEAR_ARCHIVED_TABS });
      tabs = [];
      semanticResults = null;
      $('searchNote').hidden = true;
      render();
    });
    $('openHistory').addEventListener('click', () => {
      try { chrome.tabs.create({ url: 'filo://history/history.html' }); } catch (_) {}
    });
    // Simmetria fra le tre liste sorelle: "Aperti per dopo" e "Cronologia AI"
    // rimandano già l'una all'altra e a qui; mancava solo la strada di ritorno
    // da qui verso "Aperti per dopo".
    $('openHome').addEventListener('click', () => {
      try { chrome.tabs.create({ url: 'filo://home/home.html' }); } catch (_) {}
    });
  });
})();
