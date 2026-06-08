// Pagina cronologia AI: lista, ricerca, filtro per tipo, cancellazione.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  let items = [];

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    document.title = I18n.t('history_title');
    $('title').textContent = I18n.t('history_title');
    $('search').placeholder = I18n.t('history_search_placeholder');
    $('clear').textContent = I18n.t('history_clear');
    $('empty').textContent = I18n.t('history_empty');

    const r = await chrome.runtime.sendMessage({ type: MSG.GET_HISTORY });
    items = r?.items || [];
    render();
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const filter = $('filter').value;
    const list = $('list');
    list.innerHTML = '';

    let filtered = items;
    if (filter) filtered = filtered.filter((it) => it.action === filter);
    if (q) {
      filtered = filtered.filter((it) => {
        const haystack = [
          JSON.stringify(it.input || {}),
          it.output || '',
          it.origin || '',
          it.model || '',
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    if (!filtered.length) {
      $('empty').hidden = false;
      return;
    }
    $('empty').hidden = true;

    for (const it of filtered) {
      list.appendChild(renderItem(it));
    }
  }

  function renderItem(it) {
    const wrap = document.createElement('div');
    wrap.className = 'sn-history-item';

    const meta = document.createElement('div');
    meta.className = 'sn-history-meta';
    const left = document.createElement('span');
    left.textContent = `${formatActionLabel(it.action)} • ${it.model || ''} • ${formatDate(it.timestamp)}`;
    meta.appendChild(left);
    const right = document.createElement('span');
    const cost = it.costEur ? `€${it.costEur.toFixed(4)}` : '—';
    right.textContent = cost;
    meta.appendChild(right);
    wrap.appendChild(meta);

    if (it.input) {
      const inp = document.createElement('div');
      inp.className = 'sn-history-input';
      inp.textContent = formatInput(it.input);
      wrap.appendChild(inp);
    }

    const out = document.createElement('div');
    out.className = 'sn-history-output';
    out.textContent = it.output || '';
    wrap.appendChild(out);

    if (it.origin) {
      const origin = document.createElement('div');
      origin.className = 'sn-muted';
      origin.style.marginTop = '6px';
      origin.style.fontSize = '11px';
      origin.textContent = it.origin;
      wrap.appendChild(origin);
    }
    return wrap;
  }

  function formatActionLabel(a) {
    return ({
      explain: 'Spiega',
      explain_deep: 'Approfondisci',
      translate_selection: 'Traduci selezione',
      translate_page: 'Traduci pagina',
      help: 'Aiuto',
      categorize: 'Categorizza',
    })[a] || a;
  }

  function formatInput(input) {
    if (typeof input === 'string') return truncate(input, 400);
    const sel = input.selection || input.userMessage || input.title || input.url || '';
    return truncate(sel, 400);
  }

  function truncate(s, n) {
    if (!s) return '';
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('it-IT');
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('search').addEventListener('input', render);
    $('filter').addEventListener('change', render);
    $('clear').addEventListener('click', async () => {
      if (!confirm(I18n.t('history_clear_confirm'))) return;
      await chrome.runtime.sendMessage({ type: MSG.CLEAR_HISTORY });
      items = [];
      render();
    });
    $('openArchive').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://archive/archive.html' });
    });
    $('openHome').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/home/home.html') });
    });
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  });
})();
