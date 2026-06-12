// Shell renderer: tab bar + barra indirizzi.
// Sottoscrive a `filoShell.tabs.onUpdate` per il rerender.

(() => {
  const api = window.filoShell;
  if (!api) {
    console.error('[Filo shell] filoShell non disponibile (preload non caricato?)');
    return;
  }

  const tabsEl = document.getElementById('tabs');
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

  // Token estetici (#146.1): applica gli override dell'utente alle variabili
  // della shell (--accent, --fg, …) al boot e live a ogni cambio impostazioni
  // (stesso canale SETTINGS_UPDATED usato dalle pagine).
  const ThemeTokens = window.SN_THEME_TOKENS;
  function applyShellTokens(tokens) {
    if (ThemeTokens) ThemeTokens.applyToDocument(document, tokens || {}, { shell: true });
  }
  api.message({ type: 'get_settings' })
    .then((r) => applyShellTokens(r?.settings?.themeTokens))
    .catch(() => {});
  if (typeof api.onBroadcast === 'function') {
    api.onBroadcast((m) => {
      if (m?.type === 'settings_updated') applyShellTokens(m.settings?.themeTokens);
    });
  }

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
      { label: 'Altro', icon: 'options', url: 'filo://options/altro.html' },
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
    let x = Math.round(r.left);
    let y = Math.round(r.bottom + 4);
    // La barra in alto è nascosta e le icone reali hanno rect nullo: i menu
    // (Impostazioni, App, Account) si aprono sotto le icone, che ora vivono in
    // alto a destra DENTRO la home. La home parte sotto la fila di tab (~40px) e
    // le icone sono alte ~34px: ancoriamo appena sotto. Coordinate relative alla
    // finestra shell. popup-menu.js riallinea/clampa per restare nello schermo.
    if (r.width === 0 && r.height === 0) {
      x = Math.max(8, window.innerWidth - 250);
      y = 86;
    }
    api.popupMenu(entries, x, y);
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

  // Comandi shell pilotati dall'agente "Aiuto": l'AI aziona i comandi rapidi
  // della barra cliccando il bottone REALE (così riusa menu, navigazione e
  // toggle finestra senza duplicare logica). "close" è escluso di proposito:
  // non è mappato qui, quindi l'AI non può chiudere la finestra.
  if (api.onTriggerButton) {
    const triggerMap = {
      home: homeBtn,
      settings: settingsBtn,
      apps: appsBtn,
      account: accountBtn,
      minimize: winMinBtn,
      fullscreen: winMaxBtn,
    };
    api.onTriggerButton((command) => {
      const btn = triggerMap[command];
      if (btn) btn.click();
    });
  }

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

  // ── Menu contestuale (tasto destro) su una tab ────────────────────────────
  // Riusa il popup-menu nativo della shell (sopra le WebContentsView). Le voci
  // portano `action` custom prefissate `tab-`; la scelta torna via onMenuAction
  // e si applica alla tab su cui si era aperto il menu (ctxTabId).
  const MUTE_IND_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6"/><path d="M21 9l-4 6"/></svg>';

  // "Vetro smerigliato" della tab attiva (§1.1): dato il colore campionato dal
  // sito, scegli un testo leggibile per contrasto (luminanza relativa).
  function readableOn(rgbStr) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
    if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    return L > 0.45 ? '#1a1918' : '#f8f6f0';
  }

  // Un colore "ha identità" solo se ha croma sufficiente: bianco/nero/grigio
  // (es. l'header bianco di YouTube campionato per il vetro smerigliato §1.1)
  // non rappresentano il sito. Soglia allineata a SN_TAB_COLOR
  // (src/shared/tabColor.js) e al campionatore favicon in pageColor.js.
  function hasColorIdentity(rgbStr) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
    if (!m) return false;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return false;
    return Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) >= 24;
  }

  // Colore identità attenuato (§1.2): smorza la saturazione del colore del sito
  // a una frazione dell'originale (tinta "subliminale"). La luminosità non la
  // tocchiamo qui: la spostiamo verso il neutro del tab bar mescolandola con
  // --tab-bg via CSS color-mix (così resta giusta sia in tema chiaro che scuro).
  function attenuateIdentity(rgbStr) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
    if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    const r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    s *= 0.18; // saturazione ridotta al ~18% dell'originale (spec: 15-20%)
    const hue2rgb = (pp, qq, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return pp + (qq - pp) * 6 * t;
      if (t < 1 / 2) return qq;
      if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6;
      return pp;
    };
    let nr, ng, nb;
    if (s === 0) {
      nr = ng = nb = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const pq = 2 * l - q;
      nr = hue2rgb(pq, q, h + 1 / 3);
      ng = hue2rgb(pq, q, h);
      nb = hue2rgb(pq, q, h - 1 / 3);
    }
    return `rgb(${Math.round(nr * 255)}, ${Math.round(ng * 255)}, ${Math.round(nb * 255)})`;
  }

  let ctxTabId = null;
  function openTabContextMenu(t, x, y) {
    ctxTabId = t.id;
    const entries = [
      { label: 'Duplica', icon: 'duplicate', action: 'tab-duplicate' },
      t.muted
        ? { label: 'Riattiva audio', icon: 'mute', action: 'tab-mute' }
        : { label: 'Muta', icon: 'sound', action: 'tab-mute' },
      { label: 'Aiuto', icon: 'help', action: 'tab-help' },
      { type: 'separator' },
      { label: 'Chiudi', icon: 'close', action: 'tab-close' },
    ];
    api.popupMenu(entries, Math.round(x), Math.round(y));
  }

  // Le azioni del menu tornano qui (canale globale onMenuAction): filtriamo solo
  // quelle `tab-…` e le applichiamo alla tab memorizzata in ctxTabId.
  if (api.onMenuAction) {
    api.onMenuAction((action) => {
      const id = ctxTabId;
      if (!id) return;
      if (action === 'tab-duplicate') api.tabs.duplicate(id);
      else if (action === 'tab-mute') api.tabs.setMuted(id);
      else if (action === 'tab-help') api.tabs.help(id);
      else if (action === 'tab-close') api.tabs.close(id);
    });
  }

  function render() {
    // tabs
    tabsEl.innerHTML = '';
    for (const t of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === state.activeId ? ' active' : '');
      el.dataset.id = t.id;
      el.dataset.tip = t.title || t.url;

      // Tab attiva: tingila col colore live del sito (§1.1). Sovrascriviamo la
      // variabile --tab-active così anche i "piedini" a goccia (::before/::after)
      // assumono lo stesso colore. Il testo passa a chiaro/scuro per contrasto.
      // Se il colore campionato dalla cima pagina è neutro (header bianco/grigio:
      // es. YouTube) non porta identità → ripieghiamo sul colore identità del
      // sito (theme-color/favicon), così la tab attiva mostra il brand e non il
      // bianco. Se manca anche quello, si resta sul colore campionato.
      if (t.id === state.activeId) {
        const activeColor = hasColorIdentity(t.color) ? t.color : (t.identityColor || t.color);
        if (activeColor) {
          const fg = readableOn(activeColor);
          el.style.setProperty('--tab-active', activeColor);
          if (fg) el.style.color = fg;
        }
      }

      // Tab INATTIVE: tinta identità attenuata del sito (§1.2). Smorziamo la
      // saturazione e poi mescoliamo col neutro del tab bar via CSS, così la
      // tinta è appena percepibile ma riconoscibile a livello subliminale.
      // Usiamo la variabile --tab-bg-eff (non `background` diretto) per non
      // rompere il feedback di hover, che è definito in CSS sulla stessa var.
      if (t.id !== state.activeId && t.identityColor) {
        const tint = attenuateIdentity(t.identityColor);
        if (tint) {
          el.style.setProperty(
            '--tab-bg-eff',
            `color-mix(in srgb, ${tint} 38%, var(--tab-bg))`,
          );
        }
      }

      const ico = document.createElement('div');
      if (t.loading) {
        ico.className = 'spinner';
      } else {
        ico.className = 'favicon';
        if (t.favicon) ico.style.backgroundImage = `url("${t.favicon}")`;
      }
      el.appendChild(ico);

      // Indicatore "audio mutato": un altoparlante barrato accanto al titolo,
      // così l'utente sa quali tab ha silenziato senza doverci passare sopra.
      if (t.muted) {
        const m = document.createElement('span');
        m.className = 'mute-ind';
        m.setAttribute('aria-label', 'Audio mutato');
        m.innerHTML = MUTE_IND_SVG;
        el.appendChild(m);
      }

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = tabLabel(t);
      el.appendChild(title);

      // Tasto destro su una tab → menu contestuale (Duplica / Muta / Chiudi).
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openTabContextMenu(t, e.clientX, e.clientY);
      });

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

    // §6 — con la striscia scrollabile, assicuriamoci che la scheda attiva sia
    // sempre visibile (può finire fuori vista dopo che ne apri molte).
    const activeEl = tabsEl.querySelector('.tab.active');
    if (activeEl) {
      try { activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (_) {}
    }

    // Barra di navigazione (icone). Il campo URL è stato rimosso: l'indirizzo
    // si digita dalla home di Filo. Qui aggiorniamo solo lo stato dei tasti.
    const a = activeTab();
    backBtn.disabled = !(a && a.canBack);
    fwdBtn.disabled = !(a && a.canFwd);
    reloadBtn.disabled = !a;

    // Chrome compatto: la barra indirizzi (icone + URL) si vede SOLO sulla home
    // di Filo. Sui siti resta solo la fila di tab + i controlli finestra.
    applyChrome(isHomeUrl(a ? a.url : null));
  }

  function displayUrl(url) {
    if (!url) return '';
    if (url.startsWith('filo://newtab/')) return '';
    return url;
  }

  // Etichette pulite per le schede delle pagine interne di Filo: niente prefisso
  // "Filo —", e il nome è quello del tasto che apre la pagina (es. "Modelli" per
  // le Opzioni). La newtab è "Home". Le pagine web esterne tengono il loro title.
  const FILO_TAB_LABELS = {
    'newtab': 'Home',
    'options/options.html': 'Modelli',
    'options/altro.html': 'Altro',
    'security/security.html': 'Sicurezza',
    'preferences/preferences.html': 'Preferenze',
    'admin-defaults/admin-defaults.html': 'Modelli predefiniti',
    'editor/editor.html': 'Editor',
    'feedback/feedback.html': 'Feedback',
    'history/history.html': 'Cronologia',
    'archive/archive.html': 'Tab archiviate',
    'home/home.html': 'Aperti per dopo',
    'spellcheck/spellcheck.html': 'Correttore',
  };

  // Toglie un eventuale prefisso "Filo — " / "Filo -" da un titolo di pagina.
  function stripFiloPrefix(title) {
    return String(title || '').replace(/^\s*Filo\s*[—–-]\s*/i, '').trim();
  }

  // Nome da mostrare sulla scheda. Le pagine filo:// interne usano l'etichetta
  // pulita; tutto il resto usa il title della pagina (o l'URL come ripiego).
  function tabLabel(t) {
    const url = t.url || '';
    if (url.startsWith('filo://')) {
      // Chiave = host + path, senza lo slash iniziale del path. La newtab è
      // "filo://newtab/" → chiave "newtab".
      const rest = url.slice('filo://'.length);
      const noQuery = rest.split(/[?#]/)[0];
      const key = noQuery.replace(/\/+$/, '');
      if (FILO_TAB_LABELS[key]) return FILO_TAB_LABELS[key];
      const host = key.split('/')[0];
      if (FILO_TAB_LABELS[host]) return FILO_TAB_LABELS[host];
      // Pagina interna non mappata: almeno togli il prefisso "Filo —".
      const clean = stripFiloPrefix(t.title);
      if (clean) return clean;
    }
    return t.title || displayUrl(t.url) || 'Nuova scheda';
  }

  // La "home" di Filo è la newtab (mappata sulla dashboard). Senza tab attiva
  // trattiamo lo stato come home così la barra resta accessibile.
  function isHomeUrl(url) {
    return !url || url.startsWith('filo://newtab/');
  }

  // La barra indirizzi è sempre nascosta: le icone di navigazione (indietro,
  // avanti, ricarica) vivono nel menu tasto destro, mentre home/impostazioni/
  // app/profilo sono state spostate DENTRO la pagina home (in alto a destra).
  // Resta solo la fila di tab, e la WebContentsView risale a coprire lo spazio
  // liberato. Manteniamo applyChrome (chiamata dal render) per idempotenza.
  let chromeCompact = null;
  function applyChrome(_isHome) {
    const compact = true;
    if (compact === chromeCompact) return;
    chromeCompact = compact;
    document.documentElement.dataset.chromeCompact = '1';
    try { api.tabs.setChromeCompact?.(compact); } catch (_) {}
  }

  // §6 — la rotellina verticale del mouse scrolla la striscia delle tab in
  // orizzontale (la tab bar non ha scroll verticale). Solo quando c'è davvero
  // overflow, così non intercettiamo gesti inutili.
  tabsEl.addEventListener('wheel', (e) => {
    if (tabsEl.scrollWidth <= tabsEl.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!delta) return;
    tabsEl.scrollLeft += delta;
    e.preventDefault();
  }, { passive: false });

  // §2.3 — toast informativo (niente pulsante annulla, per scelta di design:
  // l'annulla esiste via linguaggio naturale, "riapri le tab di X").
  let toastTimer = null;
  function showToast(text) {
    if (!text) return;
    let el = document.getElementById('shell-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'shell-toast';
      el.className = 'shell-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
  }
  if (api.onToast) api.onToast((info) => showToast(info && info.text));

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
      // L'indirizzo si digita dalla home: Ctrl+L apre la home di Filo.
      e.preventDefault();
      const a = activeTab();
      if (a) api.tabs.navigate(a.id, 'filo://newtab/');
      else api.tabs.open('filo://newtab/');
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

    // ── Disegno annotazione sulla barra in alto ──────────────────────────
    // Permette di disegnare a mano libera su tab+barra indirizzi (la parte di
    // Filo non coperta dalla WebContentsView), così l'annotazione copre TUTTA
    // l'app. I tratti sono identici a quelli della pagina (rosso, spessore 3).
    const drawCanvas = document.getElementById('feedback-draw');
    const STROKE_COLOR = '#ff3b30';
    const STROKE_WIDTH = 3;
    const strokes = [];
    let dctx = null;
    let drawingNow = false;
    let curStroke = null;

    function barHeight() {
      const header = document.querySelector('header.shell');
      return header ? Math.max(1, Math.round(header.getBoundingClientRect().height)) : 1;
    }
    function sizeDrawCanvas() {
      if (!drawCanvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = barHeight();
      drawCanvas.width = Math.max(1, Math.round(w * dpr));
      drawCanvas.height = Math.max(1, Math.round(h * dpr));
      drawCanvas.style.width = w + 'px';
      drawCanvas.style.height = h + 'px';
      dctx = drawCanvas.getContext('2d');
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawDraw();
    }
    function redrawDraw() {
      if (!dctx) return;
      dctx.save();
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      dctx.restore();
      const dpr = window.devicePixelRatio || 1;
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dctx.lineCap = 'round';
      dctx.lineJoin = 'round';
      for (const s of strokes) {
        if (!s.points.length) continue;
        dctx.strokeStyle = s.color;
        dctx.lineWidth = s.width;
        dctx.beginPath();
        s.points.forEach((p, i) => (i ? dctx.lineTo(p.x, p.y) : dctx.moveTo(p.x, p.y)));
        if (s.points.length === 1) dctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1);
        dctx.stroke();
      }
    }
    function hasDraw() { return strokes.some((s) => s.points.length > 0); }
    function reportState() { try { api.feedbackDrawState?.(hasDraw()); } catch (_) {} }
    function clearDraw() { strokes.length = 0; redrawDraw(); }

    if (drawCanvas) {
      drawCanvas.addEventListener('pointerdown', (e) => {
        drawingNow = true;
        curStroke = { color: STROKE_COLOR, width: STROKE_WIDTH, points: [{ x: e.clientX, y: e.clientY }] };
        strokes.push(curStroke);
        try { drawCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });
      drawCanvas.addEventListener('pointermove', (e) => {
        if (!drawingNow || !curStroke) return;
        curStroke.points.push({ x: e.clientX, y: e.clientY });
        redrawDraw();
      });
      const endStroke = () => {
        if (!drawingNow) return;
        drawingNow = false;
        curStroke = null;
        reportState();
      };
      drawCanvas.addEventListener('pointerup', endStroke);
      drawCanvas.addEventListener('pointercancel', endStroke);
      window.addEventListener('resize', () => { if (!drawCanvas.hidden) sizeDrawCanvas(); });
      // Il box (pagina) ha premuto "Cancella disegno": ripuliamo anche la barra.
      api.onFeedbackClearDraw?.(() => { clearDraw(); reportState(); });
    }

    function setDim(on) {
      if (on) {
        document.documentElement.dataset.feedbackDim = '1';
        dimTabId = state?.activeId ?? null;
        if (drawCanvas) {
          clearDraw();
          drawCanvas.hidden = false;
          sizeDrawCanvas();
          reportState();
        }
      } else {
        delete document.documentElement.dataset.feedbackDim;
        dimTabId = null;
        if (drawCanvas) {
          clearDraw();
          drawCanvas.hidden = true;
          reportState();
        }
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
