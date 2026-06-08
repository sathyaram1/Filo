// Pagina archivio tab (§3.3): le schede chiuse, raggruppate per giorno e
// ordinate per colore (ordine cromatico). Riapri / rimuovi / svuota.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  let tabs = [];

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

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const list = $('list');
    list.innerHTML = '';

    let filtered = tabs;
    if (q) {
      filtered = filtered.filter((t) =>
        `${t.title || ''} ${t.url || ''}`.toLowerCase().includes(q));
    }

    if (!filtered.length) {
      $('empty').hidden = false;
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

  function renderTab(t) {
    const row = document.createElement('div');
    row.className = 'arc-tab';
    if (t.identityColor) row.style.setProperty('--arc-color', t.identityColor);

    const fav = document.createElement('div');
    fav.className = 'arc-fav';
    if (t.favicon) fav.style.backgroundImage = `url("${t.favicon}")`;
    row.appendChild(fav);

    const main = document.createElement('div');
    main.className = 'arc-main';
    const title = document.createElement('div');
    title.className = 'arc-title';
    title.textContent = t.title || t.url || '';
    main.appendChild(title);
    const url = document.createElement('div');
    url.className = 'arc-url';
    url.textContent = t.url || '';
    main.appendChild(url);
    row.appendChild(main);

    const time = document.createElement('div');
    time.className = 'arc-time';
    time.textContent = timeLabel(t.closedAt);
    row.appendChild(time);

    const actions = document.createElement('div');
    actions.className = 'arc-actions';

    const reopen = document.createElement('button');
    reopen.className = 'sn-btn';
    reopen.textContent = 'Riapri';
    reopen.addEventListener('click', () => {
      // Riapre ripristinando lo scroll registrato (§3.1).
      try {
        chrome.runtime.sendMessage({
          type: MSG.REOPEN_ARCHIVED_TAB,
          url: t.url,
          scrollPct: typeof t.scrollPosition === 'number' ? t.scrollPosition : null,
        });
      } catch (_) {
        try { chrome.tabs.create({ url: t.url }); } catch (_) {}
      }
    });
    actions.appendChild(reopen);

    const del = document.createElement('button');
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = 'Rimuovi';
    del.addEventListener('click', async () => {
      const r = await chrome.runtime.sendMessage({ type: MSG.REMOVE_ARCHIVED_TAB, id: t.id });
      tabs = (r && r.tabs) || tabs.filter((x) => x.id !== t.id);
      render();
    });
    actions.appendChild(del);

    row.appendChild(actions);
    return row;
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('search').addEventListener('input', render);
    $('clear').addEventListener('click', async () => {
      if (!tabs.length) return;
      if (!confirm('Svuotare l’archivio delle tab? L’operazione non è reversibile.')) return;
      await chrome.runtime.sendMessage({ type: MSG.CLEAR_ARCHIVED_TABS });
      tabs = [];
      render();
    });
    $('openHistory').addEventListener('click', () => {
      try { chrome.tabs.create({ url: 'filo://history/history.html' }); } catch (_) {}
    });
  });
})();
