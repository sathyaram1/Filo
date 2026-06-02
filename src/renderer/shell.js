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
  const appsBtn = document.getElementById('nav-apps');
  const accountBtn = document.getElementById('nav-account');
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
  setIcon(accountBtn, 'user', 16);
  setIcon(newBtn, 'plus', 16);

  // ── Modalità incognito ────────────────────────────────────────────────────
  // La finestra incognito carica shell.html?incognito=1. Applichiamo un tema
  // scuro dedicato (via data-incognito sul <html>, vedi shell.css) e mostriamo
  // un badge "Incognito" nella barra così la finestra è inconfondibile.
  const isIncognito = new URLSearchParams(location.search).get('incognito') === '1';
  if (isIncognito) {
    document.documentElement.dataset.incognito = '1';
    const badge = document.getElementById('incognito-badge');
    if (badge) {
      const ico = typeof ICONS.incognito === 'function' ? ICONS.incognito(16) : '';
      badge.innerHTML = ico + '<span class="incognito-label">Incognito</span>';
      badge.hidden = false;
    }
  }

  // Registro app del launcher. Il Feedback vive qui fra le App.
  const APPS = [
    { label: 'Editor', icon: 'editor', url: 'filo://editor/editor.html' },
    { type: 'separator' },
    { label: 'Feedback', icon: 'feedback', url: 'filo://feedback/feedback.html' },
  ];
  // Voci del menu Impostazioni (ingranaggio): Modelli, Sicurezza, Preferenze —
  // tre pagine interne dedicate. La voce "Modelli predefiniti" appare SOLO agli
  // admin (gli utenti comuni non la vedono affatto). `buildSettings()` ricostruisce
  // la lista ad ogni apertura del menu, così riflette lo stato auth corrente.
  function buildSettings() {
    const entries = [
      { label: 'Modelli', icon: 'models', url: 'filo://options/options.html' },
      { label: 'Sicurezza', icon: 'lock', url: 'filo://security/security.html' },
      { type: 'separator' },
      { label: 'Preferenze', icon: 'colorPicker', url: 'filo://preferences/preferences.html' },
    ];
    if (isAdmin) {
      entries.push({ type: 'separator' });
      entries.push({ label: 'Modelli predefiniti', icon: 'models', url: 'filo://admin-defaults/admin-defaults.html' });
    }
    return entries;
  }

  // Popup menu custom: BrowserWindow frameless che appare sopra le
  // WebContentsView native, stilizzato come il menu tasto destro.
  function showNativeMenu(btn, entries) {
    const r = btn.getBoundingClientRect();
    api.popupMenu(entries, Math.round(r.left), Math.round(r.bottom + 4));
  }

  settingsBtn.addEventListener('click', () => showNativeMenu(settingsBtn, buildSettings()));
  appsBtn.addEventListener('click', () => showNativeMenu(appsBtn, APPS));

  // "Nuova finestra incognito" vive ora nel menu dell'account (icona profilo),
  // non più nel menu Impostazioni → apre la finestra incognito nel main.
  // Registrazione separata così funziona anche se il bottone account non è
  // presente. L'altro ingresso resta l'icona nel menu del tasto destro.
  if (api.onMenuAction) {
    api.onMenuAction((action) => {
      if (action === 'open-incognito' && api.openIncognito) api.openIncognito();
    });
  }

  // ── Account "Accedi con Google" ───────────────────────────────────────────
  // Lo stato vive nel main; qui mostriamo solo il profilo pubblico. Quando
  // loggato, l'icona diventa l'avatar (foto Google) e il click apre un menu
  // con "Esci"; quando non loggato, il click avvia il login.
  let authProfile = null;
  let authBusy = false;
  // Gate UX della voce admin "Modelli predefiniti". La garanzia forte resta nel
  // main (handler DEFAULTS_*) e nelle regole Firestore: qui decidiamo solo se
  // mostrare la voce di menu.
  let isAdmin = false;

  function shortName(p) {
    if (!p) return '';
    return p.name || (p.email || '').split('@')[0] || 'Account';
  }

  function renderAccount() {
    if (!accountBtn) return;
    if (authBusy) {
      accountBtn.dataset.tip = 'Accesso in corso…';
      accountBtn.setAttribute('aria-label', 'Accesso in corso');
      return;
    }
    if (authProfile) {
      const label = shortName(authProfile);
      accountBtn.dataset.tip = authProfile.email ? `${label} — ${authProfile.email}` : label;
      accountBtn.setAttribute('aria-label', `Account: ${label}`);
      accountBtn.classList.add('signed-in');
      if (authProfile.picture) {
        // Costruisco l'<img> via DOM così posso ripiegare sull'icona utente
        // se la foto Google non si carica (CSP/rete).
        const img = document.createElement('img');
        img.className = 'account-avatar';
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => setIcon(accountBtn, 'user', 16);
        img.src = authProfile.picture;
        accountBtn.replaceChildren(img);
      } else {
        setIcon(accountBtn, 'user', 16);
      }
    } else {
      accountBtn.dataset.tip = 'Accedi';
      accountBtn.setAttribute('aria-label', 'Accedi');
      accountBtn.classList.remove('signed-in');
      setIcon(accountBtn, 'user', 16);
    }
  }

  async function refreshAuth() {
    try {
      const r = await api.auth.status();
      authProfile = (r && r.ok && r.signedIn) ? r.profile : null;
      isAdmin = !!(r && r.ok && r.signedIn && r.isAdmin);
    } catch (_) {
      authProfile = null;
      isAdmin = false;
    }
    renderAccount();
  }

  async function doSignIn() {
    if (authBusy) return;
    authBusy = true; renderAccount();
    try {
      const r = await api.auth.signIn();
      if (r && r.ok) { authProfile = r.profile; isAdmin = !!r.isAdmin; }
      else if (r && r.error) alert('Accesso non riuscito: ' + r.error);
    } catch (e) {
      alert('Accesso non riuscito: ' + (e?.message || e));
    } finally {
      authBusy = false; renderAccount();
    }
  }

  async function doSignOut() {
    try { await api.auth.signOut(); } catch (_) {}
    authProfile = null; isAdmin = false; renderAccount();
  }

  if (accountBtn) {
    // Il menu dell'account apre SEMPRE (loggato o no) così la voce "Nuova
    // finestra incognito" — spostata qui dal menu Impostazioni — è raggiungibile
    // in entrambi gli stati. Da loggato mostra email + incognito + Esci; da
    // sloggato mostra "Accedi con Google" + incognito.
    accountBtn.addEventListener('click', () => {
      if (authBusy) return;
      if (authProfile) {
        const label = shortName(authProfile);
        showNativeMenu(accountBtn, [
          { label: authProfile.email || label, disabled: true },
          { type: 'separator' },
          { label: 'Nuova finestra incognito', icon: 'incognito', action: 'open-incognito' },
          { label: 'Esci', icon: 'close', action: 'auth-signout' },
        ]);
      } else {
        showNativeMenu(accountBtn, [
          { label: 'Accedi con Google', icon: 'user', action: 'auth-signin' },
          { type: 'separator' },
          { label: 'Nuova finestra incognito', icon: 'incognito', action: 'open-incognito' },
        ]);
      }
    });
    // Il menu account usa azioni custom invece di url: ascolta la scelta.
    if (api.onMenuAction) {
      api.onMenuAction((action) => {
        if (action === 'auth-signout') doSignOut();
        else if (action === 'auth-signin') doSignIn();
      });
    }
    // Aggiorna l'icona quando il main segnala un cambio sessione.
    if (api.auth && api.auth.onChanged) {
      api.auth.onChanged((m) => { authProfile = m.profile || null; isAdmin = !!(m && m.isAdmin); renderAccount(); });
    }
    refreshAuth();
  }
  setIcon(winMinBtn, 'minimize', 16);
  setIcon(winMaxBtn, 'maximize', 14);
  setIcon(winCloseBtn, 'close', 16);

  // Tooltip custom: legge `data-tip` su qualunque elemento della shell e chiede
  // al main di mostrare un mini-BrowserWindow stile Filo (vedi popup-tooltip.js),
  // invece del title nativo bianco squadrato. Serve una BrowserWindow secondaria
  // perché la shell è alta solo 88px e gli elementi DOM non possono apparire
  // sopra le WebContentsView delle tab. Delega globale così funziona anche per i
  // tab ricreati ad ogni render().
  (() => {
    let showTimer = null;
    let currentTarget = null;
    const SHOW_DELAY = 350;

    function hide() {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      if (currentTarget) api.tooltipHide();
      currentTarget = null;
    }
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t || t === currentTarget) return;
      hide();
      currentTarget = t;
      const text = t.dataset.tip;
      if (!text) return;
      showTimer = setTimeout(() => {
        const r = t.getBoundingClientRect();
        // Punto di ancoraggio: sotto il bottone, centrato. Il main rifinisce la
        // posizione una volta misurato il testo (e potrà flipparlo se necessario).
        const x = Math.round(r.left + r.width / 2 - 60);
        const y = Math.round(r.bottom + 6);
        api.tooltipShow(text, x, y);
      }, SHOW_DELAY);
    });
    document.addEventListener('mouseout', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      if (t === currentTarget && (!e.relatedTarget || !t.contains(e.relatedTarget))) hide();
    });
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('blur', hide);
  })();

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
      el.dataset.tip = t.title || t.url;

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

  // ─── Velo d'ombra "modalità annotazione" feedback ──────────────────────────
  // Il box feedback vive in un content script sulla pagina e da lì oscura solo
  // l'area pagina. Quando si apre, il main ci avvisa via `shell:feedback-dim`
  // così copriamo ANCHE la barra in alto di Filo con lo stesso velo: tutta la
  // app entra in penombra, segnalando che si è in modalità annotazione. Il velo
  // intercetta i click (cursore a mirino) per evitare interazioni accidentali
  // con tab/indirizzo mentre si sta dando un feedback.
  if (api.onFeedbackDim) {
    let dimTabId = null;
    function setDim(on) {
      if (on) {
        document.documentElement.dataset.feedbackDim = '1';
        dimTabId = state?.activeId ?? null;
      } else {
        delete document.documentElement.dataset.feedbackDim;
        dimTabId = null;
      }
    }
    api.onFeedbackDim(setDim);
    // Rete di sicurezza: se l'utente cambia tab mentre il box è aperto, il
    // content script di quella pagina non riceve più eventi e non potrà
    // togliere la penombra → la togliamo qui appena la tab attiva cambia.
    api.tabs.onUpdate((snap) => {
      if (document.documentElement.dataset.feedbackDim && snap && snap.activeId !== dimTabId) {
        setDim(false);
      }
    });
  }

  // ─── Chip "popup bloccato" ─────────────────────────────────────────────
  // Quando il main blocca un window.open() non richiesto invia
  // 'tabs:popup-blocked' con { tabId, url, host }. Mostriamo una chip ancorata
  // sotto la barra indirizzi: "Bloccato popup da <host>  [Apri] [×]".
  // - Click "Apri": apre il popup come nuovo tab (bypass blocco).
  // - Click "×" o auto-dismiss dopo 8s: chip svanisce.
  // Riusiamo `reserveTop` (lo stesso meccanismo che già si usa per i menu
  // dropdown) per evitare che la chip finisca sopra l'area WebContentsView
  // di un'altra tab: la posizioniamo dentro la shell (DOM HTML), quindi non
  // serve riservare spazio extra — è già sopra l'area pagina.
  if (api.tabs.onPopupBlocked) {
    const chipHost = document.createElement('div');
    chipHost.id = 'popup-chips';
    chipHost.style.position = 'fixed';
    chipHost.style.top = '52px';
    chipHost.style.right = '12px';
    chipHost.style.zIndex = '1000';
    chipHost.style.display = 'flex';
    chipHost.style.flexDirection = 'column';
    chipHost.style.gap = '6px';
    chipHost.style.pointerEvents = 'auto';
    document.body.appendChild(chipHost);

    api.tabs.onPopupBlocked((info) => {
      if (!info) return;
      const { url, host } = info;
      const chip = document.createElement('div');
      chip.className = 'popup-chip';
      chip.style.background = 'var(--sn-surface, #fff)';
      chip.style.color = 'var(--sn-text, #222)';
      chip.style.border = '1px solid var(--sn-border, #d0d0d0)';
      chip.style.borderRadius = '999px';
      chip.style.padding = '6px 10px';
      chip.style.font = '12px system-ui, sans-serif';
      chip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      chip.style.display = 'inline-flex';
      chip.style.alignItems = 'center';
      chip.style.gap = '8px';
      chip.style.maxWidth = '360px';

      const label = document.createElement('span');
      label.textContent = `Bloccato popup da ${host || '?'}`;
      label.style.whiteSpace = 'nowrap';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      chip.appendChild(label);

      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Apri';
      open.style.cursor = 'pointer';
      open.style.background = 'transparent';
      open.style.border = '1px solid currentColor';
      open.style.borderRadius = '999px';
      open.style.padding = '2px 8px';
      open.style.font = 'inherit';
      open.style.color = 'inherit';
      open.addEventListener('click', () => {
        try { api.tabs.openBlockedPopup(url); } catch (_) {}
        dismiss();
      });
      chip.appendChild(open);

      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Chiudi');
      x.style.cursor = 'pointer';
      x.style.background = 'transparent';
      x.style.border = 'none';
      x.style.font = '16px system-ui';
      x.style.lineHeight = '1';
      x.style.padding = '0 4px';
      x.style.color = 'inherit';
      x.addEventListener('click', () => dismiss());
      chip.appendChild(x);

      chipHost.appendChild(chip);
      let timer = setTimeout(dismiss, 8000);
      function dismiss() {
        if (timer) { clearTimeout(timer); timer = null; }
        try { chip.remove(); } catch (_) {}
      }
    });
  }
})();
