// App deck builder Commander (spec: DECK-BUILDER-SPEC.md): libreria, builder a tre
// colonne, partita stub. Routing su hash: #/ libreria, #/deck/<id> builder, #/game partita.

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

  // La Partita è uno stub (spec §12): finché il tavolo non c'è nessuna strada ci porta, né il
  // pulsante né un #/game ripreso da cronologia, sessione o link, perché è un vicolo cieco (#391).
  const PARTITA_PRONTA = false;

  let decks = [];        // cache della lista per la libreria
  let current = null;    // mazzo aperto nel builder

  // Layout del Builder (§2): tre colonne a larghezza FISSA, nessun resize automatico.
  // L'unico resize è il trascinamento dei divisori; le larghezze si persistono.
  const LAYOUT_KEY = window.SN_CONST.STORAGE_KEYS.DECKS_UI;
  // Colonne esterne FISSE (chat a sinistra, dettaglio a destra), colonna del MAZZO al
  // centro flessibile: il dettaglio resta di dimensione sana anche a piena larghezza.
  const LAYOUT_DEFAULT = { leftW: 340, rightW: 340, module: 'default' };
  const LAYOUT_MIN = { leftW: 260, rightW: 280 };
  const CENTER_MIN = 260; // il mazzo (colonna flessibile) non deve sparire
  let layout = { ...LAYOUT_DEFAULT };

  // Le preferenze salvate ristrette allo spazio reale: il centro tiene sempre CENTER_MIN.
  // NON tocca `layout`: riallargando la finestra tornano le misure scelte.
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
    // minmax(0, 1fr) sul centro: può stringersi fino a 0 invece di forzare la larghezza
    // minima del contenuto e far traboccare le colonne laterali fuori dal riquadro.
    grid.style.gridTemplateColumns =
      `${leftW}px 6px minmax(0, 1fr) 6px ${rightW}px`;
  }

  async function loadLayout() {
    try {
      const res = await chrome.storage.local.get(LAYOUT_KEY);
      const saved = res && res[LAYOUT_KEY];
      if (saved && typeof saved === 'object') {
        layout.leftW = Math.max(LAYOUT_MIN.leftW, Number(saved.leftW) || LAYOUT_DEFAULT.leftW);
        // Un layout salvato senza `rightW` riparte dal default.
        layout.rightW = Math.max(LAYOUT_MIN.rightW, Number(saved.rightW) || LAYOUT_DEFAULT.rightW);
        if (DETAIL_MODULES[saved.module]) layout.module = saved.module;
      }
    } catch (_) {}
    applyLayout();
  }

  function persistLayout() {
    chrome.storage.local.set({ [LAYOUT_KEY]: { ...layout } }).catch?.(() => {});
  }

  // Trascinamento dei divisori: larghezza live, persistita al rilascio. Oltre al minimo
  // della colonna si clampa perché il mazzo al centro mantenga sempre CENTER_MIN.
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
    wireDivider($('dividerLeft'), 'leftW', (ev, rect) => ev.clientX - rect.left);
    wireDivider($('dividerRight'), 'rightW', (ev, rect) => rect.right - ev.clientX - 6);
  }

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
    // Solo il builder esce dal max-width di .sn-page: libreria e partita restano centrate.
    document.body.classList.toggle('dk-full', screen === 'builder');
    // Il grid ha larghezza reale solo da visibile: ri-clampa ora, o un mazzo riaperto con
    // larghezze salvate più grandi dello spazio corrente perde la colonna centrale.
    if (screen === 'builder') applyLayout();
  }

  async function route() {
    const r = parseRoute();
    // Una rinomina dalla libreria si salva prima che il banco di lavoro rilegga il mazzo, o lo riscriverebbe col nome vecchio.
    if (libRename) libRename.finish(true);
    await libSaving;
    if (r.screen !== 'library') libPriceToken++;
    if (r.screen === 'builder') {
      const [res] = await Promise.all([send({ type: MSG.DECKS_GET, id: r.id }), ensureChatLoaded(r.id)]);
      if (!res || !res.ok) { location.hash = '#/'; return; }
      const prevId = current && current.id;
      current = res.deck;
      // Cambio di mazzo o schermata: il pannello destro riparte dal riposo e la cache dei
      // pareri si svuota, perché i pareri sono per-mazzo (§6.2).
      if (prevId !== current.id) { opinionsByCard.clear(); opinionErrors.clear(); }
      carousel = null;
      setDetailState('stats');
      show('builder');
      await renderBuilder(true); // apertura: la chat parte dall'ultimo scambio
      return;
    }
    if (r.screen === 'game') {
      if (PARTITA_PRONTA) { show('game'); return; }
      history.replaceState(null, '', '#/');
    }
    current = null;
    await loadLibrary();
    show('library');
  }

  async function loadLibrary() {
    const res = await send({ type: MSG.DECKS_LIST });
    decks = Decks.sortForLibrary((res && res.decks) || []);
    renderLibrary();
    loadLibraryPrices();
  }

  // Prezzo totale sulla scheda (§10): stesso conto e formato del pannello statistiche (budgetInfo, fmtEur).
  // Prima la cache, poi i prezzi freschi dietro, senza far aspettare la griglia (#380).
  const PRICE_CHUNK = 25;
  let libPricesRead = false; // prima della cache la scheda tace: «n.d.» direbbe che il prezzo manca, non che arriva
  let libPriceToken = 0;

  function deckCardIds(deck) {
    const ids = deck.carte.map((c) => c.scryfall_id);
    if (deck.commander) ids.push(deck.commander);
    return ids;
  }

  function paintPrice(slot, deck) {
    if (!libPricesRead) return;
    const b = Stats.budgetInfo(deck, cardsById);
    const carte = (n) => `${n} cart${n === 1 ? 'a' : 'e'}`;
    if (b.missing && !b.total) {
      slot.textContent = 'prezzo n.d.';
      slot.title = `Prezzo non noto per ${carte(b.missing)}`;
    } else if (b.missing) {
      slot.textContent = `≥ ${fmtEur(b.total)}`;
      slot.title = `Totale parziale: ${carte(b.missing)} senza prezzo noto`;
    } else {
      slot.textContent = fmtEur(b.total);
      slot.title = 'Prezzo totale del mazzo';
    }
    slot.dataset.missing = String(b.missing);
  }

  function paintLibraryPrices() {
    for (const el of $('deckGrid').querySelectorAll('[data-deck-id]')) {
      const deck = decks.find((d) => d.id === el.dataset.deckId);
      const slot = el.querySelector('.dk-price');
      if (deck && slot) paintPrice(slot, deck);
    }
  }

  // I freschi vanno mazzo per mazzo nell'ordine della griglia e a pezzi: lasciata la libreria il giro si ferma al
  // pezzo dopo, invece di occupare Scryfall con mazzi che nessuno sta guardando.
  async function loadLibraryPrices() {
    const token = ++libPriceToken;
    const live = () => token === libPriceToken;
    const all = [...new Set(decks.flatMap(deckCardIds))];
    if (all.length) {
      const r = await send({ type: MSG.SCRYFALL_CARDS, ids: all, cacheOnly: true }).catch(() => null);
      if (!live()) return;
      Object.assign(cardsById, (r && r.ok && r.cards) || {});
    }
    libPricesRead = true;
    paintLibraryPrices();
    const seen = new Set();
    for (const deck of decks) {
      const ids = deckCardIds(deck).filter((id) => !seen.has(id));
      ids.forEach((id) => seen.add(id));
      for (let i = 0; i < ids.length; i += PRICE_CHUNK) {
        if (!live()) return;
        const r = await send({ type: MSG.SCRYFALL_CARDS, ids: ids.slice(i, i + PRICE_CHUNK), freshPrices: true }).catch(() => null);
        if (!live()) return;
        if (r && r.ok && r.cards) {
          Object.assign(cardsById, r.cards);
          paintLibraryPrices();
        }
      }
    }
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
            <span class="dk-price"></span>
            <span style="margin-left:auto">${esc(dateStr)}</span>
          </div>
        </div>
      </div>`;
  }

  function renderLibrary() {
    const grid = $('deckGrid');
    grid.innerHTML = decks.map(deckCardHtml).join('');
    $('deckEmpty').hidden = decks.length > 0;
    paintLibraryPrices();
  }

  function libraryCardEl(id) {
    return [...$('deckGrid').querySelectorAll('[data-deck-id]')].find((el) => el.dataset.deckId === id) || null;
  }

  // Rinomina dalla libreria: un campo al posto del titolo, come nel banco di lavoro (Invio o uscita salvano, Esc
  // annulla). La scheda resta al suo posto: il riordino per data aspetta il prossimo giro della libreria (#509).
  let libRename = null;
  let libSaving = Promise.resolve();

  function renameFromLibrary(id) {
    if (libRename) libRename.finish(true);
    const cardEl = libraryCardEl(id);
    const deck = decks.find((d) => d.id === id);
    if (!cardEl || !deck) return;
    const title = cardEl.querySelector('.sn-card-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dk-card-rename';
    input.setAttribute('aria-label', 'Rinomina il mazzo');
    input.value = deck.nome;
    title.hidden = true;
    title.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      libRename = null;
      const refocus = document.activeElement === input;
      const nome = input.value;
      input.remove();
      title.hidden = false;
      if (commit) libSaving = libSaving.then(() => saveLibraryName(id, nome, refocus)).catch(() => {});
      else if (refocus) cardEl.focus();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    libRename = { finish };
  }

  // Si rinomina il mazzo salvato, non la riga della griglia: quella può essere più vecchia di una modifica fatta altrove.
  async function saveLibraryName(id, nome, refocus) {
    const r = await send({ type: MSG.DECKS_GET, id });
    if (!r || !r.ok) return;
    const next = Decks.renameDeck(r.deck, nome);
    if (next === r.deck) return;
    const res = await send({ type: MSG.DECKS_UPDATE, deck: next });
    if (!res || !res.ok) { toastErrore('Rinomina non riuscita.'); return; }
    const i = decks.findIndex((d) => d.id === id);
    if (i >= 0) decks[i] = res.deck;
    const old = libraryCardEl(id);
    if (!old) return;
    old.insertAdjacentHTML('afterend', deckCardHtml(res.deck));
    const fresh = old.nextElementSibling;
    old.remove();
    paintPrice(fresh.querySelector('.dk-price'), res.deck);
    if (refocus) fresh.focus();
  }

  // ── Menu contestuale sulla card (duplica / esporta / rinomina / elimina) ───
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
      // Un dato da leggere sotto la voce (la ricerca esatta di una lista, #788): va a capo, non si taglia.
      if (it.detail) {
        row.classList.add('dk-ctx-has-detail');
        const d = document.createElement('code');
        d.className = 'dk-ctx-detail';
        d.textContent = it.detail;
        row.appendChild(d);
      }
      row.addEventListener('click', (e) => { e.stopPropagation(); closeCtx(); it.run(); });
      pop.appendChild(row);
    }
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    pop.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    ctxEl = pop;
    document.addEventListener('keydown', ctxKey, true);
    setTimeout(() => {
      if (ctxEl !== pop) return;
      document.addEventListener('click', closeCtx, true);
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
      parti: deck && deck.nome ? ['Il mazzo', { citazione: deck.nome }, 'verrà eliminato definitivamente.'] : null,
      okLabel: 'Elimina',
    });
    if (!ok) return;
    stopTurnOf(chatByDeck.get(id));
    await send({ type: MSG.DECKS_DELETE, id });
    await loadLibrary();
  }

  // Budget: formato italiano come ogni altro prezzo dell'app («40,50», non «40.5»).
  function fmtBudgetShort(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  }
  function fmtBudgetInput(b) {
    return (b === null || b === undefined) ? '' : fmtBudgetShort(b);
  }

  // `stickChat`: all'apertura del mazzo la chat mostra l'ultimo scambio; nei refresh dopo
  // una modifica si rispetta invece la posizione dell'utente.
  async function renderBuilder(stickChat) {
    $('deckNameText').textContent = current.nome;
    const line = $('commanderLine');
    const commanderName = current.commander && current.commanderMeta && current.commanderMeta.name;
    line.textContent = commanderName ? 'Commander: ' : 'Nessun commander. Impostalo col tasto destro su una carta.';
    if (commanderName) {
      // Il nome del commander è un nome di carta come gli altri (§5.1): anteprima al passaggio, carosello al clic.
      const name = document.createElement('span');
      name.className = 'dk-prose-card';
      name.dataset.cardId = current.commander;
      name.textContent = commanderName;
      line.appendChild(name);
    }
    if (current.budget !== null && current.budget !== undefined) {
      line.appendChild(document.createTextNode(` · Budget: ${fmtBudgetShort(current.budget)} €`));
    }
    // Suggerisce, senza ingombrare, come tornare indietro (feedback #302).
    $('commanderLine').title = current.commander
      ? 'Tasto destro per rimuovere il commander' : '';
    $('deckCount').textContent = `${Decks.deckCount(current)}/100 carte`;
    // Cache-first: l'elenco compare SUBITO coi campi statici già in cache; i prezzi freschi
    // arrivano dopo, in background, senza far aspettare le carte (feedback #380).
    await Promise.all([ensureSymbols(), loadDeckCards(), loadChatCards()]);
    refreshOpinionStaleness();
    renderDeckList();
    renderChat(stickChat);
    renderStats();
    syncDetailInDeck();
    refreshPrices();
  }

  async function saveDeck(next) {
    if (next === current) return;
    const res = await send({ type: MSG.DECKS_UPDATE, deck: next });
    if (res && res.ok) { current = res.deck; await renderBuilder(); }
  }

  // Versione del mazzo avanzata: i pareri calcolati su versioni precedenti diventano
  // stantii SUL POSTO (§6.2) — restano visibili, marcati.
  function refreshOpinionStaleness() {
    for (const op of opinionsByCard.values()) {
      op.stale = (Number(op.versione) || 0) < (Number(current.versione) || 1);
    }
  }

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

  // Default cache-first sui campi STATICI: l'elenco compare subito, senza rete.
  // freshPrices rifetcha i prezzi stantii (TTL 6h, §9.2): lento, sempre in background.
  async function loadDeckCards({ freshPrices = false } = {}) {
    const ids = current.carte.map((c) => c.scryfall_id);
    if (current.commander) ids.push(current.commander);
    if (!ids.length) return;
    const r = await send({ type: MSG.SCRYFALL_CARDS, ids, freshPrices });
    // MERGE, mai sostituzione: la cache di pagina contiene anche le carte dei
    // risultati chat (sendChat, loadChatCards) e dei nomi in prosa risolti
    // (resolveProseCard): dopo un edit del mazzo l'hover su quei risultati deve
    // continuare ad aprire la preview.
    Object.assign(cardsById, (r && r.ok && r.cards) || {});
  }

  // Refresh prezzi in background (§9.2): aggiorna le sole parti che dipendono dal prezzo.
  // Il token scarta un refresh in corso se intanto si è cambiato mazzo.
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

  // Precarico immagini (§5.1): scaldare la cache HTTP appena le righe sono visibili rende
  // istantaneo il primo hover. Priorità bassa, ordine di lettura, dedup per URL.
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
  // Solo le righe VISIBILI: tutto il mazzo più le liste risultati APERTE (una lista
  // incollata ha centinaia di righe collassate: si scaldano quando l'utente le espande).
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

  // Riepilogo di legalità (§8.4): compare SOLO quando c'è un problema (doppioni,
  // identity, banned).
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

  // Stato di riposo del pannello destro: statistiche calcolate in pagina (§9), non dal main.

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
  // mazzo + "terre"), con accanto quante ne servono nella mano per tenerla
  // (visibile solo con almeno un mulligan). I valori digitati sopravvivono al rerender.
  function renderProbForm() {
    const cats = Stats.categoriesOf(current, cardsById);
    const host = $('probNeeds');
    const prev = {};
    const prevKeep = {};
    for (const inp of host.querySelectorAll('input[data-tag]')) prev[inp.dataset.tag] = inp.value;
    for (const inp of host.querySelectorAll('input[data-keep]')) prevKeep[inp.dataset.keep] = inp.value;
    host.innerHTML = cats.map((tag, i) => `
      <div class="dk-prob-row">
        <label for="probTag${i}">${esc(tag)}</label>
        <input id="probTag${i}" data-tag="${esc(tag)}" type="number"
               min="0" max="99" step="1" value="${esc(prev[tag] || '0')}" />
        <input class="dk-prob-keep" data-keep="${esc(tag)}" type="number" min="0" max="7" step="1"
               value="${esc(prevKeep[tag] || '0')}" aria-label="${esc(tag)} nella mano da tenere"
               title="Quante ne vuoi nella mano iniziale per tenerla" />
      </div>`).join('');
    $('probHint').hidden = cats.length > 1;
    $('probCard').hidden = !cats.length;
  }

  // Partita (#791): Commander si gioca in più persone, quindi il default pesca al primo turno.
  const PROB_GAMES = [
    { id: 'multi', label: 'a più giocatori' },
    { id: 'play', label: 'a due, inizio io' },
    { id: 'draw', label: 'a due, inizia l\'altro' },
  ];
  function setProbGame(id) {
    const g = PROB_GAMES.find((x) => x.id === id) || PROB_GAMES[0];
    $('probGame').dataset.game = g.id;
    $('probGame').textContent = `${g.label} ▾`;
  }

  const probCount = (id, max) => Math.min(max, Math.max(0, Math.floor(Number($(id).value) || 0)));

  function probConditions() {
    const mulligans = probCount('probMull', 7);
    const keep = mulligans > 0
      ? [...$('probNeeds').querySelectorAll('input[data-keep]')]
        .map((inp) => ({ tag: inp.dataset.keep, n: Number(inp.value) || 0 }))
        .filter((w) => w.n > 0)
      : [];
    return { game: $('probGame').dataset.game, mulligans, keep, extraDraws: probCount('probExtra', 99) };
  }

  // Con il primo mulligan compare la colonna «per tenere»: se è vuota parte da
  // 2 terre, la mano più comune da tenere, perché un mulligan senza mano da
  // tenere non cambierebbe niente.
  let probMullBefore = 0;
  function onProbMull() {
    const m = probCount('probMull', 7);
    $('probCard').dataset.mull = m > 0 ? '1' : '0';
    const keeps = [...$('probNeeds').querySelectorAll('input[data-keep]')];
    if (m > 0 && probMullBefore === 0 && keeps.every((inp) => !(Number(inp.value) > 0))) {
      for (const w of Stats.DEFAULT_KEEP) {
        const inp = keeps.find((x) => x.dataset.keep === w.tag);
        if (inp) inp.value = String(w.n);
      }
    }
    probMullBefore = m;
  }

  // Calcolatore di probabilità (§9.3): la stima si raffina DA SOLA (feedback
  // #354). Appena cambiano le condizioni (turno, categorie, partita, mulligan,
  // pescate extra o il mazzo) riparte una simulazione progressiva: un primo batch dà subito una
  // stima, i batch successivi si accumulano e la fanno convergere verso il vero
  // valore, poi si ferma. Niente più bottone "Calcola" né oscillazione del
  // risultato tra un ricalcolo e l'altro.
  //
  //   PROB_BATCH  simulazioni per giro (SN_DECK_STATS, condiviso con la chat)
  //   PROB_CAP    tetto totale = 100× le 10.000 di prima. A 1.000.000 di mani
  //               l'errore statistico è ~0,05 punti percentuali (ben sotto
  //               l'oscillazione di ~1 punto segnalata): salire oltre non
  //               cambierebbe la cifra mostrata, costerebbe solo CPU.
  const PROB_BATCH = Stats.PROB_BATCH;
  const PROB_CAP = 1000000;
  let probRunId = 0;         // invalida i batch di run precedenti
  let probDebounce = null;

  function probWants() {
    return [...$('probNeeds').querySelectorAll('input[data-tag]')]
      .map((inp) => ({ tag: inp.dataset.tag, n: Number(inp.value) || 0 }))
      .filter((w) => w.n > 0);
  }

  function runProb() {
    const runId = ++probRunId;
    const out = $('probResult');
    const want = probWants();
    if (!want.length) {
      out.textContent = 'Scegli almeno una categoria.';
      out.classList.remove('dk-prob-refining');
      out.removeAttribute('title');
      return;
    }
    const turn = Math.max(1, Number($('probTurn').value) || 1);
    const cond = probConditions();
    const library = Stats.buildLibrary(current, cardsById);
    let hits = 0; let iters = 0; let batchSeed = 1; let seen = 0;
    out.classList.add('dk-prob-refining');

    const step = () => {
      if (runId !== probRunId) return; // le condizioni sono cambiate: molla
      const r = Stats.simulate({ library, want, turn, ...cond, iterations: PROB_BATCH, seed: batchSeed++ });
      hits += r.hits; iters += r.iterations; seen = r.seen;
      const p = hits / iters;
      out.textContent = `≈ ${(p * 100).toFixed(1).replace('.', ',')}%`;
      out.title = `${iters.toLocaleString('it-IT', { useGrouping: true })} mani simulate, ${seen} carte viste`
        + (cond.keep.length ? ' tenendo la prima mano' : '');
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

  // Debounce: digitare più cifre o una raffica di rerender non deve lanciare mille run.
  function scheduleProb() {
    clearTimeout(probDebounce);
    // Il numero di prima non vale più: il puntino lo dice già durante l'attesa.
    $('probResult').classList.add('dk-prob-refining');
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
    // Mazzo cambiato: riraffina da sé, senza che l'utente debba ricalcolare.
    scheduleProb();
  }

  async function removeFromDeck(cardId) {
    const { deck, removed } = Decks.removeCard(current, cardId);
    if (removed) await saveDeck(deck);
  }

  // Lo spostamento è PER-VISTA (feedback #316): cambiando raggruppamento la carta torna a
  // raggrupparsi col nuovo criterio invece di trascinarsi dietro il gruppo forzato altrove.
  function chooseGroup(x, y, cardId) {
    const view = current.raggruppamento || 'tipo';
    const items = Decks.groupDeck(current, cardsById).map((g) => ({
      label: g.name,
      run: () => saveDeck(Decks.setGroupOverride(current, cardId, g.name, view)),
    }));
    // «(gruppo naturale)» solo se in questa vista c'è un override: altrimenti è un no-op.
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

  // Nella vista «per tag» la categoria È un tag: scelta aggiungi-vs-sostituisci; altrove il
  // drop forza il gruppo. Popup SOLO se le due opzioni divergono (#344).
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

    // «Senza tag»: rilasciarci sopra significa togliere ogni tag (l'inverso del drag).
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

  // Se la destinazione ha già la carta le quantità si SOMMANO, mai un no-op silenzioso.
  // L'origine si svuota solo dopo che la destinazione è salvata; ogni esito ha il suo toast.
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
          toastErrore(`${verb} non riuscito: mazzo "${d.nome}" non raggiungibile.`);
          return;
        }
        const { deck: target, merged } = Decks.mergeCard(t.deck, cardId, {
          qty: entry ? entry.qty : 1, tags: entry ? entry.tags : [],
        });
        const up = await send({ type: MSG.DECKS_UPDATE, deck: target });
        if (!up || !up.ok) {
          toastErrore(`${verb} non riuscito: "${d.nome}" non è stato aggiornato.`);
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

  // Imposta, cambia o toglie (id vuoto) il commander (§8.4): chi esce dall'elenco e chi ci rientra lo decide il main
  // (Decks.replaceCommander); qui la riga che dice quale carta è tornata nel mazzo, per poterla togliere (#789).
  async function setCommanderTo(cardId) {
    const r = await send({ type: MSG.DECKS_SET_COMMANDER, id: current.id, scryfallId: cardId });
    if (!r || !r.ok) {
      toastErrore('Non sono riuscito a cambiare il commander.');
      return;
    }
    if (!current || r.deck.id !== current.id) return;
    current = r.deck;
    await renderBuilder();
    if (r.previous) showToast(`${r.previous.name || 'Il commander di prima'} torna nel mazzo come carta normale.`);
  }
  function makeCommander(cardId) { return setCommanderTo(cardId); }
  function removeCommander() { return current.commander ? setCommanderTo('') : Promise.resolve(); }

  // Le azioni su una carta fuori dall'elenco del mazzo (risultati, nomi citati, intestazione, carta grande), le stesse
  // della riga del mazzo dove hanno senso (§8.3): il commander offre di toglierlo, le altre di entrare, uscire o diventarlo.
  function cardMenuItems(id, qty = 1) {
    const card = cardsById[id];
    const items = id === current.commander
      ? [{ label: 'Rimuovi commander', run: () => removeCommander() }]
      : [
          inDeck(id)
            ? { label: 'Rimuovi dal mazzo', run: () => { if (inDeck(id)) toggleCard(id); } }
            : { label: 'Aggiungi al mazzo', run: () => { if (!inDeck(id)) toggleCard(id, qty); } },
          { label: 'Imposta come commander', run: () => makeCommander(id) },
        ];
    if (card && card.scryfallUri) {
      items.push({ label: 'Apri su Scryfall', run: () => send({ type: MSG.OPEN_URL, url: card.scryfallUri }) });
    }
    return items;
  }

  // ── Colonna Chat / Risultati (§3): la ricerca È la chat ────────────────────
  // Messaggi TIPIZZATI (§3.2): una bolla utente è testo; una bolla di Filo può
  // avere testo (con [[Nome Carta]] resi span hoverable, §3.5) e/o una CardList
  // renderizzata dagli ID salvati come DATI (mai markdown). L'ultima bolla
  // mostra la lista con scroll interno; le precedenti collassano a una riga di
  // sintesi riespandibile (§3.3). Stato per-mazzo e SALVATO (#787): cosa di una
  // bolla si conserva lo decide SN_DECK_CHAT, lo scrive il main una modifica alla volta (DECKS_CHAT_EDIT).

  const Chat = window.SN_DECK_CHAT;
  const chatByDeck = new Map(); // deckId → [{ who, text, reply, cardIds, query, error, pending, interrupted, expanded, … }]
  const chatLoading = new Map(); // deckId → lettura in corso
  // Per conversazione, non globale: svuotata la chat mentre Filo risponde, la nuova è subito libera. Il turno resta
  // qui finché la sua bolla non è scritta; arrivata o fermata la risposta, la chat è già dell'utente (chatTaken).
  const busyChats = new WeakMap(); // conversazione → { bot, reqId, startedAt, stopped, stop }
  function chatTaken(msgs) {
    const t = msgs && busyChats.get(msgs);
    return !!t && !!t.bot.pending;
  }
  // Una risposta che nessuno leggerà più (chat svuotata, mazzo eliminato) non si lascia lavorare a pagamento.
  function stopTurnOf(msgs) {
    const t = msgs && busyChats.get(msgs);
    if (t && !t.stopped) t.stop();
  }
  // Cambiata altrove mentre qui si aspettava Filo: si rilegge appena la risposta è scritta.
  const staleChats = new WeakSet();
  // Chi ha salvato: la scheda che scrive non si rilegge al proprio avviso (DECKS_CHAT_CHANGED).
  const chatClientId = `dk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function chatMsgs() {
    if (!chatByDeck.has(current.id)) chatByDeck.set(current.id, []);
    return chatByDeck.get(current.id);
  }

  function ensureChatLoaded(deckId) {
    if (chatByDeck.has(deckId)) return Promise.resolve(chatByDeck.get(deckId));
    if (chatLoading.has(deckId)) return chatLoading.get(deckId);
    const p = send({ type: MSG.DECKS_CHAT_GET, deckId }).catch(() => null).then((r) => {
      chatLoading.delete(deckId);
      if (!chatByDeck.has(deckId)) {
        const msgs = (r && r.ok && Array.isArray(r.messages)) ? r.messages : [];
        rememberProseNames(msgs);
        chatByDeck.set(deckId, msgs);
      }
      return chatByDeck.get(deckId);
    });
    chatLoading.set(deckId, p);
    return p;
  }

  // Una modifica alla volta sulla chat salvata (SN_DECK_CHAT.applyEdit), mai la chat intera dalla memoria di questa
  // scheda. Oltre il tetto il main rifiuta, e renderChat lo dice sotto l'ultima bolla.
  function editChat(deckId, change) {
    return send({ type: MSG.DECKS_CHAT_EDIT, deckId, clientId: chatClientId, ...change }).catch(() => null);
  }

  // I nomi in prosa risolti, raccolti per bolla e scritti insieme: passare il mouse su dieci nomi è una scrittura.
  const namesToSave = new Map(); // bolla → mazzo
  let namesTimer = 0;
  function saveNamesSoon(deckId, m) {
    if (!m.turn) return;
    namesToSave.set(m, deckId);
    clearTimeout(namesTimer);
    namesTimer = setTimeout(() => {
      for (const [bubble, id] of namesToSave) editChat(id, { op: 'names', turn: bubble.turn, nameIds: bubble.nameIds });
      namesToSave.clear();
    }, 400);
  }

  function newTurnId() {
    return `${chatClientId}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  // Le carte della chat riaperta: prima dalla cache (subito), poi dalla rete le poche che mancano, senza far
  // aspettare la pagina. Una carta già chiesta alla rete non si richiede a ogni ridisegno.
  const chatCardsAsked = new Set();
  async function loadChatCards() {
    if (!current) return;
    const missing = Chat.cardIdsOf(chatByDeck.get(current.id)).filter((id) => !cardsById[id]);
    if (!missing.length) return;
    const r = await send({ type: MSG.SCRYFALL_CARDS, ids: missing, cacheOnly: true }).catch(() => null);
    Object.assign(cardsById, (r && r.ok && r.cards) || {});
    const still = missing.filter((id) => !cardsById[id] && !chatCardsAsked.has(id));
    if (!still.length) return;
    for (const id of still) chatCardsAsked.add(id);
    send({ type: MSG.SCRYFALL_CARDS, ids: still }).then((r2) => {
      if (!(r2 && r2.ok && r2.cards && Object.keys(r2.cards).length)) return;
      Object.assign(cardsById, r2.cards);
      if (current && !$('screenBuilder').hidden) renderChat();
    }).catch(() => {});
  }

  // Un'altra scheda ha cambiato la chat di un mazzo che qui è in memoria: si rilegge. Se qui c'è una risposta in
  // volo si aspetta che sia scritta (la bolla che la aspetta vive in questa memoria), poi si rilegge.
  function onChatChangedElsewhere(msg) {
    if (!msg || msg.type !== MSG.DECKS_CHAT_CHANGED || msg.clientId === chatClientId) return;
    const deckId = String(msg.deckId || '');
    const msgs = chatByDeck.get(deckId);
    if (!msgs) return;
    if (busyChats.has(msgs)) { staleChats.add(msgs); return; }
    rereadChat(deckId, msgs);
  }

  function rereadChat(deckId, msgs) {
    return send({ type: MSG.DECKS_CHAT_GET, deckId }).then(async (r) => {
      if (!(r && r.ok && Array.isArray(r.messages))) return;
      if (chatByDeck.get(deckId) !== msgs || busyChats.has(msgs)) return;
      rememberProseNames(r.messages);
      chatByDeck.set(deckId, r.messages);
      if (!current || current.id !== deckId || $('screenBuilder').hidden) return;
      await loadChatCards();
      renderChat();
    }).catch(() => {});
  }

  async function clearChat() {
    const deck = current;
    if (!deck || !(chatByDeck.get(deck.id) || []).length) return;
    const ok = await window.SN_CONFIRM_UI.confirm({
      title: 'Svuotare la chat?',
      text: `La conversazione su "${deck.nome}" sparisce per sempre. Il mazzo resta com'è.`,
      parti: deck.nome ? ['La conversazione sul mazzo', { citazione: deck.nome }, "sparisce per sempre. Il mazzo resta com'è."] : null,
      okLabel: 'Svuota',
    });
    if (!ok) return;
    stopTurnOf(chatByDeck.get(deck.id));
    chatByDeck.set(deck.id, []);
    if (current && current.id === deck.id) renderChat(true);
    await send({ type: MSG.DECKS_CHAT_CLEAR, deckId: deck.id, clientId: chatClientId }).catch(() => {});
  }

  // «Riprova» sull'ultima bolla fallita, interrotta o riuscita solo in parte: lo stesso turno rifatto, non una domanda in più.
  function retryLastTurn() {
    const msgs = chatMsgs();
    if (chatTaken(msgs)) return;
    const bot = msgs[msgs.length - 1];
    const user = msgs[msgs.length - 2];
    if (!bot || bot.who !== 'bot' || !(bot.error || bot.interrupted || bot.stopped || bot.retryable)) return;
    if (!user || user.who !== 'user' || !user.text) return;
    msgs.splice(msgs.length - 2, 2);
    editChat(current.id, { op: 'drop', turn: bot.turn || '', userText: user.text });
    sendChat(user.text);
  }

  function inDeck(cardId) {
    return current.carte.some((c) => c.scryfall_id === cardId);
  }

  // Riga della CardList (§3.4): nome + costo mana destro-allineato + toggle
  // aggiungi-al-mazzo. L'immagine non è nella riga: si mostra nella preview del
  // detail all'hover, ma è già precaricata (preloadVisibleCards) così è istantanea.
  // `qty` arriva dall'import (§11.2, es. "37 Forest"): il toggle la userà
  // come quantità reale invece del default 1 delle ricerche normali.
  // `unchecked`: il giudice non l'ha potuta guardare (§4.1), la riga lo dice.
  function chatRowHtml(id, qty, unchecked) {
    const card = cardsById[id];
    const name = card ? card.name : id;
    const mana = card ? manaHtml(card.manaCost) : '';
    const added = inDeck(id);
    const q = Number(qty) > 1 ? Number(qty) : 0;
    const flag = unchecked ? '<span class="dk-row-flag" title="Non controllata: potrebbe non c\'entrare">?</span>' : '';
    const addBtn = id === current.commander
      ? `<button class="dk-add" data-add="${esc(id)}" data-in="cmd" aria-disabled="true"
                title="È il commander del mazzo" aria-label="${esc(name)} è il commander del mazzo">✓</button>`
      : `<button class="dk-add" data-add="${esc(id)}" data-qty="${q || 1}" data-in="${added ? 1 : 0}"
                title="${added ? 'Rimuovi dal mazzo' : 'Aggiungi al mazzo'}"
                aria-label="${added ? `Rimuovi ${esc(name)} dal mazzo` : `Aggiungi ${esc(name)} al mazzo`}">${added ? '✓' : '+'}</button>`;
    return `
      <div class="dk-row${unchecked ? ' dk-row-unchecked' : ''}" data-card-id="${esc(id)}">
        ${addBtn}
        <span class="dk-row-name">${q ? `<span class="dk-row-qty">${q}×</span> ` : ''}${esc(name)}</span>${flag}
        <span class="dk-row-mana">${mana}</span>
      </div>`;
  }

  // Prosa con [[Nome Carta]] → span hoverable (§3.5). I nomi già risolti rinascono col loro
  // data-card-id dopo un rerender: senza, click ed evidenziazione smettevano di funzionare.
  function proseHtml(text) {
    return window.SN_SCRYFALL_Q.proseSegments(text).map((seg) => {
      if (seg.type !== 'card') return esc(seg.text);
      const known = proseIdByName.get(String(seg.name).toLowerCase());
      const card = known && cardsById[known];
      const title = card ? ` title="${esc(`${card.name} — ${card.typeLine}`)}"` : '';
      return `<span class="dk-prose-card" data-card-name="${esc(seg.name)}"${known ? ` data-card-id="${esc(known)}"` : ''}${title}>${esc(seg.name)}</span>`;
    }).join('');
  }

  // Ragionamento del modello (#331): aperto mentre Filo pensa (si vede scorrere in diretta),
  // collassato a risposta arrivata, salvo scelta esplicita dell'utente (m.cotOpen).
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

  // Bolla in attesa: la frase del modello appena c'è, e la fase della ricerca con quante carte su quante (#382).
  function progressHtml(p) {
    if (!p || !(p.total > 0)) return '<div class="dk-msg-pending">Filo sta pensando…</div>';
    const n = (x) => Number(x).toLocaleString('it-IT', { useGrouping: true });
    const done = Math.min(Number(p.done) || 0, p.total);
    const label = p.fase === 'controllo'
      ? `Controllo una per una le ${n(p.total)} carte trovate…`
      : 'Cerco le carte su Scryfall…';
    const pct = Math.round((done / p.total) * 100);
    return `${p.reply ? `<p class="dk-msg-text">${proseHtml(p.reply)}</p>` : ''}
      <div class="dk-msg-pending dk-progress" role="status">
        <span>${esc(label)}</span><span class="dk-progress-n">${n(done)} di ${n(p.total)}</span>
        <span class="dk-progress-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </div>`;
  }

  function chatBubbleHtml(m, isLast) {
    if (m.who === 'user') return `<div class="dk-msg dk-msg-user">${esc(m.text)}</div>`;
    if (m.pending) return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${cotHtml(m)}${progressHtml(m.progress)}</div>`;
    // Solo l'ultima bolla si riprova: rifarne una in mezzo metterebbe la risposta fuori posto.
    const retry = isLast ? '<button class="dk-retry" data-retry="1" title="Rimanda la stessa domanda">↻ Riprova</button>' : '';
    // La frase nomina la pagina dove si rimedia: il tasto per andarci viene prima di «Riprova», che finché
    // l'ostacolo resta rimanda la stessa domanda allo stesso muro (#663, #828.1). Come «Riprova», sull'ultima bolla.
    const pagina = isLast && m.rimedio ? window.SN_CHAT_ERRORS?.rimedioPagina?.(m.rimedio) : null;
    const via = pagina ? `<button class="dk-retry dk-rimedio" data-rimedio="1" title="${esc(pagina.title || '')}">${esc(pagina.label)}</button>` : '';
    if (m.interrupted) return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${cotHtml(m)}<div class="dk-msg-pending">Risposta interrotta. La pagina si è chiusa prima che Filo finisse.</div>${retry}</div>`;
    if (m.stopped) return `<div class="dk-msg dk-msg-bot dk-msg-stopped" data-msg-i="${m._i}">${cotHtml(m)}<div class="dk-msg-pending">Risposta fermata.</div>${retry}</div>`;
    if (m.error) return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${cotHtml(m)}<div class="dk-msg-error">Non ha funzionato: ${esc(m.error)}</div>${via}${retry}</div>`;
    const parts = [cotHtml(m)];
    // Risposta fermata a metà: la riga lo dice da nota, non da risposta, e l'ultima bolla offre «Continua».
    const CE = window.SN_CHAT_ERRORS;
    const righe = String(m.reply || '').split('\n');
    const interrotta = righe.length > 1 && !!CE?.eFraseInterrotta?.(righe[righe.length - 1]);
    const testo = interrotta ? righe.slice(0, -1).join('\n') : m.reply;
    if (testo) parts.push(`<p class="dk-msg-text">${proseHtml(testo)}</p>`);
    if (interrotta) {
      parts.push(`<div class="dk-msg-pending">${esc(righe[righe.length - 1])}</div>`);
      if (isLast) parts.push('<button class="dk-retry" data-continua="1" title="Continua la risposta da dove si è interrotta">Continua</button>');
    }
    // Sopra la lista: con decine di righe, sotto non lo vedrebbe nessuno.
    if (via) parts.push(via);
    if (m.retryable) parts.push(retry);
    if (m.clearChat) {
      parts.push('<button class="dk-retry" data-clear-chat="1" title="Chiede conferma, poi svuota la chat di questo mazzo">Svuota la chat…</button>');
    } else if (m.cardIds && m.cardIds.length) {
      const label = Chat.listLabel(m.cardIds.length, m.title);
      // Le righe di una lista chiusa non si disegnano: una chat salvata cresce di sessione in sessione, e
      // renderChat gira a ogni pezzo di ragionamento. Senza una scelta dell'utente è aperta solo l'ultima (§3.3).
      const open = m.expanded === undefined ? isLast : !!m.expanded;
      const ids = open ? Chat.sortIds(m.cardIds, cardsById, m.sort) : [];
      // Import via chat (§11.2): oltre al toggle per riga, un bottone che
      // aggiunge/aggiorna TUTTE le carte riconosciute in un colpo solo — con
      // 100 carte di una lista incollata, cliccare riga per riga è attrito
      // puro. Resta comunque una conferma esplicita, mai automatica.
      const unchecked = new Set(open && Array.isArray(m.uncheckedIds) ? m.uncheckedIds : []);
      const importDone = open && !!m.importQty && !importAllWouldChange(m);
      const importAllHtml = open && m.importQty
        ? `<button class="dk-import-all" data-import-all="1" ${importDone ? 'disabled' : ''}>${importDone ? 'Aggiunte ✓' : 'Aggiungi tutte al mazzo'}</button>`
        : '';
      parts.push(`
        <button class="dk-list-summary" data-toggle-list="1" aria-expanded="${open ? 'true' : 'false'}" title="${esc(label)}">
          <span>${open ? '▾' : '▸'}</span>
          <span class="dk-list-title">${esc(label)}</span>
        </button>
        <div class="dk-cardlist" ${open ? '' : 'hidden'}>${open ? importAllHtml + ids.map((id) => chatRowHtml(id, m.importQty && m.importQty[id], unchecked.has(id))).join('') : ''}</div>`);
    } else if (!m.reply) {
      parts.push('<p class="dk-msg-text dk-msg-pending">Nessun risultato.</p>');
    }
    return `<div class="dk-msg dk-msg-bot" data-msg-i="${m._i}">${parts.join('')}</div>`;
  }

  // `stickBottom` = "porta comunque la vista in fondo" (nuovo turno dell'utente:
  // vuole vedere il messaggio appena inviato). Negli altri casi si segue il fondo
  // SOLO se l'utente era già in fondo: durante la generazione renderChat gira in
  // continuazione (i chunk di ragionamento, ~ogni 250ms) e non deve strappare la
  // vista mentre l'utente scrolla per leggere (#336).
  // Ridisegno per differenza: si rifà solo la bolla il cui HTML è cambiato (la risposta in arrivo, la lista
  // aperta, i + dopo un'aggiunta). La chat salvata cresce di sessione in sessione, e rifarla tutta a ogni pezzo di
  // ragionamento bloccava la pagina (#787).
  // Le bolle stanno a gruppi di CHAT_CHUNK: cambiare l'ultima fa ricalcolare la posizione del suo gruppo, non di
  // migliaia di bolle.
  const CHAT_CHUNK = 50;
  let chatDom = []; // [{ html, el }], nell'ordine delle bolle nel log
  function renderChat(stickBottom) {
    if (!current) return;
    const log = $('chatLog');
    const prevTop = log.scrollTop;
    // "vicino al fondo" con tolleranza: seguire anche se manca qualche px.
    const follow = stickBottom || (log.scrollHeight - prevTop - log.clientHeight < 48);
    const msgs = chatMsgs();
    msgs.forEach((m, i) => { m._i = i; });
    $('chatEmpty').hidden = msgs.length > 0;
    $('chatClear').hidden = msgs.length === 0;
    const htmls = msgs.map((m, i) => chatBubbleHtml(m, i === msgs.length - 1));
    if (chatDom.some((d) => !log.contains(d.el))) chatDom = [];
    if (!chatDom.length) for (const el of log.querySelectorAll('.dk-chat-chunk, .dk-msg')) el.remove();
    const chunks = [...log.querySelectorAll(':scope > .dk-chat-chunk')];
    const chunkFor = (i) => {
      const c = Math.floor(i / CHAT_CHUNK);
      while (chunks.length <= c) {
        const div = document.createElement('div');
        div.className = 'dk-chat-chunk';
        (chunks[chunks.length - 1] || $('chatEmpty')).after(div);
        chunks.push(div);
      }
      return chunks[c];
    };
    const next = htmls.map((html, i) => {
      const old = chatDom[i];
      if (old && old.html === html) return old;
      const t = document.createElement('template');
      t.innerHTML = html;
      const el = t.content.firstElementChild;
      if (old) old.el.replaceWith(el); else chunkFor(i).appendChild(el);
      return { html, el };
    });
    for (const d of chatDom.slice(htmls.length)) d.el.remove();
    for (const div of chunks.slice(Math.ceil(htmls.length / CHAT_CHUNK))) div.remove();
    chatDom = next;
    const capEl = log.querySelector(':scope > .dk-chat-cap');
    if (Chat.fits(msgs)) { if (capEl) capEl.remove(); } else if (!capEl) {
      log.insertAdjacentHTML('beforeend', `<p class="dk-msg dk-chat-cap" role="status">Questa chat ha superato i ${Chat.MAX_MESSAGES.toLocaleString('it-IT', { useGrouping: true })} messaggi e da qui in poi Filo non salva i nuovi. Svuotala per ripartire da zero.</p>`);
    }
    log.scrollTop = follow ? log.scrollHeight : prevTop;
    syncCarouselHighlight();
    preloadVisibleCards();
    syncWait();
  }

  // Mentre il ragionamento scorre cambia solo la bolla che aspetta: si rifà quella, senza ricalcolare le altre.
  function renderBubble(m) {
    if (!current || $('screenBuilder').hidden) return;
    const msgs = chatMsgs();
    const i = msgs.indexOf(m);
    const d = chatDom[i];
    if (i < 0 || !d) return;
    const html = chatBubbleHtml(m, i === msgs.length - 1);
    if (html === d.html) return;
    const log = $('chatLog');
    const prevTop = log.scrollTop;
    const follow = log.scrollHeight - prevTop - log.clientHeight < 48;
    const t = document.createElement('template');
    t.innerHTML = html;
    const el = t.content.firstElementChild;
    d.el.replaceWith(el);
    d.el = el;
    d.html = html;
    log.scrollTop = follow ? log.scrollHeight : prevTop;
  }

  // Una bolla toccata a mano (un tasto spento in attesa) si rifà al prossimo ridisegno anche se l'HTML torna uguale.
  function forgetBubble(el) {
    const d = chatDom.find((x) => x.el === el);
    if (d) d.html = '';
  }

  // L'attesa della chat del mazzo aperto (#792): da quanto dura e il tasto per fermarla, nel campo di scrittura, che
  // non si ridisegna mai (le bolle sì, a ogni pezzo di ragionamento, e un clic a metà ridisegno andrebbe perso).
  let waitTick = 0;
  function syncWait() {
    const msgs = current && !$('screenBuilder').hidden ? chatByDeck.get(current.id) : null;
    const t = chatTaken(msgs) ? busyChats.get(msgs) : null;
    const box = $('chatWait');
    if (!box) return;
    box.hidden = !t;
    $('chatForm').classList.toggle('dk-busy', !!t);
    if (t) $('chatWaitTime').textContent = window.SN_TIME.fmtCountdown((Date.now() - t.startedAt) / 1000);
    if (t && !waitTick) waitTick = setInterval(syncWait, 1000);
    else if (!t && waitTick) { clearInterval(waitTick); waitTick = 0; }
  }

  function stopChat() {
    if (!current) return;
    stopTurnOf(chatByDeck.get(current.id));
    const input = $('chatInput');
    if (input && !$('screenBuilder').hidden) input.focus();
  }

  // Invio con la chat occupata: il messaggio resta nel campo e il tasto Ferma si fa vedere, che è lui a tenerla.
  let nudgeTimer = 0;
  function nudgeStop() {
    const btn = $('chatStop');
    if (!btn) return;
    btn.classList.remove('dk-nudge');
    void btn.offsetWidth;
    btn.classList.add('dk-nudge');
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => btn.classList.remove('dk-nudge'), window.SN_THEME_TOKENS ? window.SN_THEME_TOKENS.motionMs(900) : 900);
  }

  async function sendChat(text) {
    const deckId = current.id;
    const msgs = chatMsgs();
    if (chatTaken(msgs)) return;
    // Le bolle precedenti tornano collassate quando arriva un nuovo scambio (§3.3).
    for (const m of msgs) m.expanded = false;
    // La cronologia per l'agente si costruisce PRIMA di accodare il nuovo turno.
    const history = Chat.historyFor(msgs);
    // "Valuta questi risultati" (§6.1): l'insieme indicato è l'ultima CardList
    // mostrata — sono DATI della bolla, si passano come id al main.
    const lastList = [...msgs].reverse().find((m) => m.who === 'bot' && m.cardIds && m.cardIds.length);
    const lastResults = lastList ? [...lastList.cardIds] : [];
    const user = { who: 'user', text };
    const bot = { who: 'bot', pending: true, turn: newTurnId() };
    // Ragionamento in diretta (#331): mentre il modello pensa, i chunk di CoT
    // arrivano sul canale filo:reasoning e riempiono la bolla "sta pensando"
    // (render con throttle: i chunk possono essere fitti). Lo stesso id ferma il turno nel main (#792).
    const reasoningReqId = `dk${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const turno = { bot, reqId: reasoningReqId, startedAt: Date.now(), stopped: false, stop: null };
    busyChats.set(msgs, turno);
    msgs.push(user, bot);
    // Salvata subito: chi chiude la pagina adesso ritrova la domanda, con la risposta segnata come interrotta.
    // Oltre il tetto il main la rifiuta: la pagina lo dice (renderChat), la conversazione continua qui.
    editChat(deckId, { op: 'append', messages: [user, bot] });
    renderChat(true); // nuovo turno: porta la vista in fondo per mostrarlo
    let cotRenderTimer = 0;
    const offReasoning = (window.filo && window.filo.onReasoning)
      ? window.filo.onReasoning((data) => {
          if (!data || data.reqId !== reasoningReqId || !bot.pending) return;
          if (data.progress) bot.progress = data.progress;
          else if (data.text) bot.reasoning = (bot.reasoning || '') + data.text;
          else return;
          if (!cotRenderTimer) {
            cotRenderTimer = setTimeout(() => {
              cotRenderTimer = 0;
              if (bot.pending) renderBubble(bot);
            }, 250);
          }
        })
      : null;
    const stopListening = () => {
      if (offReasoning) offReasoning();
      if (cotRenderTimer) { clearTimeout(cotRenderTimer); cotRenderTimer = 0; }
    };
    const onScreen = () => current && !$('screenBuilder').hidden;
    // La risposta entra al posto del SUO turno nella chat salvata: svuotata nel frattempo (qui o altrove), non
    // rientra. Solo dopo il turno lascia la conversazione, così un avviso arrivato intanto la fa rileggere dal salvato.
    const saveAndRelease = async () => {
      await editChat(deckId, { op: 'fill', turn: bot.turn, message: bot });
      if (busyChats.get(msgs) !== turno) return;
      busyChats.delete(msgs);
      if (staleChats.has(msgs)) {
        staleChats.delete(msgs);
        await rereadChat(deckId, msgs);
      }
    };
    // «Ferma» (#792): la chat torna subito dell'utente e il main spegne la chiamata al modello. Nessuna modifica al
    // mazzo: il main la scrive solo a risposta arrivata.
    turno.stop = () => {
      if (turno.stopped || !bot.pending) return;
      turno.stopped = true;
      bot.pending = false;
      bot.stopped = true;
      // Chi ferma ha visto qualcosa che non gli torna: il ragionamento resta aperto dov'era.
      if (bot.reasoning && bot.cotOpen === undefined) bot.cotOpen = true;
      stopListening();
      send({ type: MSG.DECKS_CHAT_STOP, reqId: reasoningReqId }).catch(() => {});
      if (onScreen() && chatByDeck.get(current.id) === msgs) renderChat();
      syncWait();
      saveAndRelease();
    };
    syncWait();
    let deckChanged = false;
    let wantsClear = false;
    let r = null;
    let failure = null;
    try {
      r = await send({ type: MSG.DECKS_CHAT, deckId, text, history, lastResults, reasoningReqId });
    } catch (e) {
      failure = e;
    }
    // Fermata: la bolla l'ha già detto e la chat è già libera. Una risposta che il main aveva già finito di scrivere
    // nel mazzo arriva lo stesso, perché il mazzo è cambiato e la bolla deve dire come.
    if (turno.stopped && !(r && r.ok)) return;
    stopListening();
    bot.pending = false;
    bot.stopped = false;
    // Il testo completo del ragionamento torna con la risposta (anche in
    // caso d'errore): è la versione autoritativa rispetto ai chunk live.
    if (r && r.reasoning) bot.reasoning = r.reasoning;
    if (failure) {
      bot.error = (failure && failure.message) || 'errore di rete';
    } else if (r && r.stopped) {
      bot.stopped = true;
    } else if (!r || !r.ok) {
      bot.error = (r && r.error) || 'nessuna risposta';
      const rimedio = r && { code: r.code, keyRefused: !!r.keyRefused, reason: r.reason, maxTokens: r.maxTokens, finishReason: r.finishReason };
      if (window.SN_CHAT_ERRORS?.rimedioPagina?.(rimedio)) bot.rimedio = rimedio;
    } else {
      bot.reply = r.reply || '';
      bot.cardIds = r.cardIds || [];
      bot.query = r.query || '';
      if (r.title) bot.title = r.title;
      // L'ordine chiesto a parole vale per la lista di questa risposta, o senza carte nuove per quella di prima.
      if (Chat.SORTS.includes(r.sort)) {
        if (bot.cardIds.length) setListSort(deckId, bot, r.sort, false);
        else if (lastList && msgs.includes(lastList)) setListSort(deckId, lastList, r.sort, true);
      }
      if (Array.isArray(r.uncheckedIds) && r.uncheckedIds.length) bot.uncheckedIds = r.uncheckedIds;
      if (r.retryable) bot.retryable = true;
      // Una parte del turno non è partita per un ostacolo che si toglie altrove (il controllo delle carte, #1344.1).
      if (r.rimedio && window.SN_CHAT_ERRORS?.rimedioPagina?.(r.rimedio)) bot.rimedio = r.rimedio;
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
      opinionErrors.clear();
      // La chat può aver modificato il mazzo (es. budget, §9.2): il mazzo
      // aggiornato torna nella risposta → header e statistiche si rinfrescano.
      if (r.deck && current && r.deck.id === current.id) { current = r.deck; deckChanged = true; }
      // «Svuota la chat» chiesto a parole: stessa conferma della gomma, dopo aver mostrato la risposta. La bolla
      // tiene il tasto: se la conferma non arriva adesso (Annulla, mazzo lasciato), la richiesta resta lì.
      wantsClear = !!r.clearChat && !turno.stopped;
      if (wantsClear) bot.clearChat = true;
    }
    turno.stopped = false;
    if (onScreen()) {
      if (deckChanged) await renderBuilder();
      else renderChat();
    }
    await saveAndRelease();
    syncWait();
    if (wantsClear && onScreen() && current.id === deckId && chatByDeck.get(deckId) === msgs) clearChat();
  }

  // Tasto destro sulla riga di sintesi di una lista (#788): la ricerca esatta, l'ordinamento, la stessa ricerca su
  // Scryfall. Una lista senza ricerca (import, carte da un altro mazzo) ha solo l'ordinamento.
  const LIST_SORT_LABELS = { cmc: 'Ordina per costo di mana', name: 'Ordina per nome', price: 'Ordina per prezzo' };
  const SCRYFALL_ORDER = { cmc: 'cmc', name: 'name', price: 'eur' };
  function listMenuItems(m) {
    const cur = m.sort || Chat.SORTS[0];
    const items = [];
    if (m.query) items.push({ label: 'Copia la ricerca', detail: m.query, run: () => copyText(m.query, 'Ricerca copiata.') });
    for (const key of Chat.SORTS) {
      items.push({ label: LIST_SORT_LABELS[key] + (key === cur ? ' ✓' : ''), run: () => sortList(m, key) });
    }
    if (m.query) {
      const url = `https://scryfall.com/search?q=${encodeURIComponent(m.query)}&order=${SCRYFALL_ORDER[cur]}&dir=asc`;
      items.push({ label: 'Apri la ricerca su Scryfall', run: () => send({ type: MSG.OPEN_URL, url }) });
    }
    return items;
  }

  // L'ordine scelto è della lista, e si salva con lei. Una lista chiusa si apre: chi la riordina la vuole vedere.
  function sortList(m, sort) {
    if (!current) return;
    const msgs = chatMsgs();
    const target = (m.turn && msgs.find((x) => x.who === 'bot' && x.turn === m.turn)) || m;
    if (!msgs.includes(target)) return;
    setListSort(current.id, target, sort, true);
    renderChat();
  }

  // `save`: la lista è già scritta nella chat salvata. Quella di una risposta in arrivo si salva col suo turno.
  function setListSort(deckId, m, sort, save) {
    if (sort === Chat.SORTS[0]) delete m.sort; else m.sort = sort;
    m.expanded = true;
    if (save && m.turn) editChat(deckId, { op: 'sort', turn: m.turn, sort });
  }

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* resta il messaggio sotto */ }
      ta.remove();
      if (!ok) { toastErrore('Non sono riuscito a copiare.'); return; }
    }
    showToast(done);
  }

  // Toggle della riga (§3.4); `qty` dall'import via chat (§11.2), default 1 per le ricerche.
  async function toggleCard(cardId, qty = 1) {
    // Il commander sta nell'intestazione, non anche fra le 99 (§8.4): nessuna strada lo duplica nell'elenco.
    if (cardId === current.commander) return;
    const adding = !inDeck(cardId);
    const { deck, added } = adding
      ? Decks.addCard(current, cardId, { qty })
      : (() => { const r = Decks.removeCard(current, cardId); return { deck: r.deck, added: r.removed }; })();
    if (added) {
      await saveDeck(deck);
      // Parere per la carta appena aggiunta (§6.1): in background, pronto al prossimo hover.
      if (adding) requestOpinions([cardId], { refresh: true }).catch(() => {});
    }
  }

  // "Aggiungi tutte al mazzo" (§11.2): merge in un colpo solo di tutte le
  // carte riconosciute dall'import via chat (rispettando la qty per riga) +
  // il commander candidato, MA SOLO se il mazzo non ne ha già uno (mai
  // sovrascrivere una scelta esistente senza un'azione dedicata, §8.4).
  function importEntries(m) {
    return (m.cardIds || [])
      .filter((id) => id !== m.importCommanderId)
      .map((id) => ({ scryfall_id: id, qty: (m.importQty && m.importQty[id]) || 1 }));
  }

  // Lo stato del tasto si ricava dal mazzo di adesso, come il + delle righe (#787): acceso finché il clic
  // cambierebbe qualcosa, anche dopo una ricarica o dopo aver tolto le carte.
  function importAllWouldChange(m) {
    const { addedCount, updatedCount } = Decks.importCards(current, importEntries(m));
    return addedCount + updatedCount > 0 || !!(m.importCommanderId && !current.commander);
  }

  async function importAllFromBubble(bubbleEl) {
    const m = chatMsgs()[Number(bubbleEl.dataset.msgI)];
    if (!m || !m.cardIds || !m.cardIds.length || !importAllWouldChange(m)) return;
    const btn = bubbleEl.querySelector('[data-import-all]');
    if (btn) { btn.disabled = true; forgetBubble(bubbleEl); }
    const { deck: merged, addedCount, updatedCount } = Decks.importCards(current, importEntries(m));
    const saved = merged !== current ? await send({ type: MSG.DECKS_UPDATE, deck: merged }) : { ok: true, deck: current };
    if (saved && saved.ok) current = saved.deck;
    let commanderSet = false;
    if (m.importCommanderId && !current.commander) {
      const r = await send({ type: MSG.DECKS_SET_COMMANDER, id: current.id, scryfallId: m.importCommanderId });
      if (r && r.ok) { current = r.deck; commanderSet = true; }
    }
    await renderBuilder();
    const total = addedCount + updatedCount + (commanderSet ? 1 : 0);
    // Il commander della lista resta fuori se il mazzo ne ha già un altro: l'avviso lo nomina (#789).
    const skipped = m.importCommanderId && !commanderSet && current.commander !== m.importCommanderId
      ? ` ${(cardsById[m.importCommanderId] && cardsById[m.importCommanderId].name) || 'Il commander della lista'} non è diventato commander: il mazzo ha già il suo.`
      : '';
    showToast((total ? `${total === 1 ? 'Aggiunta 1 carta' : `Aggiunte ${total} carte`} al mazzo.` : 'Nessuna carta nuova da aggiungere.') + skipped);
  }

  // Toast discreto in basso a destra (conferme di import/export non
  // bloccanti): stesso pattern del toast dell'editor. Tempi in avvisiTempo.js.
  const dkToastTempi = window.SN_AVVISI.orologio();
  let dkToastTempo = null;
  function hideToast(el) {
    if (dkToastTempo) dkToastTempo.annulla();
    dkToastTempo = null;
    el.classList.remove('show');
    dkToastTempi.lascia(el);
  }
  // Un avviso d'errore si conta per i contatori anonimi (#1461): la chiave, mai il testo.
  function toastErrore(text) {
    showToast(text);
    try { Promise.resolve(send({ type: MSG.CONTATORI_EVENTO, misura: 'avviso', chiave: 'mazzi_non_riuscito' })).catch(() => {}); } catch (_) {}
  }
  function showToast(text) {
    let el = document.getElementById('dkToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dkToast';
      el.className = 'dk-toast';
      el.setAttribute('role', 'status');
      el.addEventListener('click', () => {
        const sel = document.getSelection();
        if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return;
        hideToast(el);
      });
      dkToastTempi.segui(el);
      window.SN_AVVISI.chiudibile(el, () => hideToast(el));
      document.body.appendChild(el);
    }
    el.textContent = text;
    void el.offsetWidth;
    el.classList.add('show');
    if (dkToastTempo) dkToastTempo.annulla();
    dkToastTempo = dkToastTempi.avvia(window.SN_AVVISI.durata(3400), () => hideToast(el));
  }

  // Import/Export rigido (§11): il parser è DETERMINISTICO, mai LLM. L'import mostra sempre
  // un'anteprima con conferma; le righe non riconosciute sono segnalate, mai indovinate.
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

  function openExportDialog(deckId) {
    const body = buildIoOverlay('Esporta mazzo');
    body.innerHTML = `
      <textarea class="dk-io-textarea" readonly rows="14">(generazione…)</textarea>
      <div class="dk-io-row">
        <button class="dk-io-btn" data-io="close">Chiudi</button>
        <button class="dk-io-btn dk-io-btn-ok" data-io="copy">Copia</button>
      </div>`;
    const ta = body.querySelector('textarea');
    send({ type: MSG.DECKS_EXPORT, id: deckId }).then((r) => {
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
        toastErrore('Analisi non riuscita.');
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
        showToast(`${total === 1 ? 'Importata 1 carta' : `Importate ${total} carte`}${res.updatedCount ? ` (${res.updatedCount} aggiornat${res.updatedCount === 1 ? 'a' : 'e'})` : ''}.`);
      } else {
        toastErrore('Import non riuscito.');
        applyBtn.disabled = false;
        applyBtn.textContent = `Importa ${resolved.length} cart${resolved.length === 1 ? 'a' : 'e'}`;
      }
    });
  }

  // Risoluzione fuzzy una-tantum dei nomi in prosa (§3.5). Ritorna una Promise dell'id: il
  // carosello dal testo libero (#343) la attende. La cache sopravvive ai rerender della chat.
  const proseIdByName = new Map();    // nome (lowercase) → scryfall id
  const proseResolving = new WeakMap(); // span → Promise in corso

  // I nomi risolti stanno anche nella bolla (nameIds): riaperta la chat, passarci sopra non chiede più la rete.
  function rememberProseNames(msgs) {
    for (const m of msgs || []) {
      if (m && m.nameIds) for (const [name, id] of Object.entries(m.nameIds)) proseIdByName.set(name, id);
    }
  }

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
    const bubble = el.closest('[data-msg-i]');
    const deckId = current && current.id;
    const m = bubble && deckId ? chatMsgs()[Number(bubble.dataset.msgI)] : null;
    const p = (async () => {
      const r = await send({ type: MSG.SCRYFALL_NAMED, name: el.dataset.cardName });
      proseResolving.delete(el);
      if (!(r && r.ok && r.card)) return null;
      el.dataset.cardId = r.card.id;
      proseIdByName.set(key, r.card.id);
      cardsById[r.card.id] = r.card;
      if (m && m.who === 'bot') {
        m.nameIds = { ...(m.nameIds || {}), [key]: r.card.id };
        saveNamesSoon(deckId, m);
      }
      el.title = `${r.card.name} — ${r.card.typeLine}`;
      // Risoluzione arrivata dopo il mouseover: senza un nuovo evento, la preview parte da qui.
      if (el.matches(':hover')) hoverEnter(r.card.id);
      return r.card.id;
    })();
    proseResolving.set(el, p);
    return p;
  }

  // Tre stati (§5): statistiche, preview all'hover, carosello pinnato. La geometria MAI.
  // Timing (§5.1): apertura ~200ms, riga→riga con grace ~100ms, uscita con linger ~1s.
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

  // Box modulare del detail (§5.2): SLOT dei moduli, tasto destro per sceglierlo (stesso
  // slot in preview e nel carosello). La scelta è persistita col layout.

  // Parere di Filo (§6): opinionsByCard è cache di PAGINA, solo per il mazzo corrente; il
  // calcolo e la cache persistente per (carta, versione mazzo) vivono nel main.
  const opinionsByCard = new Map();
  const opinionPending = new Set();
  // Il parere che non è arrivato, col perché (la frase e quello che serve al tasto del rimedio): finché c'è, la
  // carta non si richiede da sola. Senza, il riquadro la richiedeva a ogni ridisegno, centinaia di volte al secondo (#1344.1).
  const opinionErrors = new Map();
  const SENZA_RISPOSTA = 'non ho avuto risposta. Riprova.';
  function erroreDelParere(r) {
    const frase = r && r.error && r.error !== 'not_found' ? String(r.error) : SENZA_RISPOSTA;
    return {
      frase,
      ...(r && r.code ? { code: r.code } : {}),
      ...(r && r.keyRefused ? { keyRefused: true } : {}),
      ...(r && r.reason ? { reason: r.reason } : {}),
      ...(r && Number(r.maxTokens) > 0 ? { maxTokens: Number(r.maxTokens) } : {}),
      ...(r && r.finishReason ? { finishReason: r.finishReason } : {}),
    };
  }

  // La carta mostrata ADESSO nel pannello destro (preview o carosello).
  function currentDetailCard() {
    if (detailState === 'carousel' && carousel) return cardsById[carousel.ids[carousel.i]] || null;
    if (detailState === 'preview') return cardsById[$('previewImg').dataset.cardId] || null;
    return null;
  }

  // Una richiesta sola: il main fa UN batch LLM per i soli mancanti o stantii. refresh=true
  // ricalcola comunque (§6.2); al ritorno il modulo si aggiorna sul posto.
  async function requestOpinions(ids, { refresh = false } = {}) {
    // Uno stantio resta visibile marcato e si ricalcola SOLO col bottone (§6.2); uno mancato solo con «Riprova».
    const ask = ids.filter((id) => refresh
      || (!opinionsByCard.has(id) && !opinionPending.has(id) && !opinionErrors.has(id)));
    if (!ask.length || !current) return;
    for (const id of ask) { opinionPending.add(id); opinionErrors.delete(id); }
    const deckId = current.id;
    let r = null;
    try {
      r = await send({ type: MSG.DECKS_OPINION, deckId, cardIds: ask, compute: true, refresh });
    } catch (_) {
      r = { ok: false, error: '' };
    } finally {
      for (const id of ask) opinionPending.delete(id);
    }
    // I pareri sono per mazzo: quelli di un mazzo lasciato nel frattempo non entrano nella cache del nuovo.
    if (!current || current.id !== deckId) return;
    if (r && r.ok) {
      const opinions = r.opinions || {};
      for (const [id, op] of Object.entries(opinions)) opinionsByCard.set(id, op);
      const mancanti = r.mancanti || {};
      for (const id of ask) if (!opinions[id]) opinionErrors.set(id, erroreDelParere(mancanti[id] || {}));
    } else {
      const errore = erroreDelParere(r);
      for (const id of ask) opinionErrors.set(id, errore);
    }
    const cur = currentDetailCard();
    if (cur && layout.module === 'opinion' && ask.includes(cur.id)) renderDetailModule(cur);
  }

  // Ristampe (modulo «Prezzo e dati»): conteggio lazy, cache nel main.
  const printsByName = new Map();
  const printsPending = new Set();
  // Come per i pareri: un conteggio che Scryfall non ha dato non si richiede a ogni ridisegno del riquadro.
  const printsFailed = new Set();
  async function fetchPrints(card) {
    if (printsByName.has(card.name) || printsPending.has(card.name) || printsFailed.has(card.name)) return;
    printsPending.add(card.name);
    try {
      const r = await send({ type: MSG.SCRYFALL_PRINTS, name: card.name });
      if (r && r.ok) printsByName.set(card.name, r.prints);
      else printsFailed.add(card.name);
    } catch (_) {
      printsFailed.add(card.name);
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
    // Mini curva (§5.2.1): dove cadrebbe la carta — «mi fixa la curva?» ha risposta visiva.
    curve: {
      label: 'Mini curva di mana',
      render(card, host) {
        const curve = Stats.manaCurve(current, cardsById);
        const land = /\bLand\b/i.test(String(card.typeLine).split('//')[0]);
        const n = Math.max(0, Math.floor(Number(card.cmc) || 0));
        const bucket = land ? null : (n >= 7 ? '7+' : String(n));
        const already = inDeck(card.id);
        // Carta non nel mazzo: segmento «fantasma» (+1) dove cadrebbe aggiungendola.
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
    price: {
      label: 'Prezzo e dati',
      render(card, host) {
        const price = card.priceEur != null
          ? `${card.priceEur.toFixed(2).replace('.', ',')} € (Cardmarket)` : 'n.d.';
        const prints = printsByName.get(card.name);
        const fallite = prints == null && printsFailed.has(card.name);
        host.innerHTML = `
          <p class="dk-module-title">Prezzo e dati</p>
          <p>Prezzo: ${esc(price)}</p>
          <p data-prints>${prints != null
            ? `Ristampe: ${prints} stamp${prints === 1 ? 'a' : 'e'}`
            : (fallite ? 'Ristampe: Scryfall non ha risposto' : 'Ristampe: …')}</p>
          <p data-legal="${card.legalCommander ? 1 : 0}">${card.legalCommander
            ? '✓ Legale in Commander' : '✗ Non legale in Commander'}</p>`;
        if (prints == null && !fallite) fetchPrints(card);
      },
    },
    // Parere di Filo (§6): giudizio contestuale carta-vs-mazzo; stantio = pallino discreto
    // più «Aggiorna» (§6.2).
    opinion: {
      label: 'Parere di Filo',
      render(card, host) {
        const op = opinionsByCard.get(card.id);
        const pending = opinionPending.has(card.id);
        const errore = pending ? null : opinionErrors.get(card.id);
        let body;
        if (op && errore) {
          // L'«Aggiorna» non è andato: il parere vecchio resta, col perché e le stesse strade.
          body = `<p class="dk-op-text">${proseHtml(op.text)}</p>${erroreParereHtml(card.id, errore, 'Non sono riuscito ad aggiornarlo.', 'Aggiorna')}`;
        } else if (errore) {
          body = erroreParereHtml(card.id, errore, 'Il parere non è arrivato.', 'Riprova');
        } else if (op) {
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
        // L'hover con questo modulo attivo È il trigger (§6.1): cache-first, e uno stantio non si
        // ricalcola mai da solo (§6.2), come uno mancato.
        if (!op && !pending && !errore) requestOpinions([card.id]).catch(() => {});
      },
    },
  };

  // Il motivo prima, poi il tasto che toglie l'ostacolo (Crediti, Opzioni, Preferenze) e, accanto, quello per
  // riprovare: finché l'ostacolo resta, riprovare rimanda la stessa richiesta allo stesso muro (#663, #828.1).
  function erroreParereHtml(id, errore, apertura, riprova) {
    const frase = String(errore.frase || '');
    const pagina = window.SN_CHAT_ERRORS?.rimedioPagina?.(errore) || null;
    const via = pagina
      ? `<button class="dk-mod-btn dk-rimedio" data-op-rimedio="${esc(id)}" title="${esc(pagina.title || '')}">${esc(pagina.label)}</button>`
      : '';
    return `<p class="dk-mod-note dk-op-errore" role="status">${esc(apertura)} ${esc(frase.charAt(0).toUpperCase() + frase.slice(1))}</p>
      <div class="dk-mod-actions">${via}<button class="dk-mod-btn" data-op-retry="${esc(id)}">${esc(riprova)}</button></div>`;
  }

  // Stesso slot per preview e carosello: il modulo scelto si disegna nello stato attivo.
  function renderDetailModule(card, hostId) {
    const host = $(hostId || (detailState === 'carousel' ? 'carouselModule' : 'previewModule'));
    if (!host) return;
    const mod = DETAIL_MODULES[layout.module] || DETAIL_MODULES.default;
    mod.render(card, host);
  }

  // Riga di contesto (§5.2): prezzo EUR, tag assegnati e «già nel mazzo» — che vale anche
  // per il commander.
  function renderDetailCtx(card) {
    const entry = current.carte.find((c) => c.scryfall_id === card.id);
    const parts = [];
    if (card.priceEur != null) {
      parts.push(`<span>${esc(card.priceEur.toFixed(2).replace('.', ','))} €</span>`);
    }
    for (const t of (entry && entry.tags) || []) {
      parts.push(`<span class="dk-tag">${esc(t)}</span>`);
    }
    if (card.id === current.commander) parts.push('<span class="dk-indeck">✓ commander</span>');
    else if (entry) parts.push('<span class="dk-indeck">✓ già nel mazzo</span>');
    $('previewCtx').innerHTML = parts.join('');
  }

  // Ogni riapertura riparte dal FRONTE (#373): si ridipinge al cambio carta e da chiusa,
  // ma non se è già aperta sulla stessa carta, o si perderebbe un flip voluto dall'utente.
  function showPreview(cardId) {
    const card = cardsById[cardId];
    if (!card) return;
    const img = $('previewImg');
    if (detailState !== 'preview' || img.dataset.cardId !== card.id) paintCardImage(img, card);
    renderDetailCtx(card);
    renderDetailModule(card);
    if (detailState !== 'preview') setDetailState('preview');
  }

  // Dipinge una carta in uno slot: sempre dalla faccia frontale, tasto «gira» solo per le
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

  // Alterna fronte e retro SUL POSTO; no-op sulle carte a faccia unica.
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

  // L'id carta sotto il puntatore: da riga (.dk-row) o da nome in prosa (.dk-prose-card).
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

  // Sull'anteprima si va per usarla («Aggiorna», il tasto per Crediti o Opzioni): resta aperta finché il puntatore è
  // lì, e il linger riparte quando esce.
  function holdPreview() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; }
    if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = 0; }
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

  // Carosello (§5.3), flusso di triage pinnato al click: naviga la lista DA CUI è partito
  // (i risultati di quella bolla, o l'elenco del mazzo).
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
    syncCarouselToggle();
    // Prefetch di precedente e successiva (§5.1): la navigazione non aspetta.
    preloadCardImages([carousel.ids[carousel.i - 1], carousel.ids[carousel.i + 1]].filter(Boolean));
    if (card) renderDetailModule(card, 'carouselModule');
    // Parere attivo → prefetch delle vicine in una richiesta sola: scorrendo è già lì.
    if (card && layout.module === 'opinion') {
      const near = [carousel.i, carousel.i - 1, carousel.i + 1]
        .map((j) => carousel.ids[j]).filter(Boolean);
      requestOpinions(near).catch(() => {});
    }
    syncCarouselHighlight();
  }

  function syncCarouselToggle() {
    const id = carousel.ids[carousel.i];
    const added = inDeck(id);
    const isCommander = id === current.commander;
    const btn = $('carouselToggle');
    btn.dataset.in = isCommander ? 'cmd' : (added ? '1' : '0');
    btn.setAttribute('aria-disabled', isCommander ? 'true' : 'false');
    btn.textContent = isCommander ? '✓ commander' : (added ? '✓ nel mazzo' : '+ aggiungi');
    btn.title = isCommander ? 'È il commander del mazzo' : (added ? 'Rimuovi dal mazzo (Invio)' : 'Aggiungi al mazzo (Invio)');
  }

  // Lo stato «nel mazzo / commander» del dettaglio segue il mazzo da qualunque strada cambi (menu, chat, righe),
  // senza ridipingere l'immagine (resterebbe girata sul retro).
  function syncDetailInDeck() {
    if (detailState === 'carousel' && carousel) syncCarouselToggle();
    else if (detailState === 'preview') { const card = currentDetailCard(); if (card) renderDetailCtx(card); }
  }

  function carouselNav(delta) {
    if (!carousel) return;
    const next = carousel.i + delta;
    if (next < 0 || next >= carousel.ids.length) return;
    carousel.i = next;
    renderCarousel();
  }

  async function carouselToggle() {
    if (!carousel) return;
    await toggleCard(carousel.ids[carousel.i]);
    renderCarousel();
  }

  // La lista è l'ordine VISIBILE delle righe del contenitore di partenza.
  function openCarouselFromRow(row, containerSel) {
    const box = row.closest(containerSel);
    if (!box) return;
    const ids = [...box.querySelectorAll('.dk-row[data-card-id]')].map((r) => r.dataset.cardId);
    openCarousel(ids, ids.indexOf(row.dataset.cardId));
  }

  // Carosello dal testo libero (#343): naviga TUTTE le carte citate nella bolla, in parità
  // con le CardList. Apre subito sulla cliccata, risolvendola, e completa la lista dopo.
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

  // Evidenzia ovunque la carta mostrata nel carosello (#343): si vede a colpo d'occhio dove
  // sei. Va richiamata anche ad ogni rerender di chat e mazzo, che rigenerano il DOM.
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
    // Hover unificato (§5.1) in delega sul documento: fuori da una riga carta parte il linger.
    document.addEventListener('mouseover', (e) => {
      const id = hoverCardId(e.target);
      if (id) hoverEnter(id);
      else if (detailState === 'preview' && e.target.closest && e.target.closest('#statePreview')) holdPreview();
      else hoverLeave();
    });

    // Tastiera (§5.3): frecce navigano, Invio o Spazio aggiunge e toglie, Esc chiude.
    document.addEventListener('keydown', (e) => {
      if (detailState !== 'carousel') return;
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); carouselNav(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); carouselNav(-1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); carouselToggle(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCarousel(); }
    });

    // Probabilità (§9.3): si aggiorna da sola (feedback #354). L'ascolto è delegato a
    // #stateStats perché le righe categoria si ricostruiscono ad ogni rerender.
    $('stateStats').addEventListener('input', (e) => {
      if (!e.target || !e.target.matches('#probTurn, #probNeeds input, #probMull, #probExtra')) return;
      if (e.target.id === 'probMull') onProbMull();
      scheduleProb();
    });
    $('probGame').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = $('probGame').getBoundingClientRect();
      openCtx(r.left, r.bottom + 2, PROB_GAMES.map((g) => ({
        label: `Partita ${g.label}`,
        run: () => { setProbGame(g.id); scheduleProb(); },
      })));
    });

    $('carouselPrev').addEventListener('click', () => carouselNav(-1));
    $('carouselNext').addEventListener('click', () => carouselNav(1));
    $('carouselToggle').addEventListener('click', () => carouselToggle());
    $('carouselClose').addEventListener('click', () => closeCarousel());

    // Gira la bifronte (feedback #373): tasto dedicato e — gesto fisico naturale — anche il
    // click sull'immagine. Vale in entrambi gli slot: parità fra i cammini.
    $('previewFlip').addEventListener('click', (e) => { e.stopPropagation(); flipCardImage($('previewImg')); });
    $('carouselFlip').addEventListener('click', (e) => { e.stopPropagation(); flipCardImage($('carouselImg')); });
    $('previewImg').addEventListener('click', () => flipCardImage($('previewImg')));
    $('carouselImg').addEventListener('click', () => flipCardImage($('carouselImg')));
    // Tasto destro sulla carta grande (§8.3): le stesse azioni della riga da cui è arrivata, commander compreso.
    const openCardImageMenu = (e) => {
      const card = current && currentDetailCard();
      if (!card) return;
      e.preventDefault();
      openCtx(e.clientX, e.clientY, cardMenuItems(card.id));
    };
    $('previewImg').addEventListener('contextmenu', openCardImageMenu);
    $('carouselImg').addEventListener('contextmenu', openCardImageMenu);

    // Tasto destro sul box modulare (§5.2): vale sia per la preview sia per il carosello.
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

    // «Aggiorna» (§6.2): refresh della SOLA carta mostrata, in delega su entrambi gli slot.
    const onModuleClick = (e) => {
      const via = e.target.closest('[data-op-rimedio]');
      if (via) {
        const errore = opinionErrors.get(via.dataset.opRimedio);
        const pagina = errore ? window.SN_CHAT_ERRORS?.rimedioPagina?.(errore) : null;
        if (pagina) send({ type: MSG.OPEN_URL, url: pagina.url });
        return;
      }
      const btn = e.target.closest('[data-op-refresh], [data-op-retry]');
      if (!btn) return;
      const id = btn.dataset.opRefresh || btn.dataset.opRetry;
      btn.disabled = true;
      // Esplicito come «Aggiorna»: passa sopra al parere mancato, e su una carta senza parere chiede solo lei.
      requestOpinions([id], { refresh: true }).catch(() => {});
      const cur = currentDetailCard();
      if (cur && cur.id === id) renderDetailModule(cur); // mostra "sta pensando"
    };
    $('previewModule').addEventListener('click', onModuleClick);
    $('carouselModule').addEventListener('click', onModuleClick);
    // Chi torna da Crediti o dalle Opzioni ha di solito tolto l'ostacolo: i pareri mancati si richiedono, una volta,
    // quando la carta si ridisegna.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || (!opinionErrors.size && !printsFailed.size)) return;
      opinionErrors.clear();
      printsFailed.clear();
      const cur = currentDetailCard();
      if (cur && (layout.module === 'opinion' || layout.module === 'price')) renderDetailModule(cur);
    });
  }

  // Switcher (§8.2): popup ancorato sotto l'header, stesse classi dei menu di Filo.
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
    add('Esporta…', () => openExportDialog(current.id));
    add('Rinomina…', () => startEdit('deckNameEdit', current.nome, async (v) => {
      await saveDeck(Decks.renameDeck(current, v));
    }));
    add('Budget…', () => startEdit('deckBudgetEdit', fmtBudgetInput(current.budget), async (v) => {
      // Virgola decimale italiana accettata; un testo non numerico lascia il tetto com'era.
      const parsed = Decks.parseBudgetInput(v);
      if (!parsed.ok) {
        showToast(`Budget non valido: «${v}» non è un numero. Il tetto resta invariato.`);
        return;
      }
      await saveDeck(Decks.setBudget(current, parsed.value));
    }));
    // Solo se c'è un commander da togliere (feedback #302): senza, non c'è modo di annullarlo.
    if (current.commander) add('Rimuovi commander', () => removeCommander());
    if ((chatByDeck.get(current.id) || []).length) add('Svuota la chat…', () => clearChat());
    add('Elimina…', async () => {
      const ok = await window.SN_CONFIRM_UI.confirm({
        title: 'Eliminare il mazzo?',
        text: `"${current.nome}" verrà eliminato definitivamente.`,
      parti: current.nome ? ['Il mazzo', { citazione: current.nome }, 'verrà eliminato definitivamente.'] : null,
        okLabel: 'Elimina',
      });
      if (!ok) return;
      stopTurnOf(chatByDeck.get(current.id));
      await send({ type: MSG.DECKS_DELETE, id: current.id });
      location.hash = '#/';
    });

    $('deckHead').appendChild(pop);
    switcherEl = pop;
    document.addEventListener('keydown', switcherKey, true);
    setTimeout(() => {
      if (switcherEl !== pop) return;
      document.addEventListener('click', closeSwitcher, true);
    }, 0);
  }

  // Invio o blur salvano, Escape annulla; un solo campo attivo alla volta.
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

  function wire() {
    $('newDeck').addEventListener('click', async () => {
      const res = await send({ type: MSG.DECKS_CREATE });
      if (res && res.ok) location.hash = `#/deck/${encodeURIComponent(res.deck.id)}`;
    });
    $('openGame').hidden = !PARTITA_PRONTA;
    $('openGame').addEventListener('click', () => { location.hash = '#/game'; });
    $('backToLibrary').addEventListener('click', () => { location.hash = '#/'; });
    $('gameBack').addEventListener('click', () => { location.hash = '#/'; });

    const grid = $('deckGrid');
    // Dentro il campo della rinomina clic, Invio e spazio sono del campo, non della scheda che apre il mazzo.
    const inRename = (e) => !!e.target.closest('.dk-card-rename');
    grid.addEventListener('click', (e) => {
      if (inRename(e)) return;
      const card = e.target.closest('[data-deck-id]');
      if (card) location.hash = `#/deck/${encodeURIComponent(card.dataset.deckId)}`;
    });
    grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (inRename(e)) return;
      const card = e.target.closest('[data-deck-id]');
      if (card) { e.preventDefault(); location.hash = `#/deck/${encodeURIComponent(card.dataset.deckId)}`; }
    });
    // Le stesse azioni del menu del mazzo nel banco di lavoro, con lo stesso dialogo d'esportazione.
    grid.addEventListener('contextmenu', (e) => {
      if (inRename(e)) return;
      const card = e.target.closest('[data-deck-id]');
      if (!card) return;
      e.preventDefault();
      const id = card.dataset.deckId;
      openCtx(e.clientX, e.clientY, [
        { label: 'Duplica', run: () => duplicateDeck(id) },
        { label: 'Esporta…', run: () => openExportDialog(id) },
        { label: 'Rinomina…', run: () => renameFromLibrary(id) },
        { label: 'Elimina…', run: () => deleteDeck(id) },
      ]);
    });

    $('deckName').addEventListener('click', (e) => { e.stopPropagation(); openSwitcher(); });
    // Svuota la chat del mazzo: icona nell'intestazione della chat, tasto destro sulla stessa intestazione e voce
    // del menu del mazzo fanno la stessa cosa (clearChat, con conferma). Mentre Filo risponde, il tasto destro su
    // intestazione e bolla in attesa ferma come «Ferma» ed Esc (#792).
    $('chatClear').innerHTML = (window.SN_ICONS && window.SN_ICONS.eraser && window.SN_ICONS.eraser(15)) || '⌫';
    $('chatClear').addEventListener('click', () => clearChat());
    const stopItem = { label: 'Ferma la risposta', run: () => stopChat() };
    $('chatHead').addEventListener('contextmenu', (e) => {
      const msgs = current && chatByDeck.get(current.id);
      if (!msgs || !msgs.length) return;
      e.preventDefault();
      openCtx(e.clientX, e.clientY, [...(chatTaken(msgs) ? [stopItem] : []), { label: 'Svuota la chat…', run: () => clearChat() }]);
    });
    if (chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
      chrome.runtime.onMessage.addListener(onChatChangedElsewhere);
      // Rimesso in pausa dall'owner (#1592) mentre la pagina è aperta: si ricarica, e il main serve la pausa.
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.IN_PAUSA_CAMBIATO && msg.nome === 'mazzi' && msg.visible === false) location.reload();
      });
    }
    // Tasto destro sulla riga del commander (§ "il tasto destro è centrale"):
    // quando un commander è impostato, offre di rimuoverlo direttamente da lì
    // (feedback #302). Senza commander il menu non ha nulla da offrire.
    $('commanderLine').addEventListener('contextmenu', (e) => {
      if (!current || !current.commander) return;
      e.preventDefault();
      openCtx(e.clientX, e.clientY, cardMenuItems(current.commander));
    });
    $('commanderLine').addEventListener('click', (e) => {
      if (current && current.commander && e.target.closest('.dk-prose-card')) openCarousel([current.commander], 0);
    });
    wireDividers();
    wireDetailPanel();

    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chatInput');
      const text = input.value.trim();
      if (chatTaken(chatMsgs())) { nudgeStop(); return; }
      if (!text) return;
      input.value = '';
      sendChat(text);
    });
    // Esc nel campo ferma la risposta come il tasto: è il gesto di chi vuole uscire da un'attesa (#792).
    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !current || !chatTaken(chatByDeck.get(current.id))) return;
      e.preventDefault();
      stopChat();
    });
    $('chatStop').addEventListener('click', stopChat);
    const log = $('chatLog');
    // Toggle del Ragionamento (#331): vale per bolle normali, pending e d'errore.
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
      if (e.target.closest('[data-retry]')) { retryLastTurn(); return; }
      const via = e.target.closest('[data-rimedio]');
      if (via) {
        const bubble = via.closest('[data-msg-i]');
        const m = bubble && chatMsgs()[Number(bubble.dataset.msgI)];
        const pagina = m && m.rimedio ? window.SN_CHAT_ERRORS?.rimedioPagina?.(m.rimedio) : null;
        if (pagina) send({ type: MSG.OPEN_URL, url: pagina.url });
        return;
      }
      if (e.target.closest('[data-continua]')) { sendChat(window.SN_CHAT_ERRORS.CHIEDI_SEGUITO); return; }
      if (e.target.closest('[data-clear-chat]')) { clearChat(); return; }
      const impAll = e.target.closest('[data-import-all]');
      if (impAll) { importAllFromBubble(impAll.closest('[data-msg-i]')); return; }
      const add = e.target.closest('[data-add]');
      if (add) { toggleCard(add.dataset.add, Number(add.dataset.qty) || 1); return; }
      const sum = e.target.closest('[data-toggle-list]');
      if (sum) {
        const bubble = sum.closest('[data-msg-i]');
        const m = chatMsgs()[Number(bubble.dataset.msgI)];
        if (m) { m.expanded = sum.getAttribute('aria-expanded') !== 'true'; renderChat(); }
        return;
      }
      // Click su una riga risultato → carosello sulla lista di QUELLA bolla (§5.3).
      const row = e.target.closest('.dk-row[data-card-id]');
      if (row) { openCarouselFromRow(row, '.dk-cardlist'); return; }
      // Click su un nome in prosa → carosello su TUTTE le carte della bolla (#343).
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
    // Tasto destro su un risultato o su un nome citato (§8.3): le stesse azioni della carta, compreso il commander.
    log.addEventListener('contextmenu', async (e) => {
      const sum = e.target.closest('[data-toggle-list]');
      if (sum) {
        const bubble = sum.closest('[data-msg-i]');
        const m = bubble && chatMsgs()[Number(bubble.dataset.msgI)];
        if (!m || !m.cardIds || !m.cardIds.length) return;
        e.preventDefault();
        openCtx(e.clientX, e.clientY, listMenuItems(m));
        return;
      }
      const row = e.target.closest('.dk-row[data-card-id]');
      if (row) {
        e.preventDefault();
        const btn = row.querySelector('[data-add]');
        openCtx(e.clientX, e.clientY, cardMenuItems(row.dataset.cardId, Number(btn && btn.dataset.qty) || 1));
        return;
      }
      const span = e.target.closest('.dk-prose-card');
      if (!span) {
        const bubble = e.target.closest('[data-msg-i]');
        const msgs = current && chatByDeck.get(current.id);
        const m = bubble && msgs && msgs[Number(bubble.dataset.msgI)];
        if (!m || !m.pending || !chatTaken(msgs)) return;
        e.preventDefault();
        openCtx(e.clientX, e.clientY, [stopItem]);
        return;
      }
      e.preventDefault();
      const deckId = current && current.id;
      const id = await resolveProseCard(span).catch(() => null);
      if (id && current && current.id === deckId) openCtx(e.clientX, e.clientY, cardMenuItems(id));
    });

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
    // Drag di una carta su una categoria (#344): il drop vale su tutto il gruppo, intestazione
    // o righe. Un evidenziatore segue il gruppo sotto il cursore: ogni azione risponde.
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

    // La finestra che si rimpicciolisce deve ri-adattare le larghezze: con misure salvate più
    // grandi dello spazio disponibile la colonna centrale spariva. Solo a builder visibile.
    window.addEventListener('resize', () => {
      if (!$('screenBuilder').hidden) applyLayout();
    });
  }

  async function init() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    wire();
    await loadLayout();
    await route();
  }

  init();
})();
