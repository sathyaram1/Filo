// App deck builder Commander (DECK-BUILDER-SPEC.md): routing a tre schermate
// (Mazzi / Builder / Partita stub), libreria, layout del Builder a tre colonne
// FISSE con divisori trascinabili persistiti (§2) e header-switcher del mazzo
// (§8.2). Chat, elenco carte e statistiche arrivano coi task successivi.
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
  const LAYOUT_DEFAULT = { leftW: 340, centerW: 300 };
  const LAYOUT_MIN = { leftW: 220, centerW: 220 };
  let layout = { ...LAYOUT_DEFAULT };

  function applyLayout() {
    $('builderGrid').style.gridTemplateColumns =
      `${layout.leftW}px 6px ${layout.centerW}px 6px 1fr`;
  }

  async function loadLayout() {
    try {
      const res = await chrome.storage.local.get(LAYOUT_KEY);
      const saved = res && res[LAYOUT_KEY];
      if (saved && typeof saved === 'object') {
        layout.leftW = Math.max(LAYOUT_MIN.leftW, Number(saved.leftW) || LAYOUT_DEFAULT.leftW);
        layout.centerW = Math.max(LAYOUT_MIN.centerW, Number(saved.centerW) || LAYOUT_DEFAULT.centerW);
      }
    } catch (_) {}
    applyLayout();
  }

  function persistLayout() {
    chrome.storage.local.set({ [LAYOUT_KEY]: { ...layout } }).catch?.(() => {});
  }

  // Trascinamento dei divisori: aggiorna la larghezza live, persiste al rilascio.
  function wireDivider(el, prop, originOf) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      el.classList.add('dragging');
      const move = (ev) => {
        const w = Math.max(LAYOUT_MIN[prop], Math.round(ev.clientX - originOf()));
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
    const gridLeft = () => $('builderGrid').getBoundingClientRect().left;
    // Colonna sinistra: dal bordo del grid al cursore.
    wireDivider($('dividerLeft'), 'leftW', gridLeft);
    // Colonna centrale: dal bordo destro del primo divisore al cursore.
    wireDivider($('dividerRight'), 'centerW', () => gridLeft() + layout.leftW + 6);
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
  }

  async function route() {
    const r = parseRoute();
    if (r.screen === 'builder') {
      const res = await send({ type: MSG.DECKS_GET, id: r.id });
      if (!res || !res.ok) { location.hash = '#/'; return; }
      current = res.deck;
      show('builder');
      await renderBuilder();
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

  async function renderBuilder() {
    $('deckNameText').textContent = current.nome;
    const commander = (current.commanderMeta && current.commanderMeta.name)
      ? `Commander: ${current.commanderMeta.name}`
      : 'Nessun commander — impostalo col tasto destro su una carta del mazzo.';
    const budget = (current.budget !== null && current.budget !== undefined)
      ? ` · Budget: ${current.budget} €` : '';
    $('commanderLine').textContent = commander + budget;
    $('deckCount').textContent = `${Decks.deckCount(current)}/100 carte`;
    await Promise.all([ensureSymbols(), loadDeckCards()]);
    renderDeckList();
  }

  async function saveDeck(next) {
    if (next === current) return;
    const res = await send({ type: MSG.DECKS_UPDATE, deck: next });
    if (res && res.ok) { current = res.deck; await renderBuilder(); }
  }

  // ── Colonna mazzo (§8.1): dati carta, gruppi collassabili, righe ───────────

  let cardsById = {};      // scryfall_id → carta semplificata (cache di pagina)
  let symbolsMap = null;   // '{U}' → svg_uri (symbology, chiesta una volta)
  const collapsedGroups = new Set();
  const VIEW_LABEL = { tipo: 'tipo', tag: 'tag', cmc: 'costo', colore: 'colore' };

  async function ensureSymbols() {
    if (symbolsMap) return;
    const r = await send({ type: MSG.SCRYFALL_SYMBOLS });
    symbolsMap = (r && r.ok && r.symbols) || {};
  }

  async function loadDeckCards() {
    const ids = current.carte.map((c) => c.scryfall_id);
    if (current.commander) ids.push(current.commander);
    if (!ids.length) { cardsById = {}; return; }
    const r = await send({ type: MSG.SCRYFALL_CARDS, ids });
    cardsById = (r && r.ok && r.cards) || {};
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
      <div class="dk-row" data-card-id="${esc(entry.scryfall_id)}" tabindex="0">
        ${qty}<span class="dk-row-name">${esc(name)}</span>
        <span class="dk-row-price">${esc(price)}</span>
        <span class="dk-row-mana">${mana}</span>
      </div>`;
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
          <span class="dk-group-n">${g.entries.length}</span>
        </div>
        <div class="dk-group-rows" ${closed ? 'hidden' : ''}>
          ${g.entries.map(rowHtml).join('')}
        </div>
      </div>`;
    }).join('');
    renderLegality();
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

  async function removeFromDeck(cardId) {
    const { deck, removed } = Decks.removeCard(current, cardId);
    if (removed) await saveDeck(deck);
  }

  // "Sposta in gruppo": secondo livello del menu — i gruppi esistenti della
  // vista corrente + il ritorno al gruppo naturale (toglie l'override).
  function chooseGroup(x, y, cardId) {
    const items = Decks.groupDeck(current, cardsById).map((g) => ({
      label: g.name,
      run: () => saveDeck(Decks.setGroupOverride(current, cardId, g.name)),
    }));
    items.push({
      label: '(gruppo naturale)',
      run: () => saveDeck(Decks.setGroupOverride(current, cardId, null)),
    });
    openCtx(x, y, items);
  }

  // "Copia/Sposta in un altro mazzo": secondo livello con l'elenco dei mazzi.
  async function chooseDeck(x, y, cardId, move) {
    const res = await send({ type: MSG.DECKS_LIST });
    const others = Decks.sortForLibrary((res && res.decks) || [])
      .filter((d) => d.id !== current.id);
    if (!others.length) return;
    const entry = current.carte.find((c) => c.scryfall_id === cardId);
    openCtx(x, y, others.map((d) => ({
      label: d.nome,
      run: async () => {
        const t = await send({ type: MSG.DECKS_GET, id: d.id });
        if (t && t.ok) {
          const { deck: target, added } = Decks.addCard(t.deck, cardId, {
            qty: entry ? entry.qty : 1, tags: entry ? entry.tags : [],
          });
          if (added) await send({ type: MSG.DECKS_UPDATE, deck: target });
        }
        if (move) await removeFromDeck(cardId);
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
    add('Rinomina…', () => startEdit('deckNameEdit', current.nome, async (v) => {
      await saveDeck(Decks.renameDeck(current, v));
    }));
    add('Budget…', () => startEdit('deckBudgetEdit', current.budget ?? '', async (v) => {
      await saveDeck(Decks.setBudget(current, v === '' ? null : v));
    }));
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
    wireDividers();

    // Colonna mazzo: collassa/espandi i gruppi al click sul divisore.
    const list = $('deckList');
    list.addEventListener('click', (e) => {
      const head = e.target.closest('.dk-group-head');
      if (!head) return;
      const g = head.dataset.g;
      if (collapsedGroups.has(g)) collapsedGroups.delete(g);
      else collapsedGroups.add(g);
      renderDeckList();
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
