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
  function effectiveWidths() {
    const grid = $('builderGrid');
    const avail = (grid && grid.clientWidth) || window.innerWidth || 0;
    let leftW = Math.max(LAYOUT_MIN.leftW, layout.leftW);
    let rightW = Math.max(LAYOUT_MIN.rightW, layout.rightW);
    if (avail <= 0) return { leftW, rightW };
    // Spazio massimo per le due colonne esterne, lasciando i due divisori (12px)
    // e il minimo del mazzo al centro.
    const budget = avail - 12 - CENTER_MIN;
    let excess = (leftW + rightW) - budget;
    if (excess > 0) {
      // Riduci le due colonne proporzionalmente a quanto sono comprimibili
      // sopra il loro minimo, senza mai scendere sotto quel minimo.
      const shrinkL = leftW - LAYOUT_MIN.leftW;
      const shrinkR = rightW - LAYOUT_MIN.rightW;
      const total = shrinkL + shrinkR;
      if (total > 0) {
        const cut = Math.min(excess, total);
        const cutL = Math.round(cut * (shrinkL / total));
        leftW = Math.max(LAYOUT_MIN.leftW, leftW - cutL);
        rightW = Math.max(LAYOUT_MIN.rightW, rightW - (cut - cutL));
      }
      // Se persino ai minimi non c'entrano (finestra minuscola), restano ai
      // minimi: il mazzo si stringe sotto CENTER_MIN ma nessuna colonna esce
      // dal riquadro sovrapponendosi.
    }
    return { leftW, rightW };
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
    refreshOpinionStaleness();
    renderDeckList();
    renderChat();
    renderStats();
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
    if (!ids.length) return;
    // freshPrices: il budget (§9.2) vuole prezzi EUR con TTL, non eterni.
    const r = await send({ type: MSG.SCRYFALL_CARDS, ids, freshPrices: true });
    // MERGE, mai sostituzione: la cache di pagina contiene anche le carte dei
    // risultati chat (sendChat) e dei nomi in prosa risolti (resolveProseCard).
    // Le bolle chat vivono per tutta la pagina (chatByDeck): dopo un edit del
    // mazzo l'hover su quei risultati deve continuare ad aprire la preview.
    Object.assign(cardsById, (r && r.ok && r.cards) || {});
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

  function runProb() {
    const want = [...$('probNeeds').querySelectorAll('input[data-tag]')]
      .map((inp) => ({ tag: inp.dataset.tag, n: Number(inp.value) || 0 }))
      .filter((w) => w.n > 0);
    const out = $('probResult');
    if (!want.length) { out.textContent = 'Scegli almeno una categoria.'; return; }
    const turn = Math.max(1, Number($('probTurn').value) || 1);
    const library = Stats.buildLibrary(current, cardsById);
    const r = Stats.simulate({ library, want, turn });
    out.textContent = `≈ ${(r.probability * 100).toFixed(1).replace('.', ',')}%`;
    out.title = `${r.iterations.toLocaleString('it-IT')} mani simulate, ${r.seen} carte viste`;
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
  // aggiungi-al-mazzo. Niente immagini finché non c'è hover (task 6).
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
  function proseHtml(text) {
    return window.SN_SCRYFALL_Q.proseSegments(text).map((seg) => (
      seg.type === 'card'
        ? `<span class="dk-prose-card" data-card-name="${esc(seg.name)}">${esc(seg.name)}</span>`
        : esc(seg.text)
    )).join('');
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

  function renderChat() {
    const log = $('chatLog');
    const msgs = chatMsgs();
    msgs.forEach((m, i) => { m._i = i; });
    $('chatEmpty').hidden = msgs.length > 0;
    // Il placeholder resta come primo figlio; le bolle si rigenerano dopo.
    for (const el of [...log.querySelectorAll('.dk-msg')]) el.remove();
    $('chatEmpty').insertAdjacentHTML('afterend',
      msgs.map((m, i) => chatBubbleHtml(m, i === msgs.length - 1)).join(''));
    log.scrollTop = log.scrollHeight;
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
    renderChat();
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

  // Hover su un nome in prosa: risoluzione fuzzy una-tantum (§3.5); l'id
  // risolto resta nel dataset e, se il mouse è ancora lì, parte la preview.
  async function resolveProseCard(el) {
    if (el.dataset.cardId || el.dataset.resolving) return;
    el.dataset.resolving = '1';
    const r = await send({ type: MSG.SCRYFALL_NAMED, name: el.dataset.cardName });
    delete el.dataset.resolving;
    if (r && r.ok && r.card) {
      el.dataset.cardId = r.card.id;
      cardsById[r.card.id] = r.card;
      el.title = `${r.card.name} — ${r.card.typeLine}`;
      // La risoluzione è arrivata DOPO il mouseover: se il puntatore è ancora
      // sul nome non ci sarà un nuovo evento — la preview parte da qui.
      if (el.matches(':hover')) hoverEnter(r.card.id);
    }
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

  // Mostra/aggiorna la preview SUL POSTO: immagine (caricata solo ora — mai
  // prima dell'hover, §5.1; la cachea l'HTTP cache del browser), contesto,
  // modulo. Se lo stato era già preview non si passa dalle statistiche.
  function showPreview(cardId) {
    const card = cardsById[cardId];
    if (!card) return;
    const img = $('previewImg');
    if (img.dataset.cardId !== card.id) {
      img.src = card.image || '';
      img.alt = card.name;
      img.dataset.cardId = card.id;
    }
    renderDetailCtx(card);
    renderDetailModule(card);
    if (detailState !== 'preview') setDetailState('preview');
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
    const img = $('carouselImg');
    img.src = (card && card.image) || '';
    img.alt = (card && card.name) || '';
    $('carouselPos').textContent = `${carousel.i + 1}/${carousel.ids.length}`;
    const added = inDeck(id);
    const btn = $('carouselToggle');
    btn.dataset.in = added ? '1' : '0';
    btn.textContent = added ? '✓ nel mazzo' : '+ aggiungi';
    btn.title = added ? 'Rimuovi dal mazzo (Invio)' : 'Aggiungi al mazzo (Invio)';
    // Prefetch di precedente e successiva (§5.1): la navigazione non aspetta.
    for (const j of [carousel.i - 1, carousel.i + 1]) {
      const c = cardsById[carousel.ids[j]];
      if (c && c.image) { const pre = new Image(); pre.src = c.image; }
    }
    // Il box modulare vive anche nel carosello (§5.2): stesso slot, stesso menu.
    if (card) renderDetailModule(card, 'carouselModule');
    // Parere di Filo attivo → prefetch dei pareri delle carte VICINE (§6.1):
    // scorrendo, il parere è già lì. Una sola richiesta per corrente+vicine.
    if (card && layout.module === 'opinion') {
      const near = [carousel.i, carousel.i - 1, carousel.i + 1]
        .map((j) => carousel.ids[j]).filter(Boolean);
      requestOpinions(near).catch(() => {});
    }
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

    // Calcolatore di probabilità (§9.3): Invio su un campo = Calcola.
    $('probRun').addEventListener('click', runProb);
    $('stateStats').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.matches('#probTurn, #probNeeds input')) {
        e.preventDefault();
        runProb();
      }
    });

    $('carouselPrev').addEventListener('click', () => carouselNav(-1));
    $('carouselNext').addEventListener('click', () => carouselNav(1));
    $('carouselToggle').addEventListener('click', () => carouselToggle());
    $('carouselClose').addEventListener('click', () => closeCarousel());

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
    log.addEventListener('click', (e) => {
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
      // Click su un nome in prosa risolto → carosello su quella sola carta.
      const span = e.target.closest('.dk-prose-card');
      if (span && span.dataset.cardId) openCarousel([span.dataset.cardId], 0);
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
    await loadLayout();
    await route();
  }

  init();
})();
