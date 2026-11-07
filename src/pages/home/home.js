// Pagina "Aperti per dopo": vista lista, o a riquadri per categoria con le categorie automatiche accese.
// Ogni scheda ha il suo tasto destro (apri, apri e tieni, copia link, sposta, rimuovi con «Annulla»), anche da
// tastiera; prova: tests/home-menu-scheda.spec.mjs.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  let allPages = [];
  let categories = [];
  let useCategoryView = false;
  let currentCategoryId = null; // null = vista categorie; '' = "non categorizzate"; id = vista categoria
  // Scheda da evidenziare al primo render: la conferma di «Salva per dopo» apre la pagina
  // con ?highlight=<id> per mostrare dove è finita. Si consuma dopo averla mostrata.
  let highlightId = null;
  // Un doppio clic manda due richieste prima che la prima risponda: una scheda si apre, o si toglie, una volta.
  const inCorso = new Set();

  function readHighlightId() {
    try { return new URLSearchParams(window.location.search).get('highlight') || null; }
    catch (_) { return null; }
  }

  const send = (msg) => chrome.runtime.sendMessage(msg);
  const avviso = (testo, ms = 2200) => { try { window.SN_POPUP?.showToast?.(testo, { duration: ms }); } catch (_) {} };

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    useCategoryView = !!settings.featureFlags?.categorize;

    document.title = I18n.t('home_title');
    $('title').textContent = I18n.t('home_title');
    $('search').placeholder = I18n.t('home_search_placeholder');
    $('empty').textContent = I18n.t('home_empty');

    await leggiElenco();

    // Nella vista a tile la card non sarebbe visibile: con una scheda da evidenziare si apre
    // direttamente dentro la sua categoria.
    highlightId = readHighlightId();
    if (highlightId && useCategoryView) {
      const target = allPages.find((p) => p.id === highlightId);
      if (target) currentCategoryId = categoriaDi(target);
    }

    render();
  }

  async function leggiElenco() {
    const [pagesRes, catsRes] = await Promise.all([
      send({ type: MSG.GET_SAVED_PAGES }),
      send({ type: MSG.GET_CATEGORIES }),
    ]);
    allPages = pagesRes?.pages || [];
    categories = catsRes?.categories || [];
  }

  // Ridisegnare rifà le schede: chi stava su una scheda col fuoco resta sulla stessa, o su quella che ne prende il
  // posto, invece di ritrovarsi in cima alla pagina (`fuocoSu`: la scheda da prendere, per esempio quella rimessa).
  function render({ fuocoSu = null } = {}) {
    const grid = $('grid');
    const attiva = document.activeElement;
    const fuoco = attiva && grid.contains(attiva) ? attiva.closest('.sn-card, .sn-cat-tile') : null;
    const fuocoIdx = fuoco ? [...grid.children].indexOf(fuoco) : -1;
    const fuocoId = fuocoSu || (fuoco && fuoco.dataset.pageId) || null;

    // Una categoria svuotata (spostata o tolta l'ultima scheda) non ha più riquadro: si torna ai riquadri.
    if (useCategoryView && currentCategoryId !== null && !filterByCurrentCategory().length) {
      currentCategoryId = null;
      $('search').value = '';
    }
    if (useCategoryView && currentCategoryId === null) {
      renderCategories();
    } else {
      renderList(useCategoryView ? filterByCurrentCategory() : allPages);
    }

    if (!fuoco && !fuocoSu) return;
    const voci = [...grid.children];
    const rimessa = fuocoSu && allPages.find((p) => p.id === fuocoSu);
    const stessa = (fuocoId && voci.find((el) => el.dataset.pageId === fuocoId))
      || (rimessa && voci.find((el) => el.dataset.categoryId === categoriaDi(rimessa)));
    const dopo = stessa || voci[Math.min(Math.max(fuocoIdx, 0), voci.length - 1)];
    const fallback = !$('search').hidden ? $('search') : null;
    try { (dopo || fallback)?.focus(); } catch (_) {}
  }

  // Una pagina che punta a una categoria che non c'è più sta fra le non categorizzate: un gruppo senza categoria
  // non ha riquadro, e lì la pagina non si vedrebbe da nessuna parte.
  function categoriaDi(p) {
    return p.categoryId && categories.some((c) => c.id === p.categoryId) ? p.categoryId : '';
  }

  function filterByCurrentCategory() {
    return allPages.filter((p) => categoriaDi(p) === currentCategoryId);
  }

  function nomeCategoria(id) {
    if (!id) return I18n.t('category_default');
    return categories.find((c) => c.id === id)?.name || '';
  }

  function renderCategories() {
    const grid = $('grid');
    grid.innerHTML = '';
    grid.className = 'sn-cat-grid';
    $('back').hidden = true;
    $('search').hidden = true;

    const counts = new Map();
    const lastSavedAt = new Map();
    const lastThumb = new Map();
    for (const p of allPages) {
      const k = categoriaDi(p);
      counts.set(k, (counts.get(k) || 0) + 1);
      const t = p.savedAt || '';
      if (!lastSavedAt.has(k) || t > lastSavedAt.get(k)) {
        lastSavedAt.set(k, t);
        lastThumb.set(k, p.thumbnail || '');
      }
    }

    const tiles = [];
    for (const c of categories) {
      const n = counts.get(c.id) || 0;
      if (!n) continue;
      tiles.push({
        id: c.id,
        name: c.name,
        count: n,
        thumb: lastThumb.get(c.id) || c.thumbnailUrl || '',
        recency: lastSavedAt.get(c.id) || '',
      });
    }
    const uncatCount = counts.get('') || 0;
    if (uncatCount) {
      tiles.push({
        id: '',
        name: I18n.t('category_default'),
        count: uncatCount,
        thumb: lastThumb.get('') || '',
        recency: lastSavedAt.get('') || '',
      });
    }

    tiles.sort((a, b) => (b.recency || '').localeCompare(a.recency || ''));

    if (!tiles.length) {
      // Reset del testo: si può arrivare qui dopo un «nessun risultato».
      $('empty').textContent = I18n.t('home_empty');
      $('empty').hidden = false;
      return;
    }
    $('empty').hidden = true;

    for (const t of tiles) {
      grid.appendChild(renderTile(t));
    }
  }

  function renderTile(t) {
    const tile = document.createElement('div');
    tile.className = 'sn-cat-tile';
    tile.dataset.categoryId = t.id;
    // Le schede dentro una categoria si raggiungono da tastiera solo se ci si arriva anche al riquadro.
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    const thumb = document.createElement('div');
    thumb.className = 'sn-cat-tile-thumb';
    if (t.thumb) thumb.style.backgroundImage = `url(${JSON.stringify(t.thumb)})`;
    tile.appendChild(thumb);
    const body = document.createElement('div');
    body.className = 'sn-cat-tile-body';
    const name = document.createElement('span');
    name.className = 'sn-cat-tile-name';
    name.textContent = t.name;
    body.appendChild(name);
    const count = document.createElement('span');
    count.className = 'sn-cat-tile-count';
    count.textContent = String(t.count);
    body.appendChild(count);
    tile.appendChild(body);
    const entra = (daTastiera) => {
      currentCategoryId = t.id;
      render();
      if (daTastiera) $('grid').querySelector('.sn-card')?.focus();
    };
    tile.addEventListener('click', () => entra(false));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entra(true); }
    });
    return tile;
  }

  function renderList(pages) {
    const q = ($('search').value || '').trim().toLowerCase();
    const grid = $('grid');
    grid.innerHTML = '';
    grid.className = 'sn-card-grid';
    $('search').hidden = false;
    $('back').hidden = !useCategoryView;

    if (useCategoryView) {
      $('back').textContent = `← ${nomeCategoria(currentCategoryId)}`;
    }

    const filtered = q
      ? pages.filter((p) =>
          (p.title || '').toLowerCase().includes(q) ||
          (p.url || '').toLowerCase().includes(q))
      : pages;

    if (!filtered.length) {
      // «Nessun risultato» solo se il vuoto dipende dalla ricerca: il testo di vuoto assoluto
      // durante un filtro sembra una lista cancellata.
      $('empty').textContent = q && pages.length
        ? I18n.t('home_no_results')
        : I18n.t('home_empty');
      $('empty').hidden = false;
      return;
    }
    $('empty').hidden = true;

    for (const page of filtered) {
      grid.appendChild(renderCard(page));
    }
  }

  function renderCard(page) {
    const card = document.createElement('div');
    card.className = 'sn-card';
    if (page.id) card.dataset.pageId = page.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', page.title || page.url || '');

    // Evidenziazione una tantum: l'id si consuma, così ricerche e re-render non la ripetono;
    // data-highlighted resta come traccia dopo l'animazione.
    if (highlightId && page.id === highlightId) {
      highlightId = null;
      card.dataset.highlighted = '1';
      card.classList.add('sn-card-highlight');
      requestAnimationFrame(() => {
        try { card.scrollIntoView({ block: 'center', behavior: window.SN_THEME_TOKENS?.scrollBehavior(document) || 'smooth' }); } catch (_) {}
      });
      card.addEventListener('animationend', () => card.classList.remove('sn-card-highlight'), { once: true });
    }

    const thumb = document.createElement('div');
    thumb.className = 'sn-card-thumb';
    if (page.thumbnail) thumb.style.backgroundImage = `url(${JSON.stringify(page.thumbnail)})`;
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'sn-card-body';
    const title = document.createElement('div');
    title.className = 'sn-card-title';
    title.textContent = page.title || page.url;
    body.appendChild(title);

    const dom = document.createElement('div');
    dom.className = 'sn-card-domain';
    // Solo la copia che Filo tiene dell'icona (#1273): un indirizzo di rete aprirebbe una richiesta a ogni apertura.
    // Senza copia, o se non si carica, il globo: come la home per gli stessi siti.
    const generica = () => {
      const g = document.createElement('span');
      g.className = 'sn-card-ico';
      g.setAttribute('aria-hidden', 'true');
      g.innerHTML = typeof window.SN_ICONS?.globe === 'function' ? window.SN_ICONS.globe(14) : '';
      return g;
    };
    if (/^(filo:\/\/icone\/|data:image\/)/.test(page.favicon || '')) {
      const img = document.createElement('img');
      img.src = page.favicon;
      img.onerror = () => img.replaceWith(generica());
      dom.appendChild(img);
    } else {
      dom.appendChild(generica());
    }
    const span = document.createElement('span');
    try { span.textContent = new URL(page.url).hostname; } catch (_) { span.textContent = page.url; }
    dom.appendChild(span);
    const date = document.createElement('span');
    date.style.marginLeft = 'auto';
    date.textContent = formatDate(page.savedAt);
    dom.appendChild(date);
    body.appendChild(dom);

    if (useCategoryView && categoriaDi(page)) {
      const tag = document.createElement('div');
      tag.className = 'sn-muted';
      tag.style.fontSize = '11px';
      tag.textContent = nomeCategoria(categoriaDi(page));
      body.appendChild(tag);
    }

    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'sn-card-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'sn-card-action';
    removeBtn.type = 'button';
    removeBtn.textContent = I18n.t('home_remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rimuovi(page, { daTastiera: e.detail === 0 });
    });
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    card.addEventListener('click', () => apri(page));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      apriMenuScheda(e.clientX, e.clientY, page);
    });
    // Parità con il mouse: Invio/Spazio aprono come il clic, Maiusc+F10 o il tasto Menu come il tasto destro.
    // Solo sulla scheda: Invio sul suo «Rimuovi» è del pulsante.
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        apri(page);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = card.getBoundingClientRect();
        apriMenuScheda(r.left, r.bottom, page);
      }
    });
    return card;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  }

  // ── Le azioni su una scheda: le stesse dal clic, dal pulsante e dal menu ──

  // `tieni`: si apre e resta in lista; senza, aprirla la toglie (la lista è di cose ancora da vedere).
  async function apri(page, { tieni = false } = {}) {
    if (!tieni && inCorso.has(page.id)) return;
    window.open(page.url, '_blank', 'noopener');
    if (tieni) return;
    inCorso.add(page.id);
    try {
      const r = await send({ type: MSG.CONSUME_SAVED_PAGE, id: page.id });
      allPages = r?.pages || allPages.filter((p) => p.id !== page.id);
      render();
    } finally { inCorso.delete(page.id); }
  }

  async function rimuovi(page, { daTastiera = false } = {}) {
    if (inCorso.has(page.id) || !allPages.some((p) => p.id === page.id)) return;
    inCorso.add(page.id);
    try {
      const r = await send({ type: MSG.REMOVE_SAVED_PAGE, id: page.id });
      allPages = r?.pages || allPages.filter((p) => p.id !== page.id);
      render();
      offriAnnulla(page, { daTastiera });
    } finally { inCorso.delete(page.id); }
  }

  async function rimetti(page, { prendiFuoco = false } = {}) {
    const r = await send({ type: MSG.RESTORE_SAVED_PAGE, id: page.id });
    if (r?.pages) allPages = r.pages;
    const ok = allPages.some((p) => p.id === page.id);
    render({ fuocoSu: prendiFuoco && ok ? page.id : null });
  }

  async function copiaLink(page) {
    try {
      await navigator.clipboard.writeText(page.url);
      avviso(I18n.t('home_link_copied'), 1600);
    } catch (_) {
      avviso(I18n.t('home_link_copy_failed'));
    }
  }

  // `dove`: { categoryId } per una categoria che c'è (null = fra le non categorizzate) o { nome } per una nuova.
  async function sposta(page, dove) {
    const r = await send({ type: MSG.MOVE_PAGE_CATEGORY, pageId: page.id, ...dove });
    await leggiElenco();
    render();
    if (!r?.ok) { avviso(I18n.t('home_move_failed')); return; }
    avviso(I18n.t('home_moved', nomeCategoria(r.page?.categoryId)));
  }

  // L'«Annulla» resta più di un avviso semplice, si ferma col puntatore o col fuoco sopra e non lo sfratta un avviso
  // nuovo: per quella scheda è l'unica strada per tornare indietro. Da tastiera il fuoco ci va da sé (in fondo ai Tab,
  // dietro tutte le schede, non lo si raggiungerebbe in tempo); Esc lo riporta all'elenco.
  function offriAnnulla(page, { daTastiera = false } = {}) {
    const P = window.SN_POPUP;
    if (!P?.mountToast) return;
    const el = document.createElement('div');
    el.className = 'sn-toast home-annulla';
    el.setAttribute('role', 'status');
    const testo = document.createElement('span');
    testo.className = 'home-annulla-testo';
    testo.textContent = I18n.t('home_removed', corto(page.title || page.url || ''));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-annulla-btn';
    btn.textContent = I18n.t('home_undo');
    el.appendChild(testo);
    el.appendChild(btn);

    let chiuso = false;
    let tempo = null;
    let ritorno = null;
    const chiudi = () => {
      if (chiuso) return;
      chiuso = true;
      if (tempo) { tempo.annulla(); tempo = null; }
      // Chi aveva il fuoco sull'avviso torna all'elenco, non in cima alla pagina.
      if (el.contains(document.activeElement) && ritorno && document.contains(ritorno)) {
        try { ritorno.focus(); } catch (_) {}
      }
      el.dataset.snClosing = '1';
      el.classList.remove('sn-toast-visible');
      setTimeout(() => P.unmountToast(el), window.SN_THEME_TOKENS?.motionMs(250) ?? 250);
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chiuso) return;
      const prendiFuoco = document.activeElement === btn;
      ritorno = null;
      chiudi();
      rimetti(page, { prendiFuoco });
    });
    el.addEventListener('click', chiudi);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      chiudi();
    });
    el.addEventListener('focusin', () => { if (tempo) { tempo.annulla(); tempo = null; } });
    el.addEventListener('focusout', (e) => {
      if (chiuso || el.contains(e.relatedTarget)) return;
      tempo = P.tempoAvviso(7000, chiudi);
    });
    P.mountToast(el, { sticky: true, chiudi });
    requestAnimationFrame(() => el.classList.add('sn-toast-visible'));
    tempo = P.tempoAvviso(7000, chiudi);
    if (daTastiera) {
      ritorno = document.activeElement;
      try { btn.focus(); } catch (_) {}
    }
  }

  function corto(s, max = 60) {
    const t = String(s).trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }

  // ── Menu del tasto destro della scheda ──
  // Menu proprio della pagina: .sn-select-pop alle coordinate del
  // clic, frecce/Tab/Home/Fine/lettera per muoversi, Invio per scegliere, Esc per chiudere e tornare alla scheda.

  function apriMenuScheda(x, y, page) {
    const voci = [
      { label: I18n.t('home_menu_open'), run: () => apri(page) },
      { label: I18n.t('home_menu_open_keep'), run: () => apri(page, { tieni: true }) },
      { label: I18n.t('home_menu_copy_link'), run: () => copiaLink(page) },
    ];
    if (categories.length) voci.push({ label: I18n.t('home_menu_move'), run: () => apriMenuSposta(x, y, page) });
    voci.push({ label: I18n.t('home_remove'), run: (o) => rimuovi(page, o) });
    openMenuAt(x, y, voci);
  }

  // Il secondo livello si apre nello stesso punto, come «Sposta in gruppo…» dei Mazzi.
  function apriMenuSposta(x, y, page) {
    const altre = categories
      .filter((c) => c.id !== categoriaDi(page))
      .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))
      .map((c) => ({ label: c.name, run: () => sposta(page, { categoryId: c.id }) }));
    // Da una categoria si torna anche fra le non categorizzate, che nei riquadri hanno il loro.
    if (categoriaDi(page)) altre.push({ label: I18n.t('category_default'), run: () => sposta(page, { categoryId: null }) });
    altre.push({ label: I18n.t('home_menu_new_category'), run: () => apriCampoCategoria(x, y, page) });
    openMenuAt(x, y, altre);
  }

  function apriCampoCategoria(x, y, page) {
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.className = 'home-campo';
    campo.maxLength = window.SN_CONST?.CATEGORY_NAME_MAX || 100;
    campo.placeholder = I18n.t('home_new_category_placeholder');
    campo.setAttribute('aria-label', I18n.t('home_new_category_placeholder'));
    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const nome = campo.value.trim();
      if (!nome) return;
      closeCtxMenu();
      // Il nome del gruppo delle non categorizzate porta lì: due riquadri con lo stesso nome non si distinguono.
      const nonCategorizzate = nome.toLocaleLowerCase('it') === I18n.t('category_default').toLocaleLowerCase('it');
      sposta(page, nonCategorizzate ? { categoryId: null } : { nome });
    });
    openMenuAt(x, y, [], { campo });
    try { campo.focus(); } catch (_) {}
  }

  let openMenu = null;
  let fuocoPrimaDelMenu = null;
  function closeCtxMenu() {
    if (!openMenu) return;
    const eraDentro = openMenu.contains(document.activeElement);
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onMenuKeydown, true);
    window.removeEventListener('scroll', closeCtxMenu, true);
    window.removeEventListener('resize', closeCtxMenu);
    if (eraDentro && fuocoPrimaDelMenu && document.contains(fuocoPrimaDelMenu)) {
      try { fuocoPrimaDelMenu.focus(); } catch (_) {}
    }
    fuocoPrimaDelMenu = null;
  }
  function onOutsideClick(e) {
    if (openMenu && !openMenu.contains(e.target)) closeCtxMenu();
  }
  const vociMenu = () => (openMenu ? [...openMenu.querySelectorAll('.sn-select-option')] : []);
  function muoviFuocoMenu(passo) {
    const voci = vociMenu();
    if (!voci.length) return;
    const i = voci.indexOf(document.activeElement);
    voci[i < 0 ? (passo > 0 ? 0 : voci.length - 1) : (i + passo + voci.length) % voci.length].focus();
  }
  function onMenuKeydown(e) {
    if (!openMenu) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCtxMenu(); return; }
    // Nel campo del nome i tasti scrivono: Invio lo gestisce il campo, Tab non porta fuori dal riquadro.
    if (openMenu.querySelector('.home-campo')) {
      if (e.key === 'Tab') e.preventDefault();
      return;
    }
    const voci = vociMenu();
    const sopra = voci.includes(document.activeElement) ? document.activeElement : null;
    const giu = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
    const su = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
    if (giu || su) { e.preventDefault(); muoviFuocoMenu(giu ? 1 : -1); return; }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (voci.length) voci[e.key === 'Home' ? 0 : voci.length - 1].focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && sopra) { e.preventDefault(); sopra.click(); return; }
    if (e.key.length === 1 && e.key.trim()) {
      const lettera = e.key.toLowerCase();
      const da = voci.indexOf(document.activeElement) + 1;
      const trovata = voci.slice(da).concat(voci.slice(0, da))
        .find((o) => o.textContent.trim().toLowerCase().startsWith(lettera));
      if (trovata) { e.preventDefault(); trovata.focus(); }
    }
  }
  // `items`: [{ label, run }]; `campo`: un campo da scrivere al posto delle voci (il nome di una categoria nuova).
  function openMenuAt(x, y, items, { campo = null } = {}) {
    closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop home-ctxmenu';
    menu.setAttribute('role', campo ? 'dialog' : 'menu');

    for (const it of items) {
      const opt = document.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', 'menuitem');
      opt.tabIndex = -1;
      opt.textContent = it.label;
      // I nomi delle categorie li sceglie un modello o chi scrive: lunghi si accorciano, e il nome intero resta qui.
      opt.title = it.label;
      // detail 0: la voce l'ha scelta Invio o Spazio, non un clic.
      opt.addEventListener('click', (e) => { closeCtxMenu(); it.run({ daTastiera: e.detail === 0 }); });
      menu.appendChild(opt);
    }
    if (campo) menu.appendChild(campo);

    document.body.appendChild(menu);

    const vw = window.innerWidth, vh = window.innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;

    openMenu = menu;
    // Il fuoco entra nel menu, non sulla prima voce: la freccia giù sceglie la
    // prima, e finché nessuna è scelta Invio non fa partire niente per sbaglio.
    fuocoPrimaDelMenu = document.activeElement;
    menu.tabIndex = -1;
    try { menu.focus(); } catch (_) {}
    document.addEventListener('keydown', onMenuKeydown, true);
    // setTimeout: il mousedown che ha aperto il menu non lo deve richiudere subito.
    setTimeout(() => {
      if (openMenu !== menu) return;
      document.addEventListener('mousedown', onOutsideClick, true);
      window.addEventListener('scroll', closeCtxMenu, true);
      window.addEventListener('resize', closeCtxMenu);
    }, 0);
  }

  // La lista cambia anche da altre strade (la chat che apre o cerca una pagina, «Salva per dopo» in un'altra scheda):
  // tornando su questa scheda si rilegge, così un clic non apre una pagina che non c'è più; dopo un'importazione subito.
  async function rileggi() {
    await leggiElenco();
    closeCtxMenu();
    render();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rileggi(); });
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && ((msg.type === MSG.TAB_IN_VISTA && msg.inVista) || msg.type === MSG.DATI_IMPORTATI)) rileggi();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('search').addEventListener('input', () => render());
    $('back').addEventListener('click', () => {
      currentCategoryId = null;
      $('search').value = '';
      render();
    });
    $('openHistory').addEventListener('click', () => {
      // #252 — indirizzo canonico: una sola scheda per "Cronologia AI".
      chrome.tabs.create({ url: 'filo://history/history.html' });
    });
    $('openArchive').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://quaderno/quaderno.html' });
    });
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  });
})();
