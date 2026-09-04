// Shell renderer: tab bar + barra indirizzi.
// Sottoscrive a `filoShell.tabs.onUpdate` per il rerender.

(() => {
  const api = window.filoShell;
  if (!api) {
    console.error('[Filo shell] filoShell non disponibile (preload non caricato?)');
    return;
  }

  // Come si chiamano i tasti sul sistema di chi guarda: su Mac la scheda nuova
  // si apre con Cmd+T, e il suggerimento deve dire quello. L'HTML è uno solo
  // per tutti i sistemi, quindi la scritta si compone qui.
  const TASTI = window.SN_TASTI;
  const tasto = (accel) => (TASTI ? TASTI.etichetta(accel) : accel);

  const tabsEl = document.getElementById('tabs');
  const newBtn = document.getElementById('tab-new');
  if (newBtn) newBtn.dataset.tip = `Nuova scheda (${tasto('Ctrl+T')})`;
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
  // Opacità del colore identità sulle tab inattive (param `opacita_tab` della
  // spec "Colore identità delle tab"): governa quanto la tinta del sito copre lo
  // sfondo del tab bar nel color-mix più sotto. 0 = nessun colore, 1 = tinta
  // piena. Letta dalle impostazioni e aggiornata live al cambio prefs.
  let tabOpacity = 0.6;
  function applyTabColorParams(tabColor) {
    const v = tabColor && Number(tabColor.opacita_tab);
    if (Number.isFinite(v)) tabOpacity = Math.max(0, Math.min(1, v));
  }
  // Config notifiche (spec #170.1): durata, suono on/off, suono scelto. Letta
  // dalle impostazioni al boot e aggiornata live a ogni cambio prefs, così le
  // notifiche successive rispettano i nuovi valori senza riavviare.
  let notifConfig = { durationSec: 5, soundEnabled: false, sound: 'default' };
  function applyNotifConfig(notifications) {
    if (!notifications || typeof notifications !== 'object') return;
    const d = Number(notifications.durationSec);
    notifConfig = {
      durationSec: Number.isFinite(d) && d >= 0 ? d : 5,
      soundEnabled: notifications.soundEnabled === true,
      sound: typeof notifications.sound === 'string' ? notifications.sound : 'default',
    };
  }
  api.message({ type: 'get_settings' })
    .then((r) => {
      applyShellTokens(r?.settings?.themeTokens);
      applyTabColorParams(r?.settings?.tabColor);
      applyNotifConfig(r?.settings?.notifications);
      try { render(); } catch (_) {}
    })
    .catch(() => {});
  if (typeof api.onBroadcast === 'function') {
    api.onBroadcast((m) => {
      if (m?.type === 'settings_updated') {
        applyShellTokens(m.settings?.themeTokens);
        applyTabColorParams(m.settings?.tabColor);
        applyNotifConfig(m.settings?.notifications);
        try { render(); } catch (_) {}
      }
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
  //
  // "Aperti per dopo" sta qui perché è la CONTROPARTE di "Salva per dopo": il
  // salvataggio chiude la scheda, quindi senza un ingresso sempre visibile la
  // lista di ciò che hai messo da parte resta irraggiungibile (l'icona dedicata
  // del menu del tasto destro è stata ritirata e l'icona Home porta alla nuova
  // scheda, non lì). È l'analogo di "Scaricamenti": una lista di cose messe da
  // parte, non un'azione.
  const APPS = [
    { label: 'Editor', icon: 'editor', url: 'filo://editor/editor.html' },
    { label: 'Deck builder MTG', icon: 'decks', url: 'filo://decks/decks.html' },
    { label: 'Aperti per dopo', icon: 'saveForLater', url: 'filo://home/home.html' },
    { label: 'Scaricamenti', icon: 'download', url: 'filo://downloads/downloads.html' },
    { type: 'separator' },
    { label: 'Feedback', icon: 'feedback', url: 'filo://feedback/feedback.html' },
    { label: 'Bacheca', icon: 'board', url: 'filo://board/board.html' },
    { label: 'Gestione', icon: 'feedback', url: 'filo://manage/manage.html' },
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
      // Sta con "Modelli" e "Sicurezza" perché risponde alle stesse domande —
      // quali modelli, che fine fanno i dati — ma dal lato del PERCHÉ.
      { label: 'Trasparenza', icon: 'transparency', url: 'filo://transparency/transparency.html' },
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
          { label: 'Crediti', icon: 'credits', url: 'filo://credits/credits.html' },
          { label: 'Nuova finestra incognito', icon: 'incognito', action: 'open-incognito' },
          { label: 'Esci', icon: 'close', action: 'auth-signout' },
        ]);
      } else {
        showNativeMenu(accountBtn, [
          { label: 'Accedi con Google', icon: 'user', action: 'auth-signin' },
          { type: 'separator' },
          { label: 'Crediti', icon: 'credits', url: 'filo://credits/credits.html' },
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

  // ── Drag & drop per riordinare le tab ─────────────────────────────────────
  // Implementazione a pointer (mousedown/mousemove/mouseup) invece di HTML5
  // draggable: il drag nativo è inaffidabile in Electron sopra le
  // WebContentsView ed è praticamente non testabile da Playwright. Con i mouse
  // event il riordino è deterministico e si lascia esercitare dai test.
  // `drag` resta non-null per tutta la trascinata; `moved` diventa true solo
  // oltre la soglia, così un semplice click non viene scambiato per drag.
  let drag = null; // { id, el, startX, moved }
  let suppressClickId = null; // id della tab il cui prossimo click va ignorato

  // Elemento .tab (escluso quello trascinato) dopo cui inserire, in base alla X.
  function tabDragAfter(x) {
    const els = [...tabsEl.querySelectorAll('.tab:not(.dragging)')];
    let best = null;
    let bestOffset = -Infinity;
    for (const child of els) {
      const box = child.getBoundingClientRect();
      const offset = x - (box.left + box.width / 2);
      if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = child; }
    }
    return best;
  }

  function onTabPointerMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < 4) return;
    drag.moved = true;
    // Difesa in profondità: se per qualsiasi motivo il nodo trascinato non è più
    // attaccato al DOM (un ridisegno l'ha rigenerato), NON reinserire l'orfano —
    // creerebbe un duplicato con lo stesso id. Riaggancia il nodo vivo per questo
    // id prima di manipolarlo. Con la sospensione del render in drag questo non
    // dovrebbe mai scattare, ma tiene l'invariante "mai due .tab con lo stesso id"
    // vera comunque cambi la logica di render.
    if (!drag.el.isConnected) {
      const live = tabsEl.querySelector(`.tab[data-id="${drag.id}"]`);
      if (live) drag.el = live;
    }
    drag.el.classList.add('dragging');
    const after = tabDragAfter(e.clientX);
    if (after == null) tabsEl.appendChild(drag.el);
    else if (after !== drag.el.nextSibling) tabsEl.insertBefore(drag.el, after);
  }

  function onTabPointerUp() {
    window.removeEventListener('mousemove', onTabPointerMove);
    window.removeEventListener('mouseup', onTabPointerUp);
    const d = drag;
    drag = null;
    if (!d) return;
    d.el.classList.remove('dragging');
    if (!d.moved) return;
    // Il click che segue il mouseup non deve riattivare/spostare la tab.
    suppressClickId = d.id;
    // La posizione di rilascio è quella del NODO effettivamente trascinato, non
    // la prima occorrenza dell'id: usare l'identità del nodo (indexOf(d.el)) è
    // robusto anche se in barra esistesse un secondo .tab con lo stesso id, dove
    // indexOf(id) prenderebbe la posizione sbagliata. Se il nodo non è in barra
    // (non dovrebbe capitare), ripiego sull'id.
    const nodes = [...tabsEl.querySelectorAll('.tab')];
    let toIndex = nodes.indexOf(d.el);
    if (toIndex < 0) toIndex = nodes.map((x) => x.dataset.id).indexOf(d.id);
    if (toIndex >= 0) api.tabs.move(d.id, toIndex);
  }

  function startTabDrag(e, t, el) {
    if (e.button !== 0) return;
    // Non iniziare un drag dai controlli interni (chiudi, indicatori audio…).
    if (e.target.closest('.close, .mute-ind, .audio-ind, .proxy-ind')) return;
    drag = { id: t.id, el, startX: e.clientX, moved: false };
    window.addEventListener('mousemove', onTabPointerMove);
    window.addEventListener('mouseup', onTabPointerUp);
  }

  // ── Menu contestuale (tasto destro) su una tab ────────────────────────────
  // Riusa il popup-menu nativo della shell (sopra le WebContentsView). Le voci
  // portano `action` custom prefissate `tab-`; la scelta torna via onMenuAction
  // e si applica alla tab su cui si era aperto il menu (ctxTabId).
  const MUTE_IND_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6"/><path d="M21 9l-4 6"/></svg>';

  // Indicatore "audio in riproduzione": altoparlante con onde, così si
  // riconoscono a colpo d'occhio le tab che stanno suonando — anche quelle in
  // background. Cliccabile per silenziare al volo (parità col menu "Muta").
  const AUDIO_IND_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>' +
    '<path d="M18.5 6a9 9 0 0 1 0 12"/></svg>';

  // Indicatore "aperta da un altro paese": globo + codice paese, discreto e
  // caldo (accento Filo, niente lucchetti da security tool).
  const PROXY_IND_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
    '<path d="M12 3a13.5 13.5 0 0 1 0 18"/><path d="M12 3a13.5 13.5 0 0 0 0 18"/></svg>';

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
  let ctxMenuPos = { x: 0, y: 0 };
  // Stato proxy per il menu (lazy, richiesto a ogni apertura: la config può
  // cambiare dalle impostazioni mentre l'app è aperta).
  let ctxProxyStatus = null;
  async function openTabContextMenu(t, x, y) {
    ctxTabId = t.id;
    ctxMenuPos = { x: Math.round(x), y: Math.round(y) };
    const entries = [
      { label: 'Duplica', icon: 'duplicate', action: 'tab-duplicate' },
      t.muted
        ? { label: 'Riattiva audio', icon: 'mute', action: 'tab-mute' }
        : { label: 'Muta', icon: 'sound', action: 'tab-mute' },
      { label: 'Aiuto', icon: 'help', action: 'tab-help' },
    ];
    // "Apri da un altro paese" (proxy per-tab): solo se un endpoint è
    // configurato — una voce che non può funzionare non deve comparire.
    // Il click diretto usa il default (ultima location usata, altrimenti USA);
    // la freccia apre la lista paesi. Su tab già proxata: "Torna in Italia".
    try { ctxProxyStatus = await api.tabs.proxyStatus(); } catch (_) { ctxProxyStatus = null; }
    if (ctxProxyStatus && ctxProxyStatus.configured) {
      if (t.proxy) {
        // Tab già instradata: si può cambiare paese (apre la lista) o tornare
        // diretti. Senza "Cambia paese" l'utente dovrebbe prima tornare in
        // Italia e poi riproxare — un'asimmetria inutile.
        entries.push({ label: 'Cambia paese', icon: 'globe', action: 'tab-proxy-pick' });
        entries.push({ label: 'Torna in Italia', icon: 'globe', action: 'tab-proxy-clear' });
      } else {
        entries.push({
          label: 'Apri da un altro paese', icon: 'globe',
          action: 'tab-proxy-default', subAction: 'tab-proxy-pick',
        });
      }
    }
    entries.push(
      { type: 'separator' },
      { label: 'Chiudi', icon: 'close', action: 'tab-close' },
    );
    api.popupMenu(entries, ctxMenuPos.x, ctxMenuPos.y);
  }

  // Secondo livello di "Apri da un altro paese": la lista delle location
  // curate, riaperta nello stesso punto del menu tab.
  // Instrada una tab "da un altro paese". Un solo tentativo per click (mai
  // retry automatici): se il fornitore non risponde, mostra un messaggio onesto
  // invece di lasciare l'utente senza riscontro.
  async function proxyTab(id, country) {
    let res = null;
    try { res = await api.tabs.setProxy(id, country); } catch (_) { res = { ok: false, error: 'proxy_failed' }; }
    if (res && res.ok) return;
    const err = res && res.error;
    const msg = err === 'not_configured'
      ? 'Nessun fornitore di rete configurato per aprire le schede da un altro paese. Configuralo in Impostazioni → Sicurezza.'
      : err === 'bad_country'
        ? 'Paese non riconosciuto: riprova con un altro.'
        : 'Non sono riuscito ad aprire la scheda da un altro paese: il fornitore di rete non ha risposto. Riprova più tardi.';
    showToast(msg);
  }

  function openProxyCountryMenu() {
    const locs = (ctxProxyStatus && ctxProxyStatus.locations) || [];
    if (!locs.length) return;
    const entries = locs.map((l) => ({
      label: l.label,
      action: 'tab-proxy-go:' + l.code,
    }));
    api.popupMenu(entries, ctxMenuPos.x, ctxMenuPos.y);
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
      else if (action === 'tab-proxy-default') proxyTab(id);
      else if (action === 'tab-proxy-clear') api.tabs.clearProxy(id);
      else if (action === 'tab-proxy-pick') openProxyCountryMenu();
      else if (action.startsWith('tab-proxy-go:')) proxyTab(id, action.slice('tab-proxy-go:'.length));
    });
  }

  function render() {
    // Durante una trascinata non ridisegnare: cancellare i nodi farebbe perdere
    // il riferimento alla tab trascinata e interromperebbe il drag. Il riordino
    // viene confermato dal broadcast successivo al rilascio (api.tabs.move).
    // NB: si sospende NON appena il drag è armato (mousedown), non solo dopo aver
    // superato la soglia di 4px. Nella finestra tra mousedown e soglia `drag`
    // esiste ma `moved` è ancora false: un broadcast `tabs:updated` che arriva lì
    // (cambio titolo/favicon/loading/audio: frequentissimo) ricreerebbe tutti i
    // nodi .tab, ORFANIZZANDO `drag.el`. Quando poi si supera la soglia, l'orfano
    // verrebbe reinserito accanto al nodo rigenerato con lo stesso id → due schede
    // fantasma affiancate e indice di rilascio sbagliato. Sospendere già da armato
    // costa solo un frame di lag visivo mentre il tasto è premuto (ridisegnato al
    // rilascio dal broadcast successivo).
    if (drag) return;
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
      if (t.id !== state.activeId && t.identityColor && tabOpacity > 0) {
        const tint = attenuateIdentity(t.identityColor);
        if (tint) {
          // `opacita_tab` controlla la frazione di tinta nel mix col fondo del
          // tab bar: 0.6 (default) ≈ tinta percepibile ma sobria, 1 = piena.
          const pct = Math.round(tabOpacity * 100);
          el.style.setProperty(
            '--tab-bg-eff',
            `color-mix(in srgb, ${tint} ${pct}%, var(--tab-bg))`,
          );
        }
      }

      // Audio in riproduzione: aggiunge classe per il bagliore animato.
      // Il colore del bagliore viene calcolato dal colore identità della tab
      // (desaturato, come la tinta §1.2) e impostato come variabile CSS inline.
      const isAudible = t.audible && !t.muted;
      if (isAudible) {
        el.classList.add('audible');
        // Calcola il colore del bagliore: usa il colore identità se disponibile,
        // altrimenti l'accento Filo come fallback. Desaturiamo già via CSS.
        const glowBase = hasColorIdentity(t.color) ? t.color
          : (t.identityColor || null);
        if (glowBase) {
          el.style.setProperty('--tab-glow-color', glowBase);
        }
      }

      // Slot favicon / spinner. Quando la tab suona, l'icona audio SOSTITUISCE
      // la favicon in questo slot: un unico indicatore, sempre visibile a
      // qualsiasi larghezza (lo slot è a larghezza fissa), che non si sovrappone
      // mai alla favicon né viene duplicato altrove nella tab.
      const ico = document.createElement('div');
      if (t.loading) {
        ico.className = 'spinner';
      } else if (isAudible) {
        // L'icona audio prende il posto della favicon (nessun overlay sotto).
        ico.className = 'favicon favicon-audible';
        ico.innerHTML = AUDIO_IND_SVG;
        // Clic sullo slot favicon-audible muta la tab.
        ico.setAttribute('role', 'button');
        ico.title = 'Silenzia';
        ico.setAttribute('aria-label', 'Audio in riproduzione — clicca per silenziare');
        ico.addEventListener('click', (e) => { e.stopPropagation(); api.tabs.setMuted(t.id); });
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
        m.setAttribute('role', 'button');
        m.title = 'Riattiva audio';
        m.setAttribute('aria-label', 'Audio mutato — clicca per riattivare');
        m.innerHTML = MUTE_IND_SVG;
        m.addEventListener('click', (e) => { e.stopPropagation(); api.tabs.setMuted(t.id); });
        el.appendChild(m);
      }

      // Indicatore "aperta da un altro paese": globo + codice paese accanto al
      // titolo, così si riconoscono a colpo d'occhio le tab instradate altrove.
      if (t.proxy && t.proxy.country) {
        const p = document.createElement('span');
        p.className = 'proxy-ind';
        p.setAttribute('aria-label', 'Aperta da un altro paese');
        p.innerHTML = PROXY_IND_SVG + '<span class="cc">' + t.proxy.country.toUpperCase() + '</span>';
        el.appendChild(p);
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

      el.addEventListener('mousedown', (e) => startTabDrag(e, t, el));
      el.addEventListener('click', () => {
        if (suppressClickId === t.id) { suppressClickId = null; return; }
        api.tabs.activate(t.id);
      });
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
    'history/history.html': 'Cronologia AI',
    'archive/archive.html': 'Cronologia',
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

  // Notifiche/toast in basso a destra (spec #170.1). Sistema riutilizzabile:
  // ogni notifica è una card impilata nell'angolo, con durata configurabile
  // (0 = infinita → resta finché l'utente non preme la X) e suono opzionale.
  // È la base che i blocchi (#170.2/#170.3) usano per segnalare gli eventi.
  const NOTIFS = (() => {
    let host = null;
    // Tetto al numero di card impilate insieme. Senza limite una raffica di
    // eventi (es. tempesta di popup bloccati, o ripristino con molte schede su
    // siti in blacklist) fa crescere lo stack oltre l'altezza della finestra e
    // spinge le più vecchie fuori schermo, dove non si possono più chiudere.
    // Con un tetto teniamo solo le più recenti (le più rilevanti); le eccedenti
    // vengono rimosse subito, senza attendere il timeout.
    const MAX_STACK = 5;
    function hostEl() {
      if (!host) {
        host = document.getElementById('shell-notifs');
        if (!host) {
          host = document.createElement('div');
          host.id = 'shell-notifs';
          host.className = 'shell-notifs';
          document.body.appendChild(host);
        }
      }
      return host;
    }
    // Rimuove immediatamente (senza animazione) le card più vecchie oltre il
    // tetto, così lo stack non supera mai MAX_STACK elementi vivi.
    function enforceCap() {
      const h = hostEl();
      const live = Array.from(h.children).filter((c) => c.dataset.closing !== '1');
      const over = live.length - MAX_STACK;
      for (let i = 0; i < over; i++) {
        const c = live[i]; // le più vecchie sono in cima (append in coda)
        if (c._timer) clearTimeout(c._timer);
        try { c.remove(); } catch (_) {}
      }
    }
    // Se anche col tetto lo stack eccede l'altezza della finestra (finestra
    // molto bassa), il contenitore diventa scrollabile: attiviamo i pointer
    // events per poter afferrare la scrollbar e teniamo in vista la più recente.
    function syncOverflow() {
      const h = hostEl();
      const scrollable = h.scrollHeight > h.clientHeight + 1;
      h.classList.toggle('scrolling', scrollable);
      if (scrollable) h.scrollTop = h.scrollHeight;
    }
    function dismiss(card) {
      if (!card || card.dataset.closing === '1') return;
      card.dataset.closing = '1';
      if (card._timer) clearTimeout(card._timer);
      card.classList.remove('show');
      // attende la transizione prima di rimuovere dal DOM
      setTimeout(() => { try { card.remove(); } catch (_) {} syncOverflow(); }, 220);
    }
    // showNotification(text, opts?) — opts: { durationSec, sound (toneId|false),
    // actions: [{ label, onClick }] }. Senza opts usa la config delle Preferenze.
    function show(text, opts) {
      if (!text) return null;
      opts = opts || {};
      const card = document.createElement('div');
      card.className = 'shell-notif';

      const msg = document.createElement('div');
      msg.className = 'shell-notif-msg';
      msg.textContent = text;
      card.appendChild(msg);

      const durationSec = opts.durationSec != null
        ? Number(opts.durationSec)
        : notifConfig.durationSec;
      const infinite = !(Number.isFinite(durationSec) && durationSec > 0);

      // Azioni opzionali (es. "Apri comunque" per i blocchi #170.3).
      if (Array.isArray(opts.actions) && opts.actions.length) {
        const bar = document.createElement('div');
        bar.className = 'shell-notif-actions';
        for (const a of opts.actions) {
          if (!a || !a.label) continue;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'shell-notif-action';
          btn.textContent = a.label;
          btn.addEventListener('click', () => {
            try { a.onClick && a.onClick(); } catch (_) {}
            dismiss(card);
          });
          bar.appendChild(btn);
        }
        card.appendChild(bar);
      }

      // La X compare sempre per le notifiche infinite; per quelle a tempo è
      // comunque utile poterle chiudere subito, quindi la mostriamo sempre.
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'shell-notif-close';
      close.setAttribute('aria-label', 'Chiudi notifica');
      close.textContent = '×';
      close.addEventListener('click', () => dismiss(card));
      card.appendChild(close);

      hostEl().appendChild(card);
      // Applica subito il tetto: se questa card sfora, la più vecchia sparisce.
      enforceCap();
      // forza reflow così la transizione di entrata parte
      // eslint-disable-next-line no-unused-expressions
      card.offsetHeight;
      card.classList.add('show');
      // Finestra molto bassa: rendi scrollabile e mostra la più recente.
      syncOverflow();

      // Suono opzionale alla comparsa.
      const wantSound = opts.sound !== undefined
        ? opts.sound
        : (notifConfig.soundEnabled ? notifConfig.sound : false);
      if (wantSound && window.SN_SOUNDS) {
        try { window.SN_SOUNDS.play(typeof wantSound === 'string' ? wantSound : notifConfig.sound); } catch (_) {}
      }

      if (!infinite) {
        card._timer = setTimeout(() => dismiss(card), durationSec * 1000);
      }
      return card;
    }
    return { show, dismiss };
  })();

  // Compat: il vecchio toast informativo (es. "Tab riordinate e salvate") ora
  // passa per il sistema di notifiche, così rispetta la durata configurata.
  function showToast(text) { return NOTIFS.show(text); }

  // ── Aprire uno scaricamento: se il file non c'è più, DILLO ──────────────
  // Il main risponde { ok:false, missing:true, error } quando il percorso non
  // punta più a niente (file spostato, rinominato o cestinato dopo). Prima quella
  // risposta veniva buttata via e il clic non produceva nulla: il silenzio è
  // indistinguibile da un'app bloccata. Ora l'esito diventa un avviso, con la
  // cartella come via d'uscita (il file potrebbe essere lì rinominato).
  function openDownloadFile(id) {
    if (!api.downloads) return Promise.resolve();
    return api.downloads.openFile(id).then((res) => {
      if (!res || res.ok !== false) return;
      const opts = res.missing
        ? { actions: [{ label: 'Apri cartella', onClick: () => openDownloadFolder(id) }] }
        : undefined;
      NOTIFS.show(res.error || 'Non è stato possibile aprire il file', opts);
    }).catch(() => {});
  }
  function openDownloadFolder(id) {
    if (!api.downloads) return Promise.resolve();
    return api.downloads.openFolder(id).then((res) => {
      if (!res) return;
      if (res.ok === false) { NOTIFS.show(res.error || 'Non è stato possibile aprire la cartella'); return; }
      // Cartella aperta, ma il file dentro non c'è più: meglio dirlo che
      // lasciare l'utente a cercarlo.
      if (res.missing) NOTIFS.show('Il file non c’è più: ho aperto la cartella dov’era');
    }).catch(() => {});
  }

  if (api.onToast) api.onToast((info) => {
    if (!info || !info.text) return;
    // Le azioni che arrivano dal main non possono trasportare funzioni: le
    // codifichiamo in modo dichiarativo e le traduciamo qui in onClick.
    // - openUrl → apri quel sito bypassando il blocco (#170.3 "Apri comunque").
    let opts = info.opts;
    if (opts && Array.isArray(opts.actions)) {
      opts = {
        ...opts,
        actions: opts.actions.map((a) => {
          if (a && a.openUrl && !a.onClick) {
            return { label: a.label, onClick: () => api.tabs.openBlockedPopup(a.openUrl) };
          }
          // F4 — undo auto-feedback: azione dichiarativa cancelAutoFeedback.
          if (a && a.cancelAutoFeedback && !a.onClick) {
            const fbId = a.cancelAutoFeedback;
            return {
              label: a.label,
              onClick: () => api.message({ type: 'cancel_auto_feedback', id: fbId }).catch(() => {}),
            };
          }
          // #410.1 — toast di fine scaricamento: apri il file / mostra in cartella.
          if (a && a.openDownloadId && !a.onClick && api.downloads) {
            const id = a.openDownloadId;
            return { label: a.label, onClick: () => openDownloadFile(id) };
          }
          if (a && a.revealDownloadId && !a.onClick && api.downloads) {
            const id = a.revealDownloadId;
            return { label: a.label, onClick: () => openDownloadFolder(id) };
          }
          return a;
        }),
      };
    }
    NOTIFS.show(info.text, opts);
  });
  // Esposta per test e per usi programmatici dalla shell stessa.
  window.filoNotify = (text, opts) => NOTIFS.show(text, opts);

  // ─── Scaricamenti della navigazione (#410.1) ───────────────────────────
  // Indicatore nella fila di tab (sempre visibile, non coperto dalla view
  // nativa della pagina) + pannello espandibile con i singoli download. Il
  // pannello sfrutta reserveTop per rivelarsi SOPRA l'area pagina (che è una
  // WebContentsView nativa e altrimenti lo occulterebbe).
  if (api.downloads) {
    const dlBtn = document.getElementById('dl-indicator');
    const dlIcon = document.getElementById('dl-ind-icon');
    const dlCount = document.getElementById('dl-ind-count');
    const dlFill = document.getElementById('dl-ind-fill');
    setIcon(dlIcon, 'download', 15);

    // id → record (lo schema pubblico definito nel main).
    const dls = new Map();
    let panelOpen = false;
    let panel = null;

    const ACTIVE = new Set(['progressing', 'paused']);
    const isActive = (r) => r && ACTIVE.has(r.state);

    function fmtBytes(n) {
      n = Number(n) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
      if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
      return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    function pct(r) {
      if (r.totalBytes > 0) return Math.min(100, Math.round((r.receivedBytes / r.totalBytes) * 100));
      return null; // indeterminato (server senza Content-Length)
    }
    function stateLabel(r) {
      switch (r.state) {
        case 'completed': return 'Completato';
        case 'cancelled': return 'Annullato';
        case 'interrupted': return 'Interrotto';
        case 'paused': return 'In pausa';
        default: return 'In corso';
      }
    }

    function renderIndicator() {
      const all = Array.from(dls.values());
      if (!all.length) { dlBtn.hidden = true; if (panelOpen) closePanel(); return; }
      dlBtn.hidden = false;
      const active = all.filter(isActive);
      if (active.length) {
        dlCount.hidden = false;
        dlCount.textContent = String(active.length);
        // Avanzamento aggregato: byte ricevuti / totali sui download con totale
        // noto. Se nessuno ha un totale, barra indeterminata (animata via CSS).
        let recv = 0; let total = 0; let known = 0;
        for (const r of active) { if (r.totalBytes > 0) { recv += r.receivedBytes; total += r.totalBytes; known++; } }
        if (known && total > 0) {
          dlBtn.classList.remove('indeterminate');
          dlFill.style.width = `${Math.min(100, Math.round((recv / total) * 100))}%`;
        } else {
          dlBtn.classList.add('indeterminate');
          dlFill.style.width = '40%';
        }
        dlBtn.classList.add('active');
      } else {
        dlBtn.classList.remove('active', 'indeterminate');
        dlCount.hidden = true;
        dlFill.style.width = '0%';
      }
      if (panelOpen) renderPanel();
    }

    function ensurePanel() {
      if (panel) return panel;
      panel = document.createElement('div');
      panel.className = 'dl-panel';
      panel.id = 'dl-panel';
      panel.hidden = true;
      const head = document.createElement('div');
      head.className = 'dl-panel-head';
      const title = document.createElement('span');
      title.className = 'dl-panel-title';
      title.textContent = 'Scaricamenti';
      // Punto d'accesso alla pagina completa (cronologia + azioni per voce).
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'dl-panel-clear';
      allBtn.textContent = 'Vedi tutti';
      allBtn.title = 'Apri l’elenco completo degli scaricamenti';
      allBtn.addEventListener('click', () => {
        api.tabs.open('filo://downloads/downloads.html');
        closePanel();
      });
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'dl-panel-clear';
      clearBtn.textContent = 'Svuota';
      clearBtn.title = 'Rimuovi gli scaricamenti conclusi';
      clearBtn.addEventListener('click', () => {
        api.downloads.clear().then((r) => { syncFromList(r && r.items); }).catch(() => {});
      });
      head.appendChild(title);
      head.appendChild(allBtn);
      head.appendChild(clearBtn);
      panel.appendChild(head);
      const list = document.createElement('div');
      list.className = 'dl-panel-list';
      list.id = 'dl-panel-list';
      panel.appendChild(list);
      document.body.appendChild(panel);
      return panel;
    }

    function renderPanel() {
      ensurePanel();
      const list = panel.querySelector('#dl-panel-list');
      list.textContent = '';
      const all = Array.from(dls.values()).sort((a, b) => {
        // Attivi in cima, poi per data d'inizio decrescente.
        const aa = isActive(a) ? 0 : 1; const bb = isActive(b) ? 0 : 1;
        if (aa !== bb) return aa - bb;
        return String(b.startedAt || '').localeCompare(String(a.startedAt || ''));
      });
      if (!all.length) {
        const empty = document.createElement('div');
        empty.className = 'dl-empty';
        empty.textContent = 'Nessuno scaricamento';
        list.appendChild(empty);
      }
      for (const r of all) list.appendChild(renderRow(r));
      // Il pannello ha cambiato altezza: aggiorna lo spazio riservato.
      if (panelOpen) reserveForPanel();
    }

    function renderRow(r) {
      const row = document.createElement('div');
      row.className = 'dl-row';
      row.dataset.state = r.state;
      // Il file non è più al suo posto: la riga lo dice PRIMA del clic (testo
      // attenuato) e non offre "Apri file", che non avrebbe niente da aprire.
      if (r.missing) row.dataset.missing = '1';

      const name = document.createElement('div');
      name.className = 'dl-row-name';
      name.textContent = r.filename || 'download';
      name.title = r.filename || '';
      row.appendChild(name);

      if (isActive(r)) {
        const bar = document.createElement('div');
        bar.className = 'dl-row-bar';
        const fill = document.createElement('div');
        fill.className = 'dl-row-fill';
        const p = pct(r);
        if (p == null) { bar.classList.add('indeterminate'); fill.style.width = '40%'; }
        else fill.style.width = `${p}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      }

      const meta = document.createElement('div');
      meta.className = 'dl-row-meta';
      const p = pct(r);
      if (isActive(r)) {
        meta.textContent = p != null
          ? `${p}% · ${fmtBytes(r.receivedBytes)} / ${fmtBytes(r.totalBytes)}`
          : `${fmtBytes(r.receivedBytes)} scaricati`;
      } else if (r.missing) {
        meta.textContent = `Non più sul disco · ${fmtBytes(r.totalBytes || r.receivedBytes)}`;
      } else {
        meta.textContent = `${stateLabel(r)} · ${fmtBytes(r.totalBytes || r.receivedBytes)}`;
      }
      row.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'dl-row-actions';
      const addBtn = (label, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dl-row-btn';
        b.textContent = label;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      if (isActive(r)) {
        // Gli scaricamenti "a mano" (Salva immagine/video come…) non si mettono
        // in pausa: meglio nessun pulsante che uno che non fa niente.
        if (r.canPause !== false) {
          if (r.state === 'paused') addBtn('Riprendi', () => api.downloads.resume(r.id).catch(() => {}));
          else addBtn('Pausa', () => api.downloads.pause(r.id).catch(() => {}));
        }
        addBtn('Annulla', () => api.downloads.cancel(r.id).catch(() => {}));
      } else if (r.state === 'completed') {
        if (!r.missing) addBtn('Apri file', () => openDownloadFile(r.id));
        addBtn('Apri cartella', () => openDownloadFolder(r.id));
        addBtn('Rimuovi', () => api.downloads.remove(r.id).then((res) => syncFromList(res && res.items)).catch(() => {}));
      } else {
        addBtn('Rimuovi', () => api.downloads.remove(r.id).then((res) => syncFromList(res && res.items)).catch(() => {}));
      }
      row.appendChild(actions);
      return row;
    }

    // reserveTop = altezza del pannello (capped) così la view della pagina
    // scende e il pannello non finisce sotto di essa. Vedi setTopInset in tabs.js.
    function reserveForPanel() {
      if (!panelOpen || !panel) return;
      requestAnimationFrame(() => {
        const h = Math.ceil(panel.getBoundingClientRect().height);
        try { api.tabs.reserveTop && api.tabs.reserveTop(h + 6); } catch (_) {}
      });
    }
    function openPanel() {
      ensurePanel();
      panelOpen = true;
      panel.hidden = false;
      dlBtn.classList.add('open');
      renderPanel();
      reserveForPanel();
      // I file possono essere spariti dal disco mentre il pannello era chiuso
      // (nessun evento lo annuncia): ri-leggendo la lista all'apertura le voci
      // ormai vuote si mostrano già attenuate, senza aspettare un clic a vuoto.
      api.downloads.list().then((r) => { syncFromList(r && r.items); }).catch(() => {});
    }
    function closePanel() {
      panelOpen = false;
      if (panel) panel.hidden = true;
      dlBtn.classList.remove('open');
      try { api.tabs.reserveTop && api.tabs.reserveTop(0); } catch (_) {}
    }
    function togglePanel() { panelOpen ? closePanel() : openPanel(); }

    dlBtn.addEventListener('click', togglePanel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); });
    window.addEventListener('resize', () => { if (panelOpen) reserveForPanel(); });

    function syncFromList(items) {
      dls.clear();
      if (Array.isArray(items)) for (const r of items) dls.set(r.id, r);
      renderIndicator();
      if (panelOpen) renderPanel();
    }

    // Aggiornamenti live dal main (start/progress/done/error).
    api.downloads.onEvent((info) => {
      if (!info || !info.item) return;
      dls.set(info.item.id, info.item);
      renderIndicator();
      if (panelOpen) renderPanel();
    });

    // Cronologia iniziale (sopravvive al riavvio).
    api.downloads.list().then((r) => { syncFromList(r && r.items); }).catch(() => {});
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
    } else {
      // Salto alla N-esima scheda (quando il focus è sulla barra di Filo; per
      // le pagine ci pensa before-input-event nel main). Quale combinazione
      // sia lo decide src/shared/tasti.js: Alt+cifra qui, Cmd+cifra su Mac.
      const idx = TASTI ? TASTI.indiceSaltoScheda(e) : null;
      if (idx != null) {
        e.preventDefault();
        const tab = state.tabs[idx];
        if (tab) api.tabs.activate(tab.id);
      }
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
