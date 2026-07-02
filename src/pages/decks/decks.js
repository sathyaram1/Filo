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
      renderBuilder();
      show('builder');
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

  function renderBuilder() {
    $('deckNameText').textContent = current.nome;
    const commander = (current.commanderMeta && current.commanderMeta.name)
      ? `Commander: ${current.commanderMeta.name}`
      : 'Nessun commander — potrai impostarlo dalla ricerca carte.';
    const budget = (current.budget !== null && current.budget !== undefined)
      ? ` · Budget: ${current.budget} €` : '';
    $('commanderLine').textContent = commander + budget;
    $('deckCount').textContent = `${Decks.deckCount(current)}/100 carte`;
  }

  async function saveDeck(next) {
    if (next === current) return;
    const res = await send({ type: MSG.DECKS_UPDATE, deck: next });
    if (res && res.ok) { current = res.deck; renderBuilder(); }
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

    const name = $('deckName');
    name.addEventListener('blur', saveRename);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') { name.value = current ? current.nome : ''; name.blur(); }
    });

    window.addEventListener('hashchange', route);
  }

  async function init() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    wire();
    await route();
  }

  init();
})();
