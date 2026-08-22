// Pagina "Aperti per dopo".
// - Se featureFlags.categorize è OFF: vista lista flat (Fase 1).
// - Se ON: vista a tile per categoria + dettaglio.

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
  // Scheda da evidenziare al primo render (#252): la conferma cliccabile di
  // "Salva per dopo" apre questa pagina con ?highlight=<id> per far vedere subito
  // dove è finita la scheda appena salvata. La consumiamo dopo averla mostrata.
  let highlightId = null;

  function readHighlightId() {
    try { return new URLSearchParams(window.location.search).get('highlight') || null; }
    catch (_) { return null; }
  }

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    useCategoryView = !!settings.featureFlags?.categorize;

    document.title = I18n.t('home_title');
    $('title').textContent = I18n.t('home_title');
    $('search').placeholder = I18n.t('home_search_placeholder');
    $('empty').textContent = I18n.t('home_empty');

    const [pagesRes, catsRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: MSG.GET_SAVED_PAGES }),
      chrome.runtime.sendMessage({ type: MSG.GET_CATEGORIES }),
    ]);
    allPages = pagesRes?.pages || [];
    categories = catsRes?.categories || [];

    // Se dobbiamo evidenziare una scheda e la vista è per categoria, apriamoci
    // direttamente DENTRO la categoria (o "non categorizzate") dove vive la
    // scheda: nella vista a tile la card non sarebbe visibile.
    highlightId = readHighlightId();
    if (highlightId && useCategoryView) {
      const target = allPages.find((p) => p.id === highlightId);
      if (target) currentCategoryId = target.categoryId || '';
    }

    render();
  }

  function render() {
    if (useCategoryView && currentCategoryId === null) {
      renderCategories();
    } else {
      renderList(useCategoryView ? filterByCurrentCategory() : allPages);
    }
  }

  function filterByCurrentCategory() {
    if (currentCategoryId === '') return allPages.filter((p) => !p.categoryId);
    return allPages.filter((p) => p.categoryId === currentCategoryId);
  }

  function renderCategories() {
    const grid = $('grid');
    grid.innerHTML = '';
    grid.className = 'sn-cat-grid';
    $('back').hidden = true;
    $('search').hidden = true;

    // Filtra categorie effettivamente popolate, ordinate per recenza della pagina più recente.
    const counts = new Map();
    const lastSavedAt = new Map();
    const lastThumb = new Map();
    for (const p of allPages) {
      const k = p.categoryId || '';
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
    // Tile "Non categorizzate" se ci sono pagine senza categoria
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
      // Reset del testo: potremmo arrivare qui dopo un "nessun risultato".
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
    tile.addEventListener('click', () => {
      currentCategoryId = t.id;
      render();
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
      const cat = currentCategoryId === ''
        ? I18n.t('category_default')
        : (categories.find((c) => c.id === currentCategoryId)?.name || '');
      $('back').textContent = `← ${cat}`;
    }

    const filtered = q
      ? pages.filter((p) =>
          (p.title || '').toLowerCase().includes(q) ||
          (p.url || '').toLowerCase().includes(q))
      : pages;

    if (!filtered.length) {
      // "Nessun risultato" solo se il vuoto dipende dalla ricerca: il testo di
      // vuoto assoluto durante un filtro sembra una lista cancellata.
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

    // Evidenziazione una tantum della scheda appena salvata (#252): pulsazione
    // morbida che sfuma da sola, e la portiamo in vista. Consumiamo l'id così
    // ricerche/re-render successivi non la ri-evidenziano. Il marcatore
    // data-highlighted resta (traccia stabile) anche dopo che l'animazione sfuma.
    if (highlightId && page.id === highlightId) {
      highlightId = null;
      card.dataset.highlighted = '1';
      card.classList.add('sn-card-highlight');
      requestAnimationFrame(() => {
        try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
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
    if (page.favicon) {
      const img = document.createElement('img');
      img.src = page.favicon;
      img.onerror = () => img.remove();
      dom.appendChild(img);
    }
    const span = document.createElement('span');
    try { span.textContent = new URL(page.url).hostname; } catch (_) { span.textContent = page.url; }
    dom.appendChild(span);
    const date = document.createElement('span');
    date.style.marginLeft = 'auto';
    date.textContent = formatDate(page.savedAt);
    dom.appendChild(date);
    body.appendChild(dom);

    if (useCategoryView && page.category) {
      const tag = document.createElement('div');
      tag.className = 'sn-muted';
      tag.style.fontSize = '11px';
      tag.textContent = page.category;
      body.appendChild(tag);
    }

    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'sn-card-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'sn-card-action';
    removeBtn.type = 'button';
    removeBtn.textContent = I18n.t('home_remove');
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await chrome.runtime.sendMessage({ type: MSG.REMOVE_SAVED_PAGE, id: page.id });
      allPages = r?.pages || allPages.filter((p) => p.id !== page.id);
      render();
    });
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    card.addEventListener('click', async () => {
      window.open(page.url, '_blank', 'noopener');
      const r = await chrome.runtime.sendMessage({ type: MSG.CONSUME_SAVED_PAGE, id: page.id });
      allPages = r?.pages || allPages.filter((p) => p.id !== page.id);
      render();
    });
    return card;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    // #442 — un'importazione da backup ha rimesso dentro le pagine salvate:
    // questa scheda le rilegge invece di restare all'elenco di prima.
    window.SN_PAGE_BOOTSTRAP.onDataImported(
      () => { load(); },
      ['savedPages', 'categories', 'settings'],
    );
    $('search').addEventListener('input', render);
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
      chrome.tabs.create({ url: 'filo://archive/archive.html' });
    });
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  });
})();
