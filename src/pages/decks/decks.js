// App deck builder Commander (DECK-BUILDER-SPEC.md): routing a tre schermate
// (Mazzi / Builder / Partita stub), libreria, layout del Builder a tre colonne
// FISSE con divisori trascinabili persistiti (§2), header-switcher del mazzo
// (§8.2), chat unificata (§3) e pannello destro a tre stati (§5: statistiche /
// preview su hover / carosello di triage). Le statistiche vere e i moduli del
// detail arrivano coi task successivi.
//
// Routing su hash:  #/            → libreria (home)
//                   #/deck/<id>   → builder del mazzo
//                   #/game        → partita (stub)

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const Decks = window.SN_DECKS;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function send(msg) { return chrome.runtime.sendMessage(msg); }

  let decks = [];        // cache della lista per la libreria
  let current = null;    // mazzo aperto nel builder

  // ── Layout del Builder (§2): larghezze delle colonne ───────────────────────
  // Tre colonne a larghezza FISSA: nessun resize automatico, mai. L'unico
  // resize ammesso è il trascinamento deliberato dei due divisori; le larghezze
  // finiscono in chrome.storage.local e sopravvivono alla riapertura.
  const LAYOUT_KEY = window.SN_CONST.STORAGE_KEYS.DECKS_UI;
  // Colonne esterne FISSE (chat a sinistra, dettaglio a destra), colonna del
  // MAZZO al centro flessibile (assorbe lo spazio in più). `rightW` sostituisce
  // il vecchio `centerW`: prima il centro era il mazzo a larghezza fissa e la
  // destra il "resto"; ora è il contrario, così il dettaglio (anteprima carta)
  // resta di dimensione sana anche a piena larghezza.
  const LAYOUT_DEFAULT = { leftW: 340, rightW: 340, module: 'default' };
  const LAYOUT_MIN = { leftW: 260, rightW: 280 };
  const CENTER_MIN = 260; // il mazzo (colonna flessibile) non deve sparire
  let layout = { ...LAYOUT_DEFAULT };

  // Larghezze EFFETTIVE da mettere nel grid: partono dalle preferenze salvate
  // (`layout`) ma vengono ristrette allo spazio realmente disponibile, così la
  // colonna centrale del mazzo mantiene sempre almeno CENTER_MIN anche quando
  // la finestra si rimpicciolisce o si riapre un mazzo con larghezze salvate
  // più grandi dello schermo corrente. NON tocca `layout` (le preferenze
  // restano intatte): allargando di nuovo la finestra tornano le misure scelte.
  // Il calcolo (restringi le esterne, salva il minimo del centro, mai sotto i
  // minimi) è lo STESSO della dashboard di gestione: vive in SN_PANE_LAYOUT,
  // logica pura con unit test.
  function effectiveWidths() {
    const grid = $('builderGrid');
    const avail = (grid && grid.clientWidth) || window.innerWidth || 0;
    const { left, right } = window.SN_PANE_LAYOUT.fitWidths({
      avail, gutters: 12,
      left: layout.leftW, right: layout.rightW,
      minLeft: LAYOUT_MIN.leftW, minRight: LAYOUT_MIN.rightW, minCenter: CENTER_MIN,
    });
    return { leftW: left, rightW: right };
  }

  function applyLayout() {
    const grid = $('builderGrid');
    if (!grid) return;
    const { leftW, rightW } = effectiveWidths();
    // minmax(0, 1fr) sul centro: la colonna del mazzo può stringersi fino a 0
    // invece di forzare la larghezza minima del contenuto e far traboccare le
    // colonne laterali fuori dal riquadro (testo sovrapposto).
    grid.style.gridTemplateColumns =
      `${leftW}px 6px minmax(0, 1fr) 6px ${rightW}px`;
  }

  async function loadLayout() {
    try {
      const res = await chrome.storage.local.get(LAYOUT_KEY);
      const saved = res && res[LAYOUT_KEY];
      if (saved && typeof saved === 'object') {
        layout.leftW = Math.max(LAYOUT_MIN.leftW, Number(saved.leftW) || LAYOUT_DEFAULT.leftW);
        // Migrazione: i layout salvati prima avevano `centerW` (larghezza del
        // mazzo, ora flessibile). Se manca `rightW`, riparti dal default.
        layout.rightW = Math.max(LAYOUT_MIN.rightW, Number(saved.rightW) || LAYOUT_DEFAULT.rightW);
        if (DETAIL_MODULES[saved.module]) layout.module = saved.module;
      }
    } catch (_) {}
    applyLayout();
  }

  function persistLayout() {
    chrome.storage.local.set({ [LAYOUT_KEY]: { ...layout } }).catch?.(() => {});
  }

  // Trascinamento dei divisori: aggiorna la larghezza live, persiste al rilascio.
  // `computeW(ev)` ritorna la larghezza desiderata della colonna dal cursore;
  // oltre al minimo della colonna, si clampa perché il mazzo (colonna centrale
  // flessibile) mantenga sempre almeno CENTER_MIN.
  function wireDivider(el, prop, computeW) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      el.classList.add('dragging');
      const move = (ev) => {
        const rect = $('builderGrid').getBoundingClientRect();
        const other = prop === 'leftW' ? layout.rightW : layout.leftW;
        const maxW = Math.max(LAYOUT_MIN[prop], rect.width - 12 - other - CENTER_MIN);
        let w = Math.round(computeW(ev, rect));
        w = Math.min(maxW, Math.max(LAYOUT_MIN[prop], w));
        if (w !== layout[prop]) { layout[prop] = w; applyLayout(); }
      };
      const up = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persistLayout();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function wireDividers() {
    // Colonna sinistra (chat): dal bordo sinistro del grid al cursore.
    wireDivider($('dividerLeft'), 'leftW', (ev, rect) => ev.clientX - rect.left);
    // Colonna destra (dettaglio): dal cursore al bordo destro del grid,
    // meno la larghezza del divisore.
    wireDivider($('dividerRight'), 'rightW', (ev, rect) => rect.right - ev.clientX - 6);
  }

  // ── Routing ────────────────────────────────────────────────────────────────

  function parseRoute() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const mDeck = /^\/deck\/(.+)$/.exec(h);
    if (mDeck) return { screen: 'builder', id: decodeURIComponent(mDeck[1]) };
    if (/^\/game/.test(h)) return { screen: 'game' };
    return { screen: 'library' };
  }

  function show(screen) {
    $('screenLibrary').hidden = screen !== 'library';
    $('screenBuilder').hidden = screen !== 'builder';
    $('screenGame').hidden = screen !== 'game';
    // Solo il builder esce dal max-width di .sn-page per usare tutta la
    // larghezza; libreria e partita restano centrate e leggibili.
    document.body.classList.toggle('dk-full', screen === 'builder');
    // Il grid ha larghezza reale solo da visibile: ri-clampa ora, così un mazzo
    // riaperto con larghezze salvate più grandi dello spazio corrente non fa
    // sparire la colonna centrale.
    if (screen === 'builder') applyLayout();
  }

  async function route() {
    const r = parseRoute();
    if (r.screen === 'builder') {
      const res = await send({ type: MSG.DECKS_GET, id: r.id });
      if (!res || !res.ok) { location.hash = '#/'; return; }
      const prevId = current && current.id;
      current = res.deck;
      // Cambio di mazzo/schermata: il pannello destro riparte dal riposo.
      // I pareri sono per-mazzo (§6.2): cambiando mazzo la cache di pagina si svuota.
      if (prevId !== current.id) opinionsByCard.clear();
      carousel = null;
      setDetailState('stats');
      show('builder');
      await renderBuilder(true); // apertura: la chat parte dall'ultimo scambio
      return;
    }
    if (r.screen === 'game') { show('game'); return; }
    current = null;
    await loadLibrary();
    show('library');
  }

  // ── Libreria (§10) ─────────────────────────────────────────────────────────

  async function loadLibrary() {
    const res = await send({ type: MSG.DECKS_LIST });
    decks = Decks.sortForLibrary((res && res.decks) || []);
    renderLibrary();
  }

  function pipsHtml(deck) {
    const colors = (deck.commanderMeta && Array.isArray(deck.commanderMeta.colors))
      ? deck.commanderMeta.colors : [];
    if (!colors.length) return '';
    const order = ['W', 'U', 'B', 'R', 'G'];
    const dots = order.filter((c) => colors.includes(c))
      .map((c) => `<span class="dk-pip" data-c="${c}"></span>`).join('');
    return `<span class="dk-pips" title="Colori del commander">${dots}</span>`;
  }

  function deckCardHtml(deck) {
    const art = deck.commanderMeta && deck.commanderMeta.artCrop;
    const thumb = art
      ? `<div class="dk-thumb" style="background-image:url('${esc(art)}')"></div>`
      : `<div class="dk-thumb">🂠</div>`;
    const when = new Date(deck.updated_at);
    const dateStr = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    return `
      <div class="sn-card" data-deck-id="${esc(deck.id)}" tabindex="0" role="button"
           aria-label="Apri il mazzo ${esc(deck.nome)}">
        ${thumb}
        <div class="sn-card-body">
          <div class="sn-card-title">${esc(deck.nome)}</div>
          <div class="dk-meta">
            ${pipsHtml(deck)}
            <span>${Decks.deckCount(deck)}/100</span>
            <span style="margin-left:auto">${esc(dateStr)}</span>
          </div>
        </div>
      </div>`;
  }

  function renderLibrary() {
    const grid = $('deckGrid');
    grid.innerHTML = decks.map(deckCardHtml).join('');
    $('deckEmpty').hidden = decks.length > 0;
  }

  // ── Menu contestuale sulla card (duplica / elimina) ────────────────────────
  // Stesso pattern dell'archivio: popup .sn-select-pop posizionato fixed alle
  // coordinate del click, chiuso al primo click fuori / Escape.

  let ctxEl = null;
  function closeCtx() {
    if (ctxEl) { ctxEl.remove(); ctxEl = null; }
    document.removeEventListener('click', closeCtx, true);
    document.removeEventListener('keydown', ctxKey, true);
  }
  function ctxKey(e) { if (e.key === 'Escape') closeCtx(); }

  function openCtx(x, y, items) {
    closeCtx();
    const pop = document.createElement('div');
    pop.className = 'sn-select-pop dk-ctxmenu';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'sn-select-option';
      row.textContent = it.label;
      row.addEventListener('click', (e) => { e.stopPropagation(); closeCtx(); it.run(); });
      pop.appendChild(row);
    }
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    pop.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    ctxEl = pop;
    setTimeout(() => {
      document.addEventListener('click', closeCtx, true);
      document.addEventListener('keydown', ctxKey, true);
    }, 0);
  }

  async function duplicateDeck(id) {
    const res = await send({ type: MSG.DECKS_DUPLICATE, id });
    if (res && res.ok) await loadLibrary();
  }

  async function deleteDeck(id) {
    const deck = decks.find((d) => d.id === id);
    const ok = await window.SN_CONFIRM_UI.confirm({
      title: 'Eliminare il mazzo?',
      text: `"${deck ? deck.nome : ''}" verrà eliminato definitivamente.`,
      okLabel: 'Elimina',
    });
    if (!ok) return;
    await send({ type: MSG.DECKS_DELETE, id });
    await loadLibrary();
  }

  // ── Builder: identità del documento + switcher (§8.2) ──────────────────────

  // Budget nell'intestazione e nel campo di modifica: formato italiano come
  // tutti gli altri prezzi dell'app (virgola decimale), interi senza decimali
  // («100», «40,50» — non «40.5»).
  function fmtBudgetShort(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  }
  function fmtBudgetInput(b) {
    return (b === null || b === undefined) ? '' : fmtBudgetShort(b);
  }

  // `stickChat`: all'apertura del mazzo la chat mostra l'ultimo scambio (fondo);
  // nei refresh dopo una modifica si rispetta invece la posizione dell'utente.
  async function renderBuilder(stickChat) {
    $('deckNameText').textContent = current.nome;
    const commander = (current.commanderMeta && current.commanderMeta.name)
      ? `Commander: ${current.commanderMeta.name}`
      : 'Nessun commander — impostalo col tasto destro su una carta del mazzo.';
    const budget = (current.budget !== null && current.budget !== undefined)
      ? ` · Budget: ${fmtBudgetShort(current.budget)} €` : '';
    $('commanderLine').textContent = commander + budget;
    // Suggerisce, senza ingombrare, come tornare indietro (feedback #302).
    $('commanderLine').title = current.commander
      ? 'Tasto destro per rimuovere il commander' : '';
    $('deckCount').textContent = `${Decks.deckCount(current)}/100 carte`;
    // Cache-first: l'elenco compare SUBITO coi campi statici già in cache (le
    // carte del mazzo sono state risolte quando sono entrate). I prezzi freschi
    // arrivano dopo, in background, senza far aspettare le carte (feedback #380).
    await Promise.all([ensureSymbols(), loadDeckCards()]);
    refreshOpinionStaleness();
    renderDeckList();
    renderChat(stickChat);
    renderStats();
    refreshPrices();
  }

  async function saveDeck(next) {
    if (next === current) return;
    const res = await send({ type: MSG.DECKS_UPDATE, deck: next });
    if (res && res.ok) { current = res.deck; await renderBuilder(); }
  }

  // La versione del mazzo è avanzata (edit): i pareri calcolati su versioni
  // precedenti diventano stantii SUL POSTO (§6.2) — restano visibili, marcati.
  function refreshOpinionStaleness() {
    for (const op of opinionsByCard.values()) {
      op.stale = (Number(op.versione) || 0) < (Number(current.versione) || 1);
    }
  }

  // ── Colonna mazzo (§8.1): dati carta, gruppi collassabili, righe ───────────

  let cardsById = {};      // scryfall_id → carta semplificata (cache di pagina)
  let symbolsMap = null;   // '{U}' → svg_uri (symbology, chiesta una volta)
  const preloadedImgs = new Set(); // URL immagini già scaldate nella cache HTTP
  const collapsedGroups = new Set();
  const VIEW_LABEL = { tipo: 'tipo', tag: 'tag', cmc: 'costo', colore: 'colore' };

  async function ensureSymbols() {
    if (symbolsMap) return;
    const r = await send({ type: MSG.SCRYFALL_SYMBOLS });
    symbolsMap = (r && r.ok && r.symbols) || {};
  }

  // Carica i dati carta del mazzo. DUE modalità, per azzerare l'attesa
  // all'apertura ("L'ATTESA è ATTRITO"):
  //   - default (cache-first): chiede solo dalla cache i campi STATICI (nomi,
  //     tipi, costi, colori — non scadono mai), così l'elenco del mazzo compare
  //     SUBITO senza aspettare la rete. È il primo giro all'apertura.
  //   - freshPrices: rifetcha i PREZZI stantii (TTL 6h, §9.2) — serializzato e
  //     lento su un mazzo intero, quindi gira in BACKGROUND (refreshPrices),
  //     mai bloccando la comparsa delle carte.
  async function loadDeckCards({ freshPrices = false } = {}) {
    const ids = current.carte.map((c) => c.scryfall_id);
    if (current.commander) ids.push(current.commander);
    if (!ids.length) return;
    const r = await send({ type: MSG.SCRYFALL_CARDS, ids, freshPrices });
    // MERGE, mai sostituzione: la cache di pagina contiene anche le carte dei
    // risultati chat (sendChat) e dei nomi in prosa risolti (resolveProseCard).
    // Le bolle chat vivono per tutta la pagina (chatByDeck): dopo un edit del
    // mazzo l'hover su quei risultati deve continuare ad aprire la preview.
    Object.assign(cardsById, (r && r.ok && r.cards) || {});
  }

  // Refresh dei prezzi in background (§9.2): sull'apertura il mazzo compare
  // subito coi dati di cache (prezzi eventualmente stantii); qui si rifetchano
  // i prezzi freschi SENZA bloccare e, quando arrivano, si riaggiornano le
  // sole parti che dipendono dal prezzo (righe del mazzo, budget/statistiche).
  // Il token invalida un refresh in corso se nel frattempo si è cambiato mazzo
  // (altra apertura), così non si sovrascrive una vista diversa.
  let priceRefreshToken = 0;
  async function refreshPrices() {
    if (!current || !current.carte.length) return;
    const token = ++priceRefreshToken;
    const deckId = current.id;
    await loadDeckCards({ freshPrices: true });
    if (token !== priceRefreshToken || !current || current.id !== deckId) return;
    renderDeckList();
    renderStats();
  }

  function manaHtml(cost) {
    return window.SN_SCRYFALL_Q.parseManaCost(cost).map((s) => {
      const uri = symbolsMap && symbolsMap[`{${s}}`];
      return uri
        ? `<img class="dk-mana" src="${esc(uri)}" alt="${esc(s)}" />`
        : `<span>${esc(s)}</span>`;
    }).join('');
  }

  function rowHtml({ entry, card }) {
    const name = card ? card.name : entry.scryfall_id;
    const qty = entry.qty > 1 ? `<span class="dk-row-qty">${entry.qty}×</span>` : '';
    const price = card && card.priceEur != null
      ? `${card.priceEur.toFixed(2).replace('.', ',')} €` : '';
    const mana = card ? manaHtml(card.manaCost) : '';
    return `
      <div class="dk-row" data-card-id="${esc(entry.scryfall_id)}" tabindex="0" draggable="true">
        ${qty}<span class="dk-row-name">${esc(name)}</span>
        <span class="dk-row-price">${esc(price)}</span>
        <span class="dk-row-mana">${mana}</span>
      </div>`;
  }

  // Precarico immagini (§5.1 / "L'ATTESA è ATTRITO"): appena le righe carta sono
  // visibili scaldiamo la cache HTTP del browser con le loro immagini, così il
  // primo hover mostra la carta all'istante invece di attendere la rete. Warm
  // via `new Image()` a priorità bassa (non ruba banda ad altro); l'ordine di
  // assegnazione = ordine di lettura, quindi la prima riga — quella che l'utente
  // più probabilmente aprirà — parte per prima. Dedup per URL: mai due fetch.
  function preloadImage(url) {
    if (!url || preloadedImgs.has(url)) return;
    preloadedImgs.add(url);
    const img = new Image();
    try { img.fetchPriority = 'low'; } catch { /* non supportato: irrilevante */ }
    img.decoding = 'async';
    img.src = url;
  }
  function preloadCardImages(ids) {
    for (const id of ids) {
      const card = cardsById[id];
      if (card && card.image) preloadImage(card.image);
      // Retro delle bifronte: scaldato insieme al fronte → il flip è istantaneo.
      if (card && card.backImage) preloadImage(card.backImage);
    }
  }
  // Le righe carta VISIBILI ora: tutto il mazzo (elenco limitato, ~100 carte) +
  // solo le liste risultati APERTE (una lista incollata può avere centinaia di
  // righe collassate: si scaldano quando l'utente le espande, non prima).
  function preloadVisibleCards() {
    const rows = [
      ...document.querySelectorAll('#deckList .dk-row[data-card-id]'),
      ...document.querySelectorAll('.dk-cardlist:not([hidden]) .dk-row[data-card-id]'),
    ];
    preloadCardImages(rows.map((r) => r.dataset.cardId));
  }

  function renderDeckList() {
    $('deckListEmpty').hidden = current.carte.length > 0;
    $('groupBy').textContent = `per ${VIEW_LABEL[current.raggruppamento] || 'tipo'} ▾`;
    const groups = Decks.groupDeck(current, cardsById);
    $('deckList').innerHTML = groups.map((g) => {
      const closed = collapsedGroups.has(g.name);
      return `
      <div class="dk-group" data-group="${esc(g.name)}">
        <div class="dk-group-head" data-g="${esc(g.name)}">
          <span>${closed ? '▸' : '▾'}</span><span>${esc(g.name)}</span>
          <span class="dk-group-n">${g.entries.reduce((n, x) => n + Math.max(1, Number(x.entry && x.entry.qty) || 1), 0)}</span>
        </div>
        <div class="dk-group-rows" ${closed ? 'hidden' : ''}>
          ${g.entries.map(rowHtml).join('')}
        </div>
      </div>`;
    }).join('');
    renderLegality();
    syncCarouselHighlight();
    preloadVisibleCards();
  }

  // Riepilogo di legalità (§8.4) sotto il conteggio: compare SOLO quando c'è
  // un problema (doppioni / identity / banned). Il pannello statistiche
  // completo arriva col suo task; i check devono esserci già.
  function renderLegality() {
    const el = $('deckLegality');
    const r = Decks.legalityChecks(current, cardsById);
    const parts = [];
    if (!r.singleton.ok) parts.push(`doppioni: ${r.singleton.violations.join(', ')}`);
    if (!r.identity.ok) parts.push(`fuori dai colori del commander: ${r.identity.violations.join(', ')}`);
    if (!r.banned.ok) parts.push(`bandite in Commander: ${r.banned.violations.join(', ')}`);
    el.hidden = !parts.length;
    el.textContent = parts.length ? `⚠ ${parts.join(' · ')}` : '';
  }

  // ── Statistiche (§9): stato di riposo del pannello destro ──────────────────
  // Tutto calcolato in pagina da (current, cardsById) via SN_DECK_STATS (logica
  // pura): curva CMC, colori richiesti/prodotti, composizione, legalità,
  // budget. Rirenderizzate ad ogni renderBuilder (ogni edit del mazzo ci passa).

  const Stats = window.SN_DECK_STATS;
  const COLOR_LABEL = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde', C: 'Incolore' };

  function fmtEur(n) { return `${n.toFixed(2).replace('.', ',')} €`; }

  function renderCurve(curve) {
    const max = Math.max(1, ...curve.map((b) => b.n));
    $('statCurve').innerHTML = curve.map((b) => `
      <div class="dk-curve-col" data-cmc="${esc(b.label)}" data-n="${b.n}"
           title="${b.n} cart${b.n === 1 ? 'a' : 'e'} a costo ${esc(b.label)}">
        <span class="dk-curve-n">${b.n || ''}</span>
        <div class="dk-curve-bar" style="height:${Math.round((b.n / max) * 48)}px"></div>
        <span class="dk-curve-label">${esc(b.label)}</span>
      </div>`).join('');
  }

  function renderColors(pips, produced) {
    const rows = ['W', 'U', 'B', 'R', 'G', 'C']
      .filter((c) => (pips[c] || 0) > 0 || (produced[c] || 0) > 0);
    const maxPip = Math.max(1, ...rows.map((c) => pips[c] || 0));
    const maxProd = Math.max(1, ...rows.map((c) => produced[c] || 0));
    const cell = (n, max) => `
      <span class="dk-color-cell">
        <span class="dk-color-bar" style="width:${Math.round((n / max) * 100)}%"></span>
        <span class="dk-color-n">${n}</span>
      </span>`;
    $('statColors').innerHTML = rows.length ? `
      <div class="dk-color-head"><span></span><span>richiesto</span><span>prodotto</span></div>
      ${rows.map((c) => `
        <div class="dk-color-row" data-color="${c}" title="${esc(COLOR_LABEL[c])}: ${pips[c] || 0} pip nei costi, ${produced[c] || 0} fonti">
          <span class="dk-pip" data-c="${c}"></span>
          ${cell(pips[c] || 0, maxPip)}
          ${cell(produced[c] || 0, maxProd)}
        </div>`).join('')}`
      : '<p class="dk-stat-sub">Nessun costo colorato né fonte di mana, per ora.</p>';
  }

  function renderStatLegality() {
    const r = Decks.legalityChecks(current, cardsById);
    const row = (key, label, chk) => `
      <div class="dk-leg-row" data-check="${key}" data-ok="${chk.ok ? 1 : 0}">
        <span class="dk-leg-mark">${chk.ok ? '✓' : '✗'}</span>
        <span>${label}${chk.ok ? '' : `: ${esc(chk.violations.join(', '))}`}</span>
      </div>`;
    $('statLegality').innerHTML =
      row('singleton', 'Singleton', r.singleton) +
      row('identity', 'Colori del commander', r.identity) +
      row('banned', 'Nessuna carta bandita', r.banned);
  }

  function renderBudget() {
    const b = Stats.budgetInfo(current, cardsById);
    const rows = [`
      <div class="dk-budget-row" data-b="total">
        <span>Totale mazzo</span><span class="dk-budget-n">${fmtEur(b.total)}</span>
      </div>`];
    if (b.budget !== null) {
      rows.push(`
        <div class="dk-budget-row" data-b="cap">
          <span>Tetto</span><span class="dk-budget-n">${fmtEur(b.budget)}</span>
        </div>
        <div class="dk-budget-row" data-b="residuo" data-over="${b.residuo < 0 ? 1 : 0}">
          <span>Residuo</span><span class="dk-budget-n">${fmtEur(b.residuo)}</span>
        </div>`);
    } else {
      rows.push('<p class="dk-stat-sub">Nessun tetto: impostalo dal menu del mazzo (click sul nome) o in chat ("budget 40 euro").</p>');
    }
    if (b.missing) rows.push(`<p class="dk-stat-sub">${b.missing} cart${b.missing === 1 ? 'a' : 'e'} senza prezzo noto.</p>`);
    $('statBudget').innerHTML = rows.join('');
  }

  // Sotto-pannello probabilità (§9.3): una riga-input per categoria (tag del
  // mazzo + "terre"). I valori già digitati sopravvivono al rerender.
  function renderProbForm() {
    const cats = Stats.categoriesOf(current, cardsById);
    const host = $('probNeeds');
    const prev = {};
    for (const inp of host.querySelectorAll('input[data-tag]')) {
      prev[inp.dataset.tag] = inp.value;
    }
    host.innerHTML = cats.map((tag, i) => `
      <div class="dk-prob-row">
        <label for="probTag${i}">${esc(tag)}</label>
        <input id="probTag${i}" data-tag="${esc(tag)}" type="number"
               min="0" max="99" step="1" value="${esc(prev[tag] || '0')}" />
      </div>`).join('');
    $('probHint').hidden = cats.length > 1;
    $('probCard').hidden = !cats.length;
  }

  // Calcolatore di probabilità (§9.3): la stima si raffina DA SOLA (feedback
  // #354). Appena cambiano le condizioni (turno, categorie richieste, o il mazzo
  // stesso) riparte una simulazione progressiva: un primo batch dà subito una
  // stima, i batch successivi si accumulano e la fanno convergere verso il vero
  // valore, poi si ferma. Niente più bottone "Calcola" né oscillazione del
  // risultato tra un ricalcolo e l'altro.
  //
  //   PROB_BATCH  simulazioni per giro (~15k = pochi ms, non blocca la UI)
  //   PROB_CAP    tetto totale = 100× le 10.000 di prima. A 1.000.000 di mani
  //               l'errore statistico è ~0,05 punti percentuali (ben sotto
  //               l'oscillazione di ~1 punto segnalata): salire oltre non
  //               cambierebbe la cifra mostrata, costerebbe solo CPU.
  const PROB_BATCH = 15000;
  const PROB_CAP = 1000000;
  let probRunId = 0;         // invalida i batch di run precedenti
  let probDebounce = null;

  function probWants() {
    return [...$('probNeeds').querySelectorAll('input[data-tag]')]
      .map((inp) => ({ tag: inp.dataset.tag, n: Number(inp.value) || 0 }))
      .filter((w) => w.n > 0);
  }

  function runProb() {
    const runId = ++probRunId; // ogni run nuova cancella i batch di quella vecchia
    const out = $('probResult');
    const want = probWants();
    if (!want.length) {
      out.textContent = 'Scegli almeno una categoria.';
      out.classList.remove('dk-prob-refining');
      out.removeAttribute('title');
      return;
    }
    const turn = Math.max(1, Number($('probTurn').value) || 1);
    const library = Stats.buildLibrary(current, cardsById);
    let hits = 0; let iters = 0; let batchSeed = 1; let seen = 0;
    out.classList.add('dk-prob-refining');

    const step = () => {
      if (runId !== probRunId) return; // le condizioni sono cambiate: molla
      const r = Stats.simulate({ library, want, turn, iterations: PROB_BATCH, seed: batchSeed++ });
      hits += r.hits; iters += r.iterations; seen = r.seen;
      const p = hits / iters;
      out.textContent = `≈ ${(p * 100).toFixed(1).replace('.', ',')}%`;
      out.title = `${iters.toLocaleString('it-IT')} mani simulate, ${seen} carte viste`;
      // Converge finché non tocca il tetto; un risultato esattamente 0 o 100%
      // è deterministico (caso certo/impossibile) → inutile insistere.
      if (iters < PROB_CAP && hits > 0 && hits < iters) {
        setTimeout(step, 0);
      } else {
        out.classList.remove('dk-prob-refining');
      }
    };
    step();
  }

  // Riavvia la stima quando cambiano le condizioni, con un piccolo debounce così
  // digitare più cifre o una raffica di rerender del mazzo non lancia mille run.
  function scheduleProb() {
    clearTimeout(probDebounce);
    probDebounce = setTimeout(runProb, 120);
  }

  function renderStats() {
    const has = current.carte.length > 0;
    $('statsEmpty').hidden = has;
    $('statsBody').hidden = !has;
    if (!has) return;
    renderCurve(Stats.manaCurve(current, cardsById));
    const avg = Stats.avgCmc(current, cardsById);
    $('statAvg').textContent = avg === null
      ? '' : `CMC medio (terre escluse): ${avg.toFixed(2).replace('.', ',')}`;
    renderColors(Stats.pipCounts(current, cardsById), Stats.producedCounts(current, cardsById));
    $('statTypes').innerHTML = Stats.typeCounts(current, cardsById).map((t) => `
      <div class="dk-type-row" data-type="${esc(t.name)}">
        <span>${esc(t.name)}</span><span class="dk-type-n">${t.n}</span>
      </div>`).join('');
    const total = Decks.deckCount(current) + (current.commander ? 1 : 0);
    $('statTotal').textContent = `Totale: ${total}/100 (commander incluso)`;
    renderStatLegality();
    renderBudget();
    renderProbForm();
    // Il mazzo è cambiato (carte, quantità, tag): riraffina la probabilità con
    // le categorie richieste correnti, senza che l'utente debba ricalcolare.
    scheduleProb();
  }

  async function removeFromDeck(cardId) {
    const { deck, removed } = Decks.removeCard(current, cardId);
    if (removed) await saveDeck(deck);
  }

  // "Sposta in gruppo": secondo livello del menu — i gruppi esistenti della
  // vista corrente + il ritorno al gruppo naturale (toglie l'override). Lo
  // spostamento è PER-VISTA (feedback #316): vale solo nella vista corrente,
  // così cambiando raggruppamento la carta torna a raggrupparsi secondo il
  // nuovo criterio invece di trascinarsi dietro il gruppo forzato altrove.
  function chooseGroup(x, y, cardId) {
    const view = current.raggruppamento || 'tipo';
    const items = Decks.groupDeck(current, cardsById).map((g) => ({
      label: g.name,
      run: () => saveDeck(Decks.setGroupOverride(current, cardId, g.name, view)),
    }));
    // "(gruppo naturale)" resetta l'override della vista corrente: mostralo solo
    // se un override in questa vista c'è davvero (altrimenti sarebbe un no-op).
    const entry = current.carte.find((c) => c.scryfall_id === cardId);
    const ov = entry && entry.gruppo_override;
    if (ov && typeof ov === 'object' && ov[view]) {
      items.push({
        label: '(gruppo naturale)',
        run: () => saveDeck(Decks.setGroupOverride(current, cardId, null, view)),
      });
    }
    openCtx(x, y, items);
  }

  // Rilascio di una carta su una categoria (#344). La categoria è il gruppo
  // della vista corrente. Nella vista "per tag" la categoria È un tag, quindi
  // c'è la scelta aggiungi-vs-sostituisci del feedback; nelle altre viste le
  // categorie sono proprietà intrinseche della carta (tipo/costo/colore), che
  // non si possono riscrivere: lì il trascinamento forza il gruppo, come già fa
  // il menu "Sposta in gruppo…" (parità tra cammini equivalenti).
  //
  // Filo indovina quando può (meno attrito): il popup di scelta compare SOLO
  // quando "aggiungi" e "sostituisci" darebbero risultati diversi. Se la carta
  // non ha tag (le due opzioni coincidono) o ha già solo quel tag (nessun
  // cambiamento reale) non c'è ambiguità → niente popup.
  function dropCardOnGroup(cardId, groupName, x, y) {
    const entry = current.carte.find((c) => c.scryfall_id === cardId);
    if (!entry) return;
    const name = (cardsById[cardId] && cardsById[cardId].name) || 'La carta';
    const view = current.raggruppamento || 'tipo';

    if (view !== 'tag') {
      const next = Decks.setGroupOverride(current, cardId, groupName, view);
      if (next !== current) { saveDeck(next); showToast(`${name} spostata in "${groupName}".`); }
      return;
    }

    // Vista "per tag": la pseudo-categoria "Senza tag" raccoglie le carte senza
    // tag → rilasciarci sopra significa togliere ogni tag (l'inverso del drag).
    if (groupName === 'Senza tag') {
      const next = Decks.replaceCardTags(current, cardId, []);
      if (next !== current) { saveDeck(next); showToast(`Tag rimossi da ${name}.`); }
      return;
    }

    const tags = entry.tags || [];
    const trivial = tags.length === 0 || (tags.length === 1 && tags[0] === groupName);
    if (trivial) {
      const next = Decks.addTagToCard(current, cardId, groupName);
      if (next === current) showToast(`${name} ha già il tag "${groupName}".`);
      else { saveDeck(next); showToast(`Aggiunto tag "${groupName}" a ${name}.`); }
      return;
    }

    // Ambiguità reale (la carta ha già altri tag): il popup richiesto dal feedback.
    openCtx(x, y, [
      {
        label: `Aggiungi tag "${groupName}"`,
        run: () => { saveDeck(Decks.addTagToCard(current, cardId, groupName)); showToast(`Aggiunto tag "${groupName}" a ${name}.`); },
      },
      {
        label: `Sostituisci con "${groupName}"`,
        run: () => { saveDeck(Decks.replaceCardTags(current, cardId, [groupName])); showToast(`Tag di ${name} sostituiti con "${groupName}".`); },
      },
    ]);
  }

  // "Copia/Sposta in un altro mazzo": secondo livello con l'elenco dei mazzi.
  // Se la destinazione contiene GIÀ la carta le quantità si SOMMANO (mergeCard)
  // — mai un no-op silenzioso, che nel "move" faceva sparire le copie. La
  // rimozione dall'origine avviene SOLO dopo che la destinazione è stata
  // salvata con successo: se qualcosa fallisce, l'origine resta intatta.
  // Ogni esito (successo o errore) è comunicato con un toast.
  async function chooseDeck(x, y, cardId, move) {
    const res = await send({ type: MSG.DECKS_LIST });
    const others = Decks.sortForLibrary((res && res.decks) || [])
      .filter((d) => d.id !== current.id);
    if (!others.length) return;
    const entry = current.carte.find((c) => c.scryfall_id === cardId);
    const cardName = (cardsById[cardId] && cardsById[cardId].name) || 'Carta';
    openCtx(x, y, others.map((d) => ({
      label: d.nome,
      run: async () => {
        const verb = move ? 'Spostare' : 'Copiare';
        const t = await send({ type: MSG.DECKS_GET, id: d.id });
        if (!t || !t.ok) {
          showToast(`${verb} non riuscito: mazzo "${d.nome}" non raggiungibile.`);
          return;
        }
        const { deck: target, merged } = Decks.mergeCard(t.deck, cardId, {
          qty: entry ? entry.qty : 1, tags: entry ? entry.tags : [],
        });
        const up = await send({ type: MSG.DECKS_UPDATE, deck: target });
        if (!up || !up.ok) {
          showToast(`${verb} non riuscito: "${d.nome}" non è stato aggiornato.`);
          return;
        }
        if (move) await removeFromDeck(cardId);
        const done = move ? 'spostata' : 'copiata';
        showToast(merged
          ? `${cardName} ${done} in "${d.nome}" (copie sommate a quelle già presenti).`
          : `${cardName} ${done} in "${d.nome}".`);
      },
    })));
  }

  // "Imposta come commander" (§8.4): il commander è un PARAMETRO del mazzo,
  // non una carta dell'elenco — la riga esce dall'elenco.
  async function makeCommander(cardId) {
    const r = await send({ type: MSG.DECKS_SET_COMMANDER, id: current.id, scryfallId: cardId });
    if (!r || !r.ok) return;
    current = r.deck;
    const { deck, removed } = Decks.removeCard(current, cardId);
    if (removed) await saveDeck(deck);
    else await renderBuilder();
  }

  // Inverso di makeCommander (feedback #302): torna a "nessun commander". Poiché
  // impostare un commander ne toglie la carta dall'elenco, rimuoverlo la RIMETTE
  // nel mazzo come carta normale — così non si perde la carta scelta per sbaglio
  // (il software deve reggere gli errori, non costringere a rifare il mazzo).
  async function removeCommander() {
    const prevId = current.commander;
    if (!prevId) return;
    const r = await send({ type: MSG.DECKS_SET_COMMANDER, id: current.id, scryfallId: '' });
    if (!r || !r.ok) return;
    current = r.deck;
    const { deck, added } = Decks.addCard(current, prevId);
    if (added) await saveDeck(deck);
    else await renderBuilder();
  }

  // ── Colonna Chat / Risultati (§3): la ricerca È la chat ────────────────────
  // Messaggi TIPIZZATI (§3.2): una bolla utente è testo; una bolla di Filo può
  // avere testo (con [[Nome Carta]] resi span hoverable, §3.5) e/o una CardList
  // renderizzata dagli ID salvati come DATI (mai markdown). L'ultima bolla
  // mostra la lista con scroll interno; le precedenti collassano a una riga di
  // sintesi riespandibile (§3.3). Stato per-mazzo, vive per la sessione.

  const chatByDeck = new Map(); // deckId → [{ who, text, reply, cardIds, query, error, pending, expanded }]
  let chatBusy = false;

  function chatMsgs() {
    if (!chatByDeck.has(current.id)) chatByDeck.set(current.id, []);
    return chatByDeck.get(current.id);
  }

  function inDeck(cardId) {
    return current.carte.some((c) => c.scryfall_id === cardId);
  }

  // Riga della CardList (§3.4): nome + costo mana destro-allineato + toggle
  // aggiungi-al-mazzo. L'immagine non è nella riga: si mostra nella preview del
  // detail all'hover, ma è già precaricata (preloadVisibleCards) così è istantanea.
  // `qty` arriva dall'import (§11.2, es. "37 Forest"): il toggle la userà
  // come quantità reale invece del default 1 delle ricerche normali.
  function chatRowHtml(id, qty) {
    const card = cardsById[id];
    const name = card ? card.name : id;
    const mana = card ? manaHtml(card.manaCost) : '';
    const added = inDeck(id);
    const q = Number(qty) > 1 ? Number(qty) : 0;
    return `
      <div class="dk-row" data-card-id="${esc(id)}">
        <button class="dk-add" data-add="${esc(id)}" data-qty="${q || 1}" data-in="${added ? 1 : 0}"
                title="${added ? 'Rimuovi dal mazzo' : 'Aggiungi al mazzo'}"
                aria-label="${added ? `Rimuovi ${esc(name)} dal mazzo` : `Aggiungi ${esc(name)} al mazzo`}">${added ? '✓' : '+'}</button>
        <span class="dk-row-name">${q ? `<span class="dk-row-qty">${q}×</span> ` : ''}${esc(name)}</span>
        <span class="dk-row-mana">${mana}</span>
      </div>`;
  }

  // Prosa con [[Nome Carta]] → span hoverable (§3.5), risolti fuzzy all'hover.
  // I nomi già risolti in questa sessione (proseIdByName) rinascono col loro
  // data-card-id anche dopo un rerender della chat: senza, ogni rerender
  // "smemorava" gli span e click/evidenziazione smettevano di funzionare.
  function proseHtml(text) {
    return window.SN_SCRYFALL_Q.proseSegments(text).map((seg) => {
      if (seg.type !== 'card') return esc(seg.text);
      const known = proseIdByName.get(String(seg.name).toLowerCase());
      return `<span class="dk-prose-card" data-card-name="${esc(seg.name)}"${known ? ` data-card-id="${esc(known)}"` : ''}>${esc(seg.name)}</span>`;
    }).join('');
  }

  // Ragionamento del modello (CoT, #331): blocco collassabile in testa alla
  // bolla — un click lo apre, un click lo richiude. Mentre Filo "pensa" resta
  // aperto (si vede il ragionamento scorrere in diretta); a risposta arrivata
  // torna collassato, salvo scelta esplicita dell'utente (m.cotOpen).
  function cotHtml(m) {
    if (!m.reasoning) return '';
    const open = m.cotOpen !== undefined ? m.cotOpen : !!m.pending;
    return `
      <div class="dk-cot" data-toggle-cot="1" data-open="${open ? 1 : 0}" role="button" tabindex="0"
           aria-expanded="${open ? 'true' : 'false'}"
           title="${open ? 'Clicca per nascondere il ragionamento' : 'Clicca per vedere il ragionamento'}">
        <span class="dk-cot-head"><span>${open ? '▾' : '▸'}</span><span>Ragionamento</span></span>
        ${open ? `<div class="dk-cot-body">${esc(m.reasoning)}</div>` : ''}
      </div>`;
  }

  function chatBubbleHtml(m, isLast) {
    if (m.who === 'user') return `<div class="dk-msg dk-msg-user">${esc(m.text)}</div>`;
    if (m.pending) return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${cotHtml(m)}<div class="dk-msg-pending">Filo sta pensando…</div></div>`;
    if (m.error) return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${cotHtml(m)}<div class="dk-msg-error">Non ha funzionato: ${esc(m.error)}</div></div>`;
    const parts = [cotHtml(m)];
    if (m.reply) parts.push(`<p class="dk-msg-text">${proseHtml(m.reply)}</p>`);
    if (m.cardIds && m.cardIds.length) {
      const n = m.cardIds.length;
      const label = m.query ? `per "${m.query}"` : '';
      // CMC crescente, il default di ordinamento delle liste (§3.4).
      const ids = [...m.cardIds].sort((a, b) => {
        const ca = Number(cardsById[a] && cardsById[a].cmc) || 0;
        const cb = Number(cardsById[b] && cardsById[b].cmc) || 0;
        return ca - cb;
      });
      const open = isLast || m.expanded;
      // Import via chat (§11.2): oltre al toggle per riga, un bottone che
      // aggiunge/aggiorna TUTTE le carte riconosciute in un colpo solo — con
      // 100 carte di una lista incollata, cliccare riga per riga è attrito
      // puro. Resta comunque una conferma esplicita, mai automatica.
      const importAllHtml = m.importQty
        ? `<button class="dk-import-all" data-import-all="1" ${m.imported ? 'disabled' : ''}>${m.imported ? 'Aggiunte ✓' : 'Aggiungi tutte al mazzo'}</button>`
        : '';
      parts.push(`
        <button class="dk-list-summary" data-toggle-list="1" aria-expanded="${open ? 'true' : 'false'}">
          <span>${open ? '▾' : '▸'}</span>
          <span>${n} risultat${n === 1 ? 'o' : 'i'} ${esc(label)}</span>
        </button>
        <div class="dk-cardlist" ${open ? '' : 'hidden'}>${importAllHtml}${ids.map((id) => chatRowHtml(id, m.importQty && m.importQty[id])).join('')}</div>`);
    } else if (!m.reply) {
      parts.push(`<p class="dk-msg-text dk-msg-pending">Nessun risultato${m.query ? ` per "${esc(m.query)}"` : ''}.</p>`);
    }
    return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${parts.join('')}</div>`;
  }

  // `stickBottom` = "porta comunque la vista in fondo" (nuovo turno dell'utente:
  // vuole vedere il messaggio appena inviato). Negli altri casi si segue il fondo
  // SOLO se l'utente era già in fondo: durante la generazione renderChat gira in
  // continuazione (i chunk di ragionamento, ~ogni 250ms) e — svuotando e
  // ricostruendo le bolle — strappava la vista in fondo/in cima a ogni giro,
  // impedendo di scrollare per leggere mentre Filo genera (#336). Se invece
  // l'utente ha scrollato su, gli si conserva la posizione.
  function renderChat(stickBottom) {
    const log = $('chatLog');
    const prevTop = log.scrollTop;
    // "vicino al fondo" con tolleranza: seguire anche se manca qualche px.
    const follow = stickBottom || (log.scrollHeight - prevTop - log.clientHeight < 48);
    const msgs = chatMsgs();
    msgs.forEach((m, i) => { m._i = i; });
    $('chatEmpty').hidden = msgs.length > 0;
    // Il placeholder resta come primo figlio; le bolle si rigenerano dopo.
    for (const el of [...log.querySelectorAll('.dk-msg')]) el.remove();
    $('chatEmpty').insertAdjacentHTML('afterend',
      msgs.map((m, i) => chatBubbleHtml(m, i === msgs.length - 1)).join(''));
    // Lo svuotamento sopra fa collassare scrollHeight → il browser clampa
    // scrollTop a 0: se non seguiamo il fondo va ripristinata la posizione, o la
    // vista salterebbe in cima (il sintomo segnalato).
    log.scrollTop = follow ? log.scrollHeight : prevTop;
    syncCarouselHighlight();
    preloadVisibleCards();
  }

  async function sendChat(text) {
    if (chatBusy) return;
    chatBusy = true;
    const msgs = chatMsgs();
    // Le bolle precedenti tornano collassate quando arriva un nuovo scambio (§3.3).
    for (const m of msgs) m.expanded = false;
    // La cronologia per l'agente si costruisce PRIMA di accodare il nuovo turno.
    const history = msgs
      .filter((m) => (m.who === 'user' && m.text) || (m.who === 'bot' && m.reply))
      .map((m) => (m.who === 'user'
        ? { role: 'user', content: m.text }
        : { role: 'assistant', content: m.reply }));
    // "Valuta questi risultati" (§6.1): l'insieme indicato è l'ultima CardList
    // mostrata — sono DATI della bolla, si passano come id al main.
    const lastList = [...msgs].reverse().find((m) => m.who === 'bot' && m.cardIds && m.cardIds.length);
    const lastResults = lastList ? [...lastList.cardIds] : [];
    msgs.push({ who: 'user', text });
    const bot = { who: 'bot', pending: true };
    msgs.push(bot);
    renderChat(true); // nuovo turno: porta la vista in fondo per mostrarlo
    // Ragionamento in diretta (#331): mentre il modello pensa, i chunk di CoT
    // arrivano sul canale filo:reasoning e riempiono la bolla "sta pensando"
    // (render con throttle: i chunk possono essere fitti).
    const reasoningReqId = `dk${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let cotRenderTimer = 0;
    const offReasoning = (window.filo && window.filo.onReasoning)
      ? window.filo.onReasoning((data) => {
          if (!data || data.reqId !== reasoningReqId || !data.text || !bot.pending) return;
          bot.reasoning = (bot.reasoning || '') + data.text;
          if (!cotRenderTimer) {
            cotRenderTimer = setTimeout(() => {
              cotRenderTimer = 0;
              if (bot.pending) renderChat();
            }, 250);
          }
        })
      : null;
    let deckChanged = false;
    try {
      const r = await send({ type: MSG.DECKS_CHAT, deckId: current.id, text, history, lastResults, reasoningReqId });
      bot.pending = false;
      // Il testo completo del ragionamento torna con la risposta (anche in
      // caso d'errore): è la versione autoritativa rispetto ai chunk live.
      if (r && r.reasoning) bot.reasoning = r.reasoning;
      if (!r || !r.ok) {
        bot.error = (r && r.error) || 'nessuna risposta';
      } else {
        bot.reply = r.reply || '';
        bot.cardIds = r.cardIds || [];
        bot.query = r.query || '';
        // Import via chat (§11.2): quantità reali per riga (basics tipo
        // "37 Forest") + eventuale commander candidato, per il bottone
        // "Aggiungi tutte" e per il toggle per riga.
        if (r.importPending) {
          bot.importQty = r.importPending.qtyById || {};
          bot.importCommanderId = r.importPending.commanderId || '';
        }
        Object.assign(cardsById, r.cards || {});
        // La chat può aver calcolato pareri nuovi ("valuta il mazzo", §6.1):
        // la cache di pagina si svuota così il prossimo hover legge dal main
        // i pareri freschi invece di mostrare quelli vecchi.
        opinionsByCard.clear();
        // La chat può aver modificato il mazzo (es. budget, §9.2): il mazzo
        // aggiornato torna nella risposta → header e statistiche si rinfrescano.
        if (r.deck && r.deck.id === current.id) { current = r.deck; deckChanged = true; }
      }
    } catch (e) {
      bot.pending = false;
      bot.error = (e && e.message) || 'errore di rete';
    }
    if (offReasoning) offReasoning();
    if (cotRenderTimer) { clearTimeout(cotRenderTimer); cotRenderTimer = 0; }
    chatBusy = false;
    if (deckChanged) await renderBuilder();
    else renderChat();
  }

  // Toggle aggiungi/rimuovi dalla riga della CardList (§3.4): la carta entra
  // nel gruppo giusto della colonna centrale, feedback immediato. `qty` arriva
  // dall'import via chat (§11.2, es. basics con "×37"): default 1 per le
  // ricerche normali.
  async function toggleCard(cardId, qty = 1) {
    const adding = !inDeck(cardId);
    const { deck, added } = adding
      ? Decks.addCard(current, cardId, { qty })
      : (() => { const r = Decks.removeCard(current, cardId); return { deck: r.deck, added: r.removed }; })();
    if (added) {
      await saveDeck(deck); // renderBuilder → renderDeckList + renderChat
      // Parere per la carta appena AGGIUNTA (§6.1): calcolato in background
      // sulla versione nuova del mazzo, pronto in cache al prossimo hover.
      if (adding) requestOpinions([cardId], { refresh: true }).catch(() => {});
    }
  }

  // "Aggiungi tutte al mazzo" (§11.2): merge in un colpo solo di tutte le
  // carte riconosciute dall'import via chat (rispettando la qty per riga) +
  // il commander candidato, MA SOLO se il mazzo non ne ha già uno (mai
  // sovrascrivere una scelta esistente senza un'azione dedicata, §8.4).
  async function importAllFromBubble(bubbleEl) {
    const m = chatMsgs()[Number(bubbleEl.dataset.msgI)];
    if (!m || m.imported || !m.cardIds || !m.cardIds.length) return;
    const entries = m.cardIds
      .filter((id) => id !== m.importCommanderId)
      .map((id) => ({ scryfall_id: id, qty: (m.importQty && m.importQty[id]) || 1 }));
    const { deck: merged, addedCount, updatedCount } = Decks.importCards(current, entries);
    const saved = merged !== current ? await send({ type: MSG.DECKS_UPDATE, deck: merged }) : { ok: true, deck: current };
    if (saved && saved.ok) current = saved.deck;
    let commanderSet = false;
    if (m.importCommanderId && !current.commander) {
      const r = await send({ type: MSG.DECKS_SET_COMMANDER, id: current.id, scryfallId: m.importCommanderId });
      if (r && r.ok) { current = r.deck; commanderSet = true; }
    }
    m.imported = true;
    await renderBuilder();
    const total = addedCount + updatedCount + (commanderSet ? 1 : 0);
    showToast(total ? `Aggiunte ${total} cart${total === 1 ? 'a' : 'e'} al mazzo.` : 'Nessuna carta nuova da aggiungere.');
  }

  // Toast discreto in basso a destra (conferme di import/export non
  // bloccanti): stesso pattern del toast dell'editor.
  let dkToastTimer = null;
  function showToast(text) {
    let el = document.getElementById('dkToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dkToast';
      el.className = 'dk-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(dkToastTimer);
    dkToastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  // ── Import/Export rigido (§11), via switcher ────────────────────────────────
  // Dialog minimale (overlay + box, stesso linguaggio visivo dei confirm):
  // il parser è DETERMINISTICO (mai LLM). L'import mostra sempre un'anteprima
  // con conferma prima di scrivere nel mazzo; righe non riconosciute sono
  // segnalate, mai indovinate.
  let ioOverlayEl = null;
  function closeIoOverlay() {
    if (ioOverlayEl) { ioOverlayEl.remove(); ioOverlayEl = null; }
    document.removeEventListener('keydown', ioOverlayKey, true);
  }
  function ioOverlayKey(e) { if (e.key === 'Escape') closeIoOverlay(); }

  function buildIoOverlay(title) {
    closeIoOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'dk-io-overlay';
    const box = document.createElement('div');
    box.className = 'dk-io-box';
    box.innerHTML = `<div class="dk-io-title">${esc(title)}</div><div class="dk-io-body"></div>`;
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeIoOverlay(); });
    document.body.appendChild(overlay);
    ioOverlayEl = overlay;
    document.addEventListener('keydown', ioOverlayKey, true);
    return box.querySelector('.dk-io-body');
  }

  function openExportDialog() {
    const body = buildIoOverlay('Esporta mazzo');
    body.innerHTML = `
      <textarea class="dk-io-textarea" readonly rows="14">(generazione…)</textarea>
      <div class="dk-io-row">
        <button class="dk-io-btn" data-io="close">Chiudi</button>
        <button class="dk-io-btn dk-io-btn-ok" data-io="copy">Copia</button>
      </div>`;
    const ta = body.querySelector('textarea');
    send({ type: MSG.DECKS_EXPORT, id: current.id }).then((r) => {
      ta.value = (r && r.ok) ? r.text : 'Non riuscito a generare la lista.';
      ta.focus();
      ta.select();
    });
    body.querySelector('[data-io="close"]').addEventListener('click', closeIoOverlay);
    body.querySelector('[data-io="copy"]').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(ta.value);
      } catch (_) {
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch (_) { /* copia manuale, il testo resta selezionato */ }
      }
      const btn = e.currentTarget;
      const prev = btn.textContent;
      btn.textContent = 'Copiata ✓';
      setTimeout(() => { if (btn.isConnected) btn.textContent = prev; }, 1400);
    });
  }

  function openImportDialog() {
    const body = buildIoOverlay('Importa mazzo');
    body.innerHTML = `
      <textarea class="dk-io-textarea" rows="14" placeholder="Incolla qui la lista (una carta per riga, es. «1 Sol Ring»)…"></textarea>
      <div class="dk-io-row">
        <button class="dk-io-btn" data-io="cancel">Annulla</button>
        <button class="dk-io-btn dk-io-btn-ok" data-io="parse">Analizza</button>
      </div>`;
    body.querySelector('[data-io="cancel"]').addEventListener('click', closeIoOverlay);
    body.querySelector('[data-io="parse"]').addEventListener('click', async () => {
      const ta = body.querySelector('textarea');
      const text = ta.value;
      if (!text.trim()) return;
      const btn = body.querySelector('[data-io="parse"]');
      btn.disabled = true;
      btn.textContent = 'Analizzo…';
      const r = await send({ type: MSG.DECKS_IMPORT_PREVIEW, id: current.id, text });
      if (!r || !r.ok) {
        btn.disabled = false;
        btn.textContent = 'Analizza';
        showToast('Analisi non riuscita.');
        return;
      }
      renderImportPreview(body, r);
    });
  }

  function renderImportPreview(body, r) {
    const resolved = r.entries.filter((e) => e.card);
    const unresolved = r.entries.filter((e) => !e.card).map((e) => e.name);
    const dirty = [...unresolved, ...r.dirtyLines];
    const commanderNote = r.commander
      ? (r.commander.card
        ? `<div class="dk-io-note">Commander riconosciuto: ${esc(r.commander.card.name)}${current.commander ? ' — il mazzo ha già un commander, resterà quello attuale.' : '.'}</div>`
        : `<div class="dk-io-note dk-io-warn">Commander «${esc(r.commander.name)}» non trovato su Scryfall.</div>`)
      : '';
    body.innerHTML = `
      ${commanderNote}
      <div class="dk-io-note">${resolved.length} cart${resolved.length === 1 ? 'a' : 'e'} riconosciut${resolved.length === 1 ? 'a' : 'e'} su ${r.entries.length}.</div>
      ${dirty.length ? `<div class="dk-io-note dk-io-warn">${dirty.length} riga/righe non riconosciut${dirty.length === 1 ? 'a' : 'e'}:<ul class="dk-io-dirty">${dirty.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
      <div class="dk-io-row">
        <button class="dk-io-btn" data-io="cancel">Annulla</button>
        <button class="dk-io-btn dk-io-btn-ok" data-io="apply" ${resolved.length ? '' : 'disabled'}>Importa ${resolved.length} cart${resolved.length === 1 ? 'a' : 'e'}</button>
      </div>`;
    body.querySelector('[data-io="cancel"]').addEventListener('click', closeIoOverlay);
    const applyBtn = body.querySelector('[data-io="apply"]');
    if (!applyBtn) return;
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Importo…';
      const entries = resolved.map((e) => ({ scryfallId: e.card.id, qty: e.qty }));
      const commanderId = (r.commander && r.commander.card && !current.commander) ? r.commander.card.id : '';
      const res = await send({ type: MSG.DECKS_IMPORT_APPLY, id: current.id, entries, commanderId });
      if (res && res.ok) {
        current = res.deck;
        closeIoOverlay();
        await renderBuilder();
        const total = res.addedCount + res.updatedCount;
        showToast(`Importate ${total} cart${total === 1 ? 'a' : 'e'}${res.updatedCount ? ` (${res.updatedCount} aggiornate)` : ''}.`);
      } else {
        showToast('Import non riuscito.');
        applyBtn.disabled = false;
        applyBtn.textContent = `Importa ${resolved.length} cart${resolved.length === 1 ? 'a' : 'e'}`;
      }
    });
  }

  // Hover/click su un nome in prosa: risoluzione fuzzy una-tantum (§3.5).
  // Ritorna una Promise dell'id risolto (o null): il carosello dal testo
  // libero (#343) la attende per costruire la lista di navigazione. La cache
  // per nome sopravvive ai rerender della chat (gli span si rigenerano).
  const proseIdByName = new Map();    // nome (lowercase) → scryfall id
  const proseResolving = new WeakMap(); // span → Promise in corso

  function resolveProseCard(el) {
    if (el.dataset.cardId) return Promise.resolve(el.dataset.cardId);
    const key = String(el.dataset.cardName || '').toLowerCase();
    if (proseIdByName.has(key)) {
      const id = proseIdByName.get(key);
      el.dataset.cardId = id;
      const card = cardsById[id];
      if (card) el.title = `${card.name} — ${card.typeLine}`;
      return Promise.resolve(id);
    }
    if (proseResolving.has(el)) return proseResolving.get(el);
    const p = (async () => {
      const r = await send({ type: MSG.SCRYFALL_NAMED, name: el.dataset.cardName });
      proseResolving.delete(el);
      if (!(r && r.ok && r.card)) return null;
      el.dataset.cardId = r.card.id;
      proseIdByName.set(key, r.card.id);
      cardsById[r.card.id] = r.card;
      el.title = `${r.card.name} — ${r.card.typeLine}`;
      // La risoluzione è arrivata DOPO il mouseover: se il puntatore è ancora
      // sul nome non ci sarà un nuovo evento — la preview parte da qui.
      if (el.matches(':hover')) hoverEnter(r.card.id);
      return r.card.id;
    })();
    proseResolving.set(el, p);
    return p;
  }

  // ── Pannello destro a tre stati (§5): statistiche / preview / carosello ────
  // Le statistiche sono lo stato di RIPOSO; hover su una riga carta (ovunque:
  // risultati in chat, righe mazzo, nomi [[...]] in prosa) → preview; click →
  // carosello pinnato. Il contenuto cambia, la geometria MAI.
  //
  // Timing (§5.1, valori di partenza): apertura ~200ms (anti-flicker),
  // passaggio riga→riga con grace ~100ms e aggiornamento SUL POSTO (mai
  // chiudi-riapri), uscita con linger ~1s prima di tornare alle statistiche.
  const PREVIEW_OPEN_MS = 200;
  const PREVIEW_GRACE_MS = 100;
  const PREVIEW_LINGER_MS = 1000;

  const DETAIL_TITLES = { stats: 'Statistiche', preview: 'Anteprima', carousel: 'Carosello' };
  let detailState = 'stats';
  let hoverTimer = 0;    // apertura/aggiornamento ritardato della preview
  let lingerTimer = 0;   // ritorno ritardato alle statistiche

  function setDetailState(s) {
    detailState = s;
    $('detailTitle').textContent = DETAIL_TITLES[s];
    $('stateStats').hidden = s !== 'stats';
    $('statePreview').hidden = s !== 'preview';
    $('stateCarousel').hidden = s !== 'carousel';
    // Uscendo dal carosello l'evidenziazione della carta corrente sparisce.
    if (s !== 'carousel') syncCarouselHighlight();
  }

  // Box modulare del detail (§5.2): SLOT del sistema moduli — tasto destro sul
  // box → scelta del modulo (sia in preview sia nel carosello, stesso slot).
  // Moduli alpha: dati carta (default), mini curva di mana con l'evidenza di
  // dove cadrebbe la carta, prezzo+dati (ristampe, legalità), parere di Filo
  // (§6). La scelta è persistita col layout.

  // ── Parere di Filo (§6): cache di pagina + richieste al main ──────────────
  // opinionsByCard: cardId → { text, versione, stale } (solo per il mazzo
  // corrente: si svuota al cambio mazzo). Il calcolo vero e la cache
  // persistente per (carta, versione mazzo) vivono nel main.
  const opinionsByCard = new Map();
  const opinionPending = new Set();

  // La carta mostrata ADESSO nel pannello destro (preview o carosello).
  function currentDetailCard() {
    if (detailState === 'carousel' && carousel) return cardsById[carousel.ids[carousel.i]] || null;
    if (detailState === 'preview') return cardsById[$('previewImg').dataset.cardId] || null;
    return null;
  }

  // Chiede al main i pareri per gli id dati (UNA richiesta, il main fa UN
  // batch LLM per i soli mancanti/stantii). refresh=true ricalcola comunque
  // (il refresh on-demand di §6.2). Al ritorno, se la carta mostrata è tra
  // quelle chieste, il modulo si aggiorna sul posto.
  async function requestOpinions(ids, { refresh = false } = {}) {
    // Senza refresh si chiedono solo i pareri che la pagina non ha: uno
    // stantio resta visibile marcato, si ricalcola SOLO col bottone (§6.2).
    const ask = ids.filter((id) => refresh
      || (!opinionsByCard.has(id) && !opinionPending.has(id)));
    if (!ask.length || !current) return;
    for (const id of ask) opinionPending.add(id);
    try {
      const r = await send({ type: MSG.DECKS_OPINION, deckId: current.id, cardIds: ask, compute: true, refresh });
      if (r && r.ok) {
        for (const [id, op] of Object.entries(r.opinions || {})) opinionsByCard.set(id, op);
      }
    } finally {
      for (const id of ask) opinionPending.delete(id);
    }
    const cur = currentDetailCard();
    if (cur && layout.module === 'opinion' && ask.includes(cur.id)) renderDetailModule(cur);
  }

  // ── Ristampe (modulo "Prezzo e dati"): conteggio lazy, cache nel main ─────
  const printsByName = new Map();
  const printsPending = new Set();
  async function fetchPrints(card) {
    if (printsByName.has(card.name) || printsPending.has(card.name)) return;
    printsPending.add(card.name);
    try {
      const r = await send({ type: MSG.SCRYFALL_PRINTS, name: card.name });
      if (r && r.ok) printsByName.set(card.name, r.prints);
    } finally { printsPending.delete(card.name); }
    const cur = currentDetailCard();
    if (cur && cur.name === card.name && layout.module === 'price') renderDetailModule(cur);
  }

  const DETAIL_MODULES = {
    default: {
      label: 'Dati carta',
      render(card, host) {
        const price = card.priceEur != null
          ? `${card.priceEur.toFixed(2).replace('.', ',')} €` : 'n.d.';
        host.innerHTML = `
          <p class="dk-module-title">${esc(card.name)}</p>
          <p>${esc(card.typeLine)}</p>
          <p>Costo di mana convertito: ${esc(String(card.cmc))} · Prezzo: ${esc(price)}</p>`;
      },
    },
    // Mini curva di mana (§5.2.1): la curva del mazzo con EVIDENZIATA la
    // colonna dove cadrebbe la carta — "mi fixa la curva?" ha risposta visiva.
    curve: {
      label: 'Mini curva di mana',
      render(card, host) {
        const curve = Stats.manaCurve(current, cardsById);
        const land = /\bLand\b/i.test(String(card.typeLine).split('//')[0]);
        const n = Math.max(0, Math.floor(Number(card.cmc) || 0));
        const bucket = land ? null : (n >= 7 ? '7+' : String(n));
        const already = inDeck(card.id);
        // Se la carta NON è nel mazzo, la sua colonna mostra un segmento
        // "fantasma" (+1) sopra la barra: dove cadrebbe aggiungendola.
        const ghost = bucket !== null && !already;
        const max = Math.max(1, ...curve.map((b) => b.n + (ghost && b.label === bucket ? 1 : 0)));
        const unit = 36;
        host.innerHTML = `
          <p class="dk-module-title">Mini curva di mana</p>
          <div class="dk-curve dk-curve-mini" role="img" aria-label="Curva di mana del mazzo con la posizione della carta">
            ${curve.map((b) => {
              const hit = b.label === bucket;
              return `
              <div class="dk-curve-col${hit ? ' dk-curve-hit' : ''}" data-cmc="${esc(b.label)}" data-n="${b.n}">
                <span class="dk-curve-n">${b.n || ''}</span>
                ${hit && ghost ? `<div class="dk-curve-ghost" style="height:${Math.max(3, Math.round(unit / max))}px"></div>` : ''}
                <div class="dk-curve-bar" style="height:${Math.max(b.n ? 2 : 0, Math.round((b.n / max) * unit))}px"></div>
                <span class="dk-curve-label">${esc(b.label)}</span>
              </div>`;
            }).join('')}
          </div>
          <p class="dk-mod-note">${land
            ? 'È una terra: non entra nella curva.'
            : (already ? `Conta nella colonna ${esc(bucket)}.` : `Cadrebbe nella colonna ${esc(bucket)}.`)}</p>`;
      },
    },
    // Prezzo + dati (§5.2.2): prezzo, ristampe (lazy, cache permanente), legalità.
    price: {
      label: 'Prezzo e dati',
      render(card, host) {
        const price = card.priceEur != null
          ? `${card.priceEur.toFixed(2).replace('.', ',')} € (Cardmarket)` : 'n.d.';
        const prints = printsByName.get(card.name);
        host.innerHTML = `
          <p class="dk-module-title">Prezzo e dati</p>
          <p>Prezzo: ${esc(price)}</p>
          <p data-prints>${prints != null
            ? `Ristampe: ${prints} stamp${prints === 1 ? 'a' : 'e'}` : 'Ristampe: …'}</p>
          <p data-legal="${card.legalCommander ? 1 : 0}">${card.legalCommander
            ? '✓ Legale in Commander' : '✗ Non legale in Commander'}</p>`;
        if (prints == null) fetchPrints(card);
      },
    },
    // Parere di Filo (§6): giudizio contestuale carta-vs-mazzo. L'hover con
    // questo modulo attivo È il trigger (§6.1): cache-first, LLM solo per i
    // mancanti/stantii. Stantio = pallino discreto + "Aggiorna" (§6.2).
    opinion: {
      label: 'Parere di Filo',
      render(card, host) {
        const op = opinionsByCard.get(card.id);
        const pending = opinionPending.has(card.id);
        let body;
        if (op) {
          const staleBar = !op.stale ? '' : (pending
            ? `
              <div class="dk-mod-actions">
                <span class="dk-stale-dot" title="Parere calcolato su una versione precedente del mazzo"></span>
                <span class="dk-mod-note">Aggiorno…</span>
              </div>`
            : `
              <div class="dk-mod-actions">
                <span class="dk-stale-dot" title="Parere calcolato su una versione precedente del mazzo"></span>
                <span class="dk-mod-note">Il mazzo è cambiato da allora.</span>
                <button class="dk-mod-btn" data-op-refresh="${esc(card.id)}">Aggiorna</button>
              </div>`);
          body = `<p class="dk-op-text">${proseHtml(op.text)}</p>${staleBar}`;
        } else {
          body = `<p class="dk-mod-note dk-op-pending">${pending ? 'Filo sta pensando…' : 'Chiedo un parere a Filo…'}</p>`;
        }
        host.innerHTML = `<p class="dk-module-title">Parere di Filo</p>${body}`;
        // L'hover con questo modulo attivo È il trigger (§6.1): cache-first.
        // Un parere STANTIO invece non si ricalcola da solo: refresh solo su
        // richiesta (§6.2), col bottone qui sopra.
        if (!op && !pending) requestOpinions([card.id]).catch(() => {});
      },
    },
  };

  // Renderizza il modulo scelto nello slot dello stato ATTIVO del pannello
  // (preview o carosello: stesso sistema, stesso menu col tasto destro).
  function renderDetailModule(card, hostId) {
    const host = $(hostId || (detailState === 'carousel' ? 'carouselModule' : 'previewModule'));
    if (!host) return;
    const mod = DETAIL_MODULES[layout.module] || DETAIL_MODULES.default;
    mod.render(card, host);
  }

  // Riga di contesto del detail (§5.2): prezzo EUR + tag assegnati + "già nel
  // mazzo" (vale anche per il commander, che nel mazzo c'è eccome).
  function renderDetailCtx(card) {
    const entry = current.carte.find((c) => c.scryfall_id === card.id);
    const parts = [];
    if (card.priceEur != null) {
      parts.push(`<span>${esc(card.priceEur.toFixed(2).replace('.', ','))} €</span>`);
    }
    for (const t of (entry && entry.tags) || []) {
      parts.push(`<span class="dk-tag">${esc(t)}</span>`);
    }
    if (entry || card.id === current.commander) {
      parts.push('<span class="dk-indeck">✓ già nel mazzo</span>');
    }
    $('previewCtx').innerHTML = parts.join('');
  }

  // Mostra/aggiorna la preview SUL POSTO: immagine (già scaldata in cache da
  // preloadVisibleCards appena la riga è comparsa, §5.1 → hover istantaneo),
  // contesto, modulo. Se lo stato era già preview non si passa dalle statistiche.
  //
  // OGNI riapertura riparte dal FRONTE (feedback #373): ridipingiamo l'immagine
  // (→ fronte) sia quando la carta cambia, sia quando la preview era chiusa
  // (stato ≠ preview), anche se è la STESSA carta di prima. Senza il secondo
  // caso, una carta girata sul retro, uscita dall'hover (torna alle statistiche)
  // e ri-hoverata riapriva ancora sul retro, in modo incoerente con il cambio
  // carta. Se invece la preview è GIÀ aperta sulla stessa carta (re-hover mentre
  // resta visibile), NON ridipingiamo: un flip volontario dell'utente resta.
  function showPreview(cardId) {
    const card = cardsById[cardId];
    if (!card) return;
    const img = $('previewImg');
    if (detailState !== 'preview' || img.dataset.cardId !== card.id) paintCardImage(img, card);
    renderDetailCtx(card);
    renderDetailModule(card);
    if (detailState !== 'preview') setDetailState('preview');
  }

  // Dipinge una carta in uno slot immagine del detail (preview o carosello):
  // riparte SEMPRE dalla faccia frontale e mostra il tasto "gira" solo per le
  // bifronte (transform / modal DFC). Il retro è già precaricato → flip istantaneo.
  function paintCardImage(img, card) {
    const frame = img.closest('.dk-card-frame');
    const flip = frame ? frame.querySelector('.dk-flip') : null;
    const hasBack = !!(card && card.backImage);
    img.src = (card && card.image) || '';
    img.alt = (card && card.name) || '';
    img.dataset.cardId = card ? card.id : '';
    img.dataset.face = 'front';
    if (frame) {
      frame.classList.toggle('dk-has-back', hasBack);
      frame.classList.remove('dk-flipped');
    }
    if (flip) flip.hidden = !hasBack;
  }

  // Gira la carta mostrata nello slot: alterna fronte/retro SUL POSTO. No-op se
  // la carta non ha un retro (carta a faccia unica).
  function flipCardImage(img) {
    const card = cardsById[img.dataset.cardId];
    if (!card || !card.backImage) return;
    const frame = img.closest('.dk-card-frame');
    const toBack = img.dataset.face !== 'back';
    img.dataset.face = toBack ? 'back' : 'front';
    img.src = toBack ? card.backImage : card.image;
    img.alt = (toBack ? (card.backName || card.name) : card.name) || '';
    if (frame) frame.classList.toggle('dk-flipped', toBack);
  }

  // L'id carta sotto il puntatore, qualunque sia il consumatore (§5.1):
  // riga risultati/mazzo (.dk-row) o nome in prosa risolto (.dk-prose-card).
  function hoverCardId(target) {
    if (!target || !target.closest) return null;
    const row = target.closest('.dk-row[data-card-id]');
    if (row) return row.dataset.cardId;
    const span = target.closest('.dk-prose-card');
    if (span && span.dataset.cardId) return span.dataset.cardId;
    return null;
  }

  function hoverEnter(cardId) {
    if (detailState === 'carousel') return; // il carosello è PINNATO: l'hover non lo scalza
    if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = 0; }
    if (hoverTimer) clearTimeout(hoverTimer);
    const delay = detailState === 'preview' ? PREVIEW_GRACE_MS : PREVIEW_OPEN_MS;
    hoverTimer = setTimeout(() => { hoverTimer = 0; showPreview(cardId); }, delay);
  }

  function hoverLeave() {
    if (detailState === 'carousel') return;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; }
    if (detailState === 'preview' && !lingerTimer) {
      lingerTimer = setTimeout(() => {
        lingerTimer = 0;
        if (detailState === 'preview') setDetailState('stats');
      }, PREVIEW_LINGER_MS);
    }
  }

  // ── Carosello (§5.3): flusso di triage, pinnato al click ───────────────────
  // Naviga la lista DA CUI è partito (i risultati di quella bolla, o l'elenco
  // del mazzo). Occhi sull'immagine, mano sulla tastiera.
  let carousel = null; // { ids: string[], i: number }

  function openCarousel(ids, i) {
    if (!ids.length) return;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; }
    if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = 0; }
    carousel = { ids, i: Math.max(0, Math.min(i, ids.length - 1)) };
    setDetailState('carousel');
    renderCarousel();
  }

  function closeCarousel() {
    carousel = null;
    setDetailState('stats');
  }

  function renderCarousel() {
    if (!carousel) return;
    const id = carousel.ids[carousel.i];
    const card = cardsById[id];
    paintCardImage($('carouselImg'), card || null);
    $('carouselPos').textContent = `${carousel.i + 1}/${carousel.ids.length}`;
    const added = inDeck(id);
    const btn = $('carouselToggle');
    btn.dataset.in = added ? '1' : '0';
    btn.textContent = added ? '✓ nel mazzo' : '+ aggiungi';
    btn.title = added ? 'Rimuovi dal mazzo (Invio)' : 'Aggiungi al mazzo (Invio)';
    // Prefetch di precedente e successiva (§5.1): la navigazione non aspetta.
    // Stesso warm-up (dedup) del precarico delle righe visibili.
    preloadCardImages([carousel.ids[carousel.i - 1], carousel.ids[carousel.i + 1]].filter(Boolean));
    // Il box modulare vive anche nel carosello (§5.2): stesso slot, stesso menu.
    if (card) renderDetailModule(card, 'carouselModule');
    // Parere di Filo attivo → prefetch dei pareri delle carte VICINE (§6.1):
    // scorrendo, il parere è già lì. Una sola richiesta per corrente+vicine.
    if (card && layout.module === 'opinion') {
      const near = [carousel.i, carousel.i - 1, carousel.i + 1]
        .map((j) => carousel.ids[j]).filter(Boolean);
      requestOpinions(near).catch(() => {});
    }
    syncCarouselHighlight();
  }

  function carouselNav(delta) {
    if (!carousel) return;
    const next = carousel.i + delta;
    if (next < 0 || next >= carousel.ids.length) return;
    carousel.i = next;
    renderCarousel();
  }

  // Toggle aggiungi/rimuovi della carta corrente: all'aggiunta la riga appare
  // nel gruppo giusto della colonna centrale (via saveDeck → renderDeckList).
  async function carouselToggle() {
    if (!carousel) return;
    await toggleCard(carousel.ids[carousel.i]);
    renderCarousel();
  }

  // Apre il carosello dalla riga cliccata: la lista è l'ordine VISIBILE delle
  // righe del contenitore di partenza (la CardList della bolla o #deckList).
  function openCarouselFromRow(row, containerSel) {
    const box = row.closest(containerSel);
    if (!box) return;
    const ids = [...box.querySelectorAll('.dk-row[data-card-id]')].map((r) => r.dataset.cardId);
    openCarousel(ids, ids.indexOf(row.dataset.cardId));
  }

  // Carosello dal testo libero (#343): il click su un nome in prosa naviga
  // TUTTE le carte citate nella stessa bolla (parità con le CardList), non
  // solo quella cliccata. Apre subito sulla carta cliccata (risolvendola se
  // il click è arrivato prima dell'hover — prima non succedeva nulla) e
  // completa la lista appena gli altri nomi sono risolti.
  async function openCarouselFromProse(span) {
    const bubble = span.closest('.dk-msg');
    const spans = bubble ? [...bubble.querySelectorAll('.dk-prose-card')] : [span];
    const clickedId = await resolveProseCard(span).catch(() => null);
    if (!clickedId) return;
    openCarousel([clickedId], 0);
    const mine = carousel;
    await Promise.all(spans.map((s) => resolveProseCard(s).catch(() => null)));
    // Nel frattempo il carosello può essere stato chiuso o riaperto altrove.
    if (carousel !== mine) return;
    const ids = [];
    for (const s of spans) {
      const id = s.dataset.cardId;
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length <= mine.ids.length) return;
    carousel = { ids, i: Math.max(0, ids.indexOf(mine.ids[mine.i])) };
    renderCarousel();
  }

  // Evidenzia ovunque (nomi in prosa e righe carta) la carta ATTUALMENTE
  // mostrata nel carosello (#343): il nome nel testo perde la sottolineatura
  // e prende un fondo d'accento, così si vede a colpo d'occhio dove sei.
  // Chiamata a ogni cambio del carosello E a ogni rerender di chat/mazzo
  // (che rigenerano il DOM e perderebbero la classe).
  function syncCarouselHighlight() {
    const activeId = (detailState === 'carousel' && carousel)
      ? carousel.ids[carousel.i] : '';
    for (const el of document.querySelectorAll('.dk-carousel-current')) {
      if (!activeId || el.dataset.cardId !== activeId) el.classList.remove('dk-carousel-current');
    }
    if (!activeId) return;
    const sel = `.dk-prose-card[data-card-id="${CSS.escape(activeId)}"], .dk-row[data-card-id="${CSS.escape(activeId)}"]`;
    for (const el of document.querySelectorAll(sel)) el.classList.add('dk-carousel-current');
  }

  function wireDetailPanel() {
    // Hover unificato (§5.1), in delega sul documento: un mouseover su una
    // riga carta apre/aggiorna; su qualsiasi altra cosa fa partire il linger.
    document.addEventListener('mouseover', (e) => {
      const id = hoverCardId(e.target);
      if (id) hoverEnter(id);
      else hoverLeave();
    });

    // Tastiera del carosello (§5.3): frecce naviga, Invio/Spazio aggiunge o
    // rimuove, Esc chiude e torna alle statistiche.
    document.addEventListener('keydown', (e) => {
      if (detailState !== 'carousel') return;
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); carouselNav(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); carouselNav(-1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); carouselToggle(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCarousel(); }
    });

    // Calcolatore di probabilità (§9.3): si aggiorna DA SOLO appena cambia una
    // condizione (feedback #354). Delego l'ascolto a #stateStats perché le righe
    // categoria (#probNeeds) sono ricostruite a ogni rerender delle statistiche.
    $('stateStats').addEventListener('input', (e) => {
      if (e.target && e.target.matches('#probTurn, #probNeeds input')) scheduleProb();
    });

    $('carouselPrev').addEventListener('click', () => carouselNav(-1));
    $('carouselNext').addEventListener('click', () => carouselNav(1));
    $('carouselToggle').addEventListener('click', () => carouselToggle());
    $('carouselClose').addEventListener('click', () => closeCarousel());

    // Gira la carta bifronte (feedback #373): tasto dedicato sopra l'immagine, e
    // — gesto fisico naturale — anche il click sull'immagine stessa la volta.
    // Vale in entrambi gli slot (preview e carosello): parità tra i due cammini.
    $('previewFlip').addEventListener('click', (e) => { e.stopPropagation(); flipCardImage($('previewImg')); });
    $('carouselFlip').addEventListener('click', (e) => { e.stopPropagation(); flipCardImage($('carouselImg')); });
    $('previewImg').addEventListener('click', () => flipCardImage($('previewImg')));
    $('carouselImg').addEventListener('click', () => flipCardImage($('carouselImg')));

    // Tasto destro sul box modulare (§5.2): scelta del modulo dello slot —
    // vale sia per la preview sia per il carosello (stesso sistema moduli).
    const openModuleMenu = (e) => {
      e.preventDefault();
      openCtx(e.clientX, e.clientY, Object.entries(DETAIL_MODULES).map(([key, mod]) => ({
        label: mod.label + (layout.module === key ? ' ✓' : ''),
        run: () => {
          layout.module = key;
          persistLayout();
          const cur = currentDetailCard();
          if (cur) renderDetailModule(cur);
        },
      })));
    };
    $('previewModule').addEventListener('contextmenu', openModuleMenu);
    $('carouselModule').addEventListener('contextmenu', openModuleMenu);

    // "Aggiorna" di un parere stantio (§6.2): refresh on-demand della SOLA
    // carta mostrata. In delega su entrambi gli slot del modulo.
    const onModuleClick = (e) => {
      const btn = e.target.closest('[data-op-refresh]');
      if (!btn) return;
      const id = btn.dataset.opRefresh;
      btn.disabled = true;
      requestOpinions([id], { refresh: true }).catch(() => {});
      const cur = currentDetailCard();
      if (cur && cur.id === id) renderDetailModule(cur); // mostra "sta pensando"
    };
    $('previewModule').addEventListener('click', onModuleClick);
    $('carouselModule').addEventListener('click', onModuleClick);
  }

  // Lo switcher (§8.2): click sul nome → gestione mazzi, DOVE vive il mazzo.
  // Popup ancorato sotto l'header (stesse classi dei menu di Filo).
  let switcherEl = null;
  function closeSwitcher() {
    if (switcherEl) { switcherEl.remove(); switcherEl = null; }
    document.removeEventListener('click', closeSwitcher, true);
    document.removeEventListener('keydown', switcherKey, true);
  }
  function switcherKey(e) { if (e.key === 'Escape') closeSwitcher(); }

  async function openSwitcher() {
    if (switcherEl) { closeSwitcher(); return; }
    const res = await send({ type: MSG.DECKS_LIST });
    const others = Decks.sortForLibrary((res && res.decks) || [])
      .filter((d) => d.id !== current.id);

    const pop = document.createElement('div');
    pop.className = 'sn-select-pop dk-switcher';
    const add = (label, run, cls = '') => {
      const row = document.createElement('div');
      row.className = 'sn-select-option' + (cls ? ` ${cls}` : '');
      row.textContent = label;
      row.addEventListener('click', (e) => { e.stopPropagation(); closeSwitcher(); run(); });
      pop.appendChild(row);
    };

    for (const d of others.slice(0, 8)) {
      add(d.nome, () => { location.hash = `#/deck/${encodeURIComponent(d.id)}`; });
    }
    add('+ Nuovo mazzo', async () => {
      const r = await send({ type: MSG.DECKS_CREATE });
      if (r && r.ok) location.hash = `#/deck/${encodeURIComponent(r.deck.id)}`;
    }, others.length ? 'dk-sw-sep' : '');
    add('Duplica questo mazzo', async () => {
      const r = await send({ type: MSG.DECKS_DUPLICATE, id: current.id });
      if (r && r.ok) location.hash = `#/deck/${encodeURIComponent(r.deck.id)}`;
    });
    add('Importa…', () => openImportDialog(), 'dk-sw-sep');
    add('Esporta…', () => openExportDialog());
    add('Rinomina…', () => startEdit('deckNameEdit', current.nome, async (v) => {
      await saveDeck(Decks.renameDeck(current, v));
    }));
    add('Budget…', () => startEdit('deckBudgetEdit', fmtBudgetInput(current.budget), async (v) => {
      // Virgola decimale italiana accettata (l'app mostra i prezzi come
      // «12,50 €»); testo non numerico → il tetto resta com'era, con avviso.
      const parsed = Decks.parseBudgetInput(v);
      if (!parsed.ok) {
        showToast(`Budget non valido: «${v}» non è un numero. Il tetto resta invariato.`);
        return;
      }
      await saveDeck(Decks.setBudget(current, parsed.value));
    }));
    // Solo se c'è un commander da togliere (feedback #302): l'inverso di
    // "Imposta come commander", altrimenti non c'è modo di annullarlo.
    if (current.commander) add('Rimuovi commander', () => removeCommander());
    add('Elimina…', async () => {
      const ok = await window.SN_CONFIRM_UI.confirm({
        title: 'Eliminare il mazzo?',
        text: `"${current.nome}" verrà eliminato definitivamente.`,
        okLabel: 'Elimina',
      });
      if (!ok) return;
      await send({ type: MSG.DECKS_DELETE, id: current.id });
      location.hash = '#/';
    });

    $('deckHead').appendChild(pop);
    switcherEl = pop;
    setTimeout(() => {
      document.addEventListener('click', closeSwitcher, true);
      document.addEventListener('keydown', switcherKey, true);
    }, 0);
  }

  // Scambia il bottone del nome con un campo di modifica (rinomina/budget):
  // Invio o blur salvano, Escape annulla. Un solo campo attivo alla volta.
  function startEdit(inputId, value, save) {
    const btn = $('deckName');
    const input = $(inputId);
    btn.hidden = true;
    input.hidden = false;
    input.value = value;
    input.focus();
    input.select?.();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      input.hidden = true;
      btn.hidden = false;
      if (commit) await save(input.value.trim());
      input.onblur = input.onkeydown = null;
    };
    input.onblur = () => finish(true);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
  }

  // ── Eventi ─────────────────────────────────────────────────────────────────

  function wire() {
    $('newDeck').addEventListener('click', async () => {
      const res = await send({ type: MSG.DECKS_CREATE });
      if (res && res.ok) location.hash = `#/deck/${encodeURIComponent(res.deck.id)}`;
    });
    $('openGame').addEventListener('click', () => { location.hash = '#/game'; });
    $('backToLibrary').addEventListener('click', () => { location.hash = '#/'; });
    $('gameBack').addEventListener('click', () => { location.hash = '#/'; });

    const grid = $('deckGrid');
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-deck-id]');
      if (card) location.hash = `#/deck/${encodeURIComponent(card.dataset.deckId)}`;
    });
    grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-deck-id]');
      if (card) { e.preventDefault(); location.hash = `#/deck/${encodeURIComponent(card.dataset.deckId)}`; }
    });
    grid.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('[data-deck-id]');
      if (!card) return;
      e.preventDefault();
      const id = card.dataset.deckId;
      openCtx(e.clientX, e.clientY, [
        { label: 'Duplica', run: () => duplicateDeck(id) },
        { label: 'Elimina…', run: () => deleteDeck(id) },
      ]);
    });

    $('deckName').addEventListener('click', (e) => { e.stopPropagation(); openSwitcher(); });
    // Tasto destro sulla riga del commander (§ "il tasto destro è centrale"):
    // quando un commander è impostato, offre di rimuoverlo direttamente da lì
    // (feedback #302). Senza commander il menu non ha nulla da offrire.
    $('commanderLine').addEventListener('contextmenu', (e) => {
      if (!current || !current.commander) return;
      e.preventDefault();
      openCtx(e.clientX, e.clientY, [
        { label: 'Rimuovi commander', run: () => removeCommander() },
      ]);
    });
    wireDividers();
    wireDetailPanel();

    // Chat unificata (§3): invio col form (Enter), toggle carta e collasso
    // bolle in delega sul log, risoluzione fuzzy dei nomi in prosa all'hover.
    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chatInput');
      const text = input.value.trim();
      if (!text || chatBusy) return;
      input.value = '';
      sendChat(text);
    });
    const log = $('chatLog');
    // Toggle del blocco Ragionamento (#331): click (o Invio/Spazio) apre e
    // chiude. Vale per bolle normali, pending e d'errore.
    const toggleCot = (target) => {
      const cot = target.closest && target.closest('[data-toggle-cot]');
      if (!cot) return false;
      const bubble = cot.closest('[data-msg-i]');
      const m = bubble && chatMsgs()[Number(bubble.dataset.msgI)];
      if (m) { m.cotOpen = cot.dataset.open !== '1'; renderChat(); }
      return true;
    };
    log.addEventListener('click', (e) => {
      if (toggleCot(e.target)) return;
      const impAll = e.target.closest('[data-import-all]');
      if (impAll) { importAllFromBubble(impAll.closest('[data-msg-i]')); return; }
      const add = e.target.closest('[data-add]');
      if (add) { toggleCard(add.dataset.add, Number(add.dataset.qty) || 1); return; }
      const sum = e.target.closest('[data-toggle-list]');
      if (sum) {
        const bubble = sum.closest('[data-msg-i]');
        const m = chatMsgs()[Number(bubble.dataset.msgI)];
        if (m) { m.expanded = !(m.expanded || sum.getAttribute('aria-expanded') === 'true'); renderChat(); }
        return;
      }
      // Click su una riga risultato → carosello sulla lista di QUELLA bolla (§5.3).
      const row = e.target.closest('.dk-row[data-card-id]');
      if (row) { openCarouselFromRow(row, '.dk-cardlist'); return; }
      // Click su un nome in prosa → carosello su TUTTE le carte della bolla
      // (#343); risolve da sé anche i nomi su cui non c'è stato hover.
      const span = e.target.closest('.dk-prose-card');
      if (span) openCarouselFromProse(span);
    });
    log.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target && e.target.matches && e.target.matches('[data-toggle-cot]')) {
        e.preventDefault();
        toggleCot(e.target);
      }
    });
    log.addEventListener('mouseover', (e) => {
      const span = e.target.closest('.dk-prose-card');
      if (span) resolveProseCard(span);
    });

    // Colonna mazzo: collassa/espandi i gruppi al click sul divisore.
    const list = $('deckList');
    list.addEventListener('click', (e) => {
      const head = e.target.closest('.dk-group-head');
      if (head) {
        const g = head.dataset.g;
        if (collapsedGroups.has(g)) collapsedGroups.delete(g);
        else collapsedGroups.add(g);
        renderDeckList();
        return;
      }
      // Click su una riga del mazzo → carosello sull'elenco del mazzo (§5.3).
      const row = e.target.closest('.dk-row[data-card-id]');
      if (row) openCarouselFromRow(row, '#deckList');
    });
    // Tasto destro sulla riga carta (§8.3).
    list.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.dk-row');
      if (!row) return;
      e.preventDefault();
      const id = row.dataset.cardId;
      const card = cardsById[id];
      const items = [
        { label: 'Rimuovi', run: () => removeFromDeck(id) },
        { label: 'Sposta in gruppo…', run: () => chooseGroup(e.clientX, e.clientY, id) },
        { label: 'Copia in un altro mazzo…', run: () => chooseDeck(e.clientX, e.clientY, id, false) },
        { label: 'Sposta in un altro mazzo…', run: () => chooseDeck(e.clientX, e.clientY, id, true) },
        { label: 'Imposta come commander', run: () => makeCommander(id) },
      ];
      if (card && card.scryfallUri) {
        items.push({ label: 'Apri su Scryfall', run: () => send({ type: MSG.OPEN_URL, url: card.scryfallUri }) });
      }
      openCtx(e.clientX, e.clientY, items);
    });
    // Trascina una carta su una categoria (#344). La riga è draggable; il drop
    // avviene su un intero gruppo (intestazione o righe): rilasciare ovunque
    // dentro il gruppo di destinazione conta. Un evidenziatore d'accento segue
    // il gruppo sotto il cursore (feedback: ogni azione risponde).
    let dragCardId = null;
    const clearDropHint = () => {
      for (const g of list.querySelectorAll('.dk-group.dk-drop-target')) g.classList.remove('dk-drop-target');
    };
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.dk-row[data-card-id]');
      if (!row) return;
      dragCardId = row.dataset.cardId;
      row.classList.add('dk-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragCardId); } catch (_) { /* alcuni browser lo vietano fuori da user gesture */ }
      }
    });
    list.addEventListener('dragend', (e) => {
      const row = e.target.closest && e.target.closest('.dk-row');
      if (row) row.classList.remove('dk-dragging');
      dragCardId = null;
      clearDropHint();
    });
    list.addEventListener('dragover', (e) => {
      if (!dragCardId) return;
      const group = e.target.closest && e.target.closest('.dk-group[data-group]');
      if (!group) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (!group.classList.contains('dk-drop-target')) { clearDropHint(); group.classList.add('dk-drop-target'); }
    });
    list.addEventListener('drop', (e) => {
      if (!dragCardId) return;
      const group = e.target.closest && e.target.closest('.dk-group[data-group]');
      if (!group) return;
      e.preventDefault();
      const id = dragCardId;
      const groupName = group.dataset.group;
      dragCardId = null;
      clearDropHint();
      dropCardOnGroup(id, groupName, e.clientX, e.clientY);
    });

    // Cambio di raggruppamento (vista, non dato: §8.1).
    $('groupBy').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = $('groupBy').getBoundingClientRect();
      openCtx(r.left, r.bottom + 2, [
        { label: 'per tipo', run: () => saveDeck(Decks.setRaggruppamento(current, 'tipo')) },
        { label: 'per tag', run: () => saveDeck(Decks.setRaggruppamento(current, 'tag')) },
        { label: 'per costo di mana', run: () => saveDeck(Decks.setRaggruppamento(current, 'cmc')) },
        { label: 'per colore', run: () => saveDeck(Decks.setRaggruppamento(current, 'colore')) },
      ]);
    });

    window.addEventListener('hashchange', route);

    // La finestra che si rimpicciolisce (o cambia schermo) deve ri-adattare le
    // larghezze: senza questo, con larghezze salvate più grandi dello spazio
    // disponibile la colonna centrale del mazzo spariva. Ri-applichiamo solo
    // quando il builder è visibile.
    window.addEventListener('resize', () => {
      if (!$('screenBuilder').hidden) applyLayout();
    });
  }

  async function init() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    wire();
    // Ripristino da backup: i mazzi del backup compaiono in libreria senza
    // riaprire la scheda. Se si è dentro al builder non tocchiamo niente: un
    // mazzo aperto e in modifica non va sostituito sotto le mani dell'utente.
    window.SN_PAGE_BOOTSTRAP.onDataImported(() => {
      if ($('screenLibrary').hidden) return;
      loadLibrary().catch(() => {});
    });
    await loadLayout();
    await route();
  }

  init();
})();
