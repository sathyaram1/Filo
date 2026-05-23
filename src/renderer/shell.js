// Shell renderer: tab bar + barra indirizzi.
// Sottoscrive a `filoShell.tabs.onUpdate` per il rerender.

(() => {
  const api = window.filoShell;
  if (!api) {
    console.error('[Filo shell] filoShell non disponibile (preload non caricato?)');
    return;
  }

  const tabsEl = document.getElementById('tabs');
  const addrEl = document.getElementById('addr');
  const newBtn = document.getElementById('tab-new');
  const backBtn = document.getElementById('nav-back');
  const fwdBtn = document.getElementById('nav-forward');
  const reloadBtn = document.getElementById('nav-reload');
  const homeBtn = document.getElementById('nav-home');
  const settingsBtn = document.getElementById('nav-settings');
  const settingsMenu = document.getElementById('settings-menu');
  const appsBtn = document.getElementById('nav-apps');
  const appsMenu = document.getElementById('apps-menu');
  const shelfEl = document.getElementById('shell-shelf');
  const winMinBtn = document.getElementById('win-min');
  const winMaxBtn = document.getElementById('win-max');
  const winCloseBtn = document.getElementById('win-close');

  // Popola i bottoni del chrome con le SVG della libreria condivisa
  // (`src/shared/icons.js`) così la barra in alto ha la stessa famiglia
  // visiva del menu tasto destro.
  const ICONS = window.SN_ICONS || {};
  function setIcon(el, name, size) {
    if (!el || typeof ICONS[name] !== 'function') return;
    el.innerHTML = ICONS[name](size);
  }
  setIcon(backBtn, 'back', 18);
  setIcon(fwdBtn, 'forward', 18);
  setIcon(reloadBtn, 'reload', 18);
  setIcon(homeBtn, 'home', 18);
  setIcon(settingsBtn, 'options', 16);
  setIcon(appsBtn, 'apps', 16);
  setIcon(newBtn, 'plus', 16);

  // Registro app del launcher. Il Feedback vive qui fra le App.
  const APPS = [
    { label: 'Editor', icon: 'editor', url: 'filo://editor/editor.html' },
    { label: 'Feedback', icon: '', url: 'filo://feedback/feedback.html' },
  ];
  // Voci del menu Impostazioni (ingranaggio): Modelli e Preferenze, due pagine
  // interne dedicate.
  const SETTINGS = [
    { label: 'Modelli', icon: 'options', url: 'filo://options/options.html' },
    { label: 'Preferenze', icon: 'colorPicker', url: 'filo://preferences/preferences.html' },
  ];

  // Menu nativi: i dropdown HTML non possono apparire sopra una WebContentsView
  // nativa. Usiamo Menu.popup() di Electron via IPC, che renderizza un menu OS
  // sopra tutto senza toccare la view.
  function showNativeMenu(btn, entries) {
    const r = btn.getBoundingClientRect();
    api.popupMenu(entries, Math.round(r.left), Math.round(r.bottom + 4));
  }

  settingsBtn.addEventListener('click', () => showNativeMenu(settingsBtn, SETTINGS));
  appsBtn.addEventListener('click', () => showNativeMenu(appsBtn, APPS));
  setIcon(winMinBtn, 'minimize', 16);
  setIcon(winMaxBtn, 'maximize', 14);
  setIcon(winCloseBtn, 'close', 16);

  let state = { activeId: null, tabs: [] };

  function activeTab() {
    return state.tabs.find((t) => t.id === state.activeId) || null;
  }

  function render() {
    // tabs
    tabsEl.innerHTML = '';
    for (const t of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === state.activeId ? ' active' : '');
      el.dataset.id = t.id;
      el.title = t.title || t.url;

      const ico = document.createElement('div');
      if (t.loading) {
        ico.className = 'spinner';
      } else {
        ico.className = 'favicon';
        if (t.favicon) ico.style.backgroundImage = `url("${t.favicon}")`;
      }
      el.appendChild(ico);

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = t.title || displayUrl(t.url) || 'Nuova scheda';
      el.appendChild(title);

      const close = document.createElement('span');
      close.className = 'close';
      if (typeof ICONS.close === 'function') close.innerHTML = ICONS.close(12);
      else close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        api.tabs.close(t.id);
      });
      el.appendChild(close);

      el.addEventListener('click', () => api.tabs.activate(t.id));
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) api.tabs.close(t.id);
      });
      tabsEl.appendChild(el);
    }

    // address bar
    const a = activeTab();
    if (a && document.activeElement !== addrEl) {
      addrEl.value = displayUrl(a.url);
    }
    backBtn.disabled = !(a && a.canBack);
    fwdBtn.disabled = !(a && a.canFwd);
    reloadBtn.disabled = !a;
  }

  function displayUrl(url) {
    if (!url) return '';
    if (url.startsWith('filo://newtab/')) return '';
    return url;
  }

  newBtn.addEventListener('click', () => api.tabs.open('filo://newtab/'));
  backBtn.addEventListener('click', () => { const a = activeTab(); if (a) api.tabs.back(a.id); });
  fwdBtn.addEventListener('click', () => { const a = activeTab(); if (a) api.tabs.forward(a.id); });
  reloadBtn.addEventListener('click', () => { const a = activeTab(); if (a) api.tabs.reload(a.id); });
  homeBtn.addEventListener('click', () => { const a = activeTab(); if (a) api.tabs.navigate(a.id, 'filo://newtab/'); });

  if (api.window) {
    winMinBtn?.addEventListener('click', () => api.window.minimize());
    winMaxBtn?.addEventListener('click', () => api.window.toggleMaximize());
    winCloseBtn?.addEventListener('click', () => api.window.close());
  }

  addrEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const a = activeTab();
      if (a) api.tabs.navigate(a.id, addrEl.value);
    }
  });
  addrEl.addEventListener('focus', () => addrEl.select());

  // Scorciatoie globali a livello shell.
  window.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 't') {
      e.preventDefault();
      api.tabs.open('filo://newtab/');
    } else if (meta && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      const a = activeTab(); if (a) api.tabs.close(a.id);
    } else if (meta && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      addrEl.focus();
    } else if (meta && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      const a = activeTab(); if (a) api.tabs.reload(a.id);
    }
  });

  api.tabs.onUpdate((snap) => {
    state = snap;
    render();
  });
  api.tabs.snapshot().then((snap) => { state = snap; render(); });
})();
