// La barra in alto di Filo: fila delle schede, icone, notifiche, pannello degli
// scaricamenti. Vive fuori dalle WebContentsView, quindi è l'unica superficie
// che resta visibile sopra qualunque pagina.

(() => {
  const api = window.filoShell;
  if (!api) {
    console.error('[Filo shell] filoShell non disponibile (preload non caricato?)');
    return;
  }
  window.SN_RILASCIO_VISTA?.ascolta(document, { percorsoDi: api.percorsoDelFile, manda: api.rilascioNellaChat });

  // Il nome del tasto si compone qui, non nell'HTML: regola in CLAUDE.md § Mac.
  const TASTI = window.SN_TASTI;
  const tasto = (accel) => (TASTI ? TASTI.etichetta(accel) : accel);

  const tabsEl = document.getElementById('tabs');
  const newBtn = document.getElementById('tab-new');
  if (newBtn) newBtn.dataset.tip = `Nuova scheda (${tasto('Ctrl+T')})`;
  // #871 — la maniglia apre e chiude la barra laterale; un clic altrove nella fila la chiude.
  const manigliaBarra = document.getElementById('barra-maniglia');
  if (manigliaBarra) {
    manigliaBarra.dataset.tip = `Barra laterale (${TASTI && TASTI.etichettaBarra ? TASTI.etichettaBarra() : tasto('Ctrl+Shift+B')})`;
    manigliaBarra.addEventListener('click', (e) => { if (e.isTrusted) api.barra?.commuta(); });
    // Tasto destro: le scelte della striscia (aprirla, nasconderla, spegnere l'apertura dal bordo, regolarla).
    manigliaBarra.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) api.barra?.menu?.(Math.round(e.clientX), Math.round(e.clientY));
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || (manigliaBarra && manigliaBarra.contains(e.target))) return;
    try { api.barra?.chiudi(); } catch (_) {}
  }, true);
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

  // Icone da src/shared/icons.js: la barra deve stare nella stessa famiglia
  // visiva del menu del tasto destro.
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

  // #146.1 — i token estetici dell'utente valgono anche qui, e si riapplicano
  // dal vivo a ogni cambio: la barra non può restare indietro sulle pagine.
  const ThemeTokens = window.SN_THEME_TOKENS;
  let tokenShell = {};
  function applyShellTokens(tokens) {
    tokenShell = tokens && typeof tokens === 'object' ? tokens : {};
    if (ThemeTokens) ThemeTokens.applyToDocument(document, tokenShell, { shell: true });
  }
  // Parametri "Colore identità delle tab" per il fondo delle schede non attive.
  const TabColor = window.SN_TAB_COLOR;
  let tabColorParams = TabColor ? TabColor.defaultParams() : null;
  function applyTabColorParams(tabColor) {
    if (TabColor && tabColor && typeof tabColor === 'object') tabColorParams = TabColor.clampParams(tabColor);
  }
  // Fondo e inchiostri si calcolano sui colori veri del tema: al cambio di tema si ridipinge.
  try {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { try { render({ forza: true }); } catch (_) {} });
  } catch (_) {}
  // Config notifiche (spec #170.1): durata, suono on/off, suono scelto. Letta
  // dalle impostazioni al boot e aggiornata live a ogni cambio prefs, così le
  // notifiche successive rispettano i nuovi valori senza riavviare.
  let notifConfig = { durationSec: 5, soundEnabled: false, sound: 'default' };
  // Un volume assente o storto vale «pieno»: il silenzio si sceglie, non si
  // eredita da un'impostazione malformata.
  function volumeValido(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
  }

  function applyNotifConfig(notifications) {
    if (!notifications || typeof notifications !== 'object') return;
    const d = Number(notifications.durationSec);
    notifConfig = {
      durationSec: Number.isFinite(d) && d >= 0 ? d : 5,
      soundEnabled: notifications.soundEnabled === true,
      sound: typeof notifications.sound === 'string' ? notifications.sound : 'default',
      soundVolume: volumeValido(notifications.soundVolume),
    };
  }
  // #430 — carta con l'anteprima della scheda al passaggio del puntatore: accesa e misura dalle Preferenze.
  let anteprimaSchede = { enabled: true, size: 'media' };
  function applyTabPreview(tp) {
    if (!tp || typeof tp !== 'object') return;
    anteprimaSchede = {
      enabled: tp.enabled !== false,
      size: ['piccola', 'media', 'grande'].includes(tp.size) ? tp.size : 'media',
    };
    if (!anteprimaSchede.enabled) try { ANTEPRIMA.nascondi(); } catch (_) {}
  }
  api.message({ type: 'get_settings' })
    .then((r) => {
      applyShellTokens(r?.settings?.themeTokens);
      rispecchiaBarra();
      applyTabColorParams(r?.settings?.tabColor);
      applyNotifConfig(r?.settings?.notifications);
      applyTabPreview(r?.settings?.tabPreview);
      applyRingTone(r?.settings?.timerRingtone, r?.settings?.timerRingtoneVolume);
      refreshRinging();
      try { render({ forza: true }); } catch (_) {}
      try { NOTIFS.rispecchia(); } catch (_) {}
    })
    .catch(() => {});
  if (typeof api.onBroadcast === 'function') {
    api.onBroadcast((m) => {
      if (m?.type === 'settings_updated') {
        applyShellTokens(m.settings?.themeTokens);
        rispecchiaBarra();
        applyTabColorParams(m.settings?.tabColor);
        applyNotifConfig(m.settings?.notifications);
        applyTabPreview(m.settings?.tabPreview);
        applyRingTone(m.settings?.timerRingtone, m.settings?.timerRingtoneVolume);
        // Il volume cambiato mentre suona deve sentirsi subito: senza questo si
        // sentirebbe solo alla scadenza dopo.
        refreshRinging();
        try { render({ forza: true }); } catch (_) {}
        try { NOTIFS.rispecchia(); } catch (_) {}
      }
    });
  }

  // Tema dedicato e badge: una finestra incognito dev'essere inconfondibile.
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

  // ── Suoneria di timer e sveglie ───────────────────────────────────────────
  // Suona QUI perché la shell c'è sempre: una scadenza coglie l'utente su una
  // scheda qualunque, e la pagina Nuova scheda può non essere nemmeno aperta.
  const MSG_FILO = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const ringBtn = document.getElementById('ring-indicator');
  const ringLabel = document.getElementById('ring-ind-label');
  setIcon(document.getElementById('ring-ind-icon'), 'alarm', 15);
  let ringTone = 'default';
  let ringVolume = 100;
  let ringingIds = [];
  let ringWake = null;

  function applyRingTone(id, volume) {
    const tones = window.SN_SOUNDS && window.SN_SOUNDS.TONES;
    if (typeof id === 'string' && tones && tones[id]) ringTone = id;
    ringVolume = volumeValido(volume);
  }

  function testoSuoneria(list) {
    if (list.length > 1) return `${list.length} scadenze`;
    const t = list[0];
    if (t.kind === 'alarm') return t.label ? `Sveglia — ${t.label}` : 'Sveglia';
    return t.label ? `${t.label} — scaduto` : 'Timer scaduto';
  }

  // Il watcher del main ricontrolla ogni pochi secondi: sentire la suoneria
  // cinque secondi dopo lo zero è attrito, quindi ci svegliamo sulla scadenza.
  function programmaRisveglio(timers) {
    if (ringWake) { clearTimeout(ringWake); ringWake = null; }
    let primo = Infinity;
    for (const t of timers) {
      if (!t || t.ringing || t.paused) continue;
      const ms = new Date(t.endsAt).getTime() - Date.now();
      if (Number.isFinite(ms) && ms < primo) primo = ms;
    }
    if (primo === Infinity) return;
    ringWake = setTimeout(refreshRinging, Math.min(60000, Math.max(250, primo + 150)));
  }

  // `mio` lo decide il main: fra le finestre che vedono la stessa scadenza ne
  // suona una sola. Il pulsante invece sta in tutte, perché l'utente può essere
  // davanti a una qualunque e il gesto per far smettere non si cerca.
  function applyRinging(timers, mio) {
    const tutti = Array.isArray(timers) ? timers : [];
    programmaRisveglio(tutti);
    const list = tutti.filter((t) => t && t.ringing);
    ringingIds = list.map((t) => t.id);
    const acceso = list.length > 0;
    if (ringBtn) ringBtn.hidden = !acceso;
    if (acceso && ringLabel) ringLabel.textContent = testoSuoneria(list);
    const S = window.SN_SOUNDS;
    if (!S) return;
    if (acceso && mio !== false) S.ring(ringTone, ringVolume); else S.silence();
  }

  // Ogni finestra chiede le SUE scadenze: quella incognito vede solo le proprie
  // (i timer non sono fra le chiavi che eredita dal disco), quindi nessuna
  // scadenza può squillare in due finestre insieme.
  function refreshRinging() {
    const type = MSG_FILO.FILO_GET_TIMERS;
    if (!type) return;
    api.message({ type })
      .then((r) => applyRinging(r && r.ok ? r.timers : [], !r || r.suona !== false))
      .catch(() => {});
  }

  if (typeof api.onBroadcast === 'function') {
    api.onBroadcast((m) => {
      if (m?.type === MSG_FILO.FILO_LIVE_UPDATED) refreshRinging();
    });
  }

  if (ringBtn) {
    ringBtn.addEventListener('click', () => {
      const type = MSG_FILO.FILO_STOP_TIMER_ALARM;
      const ids = ringingIds.slice();
      // Zittisci subito: l'attesa della risposta è attrito su un gesto che
      // esiste per far smettere un rumore.
      applyRinging([], false);
      if (!type) return;
      Promise.all(ids.map((id) => api.message({ type, id }).catch(() => {})))
        .then(refreshRinging);
    });
  }

  // Registro app del launcher. Il Feedback vive qui fra le App.
  //
  // "Aperti per dopo" sta qui perché è la CONTROPARTE di "Salva per dopo": il
  // salvataggio chiude la scheda, quindi senza un ingresso sempre visibile la
  // lista di ciò che hai messo da parte resta irraggiungibile (l'icona dedicata
  // del menu del tasto destro è stata ritirata e l'icona Home porta alla nuova
  // scheda, non lì). È l'analogo di "Download": una lista di cose messe da
  // parte, non un'azione.
  // "Feedback" (la posta delle segnalazioni) e "Gestione" sono superfici
  // dell'owner: da quando i feedback li legge solo chi li gestisce (#583) a un
  // utente comune aprirebbero una pagina che non ha niente da mostrare, con un
  // invito ad accedere come amministratore che non porta da nessuna parte
  // (amministratori non si diventa accedendo). Compaiono solo all'admin.
  // Gestione è l'ingresso unico delle pagine dell'owner (#1414): Modelli
  // predefiniti e Inviti e utenti stanno lì, non in altri menu. Chi vuole MANDARE
  // un feedback non passa di qui: passa dal menu del tasto destro.
  // Bacheca e Deck builder in pausa (#1592): li vede l'owner, o tutti se l'owner li ha aperti. Con la Bacheca in
  // pausa le segnalazioni mandate restano raggiungibili: la voce porta alla sola parte che è dell'utente.
  let inPausaVisibili = { bacheca: false, mazzi: false };
  function buildApps() {
    const entries = [
      { label: 'Editor', icon: 'editor', url: 'filo://editor/editor.html' },
      ...(inPausaVisibili.mazzi ? [{ label: 'Deck builder MTG', icon: 'decks', url: 'filo://decks/decks.html' }] : []),
      { label: 'Aperti per dopo', icon: 'saveForLater', url: 'filo://home/home.html' },
      { label: 'Download', icon: 'download', url: 'filo://downloads/downloads.html' },
      { label: 'Memorie', icon: 'memory', url: 'filo://quaderno/quaderno.html' },
      { type: 'separator' },
      inPausaVisibili.bacheca
        ? { label: 'Bacheca', icon: 'board', url: 'filo://board/board.html' }
        : { label: 'Le tue segnalazioni', icon: 'feedback', url: 'filo://board/board.html#segnalazioni' },
    ];
    if (isAdmin) {
      entries.push({ label: 'Feedback', icon: 'feedback', url: 'filo://feedback/feedback.html' });
      entries.push({ label: 'Gestione', icon: 'feedback', url: 'filo://manage/manage.html' });
    }
    return entries;
  }
  // Voci del menu Impostazioni (ingranaggio): uguali per tutti. Le impostazioni
  // predefinite dell'owner stanno in Gestione (#1414).
  function buildSettings() {
    return [
      { label: 'Modelli', icon: 'models', url: 'filo://options/options.html' },
      { label: 'Altro', icon: 'options', url: 'filo://options/altro.html' },
      { label: 'Sicurezza', icon: 'lock', url: 'filo://security/security.html' },
      // Con "Modelli" e "Sicurezza": stesse domande, dal lato del perché.
      { label: 'Trasparenza', icon: 'transparency', url: 'filo://transparency/transparency.html' },
      { type: 'separator' },
      { label: 'Preferenze', icon: 'colorPicker', url: 'filo://preferences/preferences.html' },
    ];
  }

  // Popup menu custom: BrowserWindow frameless che appare sopra le
  // WebContentsView native, stilizzato come il menu tasto destro.
  // Dove aprire il prossimo menu quando lo chiede la barra laterale: accanto alla sua icona.
  let ancoraMenu = null;
  function showNativeMenu(btn, entries) {
    const r = btn.getBoundingClientRect();
    let x = Math.round(r.left);
    let y = Math.round(r.bottom + 4);
    // La barra in alto è nascosta e le icone reali hanno rect nullo. Dalla barra
    // laterale arriva l'ancora; dall'assistente no, e il menu si apre in alto a
    // destra. Coordinate relative alla finestra shell: popup-menu.js clampa.
    if (ancoraMenu) {
      x = ancoraMenu.x;
      y = ancoraMenu.y;
      ancoraMenu = null;
    } else if (r.width === 0 && r.height === 0) {
      x = Math.max(8, window.innerWidth - 250);
      y = 86;
    }
    api.popupMenu(entries, x, y);
  }

  settingsBtn.addEventListener('click', () => showNativeMenu(settingsBtn, buildSettings()));
  // Lo stato di adesso; una copia scaduta il main la rilegge in sottofondo e annuncia il cambio.
  function rifletteInPausa(r) {
    if (!r || !r.ok) return;
    inPausaVisibili = { bacheca: !!(r.bacheca && r.bacheca.visible), mazzi: !!(r.mazzi && r.mazzi.visible) };
  }
  function refreshInPausa(attendi = false) {
    if (!MSG_FILO.IN_PAUSA_STATO) return Promise.resolve();
    return api.message({ type: MSG_FILO.IN_PAUSA_STATO, attendi }).then(rifletteInPausa).catch(() => {});
  }
  refreshInPausa(true);
  if (typeof api.onBroadcast === 'function') {
    api.onBroadcast((m) => {
      if (m?.type === MSG_FILO.IN_PAUSA_CAMBIATO && Object.prototype.hasOwnProperty.call(inPausaVisibili, m.nome)) {
        inPausaVisibili = { ...inPausaVisibili, [m.nome]: m.visible === true };
      } else if (m?.type === MSG_FILO.AUTH_CHANGED) refreshInPausa(true);
    });
  }
  appsBtn.addEventListener('click', () => { showNativeMenu(appsBtn, buildApps()); refreshInPausa(); });

  // Registrata a parte perché deve funzionare anche senza il bottone account.
  if (api.onMenuAction) {
    api.onMenuAction((action) => {
      if (action === 'open-incognito' && api.openIncognito) api.openIncognito();
    });
  }

  // I token vivono nel main: qui arriva solo il profilo pubblico.
  let authProfile = null;
  let authBusy = false;
  // Gate UX delle voci dell'owner nel menu App. La garanzia forte resta nel main
  // e nelle regole Firestore: qui decidiamo solo se mostrare la voce.
  let isAdmin = false;
  // Falso quando manca il portachiavi di sistema: l'accesso vale fino alla chiusura.
  let authRemembered = true;
  // Un account Google nelle schede (#1123): è un accesso diverso da quello a Filo, e il menu lo dice.
  let googleNelleSchede = false;

  function shortName(p) {
    if (!p) return '';
    return p.name || (p.email || '').split('@')[0] || 'Account';
  }

  function renderAccount() {
    rispecchiaBarra();
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
      // La foto è la copia che il main tiene nella cartella dati (#1273): un indirizzo di rete qui non si carica.
      if (/^filo:\/\/icone\//.test(authProfile.picture || '')) {
        // Via DOM per poter ripiegare sull'icona se la copia non si legge.
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

  async function refreshAuth(opzioni) {
    try {
      const r = await api.auth.status(opzioni);
      authProfile = (r && r.ok && r.signedIn) ? r.profile : null;
      isAdmin = !!(r && r.ok && r.signedIn && r.isAdmin);
      authRemembered = !(r && r.remembered === false);
      googleNelleSchede = !!(r && r.googleNelleSchede);
    } catch (_) {
      authProfile = null;
      isAdmin = false;
    }
    renderAccount();
  }

  // Gli avvisi d'errore della barra si contano per chiave, mai col testo (#1461); la chiave è anche il loro tipo.
  function avvisoErrore(testo, chiave, opts) {
    try { Promise.resolve(api.message({ type: 'contatori_evento', misura: 'avviso', chiave })).catch(() => {}); } catch (_) {}
    return NOTIFS.show(testo, { ...(opts || {}), tipo: chiave });
  }

  async function doSignIn() {
    // Con un accesso già aperto (lo chiede anche la chat, #1615) il main ne riporta davanti la pagina: l'esito resta al primo.
    if (authBusy) { Promise.resolve(api.auth.signIn()).catch(() => {}); return; }
    authBusy = true; renderAccount();
    try {
      const r = await api.auth.signIn();
      if (r && r.ok) { authProfile = r.profile; isAdmin = !!r.isAdmin; authRemembered = r.remembered !== false; }
      else avvisoErrore((r && r.error) || 'Accesso non riuscito: riprova.', 'accesso_non_riuscito');
    } catch (_) {
      avvisoErrore('Accesso non riuscito: riprova.', 'accesso_non_riuscito');
    } finally {
      authBusy = false; renderAccount();
    }
  }

  // YouTube, Gmail e Drive nelle schede: l'accesso a Google si apre in una scheda, con l'email già scritta.
  async function collegaGoogle() {
    try {
      const r = await api.message({ type: 'auth_collega_google' });
      if (r && r.ok === false) avvisoErrore(r.error || 'Non sono riuscito ad aprire l\'accesso a Google. Riprova.', 'accesso_non_riuscito');
    } catch (_) {
      avvisoErrore('Non sono riuscito ad aprire l\'accesso a Google. Riprova.', 'accesso_non_riuscito');
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
    accountBtn.addEventListener('click', async () => {
      if (authBusy) return;
      // L'ancora la toglie chi aziona il bottone appena il clic torna: dopo l'attesa il menu finiva nell'angolo.
      const ancora = ancoraMenu;
      // Google nelle schede cambia senza avvisi (un accesso o un'uscita fatti in una scheda): si chiede adesso.
      if (authProfile) await refreshAuth({ senzaRete: true });
      ancoraMenu = ancora;
      if (authProfile) {
        const label = shortName(authProfile);
        showNativeMenu(accountBtn, [
          { label: authProfile.email || label, disabled: true },
          ...(authRemembered ? [] : [{ label: 'Accesso valido fino alla chiusura di Filo', disabled: true }]),
          { type: 'separator' },
          ...(googleNelleSchede ? [] : [{ label: 'Collega anche i prodotti Google', icon: 'user', action: 'collega-google' }]),
          { label: 'Crediti', icon: 'credits', url: 'filo://credits/credits.html' },
          { label: 'Nuova finestra incognito', icon: 'incognito', action: 'open-incognito' },
          { label: googleNelleSchede ? 'Esci da Filo (Google resta collegato)' : 'Esci da Filo', icon: 'close', action: 'auth-signout' },
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
    if (api.onMenuAction) {
      api.onMenuAction((action) => {
        if (action === 'auth-signout') doSignOut();
        else if (action === 'auth-signin') doSignIn();
        else if (action === 'collega-google') collegaGoogle();
      });
    }
    if (api.auth && api.auth.onChanged) {
      api.auth.onChanged((m) => {
        authProfile = m.profile || null; isAdmin = !!(m && m.isAdmin);
        authRemembered = m.remembered !== false;
        if (!authProfile || authRemembered) NOTIFS.dismissKey('accesso-non-ricordato');
        // «Continua nel browser» (#1123) non serve più a chi è entrato.
        if (authProfile) NOTIFS.dismissKey('accesso-nel-browser');
        renderAccount();
      });
    }
    refreshAuth();
  }
  // La barra laterale si disegna in una vista sua: le arrivano da qui i colori già calcolati
  // (tema, token dell'utente, incognito) e il profilo da mostrare.
  const VAR_BARRA = ['--bg', '--fg', '--fg-soft', '--border', '--tab-active', '--tab-bg', '--accent', '--accent-rgb', '--font', '--radius', '--sn-motion', '--sn-ombra'];
  function rispecchiaBarra() {
    if (!api.barra) return;
    const cs = getComputedStyle(document.documentElement);
    const tema = {};
    for (const k of VAR_BARRA) { const v = cs.getPropertyValue(k).trim(); if (v) tema[k] = v; }
    const account = authProfile
      ? { dentro: true, foto: authProfile.picture || '', etichetta: shortName(authProfile) }
      : { dentro: false, foto: '', etichetta: '' };
    try { api.barra.stato({ tema, account }); } catch (_) {}
  }
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rispecchiaBarra); } catch (_) {}

  setIcon(winMinBtn, 'minimize', 16);
  setIcon(winMaxBtn, 'maximize', 14);
  setIcon(winCloseBtn, 'close', 16);
  // A schermo intero il quadrato si vede solo con le schede scese dal bordo alto, e lì fa uscire (#1343).
  function quadratoPerSchermoIntero(on) {
    if (!winMaxBtn) return;
    const testo = on ? 'Esci da schermo intero' : 'Massimizza';
    setIcon(winMaxBtn, on ? 'restore' : 'maximize', 14);
    winMaxBtn.dataset.tip = testo;
    winMaxBtn.setAttribute('aria-label', testo);
  }
  if (typeof api.onBroadcast === 'function') {
    api.onBroadcast((m) => {
      const tipo = globalThis.SN_MSG?.MSG?.FULLSCREEN_CHANGED || 'fullscreen_changed';
      if (m && m.type === tipo) quadratoPerSchermoIntero(!!m.fullscreen);
    });
  }

  // L'agente "Aiuto" clicca il bottone VERO, così non si duplica niente.
  // "close" non è mappato apposta: l'agente non deve chiudere la finestra.
  if (api.onTriggerButton) {
    const triggerMap = {
      home: homeBtn,
      settings: settingsBtn,
      apps: appsBtn,
      account: accountBtn,
      minimize: winMinBtn,
      fullscreen: winMaxBtn,
    };
    api.onTriggerButton((command, anchor) => {
      const btn = triggerMap[command];
      if (!btn) return;
      const ok = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
      ancoraMenu = ok ? { x: Math.round(anchor.x), y: Math.round(anchor.y) } : null;
      btn.click();
      ancoraMenu = null;
    });
  }

  // Tooltip custom: legge `data-tip` su qualunque elemento della shell e chiede
  // al main di mostrare un mini-BrowserWindow stile Filo (vedi popup-tooltip.js),
  // invece del title nativo bianco squadrato. Serve una BrowserWindow secondaria
  // perché la shell è alta solo 88px e gli elementi DOM non possono apparire
  // sopra le WebContentsView delle tab. Delega globale così funziona anche per le
  // schede nate dopo.
  // Anche la carta di una scheda lo usa: cede al suggerimento di un controllo nell'istante in cui lui compare.
  const SUGGERIMENTO_RITARDO = 350;
  (() => {
    let showTimer = null;
    let currentTarget = null;

    function hide() {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      if (currentTarget) api.tooltipHide();
      currentTarget = null;
    }
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t === currentTarget) return;
      // Un elemento tolto dal ridisegno non riceve mouseout: il suo suggerimento resterebbe sopra la carta.
      if (!t) { if (currentTarget && !currentTarget.isConnected) hide(); return; }
      hide();
      currentTarget = t;
      const text = t.dataset.tip;
      if (!text) return;
      showTimer = setTimeout(() => {
        const r = t.getBoundingClientRect();
        // Ancora provvisoria: il main la rifinisce dopo aver misurato il testo.
        const x = Math.round(r.left + r.width / 2 - 60);
        const y = Math.round(r.bottom + 6);
        api.tooltipShow(text, x, y);
      }, SUGGERIMENTO_RITARDO);
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

  // #430 — la carta di anteprima. La prima compare dopo un attimo (attraversare la barra non deve accendere
  // niente); da lì, finché si resta sulle schede, passa dall'una all'altra subito. Le foto sono già nella carta.
  const ANTEPRIMA = (() => {
    const RITARDO = 200;
    const CALDA = 600;
    const VAR_TEMA = ['--bg', '--fg', '--fg-soft', '--border', '--tab-active', '--accent', '--font', '--radius', '--sn-motion', '--sn-ombra'];
    let timer = null;
    let attesaDi = null;
    let puntatore = null;
    let vaVia = null;
    let aperta = null;
    let spentaAlle = 0;
    // La scheda appena cliccata non riapre la carta finché il puntatore non passa su un'altra.
    let zittita = null;

    function elDi(id) {
      return tabsEl.querySelector(`.tab[data-anteprima="${CSS.escape(id)}"]`);
    }
    function tema() {
      const cs = getComputedStyle(document.documentElement);
      const vars = {};
      for (const k of VAR_TEMA) {
        const v = cs.getPropertyValue(k).trim();
        if (v) vars[k] = v;
      }
      return vars;
    }
    function invia(id) {
      const el = elDi(id);
      const t = state.tabs.find((x) => x.id === id);
      if (!el || !t || !api.anteprima) { nascondi(); return; }
      const r = el.getBoundingClientRect();
      aperta = id;
      api.anteprima.mostra({
        id, titolo: tabLabel(t), x: Math.round(r.left), y: Math.round(r.bottom + 4),
        misura: anteprimaSchede.size, tema: tema(),
      });
    }
    // `clic`: la carta se ne va perché si è cliccata la sua scheda (contatori della finestra, #1470).
    function chiudi(clic) {
      if (timer) { clearTimeout(timer); timer = null; attesaDi = null; }
      if (vaVia) { clearTimeout(vaVia); vaVia = null; }
      if (!aperta) return;
      aperta = null;
      spentaAlle = Date.now();
      try { api.anteprima && api.anteprima.nascondi({ clic: clic === true }); } catch (_) {}
    }
    function nascondi() { chiudi(false); }
    function sopra(id) {
      if (vaVia) { clearTimeout(vaVia); vaVia = null; }
      if (!anteprimaSchede.enabled || drag) return;
      if (id === zittita) return;
      zittita = null;
      if (id === aperta) return;
      // La barra si ridisegna a ogni titolo o icona che cambia e il puntatore «rientra» nella scheda rifatta:
      // l'attesa della stessa scheda non riparte, o con un titolo che cambia spesso la carta non arriverebbe mai.
      if (timer && attesaDi === id) return;
      if (timer) { clearTimeout(timer); timer = null; attesaDi = null; }
      if (aperta || Date.now() - spentaAlle < CALDA) { invia(id); return; }
      attesaDi = id;
      timer = setTimeout(() => {
        timer = null;
        attesaDi = null;
        if (sottoIlPuntatore(id)) invia(id);
      }, RITARDO);
    }
    // Croce, avviso audio e paese hanno il loro suggerimento, che cade dove sta la carta (#589.16): la carta gli
    // cede il posto quando lui compare, non prima, o attraversando la croce verso la scheda accanto lampeggerebbe.
    function suUnControllo(target, el) {
      const c = target.closest('[data-tip]');
      return !!c && c !== el && el.contains(c);
    }
    function cede() {
      if (timer) { clearTimeout(timer); timer = null; attesaDi = null; }
      if (aperta && !vaVia) vaVia = setTimeout(nascondi, SUGGERIMENTO_RITARDO);
    }
    // Una scheda appena rifatta non ha ancora :hover col puntatore fermo sopra: conta dove sta il puntatore.
    function sottoIlPuntatore(id) {
      const el = elDi(id);
      if (!el) return false;
      if (el.matches(':hover')) return true;
      if (!puntatore) return false;
      const sotto = document.elementFromPoint(puntatore.x, puntatore.y);
      return !!sotto && sotto.closest('.tab[data-anteprima]') === el;
    }
    // La barra si ridisegna a ogni titolo o icona che cambia: la carta segue la sua scheda, o sparisce con lei.
    function ridisegnata() {
      if (!aperta) return;
      if (!anteprimaSchede.enabled || !elDi(aperta)) { nascondi(); return; }
      invia(aperta);
    }
    tabsEl.addEventListener('mousemove', (e) => { puntatore = { x: e.clientX, y: e.clientY }; }, { passive: true });
    tabsEl.addEventListener('mouseover', (e) => {
      puntatore = { x: e.clientX, y: e.clientY };
      const el = e.target.closest('.tab[data-anteprima]');
      if (el && suUnControllo(e.target, el)) cede();
      else if (el) sopra(el.dataset.anteprima);
      // Il bordo fra due schede non spegne la carta: passando alla vicina cambierebbe con un lampo.
      else if (!vaVia) vaVia = setTimeout(nascondi, 120);
    });
    tabsEl.addEventListener('mouseenter', () => {
      if (anteprimaSchede.enabled) try { api.anteprima && api.anteprima.prepara(); } catch (_) {}
    });
    tabsEl.addEventListener('mouseleave', () => { zittita = null; puntatore = null; nascondi(); });
    // Se la barra si ridisegna mentre il puntatore esce, l'uscita può perdersi: basta essere altrove.
    document.addEventListener('mouseover', (e) => {
      if (aperta && !tabsEl.contains(e.target)) { zittita = null; nascondi(); }
    });
    document.documentElement.addEventListener('mouseleave', nascondi);
    tabsEl.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.tab[data-anteprima]');
      zittita = el ? el.dataset.anteprima : null;
      chiudi(e.button === 0 && !!el && el.dataset.anteprima === aperta && !e.target.closest('.close'));
    }, true);
    tabsEl.addEventListener('wheel', nascondi, { passive: true });
    tabsEl.addEventListener('contextmenu', nascondi, true);
    window.addEventListener('blur', nascondi);
    window.addEventListener('resize', nascondi);
    return { nascondi, ridisegnata, aperta: () => aperta };
  })();

  function activeTab() {
    return state.tabs.find((t) => t.id === state.activeId) || null;
  }

  // Riordino a mouse event, non col drag HTML5: quello è inaffidabile sopra le WebContentsView
  // e Playwright non lo prova. `moved` scatta oltre la soglia, o un clic sarebbe un drag.
  let drag = null; // { id, el, startX, moved }
  let suppressClickId = null; // id della tab il cui prossimo click va ignorato

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
    // Invariante: mai due .tab con lo stesso id. Se il nodo trascinato è stato orfanato da un
    // ridisegno, reinserirlo ne creerebbe un doppione: si riaggancia quello vivo.
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
    // Il riordino lo ridisegna il broadcast di api.tabs.move: ridisegnare prima rimetterebbe la scheda dov'era.
    ridisegnoRimandato = false;
    // Il click che segue il mouseup non deve riattivare/spostare la tab.
    suppressClickId = d.id;
    // La posizione si prende dall'IDENTITÀ del nodo, non dall'id: con un
    // doppione in barra, cercare per id darebbe la posizione sbagliata.
    const nodes = [...tabsEl.querySelectorAll('.tab')];
    let toIndex = nodes.indexOf(d.el);
    if (toIndex < 0) toIndex = nodes.map((x) => x.dataset.id).indexOf(d.id);
    if (toIndex >= 0) api.tabs.move(d.id, toIndex);
    // Una scheda trascinata nella striscia, per i contatori (#1471): dove è finita, mai quale.
    try {
      Promise.resolve(api.message({ type: 'contatori_evento', misura: 'gesto', gesto: 'trascinamento', da: 'scheda',
        a: toIndex >= 0 ? 'striscia_schede' : 'nessuna', esito: toIndex >= 0 ? 'posato' : 'annullato' })).catch(() => {});
    } catch (_) {}
  }

  // Un clic arriva solo se pressione e rilascio cadono sullo stesso nodo: se un aggiornamento ricrea la
  // striscia in mezzo, la X e il tasto centrale non chiudono niente. Col tasto giù si ridisegna al rilascio.
  let premutoSullaStriscia = false;
  let ridisegnoRimandato = false;

  function rilascioStriscia() {
    if (!premutoSullaStriscia) return;
    premutoSullaStriscia = false;
    // Dopo il click, che il browser consegna subito dopo il mouseup.
    setTimeout(() => {
      if (!ridisegnoRimandato || premutoSullaStriscia || drag) return;
      render();
    }, 0);
  }
  tabsEl.addEventListener('mousedown', () => { premutoSullaStriscia = true; }, true);
  window.addEventListener('mouseup', rilascioStriscia, true);
  window.addEventListener('blur', rilascioStriscia);

  function startTabDrag(e, t, el) {
    if (e.button !== 0) return;
    // Non iniziare un drag dai controlli interni (chiudi, indicatori audio…).
    if (e.target.closest('.close, .tab-alert, .proxy-ind')) return;
    drag = { id: t.id, el, startX: e.clientX, moved: false };
    window.addEventListener('mousemove', onTabPointerMove);
    window.addEventListener('mouseup', onTabPointerUp);
  }

  // ── Larghezze ferme dopo una chiusura (#428) ──────────────────────────────
  // Chiusa una scheda col puntatore sulla fila in alto, le altre tengono la
  // larghezza che avevano finché il puntatore non lascia la fila: fra schede
  // larghe uguali la X di quella che scorre al posto della chiusa resta sotto il puntatore.
  const tabRowEl = tabsEl.closest('.tab-row') || tabsEl;
  let larghezzeFerme = null; // Map id → px
  let strisciaFerma = 0; // px della striscia, solo se se n'è andata l'ultima scheda
  let puntatoreSullaFila = false;
  let sondaFila = null;
  let giroSonda = 0;
  // Anche la parte di ogni scheda non cambia sotto il puntatore: un titolo che cambia mentre il puntatore sta
  // sulla fila (una scheda dietro che finisce di caricare) aspetta che la lasci, o la scheda gli scappa (#429).
  let passoTrattenuto = false;
  const fermo = () => Boolean(larghezzeFerme) || passoTrattenuto;

  function sullaFila(x, y) {
    const r = tabRowEl.getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }

  function fermaSonda() {
    giroSonda++;
    if (sondaFila) { clearTimeout(sondaFila); sondaFila = null; }
  }

  function sciogliLarghezze() {
    fermaSonda();
    if (!larghezzeFerme) { if (passoTrattenuto) misuraLarghezzeChieste(); return; }
    larghezzeFerme = null;
    strisciaFerma = 0;
    tabsEl.style.flex = '';
    for (const el of tabsEl.querySelectorAll('.tab')) {
      el.style.flex = '';
      el.style.minWidth = '';
      el.style.maxWidth = '';
      el._firma = ''; // la larghezza ferma non c'è più: la prossima volta la scheda si ridisegna da capo
    }
    // Da ferme le schede hanno misurato la larghezza fermata: senza rimisurarle restano strette fino al prossimo ridisegno.
    misuraLarghezzeChieste();
  }

  // Sulla pagina, e su Windows sulle zone di trascinamento della finestra, la
  // barra non riceve eventi del mouse: chiede al main dove sta il puntatore.
  function sondaPuntatore() {
    fermaSonda();
    if (!fermo()) return;
    const giro = giroSonda;
    Promise.resolve(typeof api.puntatore === 'function' ? api.puntatore() : null).then((p) => {
      if (giro !== giroSonda || !fermo() || puntatoreSullaFila) return;
      if (p && sullaFila(p.x, p.y)) sondaFila = setTimeout(sondaPuntatore, 150);
      else sciogliLarghezze();
    }, () => { if (giro === giroSonda) sciogliLarghezze(); });
  }

  // Le schede sparite si leggono dal confronto fra due fotografie: così vale
  // per ogni strada di chiusura (X, clic centrale, Ctrl+W, menu, la pagina stessa).
  function fermaLarghezzeSeChiusa(snap) {
    const primaIds = (state.tabs || []).map((t) => String(t.id));
    const prima = new Set(primaIds);
    const dopo = new Set(((snap && snap.tabs) || []).map((t) => String(t.id)));
    if ([...dopo].some((id) => !prima.has(id))) { sciogliLarghezze(); return; }
    if (!puntatoreSullaFila || dopo.size >= prima.size) return;
    const m = new Map();
    for (const el of tabsEl.querySelectorAll('.tab')) {
      const w = el.getBoundingClientRect().width;
      if (w > 0) m.set(el.dataset.id, w);
    }
    if (!m.size) return;
    // Con le schede larghe quanto il nome, la X della scheda che scivola al posto della chiusa cade sotto il
    // puntatore solo se le si dà la larghezza della chiusa: così si chiudono più schede di fila (#428, #429).
    const chiuse = primaIds.filter((id) => !dopo.has(id));
    if (chiuse.length === 1) {
      const i = primaIds.indexOf(chiuse[0]);
      const subentra = primaIds.slice(i + 1).find((id) => dopo.has(id));
      if (subentra && m.has(chiuse[0]) && m.has(subentra)) m.set(subentra, m.get(chiuse[0]));
    }
    larghezzeFerme = m;
    // Se se ne va l'ultima, il + scivolerebbe sotto il puntatore e il clic
    // dopo aprirebbe una scheda: la striscia tiene la sua larghezza.
    strisciaFerma = dopo.has(primaIds[primaIds.length - 1]) ? 0 : tabsEl.getBoundingClientRect().width;
  }

  document.addEventListener('mousemove', (e) => {
    puntatoreSullaFila = sullaFila(e.clientX, e.clientY);
    if (puntatoreSullaFila) fermaSonda();
    else sciogliLarghezze();
  }, true);
  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget) return;
    puntatoreSullaFila = false;
    sondaPuntatore();
  }, true);
  window.addEventListener('resize', sciogliLarghezze);
  // Le larghezze dipendono dal posto della fila: si rifanno quando cambia la finestra o compare un indicatore.
  window.addEventListener('resize', () => { if (!larghezzeFerme) misuraLarghezzeChieste(); });
  try {
    new MutationObserver(() => { if (!larghezzeFerme) misuraLarghezzeChieste(); })
      .observe(tabRowEl, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  } catch (_) {}

  // ── Menu contestuale (tasto destro) su una tab ────────────────────────────
  // Riusa il popup-menu nativo della shell (sopra le WebContentsView). Le voci
  // portano `action` custom prefissate `tab-`; la scelta torna via onMenuAction
  // e si applica alla tab su cui si era aperto il menu (ctxTabId).
  const MUTE_IND_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6"/><path d="M21 9l-4 6"/></svg>';

  // Le schede che suonano si riconoscono a colpo d'occhio anche in secondo
  // piano, e l'icona muta al clic: stessa cosa della voce "Muta" nel menu.
  const AUDIO_IND_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>' +
    '<path d="M18.5 6a9 9 0 0 1 0 12"/></svg>';

  // Globo e codice paese: il tono è viaggio, non un lucchetto da antivirus.
  const PROXY_IND_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
    '<path d="M12 3a13.5 13.5 0 0 1 0 18"/><path d="M12 3a13.5 13.5 0 0 0 0 18"/></svg>';

  // Per il bagliore audio una cima bianca/nera/grigia non è il sito e si ripiega sul suo colore
  // (la scheda attiva invece resta della cima, D63). Soglia allineata a SN_TAB_COLOR.hasIdentity.
  function hasColorIdentity(rgbStr) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
    if (!m) return false;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return false;
    return Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) >= 24;
  }

  let ctxTabId = null;
  let ctxMenuPos = { x: 0, y: 0 };
  // Richiesto a ogni apertura: la configurazione può cambiare a Filo acceso.
  let ctxProxyStatus = null;
  let ctxGiro = 0;
  const senzaErrore = (fn) => { try { return Promise.resolve(fn()).catch(() => null); } catch (_) { return Promise.resolve(null); } };
  async function openTabContextMenu(t, x, y) {
    const mio = ++ctxGiro;
    ctxTabId = t.id;
    ctxMenuPos = { x: Math.round(x), y: Math.round(y) };
    // Le domande al main partono insieme: in fila, il menu aspettava la somma (#1090).
    const [proxy, permessi, impostazioni] = await Promise.all([
      senzaErrore(() => api.tabs.proxyStatus()),
      senzaErrore(() => (api.tabs.permessi ? api.tabs.permessi(t.id) : null)),
      senzaErrore(() => api.message({ type: 'get_settings' })),
    ]);
    // Un tasto destro più recente su un'altra scheda ha già il suo menu: questo arriverebbe dopo, con le voci sbagliate.
    if (mio !== ctxGiro) return;
    ctxProxyStatus = proxy;
    const entries = [
      { label: 'Duplica', icon: 'duplicate', action: 'tab-duplicate' },
      t.muted
        ? { label: 'Riattiva audio', icon: 'mute', action: 'tab-mute' }
        : { label: 'Muta', icon: 'sound', action: 'tab-mute' },
    ];
    // L'Aiuto spento (#841) non ha la sua voce.
    const ff = impostazioni && impostazioni.settings && impostazioni.settings.featureFlags;
    if (!(ff && ff.help === false)) entries.push({ label: 'Aiuto', icon: 'help', action: 'tab-help' });
    // "Apri da un altro paese" (proxy per-tab): solo se un endpoint è
    // configurato — una voce che non può funzionare non deve comparire.
    // Il click diretto usa il default (ultima location usata, altrimenti USA);
    // la freccia apre la lista paesi. Su tab già proxata: "Torna in Italia".
    if (ctxProxyStatus && ctxProxyStatus.configured) {
      if (t.proxy) {
        // "Cambia paese" c'è perché senza si dovrebbe prima tornare in Italia
        // e poi ripartire: un giro in più per niente.
        entries.push({ label: 'Cambia paese', icon: 'globe', action: 'tab-proxy-pick' });
        entries.push({ label: 'Torna in Italia', icon: 'globe', action: 'tab-proxy-clear' });
      } else {
        entries.push({
          label: 'Apri da un altro paese', icon: 'globe',
          action: 'tab-proxy-default', subAction: 'tab-proxy-pick',
        });
      }
    }
    // #754 — cosa ha fatto Filo col banner dei cookie di questo sito, e la strada per rivederlo.
    const ck = t.cookies;
    const cookieVoci = [];
    if (ck && ck.shown) {
      cookieVoci.push({ label: 'Rifiuta i cookie in automatico qui', icon: 'cookie', action: 'tab-cookies-auto' });
    } else if (ck && (ck.rejected || ck.hidden)) {
      if (ck.rejected) cookieVoci.push({ label: 'Cookie non necessari rifiutati', icon: 'cookie', disabled: true });
      if (ck.hidden) cookieVoci.push({ label: 'Banner dei cookie nascosto', icon: 'cookie', disabled: true });
      cookieVoci.push({ label: 'Mostra il banner dei cookie', icon: 'eye', action: 'tab-cookies-show' });
    }
    // #759 — con la privacy massima l'accesso al sito si perde alla chiusura, se non resta connesso.
    if (t.connesso) {
      cookieVoci.push(t.connesso.fidato
        ? { label: 'Non restare connesso', icon: 'key', action: 'tab-connesso-no' }
        : { label: 'Resta connesso qui', icon: 'key', action: 'tab-connesso-si' });
    }
    if (cookieVoci.length) entries.push({ type: 'separator' }, ...cookieVoci);
    // Un sì o un no dato nella domanda dei permessi si toglie da qui, per il sito della scheda.
    if (permessi && Array.isArray(permessi.scelte) && permessi.scelte.length) {
      entries.push({ label: 'Azzera i permessi del sito', icon: 'lock', action: 'tab-permessi-azzera' });
    }
    entries.push(
      { type: 'separator' },
      { label: 'Chiudi', icon: 'close', action: 'tab-close' },
    );
    api.popupMenu(entries, ctxMenuPos.x, ctxMenuPos.y);
  }

  // `sito`: la proposta dopo un accesso, che vale per il sito dove l'accesso è avvenuto anche se la scheda è andata altrove.
  async function restaConnesso(id, on, sito) {
    let r = null;
    try { r = await api.tabs.restaConnesso(id, on, sito); } catch (_) { r = null; }
    if (!r || !r.ok) return;
    // In Automatico l'accesso al sito resta comunque: la voce decide dei suoi contenuti incorporati in altri siti.
    const automatico = r.modo === 'default';
    // Un sito che tiene l'accesso in un archivio che non si sposta (chiavi crittografiche, WhatsApp Web): si rientra una volta.
    const rientra = r.rientra ? (r.fidato ? ' Rientra una volta: il sito tiene l\'accesso in un archivio che Filo non riesce a spostare.'
      : ' Per continuare devi rientrare: il sito tiene l\'accesso in un archivio che Filo non riesce a spostare.') : '';
    showToast((r.fidato
      ? (automatico ? `Resti connesso a ${r.nome} anche nei suoi contenuti dentro altri siti.`
        : `Resti connesso a ${r.nome} anche quando chiudi la scheda o riapri Filo.`)
      : (automatico ? `Dentro altri siti i contenuti di ${r.nome} tengono i cookie solo per la visita.`
        : `Su ${r.nome} l'accesso finisce qualche minuto dopo che ne chiudi l'ultima scheda.`)) + rientra, 'resta_connesso_scelta');
  }

  async function azzeraPermessi(id) {
    let r = null;
    try { r = await api.tabs.dimenticaPermessi(id); } catch (_) { r = null; }
    if (!r || !r.tolte) return;
    showToast(r.ricarica
      ? 'Permessi del sito azzerati: alla prossima richiesta Filo ti chiede di nuovo. Ricarica la pagina perché valga anche per quello che sta già usando.'
      : 'Permessi del sito azzerati: alla prossima richiesta Filo ti chiede di nuovo.', 'permessi_azzerati');
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
    avvisoErrore(msg, 'scheda_da_altro_paese');
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

  // Il canale è globale: qui si prendono solo le azioni `tab-…`.
  if (api.onMenuAction) {
    api.onMenuAction((action) => {
      const id = ctxTabId;
      if (!id) return;
      // Quale voce si sceglie (#1470); «Chiudi» lo conta la chiusura, e il paese scelto non esce.
      if (/^tab-/.test(action) && action !== 'tab-close' && !action.startsWith('tab-proxy-go:')) {
        try { Promise.resolve(api.message({ type: 'contatori_evento', misura: 'voce-menu-scheda', id: action })).catch(() => {}); } catch (_) {}
      }
      if (action === 'tab-duplicate') api.tabs.duplicate(id);
      else if (action === 'tab-mute') api.tabs.setMuted(id);
      else if (action === 'tab-help') api.tabs.help(id);
      else if (action === 'tab-close') api.tabs.close(id, 'tasto_destro_scheda');
      else if (action === 'tab-proxy-default') proxyTab(id);
      else if (action === 'tab-proxy-clear') api.tabs.clearProxy(id);
      else if (action === 'tab-proxy-pick') openProxyCountryMenu();
      else if (action === 'tab-cookies-show') api.tabs.cookieBanners(id, true);
      else if (action === 'tab-cookies-auto') api.tabs.cookieBanners(id, false);
      else if (action === 'tab-connesso-si') restaConnesso(id, true);
      else if (action === 'tab-connesso-no') restaConnesso(id, false);
      else if (action === 'tab-permessi-azzera') azzeraPermessi(id);
      else if (action.startsWith('tab-proxy-go:')) proxyTab(id, action.slice('tab-proxy-go:'.length));
    });
  }

  // La scheda è un contenitore e non dà alla striscia la larghezza del contenuto: la si misura con tutto in
  // vista. Regola unica (#429): finché la fila ha posto ogni scheda è larga quanto il suo contenuto e nessun
  // nome è tagliato; quando manca, si accorciano prima i nomi più lunghi, tutti allo stesso tetto. L'attiva
  // stacca di STACCO dalla scheda tipica dietro solo con lo spazio che avanza: un vuoto suo non taglia un nome altrui.
  // Nessuna scheda, attiva e stacco compresi, supera la larghezza massima del token `tab.larghezza` (#1493).
  const STACCO = 1.25;
  const STACCO_MAX = 1.8;
  const MIN_ATTIVA = 110;
  const MIN_SCHEDA = 40;
  let larghezzeInVigore = null; // { chiave, w: number[] }
  function larghezzaMassima() {
    const v = ThemeTokens ? parseInt(ThemeTokens.effectiveValue('tab.larghezza', tokenShell), 10) : NaN;
    return Number.isFinite(v) ? Math.max(MIN_ATTIVA, v) : Infinity;
  }
  function spazioDellaStriscia() {
    const spazio = tabRowEl.querySelector('.tab-drag-spacer');
    const sp = spazio ? spazio.getBoundingClientRect().width - (parseFloat(getComputedStyle(spazio).minWidth) || 0) : 0;
    const cs = getComputedStyle(tabsEl);
    return tabsEl.getBoundingClientRect().width + Math.max(0, sp) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }
  function larghezzeDistribuite(piene, ia, posto, massimo) {
    const naturali = piene.map((w) => Math.min(w, massimo));
    const dietro = naturali.filter((_, i) => i !== ia);
    const ordinate = [...dietro].sort((a, b) => a - b);
    const tipica = ordinate.length ? ordinate[Math.floor((ordinate.length - 1) / 2)] : 0;
    const attivaCon = (tetto) => Math.max(MIN_ATTIVA, Math.min(ia >= 0 ? naturali[ia] : 0, Math.ceil(tetto * STACCO_MAX)));
    const totale = (tetto) => dietro.reduce((s, w) => s + Math.max(MIN_SCHEDA, Math.min(w, tetto)), 0) + (ia >= 0 ? attivaCon(tetto) : 0);
    let tetto = Math.max(MIN_SCHEDA, ...naturali);
    if (totale(tetto) > posto) {
      let lo = MIN_SCHEDA, hi = tetto;
      for (let k = 0; k < 24 && hi - lo > 0.5; k++) { const m = (lo + hi) / 2; if (totale(m) > posto) hi = m; else lo = m; }
      // Intero: le larghezze chieste vanno in px interi, e un tetto con la virgola le arrotonderebbe oltre il posto
      // della fila, che le stringerebbe tutte in proporzione tagliando di un pixel anche il nome che ci stava (#429).
      tetto = Math.max(MIN_SCHEDA, Math.floor(lo));
    }
    const attiva = attivaCon(tetto);
    const stacco = Math.ceil(Math.min(tetto, tipica) * STACCO) - attiva;
    const avanzo = Math.floor(posto - totale(tetto));
    const conStacco = Math.min(massimo, attiva + Math.max(0, Math.min(stacco, avanzo)));
    return naturali.map((w, i) => (i === ia ? conStacco : Math.max(MIN_SCHEDA, Math.min(w, tetto))));
  }
  function misuraLarghezzeChieste() {
    const schede = [...tabsEl.children];
    if (!schede.length) return;
    const posto = spazioDellaStriscia();
    schede.forEach((el) => el.classList.add('misura'));
    const pad = getComputedStyle(schede[0]);
    const bordi = parseFloat(pad.paddingLeft) + parseFloat(pad.paddingRight);
    const naturali = schede.map((el) => Math.ceil(el.getBoundingClientRect().width));
    const ia = schede.findIndex((el) => el.classList.contains('active'));
    const misurate = larghezzeDistribuite(naturali, ia, posto, larghezzaMassima());
    const chiave = schede.map((el) => el.dataset.id).join(',') + '|' + ia;
    const tieni = puntatoreSullaFila && larghezzeInVigore && larghezzeInVigore.chiave === chiave;
    passoTrattenuto = Boolean(tieni) && misurate.some((w, i) => w !== larghezzeInVigore.w[i]);
    const w = tieni ? larghezzeInVigore.w : misurate;
    larghezzeInVigore = { chiave, w };
    // La striscia divide in proporzione solo lo spazio oltre il padding: crescita e misura si contano sul contenuto.
    schede.forEach((el, i) => {
      const contenuto = Math.max(1, Math.ceil(w[i] - bordi));
      el.style.setProperty('--tab-chiesta', `${contenuto}px`);
      el.style.setProperty('--tab-crescita', String(contenuto));
      el.classList.toggle('segni-stretti', w[i] < naturali[i]);
      el.classList.remove('misura');
    });
  }

  // La barra si riconcilia per id (#1089): un aggiornamento tocca solo le schede cambiate e i nodi restano gli
  // stessi, così bagliore audio e suggerimenti non ripartono; misure e scorrimento si rifanno solo quando servono.
  const schedeVive = new Map(); // id → .tab

  // Il main rispedisce un'icona solo quando cambia (`faviconUguale`): le altre si riprendono dall'ultimo snapshot.
  // Solo byte già scaricati dal main con la sessione della scheda: un indirizzo qui girerebbe nella sessione della barra (#1083).
  const iconeNote = new Map(); // id → { dato, giro }
  function conIcone(snap) {
    if (!snap || !Array.isArray(snap.tabs)) return snap;
    const vive = new Map();
    for (const t of snap.tabs) {
      const id = String(t.id);
      const prima = iconeNote.get(id);
      if (t.faviconUguale) t.favicon = prima ? prima.dato : '';
      const dato = /^data:image\//.test(t.favicon || '') ? t.favicon : '';
      vive.set(id, prima && prima.dato === dato ? prima : { dato, giro: (prima ? prima.giro : 0) + 1 });
    }
    iconeNote.clear();
    for (const [id, nota] of vive) iconeNote.set(id, nota);
    return snap;
  }
  const STILI_SCHEDA = ['--tab-active', '--tab-ink', '--tab-bg-eff', '--tab-bg-hover', '--tab-glow-color'];
  let firmaMisura = '';
  let attivaInVista = null;
  // Nel posto del titolo ci sta almeno una lettera coi puntini (2em), o il titolo non si mostra, puntini compresi: mai un
  // tratto di lettera, qualunque cosa gli stia accanto (#1293). Il posto resta, così chi gli sta dopo non si sposta.
  const titoliStretti = typeof ResizeObserver === 'function' ? new ResizeObserver((voci) => {
    for (const v of voci) {
      const largo = v.contentRect.width;
      const em = parseFloat(getComputedStyle(v.target).fontSize) || 13;
      v.target.classList.toggle('illeggibile', largo > 0 && largo < 2 * em);
    }
  }) : null;
  // Colori veri del tema: leggerli forza un ricalcolo degli stili, quindi si rileggono solo al cambio di tema.
  let coloriTema;
  function coloriDelTema() {
    if (coloriTema === undefined) {
      const bar = TabColor.resolveCssColor(document, 'var(--tab-bg)');
      const page = TabColor.resolveCssColor(document, 'var(--bg)');
      const fg = TabColor.resolveCssColor(document, 'var(--fg)');
      coloriTema = bar && page && fg ? { bar, page, fg } : null;
    }
    return coloriTema;
  }
  // Il colore salvato del sito ha la tinta piena: saturazione e luminosità dell'utente si applicano qui.
  function coloreDelSito(t) {
    const c = TabColor && t.identityColor ? TabColor.adaptIdentity(t.identityColor, tabColorParams) : null;
    return c ? TabColor.rgbCss(c) : null;
  }

  // Tutto ciò che si vede di una scheda: due descrizioni uguali disegnano la stessa scheda.
  function descriviScheda(t, tinte) {
    const attiva = t.id === state.activeId;
    const d = { attiva, classi: [], stili: {} };
    // Con l'anteprima accesa la carta dice già il titolo: il suggerimento di testo sarebbe un doppione.
    if (anteprimaSchede.enabled) d.anteprima = true;
    else d.tip = t.title || t.url || '';
    const ferma = larghezzeFerme && larghezzeFerme.get(String(t.id));
    if (ferma) d.ferma = ferma;
    // Tab attiva: sempre il colore della cima della pagina, anche bianca, mai il
    // marchio del sito (decisione D63). Inchiostro con la regola delle inattive.
    if (attiva && t.color) {
      d.stili['--tab-active'] = t.color;
      const c = TabColor ? coloriDelTema() : null;
      const ink = c && TabColor.readableInk([t.color], [c.fg, c.page]);
      if (ink) {
        d.classi.push('inked');
        d.stili['--tab-ink'] = TabColor.rgbCss(ink);
      }
    }
    // Tab INATTIVE: la tinta del sito mescolata col neutro della barra quanto
    // dice opacita_tab (tabColor.js). Passa da --tab-bg-eff, non da
    // `background`, perché l'hover del CSS si calcola sulla stessa variabile.
    if (!attiva && t.identityColor && tinte) {
      const bg = TabColor.inactiveTabBackground(t.identityColor, tinte.bar, tabColorParams);
      if (bg) {
        const { ink, hover } = TabColor.inkAndHover(bg, tinte.fg, tinte.page);
        d.classi.push('tinted', 'inked');
        d.stili['--tab-bg-eff'] = TabColor.rgbCss(bg);
        d.stili['--tab-bg-hover'] = TabColor.rgbCss(hover);
        d.stili['--tab-ink'] = TabColor.rgbCss(ink);
      }
    }
    // Audio in riproduzione: bagliore col colore identità della scheda, o l'accento Filo se non ce l'ha.
    const suona = t.audible && !t.muted;
    if (suona) {
      d.classi.push('audible');
      const glow = hasColorIdentity(t.color) ? t.color : coloreDelSito(t);
      if (glow) d.stili['--tab-glow-color'] = glow;
    }
    // Nella firma l'icona entra col suo numero di giro: un data: URL da centinaia di KB a ogni ridisegno bloccava la barra.
    const nota = iconeNote.get(String(t.id));
    d.icona = t.loading ? null : (nota && nota.dato ? nota.giro : '');
    d.paese = t.proxy && t.proxy.country ? String(t.proxy.country).toUpperCase() : '';
    d.titolo = tabLabel(t);
    d.audio = t.muted ? 'muta' : suona ? 'suona' : '';
    const pm = t.permessi;
    if (pm && ((pm.usati && pm.usati.length) || (pm.negati && pm.negati.length))) {
      d.permessi = { usati: [...(pm.usati || [])].sort(), negati: [...(pm.negati || [])].sort() };
    }
    return d;
  }

  // Il segno di cosa il sito della scheda ha avuto in questa pagina o si è visto negare (#586): icone piccole prima della
  // croce. Se lo usa ancora lo sa solo la pagina, e la pagina può mentire: le frasi dicono cosa ha avuto, non «adesso».
  const SEGNI_PERMESSI = {
    audio: ['mic', 'Ha avuto il microfono in questa pagina', 'Microfono negato'],
    video: ['camera', 'Ha avuto la fotocamera in questa pagina', 'Fotocamera negata'],
    posizione: ['location', 'Ha saputo dove ti trovi in questa pagina', 'Posizione negata'],
    schermo: ['windowFrame', 'Ha visto il tuo schermo in questa pagina', 'Schermo negato'],
    notifiche: ['bell', '', 'Notifiche negate'],
    appunti: ['clipboard', '', 'Appunti negati'],
    schermi: ['windowFrame', '', 'Schermi negati'],
    presenza: ['user', '', 'Presenza al computer negata'],
    strumenti: ['readAloud', '', 'Strumenti musicali negati'],
    rete: ['wifi', '', 'Rete locale negata'],
    file: ['pencil', '', 'Modifica dei file negata'],
  };
  // Il primo segno è il più delicato: sulla scheda più stretta del suo contenuto resta solo lui (shell.css), la frase li dice tutti.
  const PESO_SEGNO = ['schermo', 'video', 'audio', 'posizione'];
  const pesoSegno = (x) => { const i = PESO_SEGNO.indexOf(x); return i < 0 ? PESO_SEGNO.length : i; };
  function disegnaSegni(nodo, pm) {
    const frasi = [];
    nodo.replaceChildren();
    const usati = [...pm.usati].sort((a, b) => pesoSegno(a) - pesoSegno(b));
    for (const [parte, negato] of [...usati.map((x) => [x, false]), ...pm.negati.map((x) => [x, true])]) {
      const def = SEGNI_PERMESSI[parte];
      if (!def) continue;
      const i = document.createElement('span');
      i.className = negato ? 'segno negato' : 'segno';
      i.dataset.parte = parte;
      setIcon(i, def[0], 13);
      nodo.appendChild(i);
      frasi.push(negato ? def[2] : def[1]);
    }
    const tip = frasi.filter(Boolean).join(' · ');
    nodo.dataset.tip = tip;
    nodo.setAttribute('aria-label', tip);
  }

  function creaScheda(id) {
    const el = document.createElement('div');
    el.dataset.id = id;
    const ico = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'title';
    if (titoliStretti) titoliStretti.observe(title);
    const close = document.createElement('span');
    close.className = 'close';
    if (typeof ICONS.close === 'function') close.innerHTML = ICONS.close(12);
    else close.textContent = '×';
    el.append(ico, title, close);
    el._parti = { ico, title, close, paese: null, audio: null, permessi: null };
    return el;
  }

  function applicaScheda(el, d) {
    const id = el.dataset.id;
    const classi = ['tab', ...(d.attiva ? ['active'] : []), ...d.classi].join(' ');
    if (el.className !== classi) el.className = classi;
    if (d.anteprima) {
      el.dataset.anteprima = id;
      delete el.dataset.tip;
    } else {
      delete el.dataset.anteprima;
      el.dataset.tip = d.tip;
    }
    for (const p of STILI_SCHEDA) {
      if (d.stili[p]) el.style.setProperty(p, d.stili[p]);
      else el.style.removeProperty(p);
    }
    const ferma = d.ferma ? `${d.ferma}px` : '';
    el.style.flex = ferma ? `0 0 ${ferma}` : '';
    el.style.minWidth = ferma;
    el.style.maxWidth = ferma;

    const p = el._parti;
    // Un sito senza icona prende il globo, come nella home: il posto vuoto sembrava un'icona che non si è caricata.
    const senzaIcona = d.icona === '';
    p.ico.className = d.icona === null ? 'spinner' : senzaIcona ? 'favicon senza-icona' : 'favicon';
    const nota = d.icona ? iconeNote.get(id) : null;
    p.ico.style.backgroundImage = nota && nota.dato ? `url("${nota.dato}")` : '';
    p.ico.innerHTML = senzaIcona && typeof ICONS.globe === 'function' ? ICONS.globe(14) : '';

    // Indicatore "aperta da un altro paese": globo + codice paese accanto al
    // titolo, così si riconoscono a colpo d'occhio le tab instradate altrove.
    if (d.paese && !p.paese) {
      p.paese = document.createElement('span');
      p.paese.className = 'proxy-ind';
      p.paese.setAttribute('aria-label', 'Aperta da un altro paese');
      p.paese.dataset.tip = 'Aperta da un altro paese';
      p.paese.innerHTML = PROXY_IND_SVG + '<span class="cc"></span>';
      el.insertBefore(p.paese, p.title);
    } else if (!d.paese && p.paese) {
      p.paese.remove();
      p.paese = null;
    }
    if (p.paese) p.paese.querySelector('.cc').textContent = d.paese;

    if (p.title.textContent !== d.titolo) p.title.textContent = d.titolo;

    // Avviso audio dopo il titolo, come in Chrome (#431): suona o mutata stanno
    // nello stesso posto, così il clic che muta lascia lì il tasto per riattivare.
    if (d.audio && !p.audio) {
      p.audio = document.createElement('span');
      p.audio.setAttribute('role', 'button');
      el.insertBefore(p.audio, p.close);
    } else if (!d.audio && p.audio) {
      p.audio.remove();
      p.audio = null;
    }
    if (p.audio && p.audio.dataset.stato !== d.audio) {
      const muta = d.audio === 'muta';
      p.audio.dataset.stato = d.audio;
      p.audio.className = 'tab-alert ' + (muta ? 'mute-ind' : 'audio-ind');
      // Ogni controllo dentro la scheda porta il suo data-tip (mai `title`): senza, il suggerimento
      // di Filo risale a quello della scheda e dice il titolo della pagina (#431).
      p.audio.dataset.tip = muta ? 'Riattiva audio' : 'Silenzia';
      p.audio.setAttribute('aria-label', muta
        ? 'Audio mutato — clicca per riattivare'
        : 'Audio in riproduzione — clicca per silenziare');
      p.audio.innerHTML = muta ? MUTE_IND_SVG : AUDIO_IND_SVG;
    }

    if (d.permessi && !p.permessi) {
      p.permessi = document.createElement('span');
      p.permessi.className = 'tab-permessi';
      el.insertBefore(p.permessi, p.audio || p.close);
    } else if (!d.permessi && p.permessi) {
      p.permessi.remove();
      p.permessi = null;
    }
    if (p.permessi) disegnaSegni(p.permessi, d.permessi);

    // La scorciatoia chiude la scheda attiva: sulle altre la croce non la promette.
    p.close.dataset.tip = d.attiva ? `Chiudi scheda (${tasto('Ctrl+W')})` : 'Chiudi scheda';
  }

  // Prima si tolgono i nodi che non restano, poi si mettono in ordine: un nodo che resta non si stacca mai.
  function allineaSchede(nodi) {
    const tieni = new Set(nodi);
    for (const f of [...tabsEl.children]) if (!tieni.has(f)) f.remove();
    nodi.forEach((n, i) => { if (tabsEl.children[i] !== n) tabsEl.insertBefore(n, tabsEl.children[i] || null); });
  }

  // `forza`: tema, font o impostazioni cambiati, quindi colori e larghezze si rileggono anche a schede uguali.
  function render({ forza = false } = {}) {
    if (forza) { coloriTema = undefined; firmaMisura = ''; }
    // Durante una trascinata (già da armata, al mousedown) e col tasto giù sulla striscia non si ridisegna:
    // riordinare i nodi riporterebbe indietro la scheda trascinata. Il broadcast dopo il rilascio ridisegna.
    if (drag || premutoSullaStriscia) { ridisegnoRimandato = true; return; }
    ridisegnoRimandato = false;
    // opacita_tab 0 = nessun colore: la scheda resta identica a una senza favicon.
    const tinte = TabColor && tabColorParams && tabColorParams.opacita_tab > 0
      && state.tabs.some((t) => t.id !== state.activeId && t.identityColor) ? coloriDelTema() : null;

    let cambiata = false;
    const nodi = [];
    const visti = new Set();
    const perMisura = [];
    for (const t of state.tabs) {
      const id = String(t.id);
      visti.add(id);
      let el = schedeVive.get(id);
      if (!el) { el = creaScheda(id); schedeVive.set(id, el); }
      const d = descriviScheda(t, tinte);
      const firma = JSON.stringify(d);
      if (el._firma !== firma) {
        applicaScheda(el, d);
        el._firma = firma;
        cambiata = true;
      }
      // L'avviso audio non rimisura: la fila e il «+» restano fermi quando una scheda comincia o smette di suonare, e
      // l'avviso prende posto dal titolo finché la fila non si rimisura per altro (#431.2).
      perMisura.push([id, d.attiva, d.titolo, d.paese, d.ferma || 0, d.permessi || null]);
      nodi.push(el);
    }
    for (const [id, el] of [...schedeVive]) {
      if (visti.has(id)) continue;
      if (titoliStretti) titoliStretti.unobserve(el._parti.title);
      schedeVive.delete(id);
    }
    if (nodi.length !== tabsEl.children.length || nodi.some((n, i) => tabsEl.children[i] !== n)) {
      allineaSchede(nodi);
      cambiata = true;
    }

    const flex = larghezzeFerme && strisciaFerma ? `0 0 ${strisciaFerma}px` : '';
    const firma = JSON.stringify([perMisura, flex]);
    if (firma !== firmaMisura) {
      firmaMisura = firma;
      misuraLarghezzeChieste();
      cambiata = true;
    }
    if (tabsEl.style.flex !== flex) tabsEl.style.flex = flex;
    if (cambiata) { try { ANTEPRIMA.ridisegnata(); } catch (_) {} }

    // §6 — con la striscia scrollabile la scheda attiva resta in vista: si porta lì quando cambia, non a ogni
    // aggiornamento, o la rotellina che scorre la striscia verrebbe riportata indietro dal titolo di un'altra.
    const activeEl = state.activeId != null ? schedeVive.get(String(state.activeId)) : null;
    if (activeEl && attivaInVista !== activeEl) {
      attivaInVista = activeEl;
      try { activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (_) {}
    }

    // Non c'è un campo URL: l'indirizzo si scrive dalla home.
    const a = activeTab();
    backBtn.disabled = !(a && a.canBack);
    fwdBtn.disabled = !(a && a.canFwd);
    reloadBtn.disabled = !a;

    applyChrome(isHomeUrl(a ? a.url : null));
  }

  // Gli eventi delle schede stanno sulla striscia: valgono per ogni nodo, anche nato dopo, e leggono la
  // scheda di adesso, non quella del momento in cui il nodo è nato.
  function schedaDellEvento(e) {
    const el = e.target && e.target.closest ? e.target.closest('.tab') : null;
    if (!el || el.parentElement !== tabsEl) return null;
    const t = state.tabs.find((x) => String(x.id) === el.dataset.id);
    return t ? { el, t } : null;
  }
  tabsEl.addEventListener('contextmenu', (e) => {
    const s = schedaDellEvento(e);
    if (!s) return;
    e.preventDefault();
    openTabContextMenu(s.t, e.clientX, e.clientY);
  });
  tabsEl.addEventListener('mousedown', (e) => {
    const s = schedaDellEvento(e);
    if (s) startTabDrag(e, s.t, s.el);
  });
  tabsEl.addEventListener('click', (e) => {
    const s = schedaDellEvento(e);
    if (!s) return;
    if (e.target.closest('.close')) { api.tabs.close(s.t.id, 'pulsante_x'); return; }
    if (e.target.closest('.tab-alert')) { api.tabs.setMuted(s.t.id); return; }
    if (suppressClickId === s.t.id) { suppressClickId = null; return; }
    api.tabs.activate(s.t.id);
  });
  tabsEl.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const s = schedaDellEvento(e);
    if (s) api.tabs.close(s.t.id, 'clic_centrale');
  });
  // Un font che finisce di caricare cambia la larghezza dei nomi.
  try { document.fonts.addEventListener('loadingdone', () => { if (!larghezzeFerme) misuraLarghezzeChieste(); }); } catch (_) {}

  function displayUrl(url) {
    if (!url) return '';
    if (url.startsWith('filo://newtab/')) return '';
    return url;
  }

  // Il nome sulla scheda di una pagina interna è quello del TASTO che la apre, senza prefisso:
  // due nomi per la stessa cosa sono un modo di non farla trovare.
  const FILO_TAB_LABELS = {
    'newtab': 'Home',
    'options/options.html': 'Modelli',
    'options/altro.html': 'Altro',
    'security/security.html': 'Sicurezza',
    'preferences/preferences.html': 'Preferenze',
    'editor/editor.html': 'Editor',
    'feedback/feedback.html': 'Feedback',
    'history/history.html': 'Cronologia AI',
    'quaderno/quaderno.html': 'Memorie',
    'home/home.html': 'Aperti per dopo',
    'spellcheck/spellcheck.html': 'Correttore',
  };

  function stripFiloPrefix(title) {
    return String(title || '').replace(/^\s*Filo\s*[—–-]\s*/i, '').trim();
  }

  function tabLabel(t) {
    const url = t.url || '';
    if (url.startsWith('filo://')) {
      // Chiave = host + path senza slash iniziale: "filo://newtab/" → "newtab".
      const rest = url.slice('filo://'.length);
      const noQuery = rest.split(/[?#]/)[0];
      const key = noQuery.replace(/\/+$/, '');
      if (FILO_TAB_LABELS[key]) return FILO_TAB_LABELS[key];
      const host = key.split('/')[0];
      if (FILO_TAB_LABELS[host]) return FILO_TAB_LABELS[host];
      // Pagina interna non mappata: almeno via il prefisso.
      const clean = stripFiloPrefix(t.title);
      if (clean) return clean;
    }
    return t.title || displayUrl(t.url) || 'Nuova scheda';
  }

  // Senza scheda attiva vale "home", o la barra diventa irraggiungibile.
  function isHomeUrl(url) {
    return !url || url.startsWith('filo://newtab/');
  }

  // La barra indirizzi è sempre nascosta: navigazione, home, impostazioni, app e
  // profilo vivono nella barra laterale (#871). Resta solo la fila di tab, e la
  // WebContentsView risale a coprire lo spazio liberato.
  let chromeCompact = null;
  function applyChrome(_isHome) {
    const compact = true;
    if (compact === chromeCompact) return;
    chromeCompact = compact;
    document.documentElement.dataset.chromeCompact = '1';
    try { api.tabs.setChromeCompact?.(compact); } catch (_) {}
  }

  // §6 — la rotella verticale scorre la striscia in orizzontale, ma solo se
  // c'è davvero overflow: altrimenti si ruberebbe un gesto per niente.
  tabsEl.addEventListener('wheel', (e) => {
    if (tabsEl.scrollWidth <= tabsEl.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!delta) return;
    tabsEl.scrollLeft += delta;
    e.preventDefault();
  }, { passive: false });

  // #170.1 — notifiche impilate in basso a destra; durata 0 = resta finché non
  // la si chiude. È la base su cui passano tutti gli avvisi della shell.
  const NOTIFS = (() => {
    let host = null;
    // Tetto alle carte a schermo: una raffica non spinge le più vecchie fuori dalla finestra. Quelle oltre il tetto
    // non si buttano (#1477): aspettano dietro un «+N» che le mostra. Regole: patterns/stack-di-overlay-impilati-limita-il-numero-e-non-superare.md
    const MAX_STACK = 5;
    // «+N» aperto: tutte a schermo finché sono più del tetto.
    let aperta = false;
    // Col puntatore sopra la pila (lo dice la vista che la disegna) i tempi aspettano: regola in avvisiTempo.js.
    const tempi = window.SN_AVVISI.orologio();
    let seq = 0;
    // Il puntatore sopra la pila: le carte in vista in quel momento sono lette (#1470).
    let sopraOra = false;
    function hostEl() {
      if (!host) {
        host = document.getElementById('shell-notifs');
        if (!host) {
          host = document.createElement('div');
          host.id = 'shell-notifs';
          host.className = 'shell-notifs';
          document.body.appendChild(host);
        }
        new MutationObserver(rispecchia).observe(host, {
          childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ['class', 'data-closing', 'data-attesa'],
        });
      }
      return host;
    }
    // Questa pila è il modello e non si disegna (la coprirebbe la scheda): a schermo la disegna la
    // vista sopra la pagina (#588.5), che riceve a ogni cambio lo stato intero, tema compreso.
    const VAR_TEMA = ['--bg', '--fg', '--fg-soft', '--border', '--tab-active', '--accent', '--muted', '--font', '--radius', '--sn-motion', '--sn-ombra'];
    function rispecchia() {
      if (!host || !api.avvisi) return;
      const tutte = Array.from(host.querySelectorAll(':scope > .shell-notif'));
      const carte = tutte.filter((c) => c.dataset.attesa !== '1').map((c) => ({
        id: c.dataset.nid || '',
        testo: c.querySelector('.shell-notif-msg')?.textContent || '',
        azioni: Array.from(c.querySelectorAll('.shell-notif-action')).map((b) => b.textContent || ''),
        chiusa: c.dataset.closing === '1',
        indirizzo: c.dataset.indirizzo || '',
        // #588.8 — lo scaricamento che la carta porta con sé quando la si trascina.
        trascina: c.dataset.trascina || '',
      }));
      const altre = tutte.filter((c) => c.dataset.attesa === '1' && c.dataset.closing !== '1').length;
      const cs = getComputedStyle(document.documentElement);
      const vars = {};
      for (const k of VAR_TEMA) vars[k] = cs.getPropertyValue(k).trim();
      try { api.avvisi.stato({ carte, altre, aperta: aperta && vive().length > MAX_STACK, tema: { vars } }); } catch (_) {}
    }
    if (api.avvisi) {
      if (api.avvisi.onSopra) {
        api.avvisi.onSopra((dati) => {
          sopraOra = !!(dati && dati.sopra);
          tempi.ferma(sopraOra);
          if (sopraOra) for (const c of vive()) if (c.dataset.attesa !== '1') c._letta = true;
        });
      }
      api.avvisi.onAzione((dati) => {
        if (!host || !dati) return;
        const card = Array.from(host.children).find((c) => c.dataset.nid === String(dati.id));
        if (!card || card.dataset.closing === '1') return;
        const btn = dati.azione === 'chiudi'
          ? card.querySelector('.shell-notif-close')
          : card.querySelectorAll('.shell-notif-action')[Number(dati.azione)];
        if (btn) btn.click();
      });
      if (api.avvisi.onPila) api.avvisi.onPila((dati) => comandoPila(dati && dati.azione));
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rispecchia); } catch (_) {}
    }
    const vive = () => Array.from(hostEl().children).filter((c) => c.dataset.closing !== '1');
    // Oltre il tetto aspettano le più vecchie: fuori vista e col tempo fermo, che parte intero quando tocca a loro.
    function disponi() {
      const live = vive();
      if (live.length <= MAX_STACK) aperta = false;
      const nascoste = aperta ? 0 : live.length - MAX_STACK;
      live.forEach((c, i) => {
        const attesa = i < nascoste;
        if (attesa === (c.dataset.attesa === '1')) return;
        if (attesa) {
          c.dataset.attesa = '1';
          c._inAttesa = true;
          if (c._tempo) c._tempo.annulla();
          c._tempo = null;
        } else {
          delete c.dataset.attesa;
          if (sopraOra) c._letta = true;
          avviaTempo(c, c._durata);
        }
      });
    }
    function comandoPila(azione) {
      if (azione === 'apri' || azione === 'riduci') {
        aperta = azione === 'apri';
        disponi();
      } else if (azione === 'chiudi-tutti') {
        for (const c of vive()) dismiss(c, 'chiuse_tutte');
      }
    }
    function uscita(card) {
      const fn = card._alChiudere;
      card._alChiudere = null;
      if (typeof fn === 'function') { try { fn(); } catch (_) {} }
    }
    function avviaTempo(card, ms) {
      if (card._tempo) card._tempo.annulla();
      card._tempo = tempi.avvia(ms, () => dismiss(card, 'scaduta'));
    }
    // Come è uscita di scena (#1470): il tipo e l'esito, mai il testo né l'etichetta del pulsante.
    function contaUscita(card, esito) {
      try {
        Promise.resolve(api.message({
          type: 'contatori_evento', misura: 'notifica', tipo: card._tipo || '', esito, letta: !!card._letta, inAttesa: !!card._inAttesa,
        })).catch(() => {});
      } catch (_) {}
    }
    // `esito`: scaduta, chiusa_x, azione_N, chiuse_tutte, sostituita; senza, l'ha ritirata chi l'aveva mostrata.
    function dismiss(card, esito = 'ritirata') {
      if (!card || card.dataset.closing === '1') return;
      contaUscita(card, esito);
      card.dataset.closing = '1';
      if (card._tempo) card._tempo.annulla();
      card._tempo = null;
      uscita(card);
      card.classList.remove('show');
      disponi();
      // Pila vuota: nessuno ha più il puntatore sopra, anche se la vista sparendo non l'ha potuto dire.
      if (!vive().length) tempi.ferma(false);
      // attende la transizione prima di rimuovere dal DOM
      setTimeout(() => { try { card.remove(); } catch (_) {} }, ThemeTokens ? ThemeTokens.motionMs(220) : 220);
    }
    // Azioni opzionali (es. "Apri comunque" per i blocchi #170.3). Stanno prima della X.
    function azioni(card, actions) {
      const vecchia = card.querySelector('.shell-notif-actions');
      if (vecchia) vecchia.remove();
      if (!Array.isArray(actions) || !actions.length) return;
      const bar = document.createElement('div');
      bar.className = 'shell-notif-actions';
      let indice = 0;
      for (const a of actions) {
        if (!a || !a.label) continue;
        const esito = `azione_${indice++}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shell-notif-action';
        btn.textContent = a.label;
        btn.addEventListener('click', () => {
          // Il bottone resta sotto il puntatore mentre la notifica sparisce: un doppio clic
          // ripeterebbe l'azione (due schede da «Apri comunque»).
          if (card.dataset.closing === '1') return;
          try { a.onClick && a.onClick(); } catch (_) {}
          dismiss(card, esito);
        });
        bar.appendChild(btn);
      }
      card.insertBefore(bar, card.querySelector('.shell-notif-close'));
    }
    // showNotification(text, opts?) — opts: { durationSec, sound (toneId|false),
    // actions: [{ label, onClick }], unica, alChiudere }. Senza opts usa la config delle Preferenze.
    // `alChiudere`: chiamata una volta quando l'avviso esce di scena, in qualunque modo (X, tempo, azione, «Chiudi tutti»).
    // `unica`: finché una notifica con la stessa chiave è a schermo non ne nasce un'altra;
    // quella riparte da capo con le azioni nuove. Chiusa, la prossima ricompare subito.
    // `indirizzo`: il sito da cui nasce l'avviso; nel filo se ne va con le pagine di quel sito (#1561).
    function show(text, opts) {
      if (!text) return null;
      opts = opts || {};
      if (opts.key) dismissKey(opts.key, 'sostituita');
      // Una durata scelta da chi chiama vale per la durata standard: quella delle Preferenze la riporta in scala.
      const chiesta = opts.durationSec != null ? Number(opts.durationSec) : window.SN_AVVISI.STANDARD_SEC;
      const durata = window.SN_AVVISI.durata(Number.isFinite(chiesta) && chiesta >= 0 ? chiesta * 1000 : undefined, notifConfig.durationSec);

      const chiave = opts.unica ? String(opts.unica) : '';
      const gemella = chiave && Array.from(hostEl().children)
        .find((c) => c.dataset.unica === chiave && c.dataset.closing !== '1');
      if (gemella) {
        // Chi c'era è stata sostituita: la nuova riparte coi suoi segni.
        contaUscita(gemella, 'sostituita');
        gemella._tipo = typeof opts.tipo === 'string' ? opts.tipo : '';
        gemella._letta = sopraOra && gemella.dataset.attesa !== '1';
        gemella._inAttesa = false;
        if (gemella._alChiudere !== opts.alChiudere) uscita(gemella);
        gemella._alChiudere = typeof opts.alChiudere === 'function' ? opts.alChiudere : null;
        gemella.dataset.indirizzo = opts.indirizzo ? String(opts.indirizzo) : '';
        gemella.dataset.trascina = opts.trascinaDownloadId ? String(opts.trascinaDownloadId) : '';
        gemella.querySelector('.shell-notif-msg').textContent = text;
        azioni(gemella, opts.actions);
        gemella._durata = durata;
        // Rinnovata mentre aspettava dietro il «+N»: è la notizia più fresca, torna in vista in fondo.
        if (gemella.dataset.attesa === '1') { hostEl().appendChild(gemella); disponi(); }
        avviaTempo(gemella, durata);
        return gemella;
      }

      const card = document.createElement('div');
      card.className = 'shell-notif';
      card.dataset.nid = String(++seq);
      card._durata = durata;
      card._alChiudere = typeof opts.alChiudere === 'function' ? opts.alChiudere : null;
      card._tipo = typeof opts.tipo === 'string' ? opts.tipo : '';
      if (opts.key) card.dataset.key = String(opts.key);
      if (chiave) card.dataset.unica = chiave;
      if (opts.indirizzo) card.dataset.indirizzo = String(opts.indirizzo);
      if (opts.trascinaDownloadId) card.dataset.trascina = String(opts.trascinaDownloadId);

      const msg = document.createElement('div');
      msg.className = 'shell-notif-msg';
      msg.textContent = text;
      card.appendChild(msg);

      // La X compare sempre per le notifiche infinite; per quelle a tempo è
      // comunque utile poterle chiudere subito, quindi la mostriamo sempre.
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'shell-notif-close';
      close.setAttribute('aria-label', 'Chiudi notifica');
      close.textContent = '×';
      close.addEventListener('click', () => dismiss(card, 'chiusa_x'));
      card.appendChild(close);
      azioni(card, opts.actions);

      hostEl().appendChild(card);
      disponi();
      if (sopraOra && card.dataset.attesa !== '1') card._letta = true;
      // forza reflow così la transizione di entrata parte
      // eslint-disable-next-line no-unused-expressions
      card.offsetHeight;
      card.classList.add('show');

      const wantSound = opts.sound !== undefined
        ? opts.sound
        : (notifConfig.soundEnabled ? notifConfig.sound : false);
      if (wantSound && window.SN_SOUNDS) {
        try {
          const tono = typeof wantSound === 'string' ? wantSound : notifConfig.sound;
          window.SN_SOUNDS.play(tono, notifConfig.soundVolume);
        } catch (_) {}
      }

      avviaTempo(card, durata);
      return card;
    }
    // Un avviso con chiave dice uno stato: quando lo stato cambia se ne va.
    function dismissKey(key, esito = 'ritirata') {
      for (const c of hostEl().querySelectorAll('.shell-notif')) {
        if (c.dataset.key === String(key)) dismiss(c, esito);
      }
    }
    return { show, dismiss, dismissKey, rispecchia };
  })();

  // Anche il toast semplice passa di qui, o non rispetterebbe la durata scelta.
  // `tipo`: l'id della notifica per i contatori (#1470).
  function showToast(text, tipo) { return NOTIFS.show(text, tipo ? { tipo } : undefined); }

  // ── Aprire uno scaricamento: se il file non c'è più, DILLO ──────────────
  // Il main risponde { ok:false, missing:true, error } quando il percorso non
  // punta più a niente (file spostato, rinominato o cestinato dopo). Prima quella
  // risposta veniva buttata via e il clic non produceva nulla: il silenzio è
  // indistinguibile da un'app bloccata. Ora l'esito diventa un avviso, con la
  // cartella come via d'uscita (il file potrebbe essere lì rinominato).
  // `luogo`: 'notifica' dai pulsanti di un avviso; senza, il pannello (contatori #1470).
  function openDownloadFile(id, confirmed, luogo) {
    if (!api.downloads) return Promise.resolve();
    return api.downloads.openFile(id, confirmed, luogo).then((res) => {
      if (!res || res.ok !== false) return;
      // #588 — è un programma: aprirlo lo esegue. Il main non lo tocca finché
      // non torna un "sì" esplicito; la via di mezzo (guardare dov'è finito
      // senza eseguirlo) resta a un clic.
      // La domanda sta nella riga del pannello: un avviso in basso finirebbe
      // sotto la pagina, e il clic sembrerebbe non fare niente.
      if (res.needsConfirm && chiediApertura) { chiediApertura(id, res.parti); return; }
      const opts = res.missing
        ? { actions: [{ label: 'Apri cartella', onClick: () => openDownloadFolder(id, 'notifica') }] }
        : undefined;
      avvisoErrore(res.error || 'Non è stato possibile aprire il file', 'file_non_aperto', opts);
    }).catch(() => {});
  }
  function openDownloadFolder(id, luogo) {
    if (!api.downloads) return Promise.resolve();
    return api.downloads.openFolder(id, luogo).then((res) => {
      if (!res) return;
      if (res.ok === false) { avvisoErrore(res.error || 'Non è stato possibile aprire la cartella', 'cartella_non_aperta'); return; }
      if (res.missing) avvisoErrore('Il file non c’è più: ho aperto la cartella dov’era', 'file_non_aperto');
    }).catch(() => {});
  }

  // #1287 — «Riprova» da un avviso o da una riga: lo stesso indirizzo riparte nella stessa voce.
  function riprovaDownload(id) {
    if (!api.downloads || !api.downloads.riprova) return Promise.resolve();
    return api.downloads.riprova(id).then((res) => {
      if (res && res.ok === false) avvisoErrore(res.error || 'Non sono riuscito a far ripartire lo scaricamento', 'download_failed');
    }).catch(() => {});
  }

  // #588 — impostata dal pannello scaricamenti: porta lì la domanda «aprire un
  // programma?», dove la pagina non la copre.
  let chiediApertura = null;

  if (api.onSuona) api.onSuona((info) => {
    const S = window.SN_SOUNDS;
    if (!S || !info || !S.TONES[info.tono]) return;
    S.play(info.tono, info.volume);
  });

  if (api.onToast) api.onToast((info) => {
    if (info && typeof info.ritira === 'string') { NOTIFS.dismissKey(info.ritira); return; }
    if (!info || !info.text) return;
    let annullata = false;
    let allaChiusura = null;
    // Le azioni che arrivano dal main non possono trasportare funzioni: le
    // codifichiamo in modo dichiarativo e le traduciamo qui in onClick.
    // - openUrl → apri quel sito; con apriComunque scavalca la lista dei siti bloccati (#170.3).
    let opts = info.opts;
    if (opts && Array.isArray(opts.actions)) {
      opts = {
        ...opts,
        actions: opts.actions.map((a) => {
          if (a && a.openUrl && !a.onClick) {
            return { label: a.label, onClick: () => api.tabs.openBlockedPopup(a.openUrl, a.apriComunque === true) };
          }
          // #759 — la proposta dopo un accesso: «Resta connesso» su quel sito.
          if (a && typeof a.restaConnesso === 'string' && !a.onClick && api.tabs.restaConnesso) {
            const sito = a.restaConnesso;
            return { label: a.label, onClick: () => restaConnesso(null, true, sito) };
          }
          // F4 — la segnalazione automatica aspetta questo avviso (#784.6): Annulla la ferma, chiuderlo la fa partire.
          if (a && a.cancelAutoFeedback && !a.onClick) {
            const fbId = String(a.cancelAutoFeedback);
            const nonRitirata = (r) => NOTIFS.show((r && r.frase) || 'Non sono riuscito a ritirare la segnalazione', { tipo: 'segnalazione_non_ritirata' });
            allaChiusura = () => { if (!annullata) api.message({ type: 'auto_feedback_parti', id: fbId }).catch(() => {}); };
            return {
              label: a.label,
              onClick: () => {
                annullata = true;
                api.message({ type: 'cancel_auto_feedback', id: fbId })
                  .then((r) => { if (!r || r.ok === false) nonRitirata(r); }, () => nonRitirata(null));
              },
            };
          }
          // #975 — la proposta del menu del sito: «Sì» lo mette al primo posto su quel sito, «Annulla» lo toglie.
          if (a && a.menuDelSito && !a.onClick) {
            const { sito, attivo } = a.menuDelSito;
            return {
              label: a.label,
              onClick: () => api.message({ type: 'menu_del_sito_imposta', sito, attivo: attivo === true, avvisa: attivo === true }).catch(() => {}),
            };
          }
          // #843 — «Annulla» dopo aver spento o riacceso Filo su un sito: rimette i siti di quel cambio.
          if (a && a.filoSpento && !a.onClick) {
            const { siti, spento } = a.filoSpento;
            return {
              label: a.label,
              onClick: () => api.message({ type: 'filo_spento_imposta', siti: Array.isArray(siti) ? siti : [], spento: spento === true }).catch(() => {}),
            };
          }
          // #349 — «Riapri» dopo la pulizia delle schede: riporta quelle chiuse da quel giro.
          if (a && Number.isInteger(a.riapriPulizia) && !a.onClick) {
            const pulizia = a.riapriPulizia;
            return {
              label: a.label,
              onClick: () => api.message({ type: 'riapri_pulizia_schede', pulizia }).then((r) => {
                if (r && r.ok === false) NOTIFS.show('Quelle schede le ritrovi nel filo della home');
              }).catch(() => {}),
            };
          }
          // #1123 — «Collega»: l'accesso a Google in una scheda, come la voce del menu dell'account.
          if (a && a.collegaGoogle && !a.onClick) return { label: a.label, onClick: () => collegaGoogle() };
          // #1039 — «Riavvia e aggiorna»: se l'installatore non parte Filo resta aperto, e lo dice.
          if (a && a.aggiornaFilo && !a.onClick) {
            return {
              label: a.label,
              onClick: () => api.message({ type: 'aggiornamento_installa' }).then((res) => {
                if (res && res.ok === false) avvisoErrore(res.frase || 'Non sono riuscito ad avviare l’aggiornamento', 'aggiornamento_non_avviato');
              }).catch(() => {}),
            };
          }
          // #410.1 — toast di fine scaricamento: apri il file / mostra in cartella.
          if (a && a.openDownloadId && !a.onClick && api.downloads) {
            const id = a.openDownloadId;
            return { label: a.label, onClick: () => openDownloadFile(id, false, 'notifica') };
          }
          if (a && a.revealDownloadId && !a.onClick && api.downloads) {
            const id = a.revealDownloadId;
            return { label: a.label, onClick: () => openDownloadFolder(id, 'notifica') };
          }
          // #950 — il nome dato da solo a uno scaricamento: «Annulla» rimette quello con cui era arrivato.
          if (a && a.rimettiNomeDownloadId && !a.onClick && api.downloads && api.downloads.rimettiNome) {
            const id = a.rimettiNomeDownloadId;
            return {
              label: a.label,
              onClick: () => api.downloads.rimettiNome(id, 'notifica').then((r) => {
                if (r && r.ok) NOTIFS.show(r.cambiato ? `Il nome di prima era occupato: ora è «${r.nome}»` : `Nome di prima rimesso: ${r.nome}`, { tipo: 'nome_rimesso' });
                else avvisoErrore((r && r.frase) || 'Non sono riuscito a rimettere il nome di prima', 'nome_non_rimesso');
              }).catch(() => {}),
            };
          }
          // #1287 — lo scaricamento non riuscito riparte nella stessa voce.
          if (a && a.riprovaDownloadId && !a.onClick && api.downloads && api.downloads.riprova) {
            const id = a.riprovaDownloadId;
            return { label: a.label, onClick: () => riprovaDownload(id) };
          }
          // #906 — una pagina di Filo (i giudici fermi aprono Gestione): solo indirizzi filo://.
          if (a && typeof a.apriFilo === 'string' && !a.onClick && /^filo:\/\/[a-z0-9-]+\/\S*$/i.test(a.apriFilo)) {
            const url = a.apriFilo;
            return { label: a.label, onClick: () => api.tabs.open(url) };
          }
          // #1357.2 — il nome che Filo non ha saputo dare: la casella per scriverlo, nella pagina Download.
          if (a && a.rinominaDownloadId && !a.onClick) {
            const id = a.rinominaDownloadId;
            return { label: a.label, onClick: () => api.tabs.open(`filo://downloads/downloads.html?rinomina=${encodeURIComponent(id)}`) };
          }
          return a;
        }),
      };
      if (allaChiusura) opts.alChiudere = allaChiusura;
      // #588.8 — l'avviso di un file arrivato si trascina come il file: dove lo si lascia, arriva quello.
      const delFile = info.opts.actions.find((a) => a && typeof a.openDownloadId === 'string');
      if (delFile) opts.trascinaDownloadId = delFile.openDownloadId;
    }
    NOTIFS.show(info.text, opts);
  });
  window.filoNotify = (text, opts) => NOTIFS.show(text, opts);

  // Il sì di una domanda che la pagina fa comparire sotto il cursore si arma dopo ARMA_MS (scaricamenti, permessi):
  // patterns/una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md.
  const ARMA_MS = 1000;

  // Lo spazio sopra la pagina lo chiedono in più (scaricamenti, domande dei permessi): la pagina scende della somma.
  const riserveSopra = new Map();
  function riservaSopra(chi, px) {
    if (px > 0) riserveSopra.set(chi, px); else riserveSopra.delete(chi);
    let tot = 0;
    for (const v of riserveSopra.values()) tot += v;
    try { api.tabs.reserveTop && api.tabs.reserveTop(tot); } catch (_) {}
  }

  // ─── Scaricamenti della navigazione (#410.1) ───────────────────────────
  // Pannello dei singoli download, che si apre da solo quando c'è una domanda (#588): nella fila di tab non
  // c'è un tasto (#941), l'elenco sta nella home e nella pagina Download. reserveTop lo porta SOPRA la view
  // nativa della pagina, che altrimenti lo coprirebbe.
  if (api.downloads) {
    // id → record (lo schema pubblico definito nel main).
    const dls = new Map();
    let panelOpen = false;
    let panel = null;
    // #588 — le domande sui programmi sono righe del pannello, che si apre sopra
    // la pagina: la riga in attesa È «scaricarlo?», e qui stanno le «aprirlo?»
    // (id → testo) finché non si risponde. Gli esiti andati storti restano
    // nella riga che li ha chiesti (id → testo).
    const domandeApri = new Map();
    const avvisiRiga = new Map();
    // #1287 — { n, nome } mentre la finestra in incognito aspetta di sapere cosa fare degli scaricamenti in corso.
    let chiusura = null;
    // #588 — il «sì» di una domanda sui programmi non si dà col clic che l'ha
    // fatta comparire: la riga nasce dove la pagina ha appena mandato il
    // cursore, e un doppio clic risponderebbe senza leggerla. I pulsanti che
    // dicono sì si armano solo quando l'elenco è fermo da ARMA_MS.
    let elencoFermoDa = 0;
    let firmaElenco = '';
    let timerArma = null;

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
        case 'pending': return 'In attesa di conferma';
        default: return 'In corso';
      }
    }

    // Un elenco svuotato non lascia aperto un pannello che direbbe solo «Nessun download».
    function aggiornaPannello() {
      if (!dls.size) { if (panelOpen) closePanel(); return; }
      if (panelOpen) renderPanel();
    }

    function ensurePanel() {
      if (panel) return panel;
      panel = document.createElement('div');
      panel.className = 'dl-panel';
      panel.id = 'dl-panel';
      panel.hidden = true;
      // Un clic che arriva mentre un sì è ancora spento ricomincia l'attesa: una raffica non lo arma (#591, giro 20).
      panel.addEventListener('pointerdown', () => {
        if (panel.querySelector('.dl-row-btn:disabled')) elencoFermoDa = Date.now();
      }, true);
      const head = document.createElement('div');
      head.className = 'dl-panel-head';
      const title = document.createElement('span');
      title.className = 'dl-panel-title';
      title.textContent = 'Download';
      // Punto d'accesso alla pagina completa (cronologia + azioni per voce).
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'dl-panel-clear';
      allBtn.textContent = 'Vedi tutti';
      allBtn.title = 'Apri l’elenco completo dei download';
      allBtn.addEventListener('click', () => {
        api.tabs.open('filo://downloads/downloads.html');
        closePanel();
      });
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'dl-panel-clear';
      clearBtn.textContent = 'Svuota';
      clearBtn.title = 'Rimuovi i download conclusi';
      clearBtn.addEventListener('click', () => {
        api.downloads.clear().then((r) => { syncFromList(r && r.items); }).catch(() => {});
      });
      // Senza un tasto nella fila di tab (#941) questa è la strada per chiuderlo col mouse; chiudere non risponde.
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'dl-panel-close';
      closeBtn.id = 'dl-panel-close';
      closeBtn.dataset.tip = 'Chiudi';
      closeBtn.setAttribute('aria-label', 'Chiudi');
      setIcon(closeBtn, 'close', 13);
      closeBtn.addEventListener('click', () => closePanel());
      head.appendChild(title);
      head.appendChild(allBtn);
      head.appendChild(clearBtn);
      head.appendChild(closeBtn);
      panel.appendChild(head);
      const domandaChiusura = document.createElement('div');
      domandaChiusura.className = 'dl-chiusura';
      domandaChiusura.id = 'dl-chiusura';
      domandaChiusura.hidden = true;
      domandaChiusura.setAttribute('role', 'alertdialog');
      panel.appendChild(domandaChiusura);
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
      const all = Array.from(dls.values()).sort((a, b) => {
        // Le domande in cima, poi gli attivi, poi per data d'inizio decrescente.
        const rank = (r) => ((r.state === 'pending' || domandeApri.has(r.id)) ? 0 : (isActive(r) ? 1 : 2));
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return String(b.startedAt || '').localeCompare(String(a.startedAt || ''));
      });
      const firma = all.map((r) => `${r.id}:${r.state === 'pending' ? 'p' : ''}${domandeApri.has(r.id) ? 'a' : ''}`).join('|')
        + (chiusura ? `|chiusura:${chiusura.n}` : '');
      if (firma !== firmaElenco) { firmaElenco = firma; elencoFermoDa = Date.now(); }
      if (!all.length) {
        const empty = document.createElement('div');
        empty.className = 'dl-empty';
        empty.textContent = 'Nessun download';
        list.replaceChildren(empty);
      } else if (window.SN_RIGHE_VIVE) {
        window.SN_RIGHE_VIVE.riconcilia(list, all.map(renderRow), ':scope > .dl-row-actions');
      } else {
        list.replaceChildren(...all.map(renderRow));
      }
      disegnaChiusura();
      const manca = elencoFermoDa + ARMA_MS - Date.now();
      if (manca > 0 && !timerArma) {
        timerArma = setTimeout(() => { timerArma = null; if (panelOpen) renderPanel(); }, manca + 20);
      }
      // Il pannello ha cambiato altezza: aggiorna lo spazio riservato.
      if (panelOpen) reserveForPanel();
    }

    function renderRow(r) {
      const row = document.createElement('div');
      row.className = 'dl-row';
      row.dataset.state = r.state;
      row.dataset.id = r.id;
      // Il file non è più al suo posto: la riga lo dice PRIMA del clic (testo
      // attenuato) e non offre "Apri file", che non avrebbe niente da aprire.
      if (r.missing) row.dataset.missing = '1';

      const name = document.createElement('div');
      name.className = 'dl-row-name';
      // #588 — un programma si riconosce PRIMA di cliccare: la marca sta
      // accanto al nome, non dentro un'estensione che l'occhio non legge.
      if (r.exe) {
        const tag = document.createElement('span');
        tag.className = 'dl-row-tag';
        tag.textContent = 'Programma';
        name.appendChild(tag);
      }
      name.appendChild(document.createTextNode(r.filename || 'download'));
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
        const base = p != null
          ? `${p}% · ${fmtBytes(r.receivedBytes)} / ${fmtBytes(r.totalBytes)}`
          : `${fmtBytes(r.receivedBytes)} scaricati`;
        // #1287 — quanto va veloce e quanto manca, misurati dal main.
        let corsa = '';
        try { corsa = window.SN_SCARICAMENTI_AVANZAMENTO.velocitaEResto(r); } catch (_) {}
        meta.textContent = corsa ? `${base} · ${corsa}` : base;
      } else if (r.missing) {
        meta.textContent = `Non più sul disco · ${fmtBytes(r.totalBytes || r.receivedBytes)}`;
      } else if (r.state === 'pending') {
        // Da quale sito arriva è la cosa che fa decidere: sta nella riga, non
        // solo nell'avviso che l'utente può aver già chiuso.
        const da = provenienza(r);
        meta.textContent = da ? `${stateLabel(r)} · ${da}` : stateLabel(r);
      } else {
        meta.textContent = `${stateLabel(r)} · ${fmtBytes(r.totalBytes || r.receivedBytes)}`;
      }
      row.appendChild(meta);

      const apri = r.state === 'completed' && !r.missing ? domandeApri.get(r.id) : null;
      const domanda = r.state === 'pending' ? partiScarica(r) : apri;
      if (domanda) {
        row.dataset.chiede = '1';
        const ask = document.createElement('div');
        ask.className = 'dl-row-ask';
        riempiDomanda(ask, domanda);
        row.appendChild(ask);
      }
      if (avvisiRiga.has(r.id)) {
        const nota = document.createElement('div');
        nota.className = 'dl-row-note';
        nota.setAttribute('role', 'status');
        nota.textContent = avvisiRiga.get(r.id);
        row.appendChild(nota);
      }

      const actions = document.createElement('div');
      actions.className = 'dl-row-actions';
      const addBtn = (label, fn, dice) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dl-row-btn';
        b.textContent = label;
        if (dice === 'si' && Date.now() - elencoFermoDa < ARMA_MS) b.disabled = true;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      if (r.state === 'pending') {
        // Le stesse due risposte dell'avviso: chiuderlo non deve togliere la
        // possibilità di rispondere (#588).
        const rispondi = (allow) => api.downloads.confirm(r.id, allow).then((res) => {
          if (res && res.ok === false) avvisiRiga.set(r.id, res.error || 'Risposta non registrata');
          if (res && res.items) syncFromList(res.items);
          else if (panelOpen) renderPanel();
        }).catch(() => {});
        addBtn('Scarica', () => rispondi(true), 'si');
        addBtn('Non scaricare', () => rispondi(false));
      } else if (isActive(r)) {
        // Gli scaricamenti "a mano" (Salva immagine/video come…) non si mettono
        // in pausa: meglio nessun pulsante che uno che non fa niente.
        if (r.canPause !== false) {
          if (r.state === 'paused') addBtn('Riprendi', () => api.downloads.resume(r.id).catch(() => {}));
          else addBtn('Pausa', () => api.downloads.pause(r.id).catch(() => {}));
        }
        addBtn('Annulla', () => api.downloads.cancel(r.id).catch(() => {}));
      } else if (apri) {
        const rispondi = (fn) => { domandeApri.delete(r.id); if (fn) fn(); renderPanel(); };
        addBtn('Apri comunque', () => rispondi(() => openDownloadFile(r.id, true)), 'si');
        addBtn('Apri cartella', () => rispondi(() => openDownloadFolder(r.id)));
        addBtn('Annulla', () => rispondi(null));
      } else if (r.state === 'completed') {
        if (!r.missing) addBtn('Apri file', () => openDownloadFile(r.id));
        addBtn('Apri cartella', () => openDownloadFolder(r.id));
        addBtn('Rimuovi', () => api.downloads.remove(r.id).then((res) => syncFromList(res && res.items)).catch(() => {}));
      } else {
        if (r.state === 'interrupted' && /^https?:/i.test(String(r.url || ''))) addBtn('Riprova', () => riprovaDownload(r.id));
        addBtn('Rimuovi', () => api.downloads.remove(r.id).then((res) => syncFromList(res && res.items)).catch(() => {}));
      }
      row.appendChild(actions);
      // #588.8 — un file arrivato si trascina dalla sua riga: sul campo per caricare file di un sito, nella chat.
      if (r.state === 'completed' && !r.missing && api.downloads.trascina) {
        row.draggable = true;
        row.dataset.trascina = '1';
        row.addEventListener('dragstart', (e) => {
          e.preventDefault();
          api.downloads.trascina(r.id).then((res) => {
            if (res && res.ok === false && res.error) { avvisiRiga.set(r.id, res.error); if (panelOpen) renderPanel(); }
          }).catch(() => {});
        });
      }
      if (r.state === 'completed' && !apri) {
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); apriMenuRiga(r); });
        if (menuRiga.id === r.id && menuRiga.voci.length) {
          row.classList.add('dl-row-con-menu');
          row.appendChild(costruisciMenuRiga(r));
        }
      }
      return row;
    }

    // #950 — il tasto destro su un file del pannello: le azioni della pagina Scaricamenti, compreso il nome
    // sensato. Il menu si apre DENTRO la riga: fuori dal pannello lo coprirebbe la pagina, che sta sopra la barra.
    // «Dai un nome sensato» porta alla pagina col riquadro aperto: nel pannello non c'è posto per casella ed esito.
    const menuRiga = { id: '', voci: [] };
    function chiudiMenuRiga() {
      if (!menuRiga.id) return;
      menuRiga.id = '';
      menuRiga.voci = [];
      if (panelOpen) renderPanel();
    }
    async function apriMenuRiga(riga) {
      // La riga resta in pagina mentre il record cambia (nome nuovo, file sparito): conta quello di adesso.
      const r = dls.get(riga.id) || riga;
      const voci = [];
      if (!r.missing) voci.push(['Apri file', () => openDownloadFile(r.id)]);
      voci.push(['Apri cartella', () => openDownloadFolder(r.id)]);
      const N = window.SN_NOMI_FILE;
      if (!r.missing && !r.exe && N && N.tipoDi(r.filename)) {
        let disp = false;
        try { disp = !!((await api.message({ type: 'file_nome_stato' })) || {}).disponibile; } catch (_) { disp = false; }
        if (disp) {
          voci.push(['Dai un nome sensato', () => {
            api.tabs.open(`filo://downloads/downloads.html?rinomina=${encodeURIComponent(r.id)}`);
            closePanel();
          }]);
        }
      }
      if (!r.missing && r.nomeOriginale) {
        voci.push(['Rimetti il nome di prima', () => api.downloads.rimettiNome(r.id).then((res) => {
          avvisiRiga.set(r.id, res && res.ok
            ? (res.cambiato ? `Il nome di prima era occupato: ora è «${res.nome}»` : `Nome di prima rimesso: ${res.nome}`)
            : ((res && res.frase) || 'Non sono riuscito a rimettere il nome di prima'));
          if (panelOpen) renderPanel();
        }).catch(() => {})]);
      }
      voci.push(['Rimuovi', () => api.downloads.remove(r.id).then((res) => syncFromList(res && res.items)).catch(() => {})]);
      menuRiga.id = r.id;
      menuRiga.voci = voci;
      if (panelOpen) renderPanel();
      const primo = panel && panel.querySelector('.dl-row-menu-voce');
      if (primo) try { primo.focus({ preventScroll: false }); } catch (_) {}
    }
    function costruisciMenuRiga() {
      const m = document.createElement('div');
      m.className = 'dl-row-menu';
      m.setAttribute('role', 'menu');
      for (const [label, fn] of menuRiga.voci) {
        const v = document.createElement('div');
        v.className = 'dl-row-menu-voce';
        v.setAttribute('role', 'menuitem');
        v.tabIndex = 0;
        v.textContent = label;
        const scegli = () => { chiudiMenuRiga(); fn(); };
        v.addEventListener('click', (e) => { e.stopPropagation(); scegli(); });
        v.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scegli(); }
        });
        m.appendChild(v);
      }
      return m;
    }
    document.addEventListener('mousedown', (e) => {
      if (menuRiga.id && !(e.target.closest && e.target.closest('.dl-row-menu'))) chiudiMenuRiga();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuRiga.id) { e.stopImmediatePropagation(); chiudiMenuRiga(); }
    }, true);

    // reserveTop = altezza del pannello (capped) così la view della pagina
    // scende e il pannello non finisce sotto di essa. Vedi setTopInset in tabs.js.
    function reserveForPanel() {
      if (!panelOpen || !panel) return;
      requestAnimationFrame(() => {
        const h = Math.ceil(panel.getBoundingClientRect().height);
        riservaSopra('scaricamenti', h + 6);
      });
    }
    function openPanel() {
      ensurePanel();
      panelOpen = true;
      panel.hidden = false;
      renderPanel();
      reserveForPanel();
      // Un file può sparire dal disco a pannello chiuso e nessun evento lo
      // annuncia: la lista si rilegge all'apertura, non dopo un clic a vuoto.
      api.downloads.list().then((r) => { syncFromList(r && r.items); }).catch(() => {});
    }
    function closePanel() {
      panelOpen = false;
      // Chiuso il pannello senza rispondere, la finestra in incognito resta aperta.
      chiusura = null;
      // Chiudere il pannello è non rispondere: «aprirlo?» si ritira, mentre un programma in attesa resta in
      // attesa, e la risposta si dà dalla pagina Download o dalla carta della home.
      domandeApri.clear();
      avvisiRiga.clear();
      firmaElenco = '';
      if (panel) panel.hidden = true;
      riservaSopra('scaricamenti', 0);
    }

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); });
    window.addEventListener('resize', () => { if (panelOpen) reserveForPanel(); });

    function syncFromList(items) {
      dls.clear();
      if (Array.isArray(items)) for (const r of items) dls.set(r.id, r);
      for (const id of Array.from(domandeApri.keys())) {
        if (dls.get(id)?.state !== 'completed') domandeApri.delete(id);
      }
      aggiornaPannello();
      if (panelOpen) renderPanel();
    }

    // #1287 (D51) — la finestra in incognito si sta chiudendo con scaricamenti in corso: la domanda sta in cima al
    // pannello, sopra la pagina. Le due risposte chiudono la finestra; chiudere il pannello la lascia aperta.
    function disegnaChiusura() {
      const el = panel && panel.querySelector('#dl-chiusura');
      if (!el) return;
      if (!chiusura) { el.hidden = true; el.replaceChildren(); return; }
      const testo = document.createElement('div');
      testo.className = 'dl-chiusura-testo';
      if (chiusura.n === 1) {
        testo.append('Chiudo la finestra, ma ');
        const nome = document.createElement('span');
        nome.className = 'dl-chiusura-nome';
        nome.textContent = `«${chiusura.nome}»`;
        testo.append(nome, ' non ha finito di scaricarsi: lo lascio finire?');
      } else {
        testo.textContent = `Chiudo la finestra, ma ${chiusura.n} scaricamenti non sono finiti: li lascio finire?`;
      }
      const azioni = document.createElement('div');
      azioni.className = 'dl-row-actions';
      const spento = Date.now() - elencoFermoDa < ARMA_MS;
      for (const [etichetta, scelta, nota] of [
        ['Lascia finire', 'finire', 'Chiude la finestra: il file arriva lo stesso nella cartella Download'],
        ['Annulla', 'annulla', 'Ferma lo scaricamento e chiude la finestra'],
      ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dl-row-btn';
        b.textContent = etichetta;
        b.dataset.scelta = scelta;
        b.title = nota;
        b.disabled = spento;
        b.addEventListener('click', () => {
          api.downloads.chiusura(scelta).then((res) => {
            if (res && res.ok === false) { chiusura = null; if (panelOpen) renderPanel(); }
          }).catch(() => {});
        });
        azioni.appendChild(b);
      }
      el.replaceChildren(testo, azioni);
      el.hidden = false;
    }
    function chiediChiusura(items) {
      const vive = (Array.isArray(items) ? items : []).filter((r) => r && r.id);
      if (!vive.length) return;
      for (const r of vive) dls.set(r.id, r);
      chiusura = { n: vive.length, nome: vive[0].filename || 'download' };
      if (panelOpen) renderPanel(); else openPanel();
    }

    // Aggiornamenti live dal main (start/progress/done/error/removed).
    api.downloads.onEvent((info) => {
      if (info && info.kind === 'chiusura') { chiediChiusura(info.items); return; }
      if (!info || !info.item) return;
      if (info.kind === 'removed') dls.delete(info.item.id);
      else dls.set(info.item.id, info.item);
      if (info.item.state !== 'completed' || info.kind === 'removed') domandeApri.delete(info.item.id);
      aggiornaPannello();
      // Il main manda 'ask' solo alla finestra da cui parte lo scaricamento.
      if (info.kind === 'ask') mostraRiga(info.item.id);
      else if (panelOpen) renderPanel();
    });

    function provenienza(r) {
      try { return window.SN_ESEGUIBILI.provenienza(r.site, r.siteUncertain, r.servedBy, r.filename); } catch (_) {}
      return r.site ? `da ${r.site}` : '';
    }

    // Le domande sui programmi a pezzi: il nome lo sceglie il sito, e fra le parole di Filo potrebbe chiudere le
    // virgolette e continuare con la sua voce. Sta in un riquadro suo, come nei popup di conferma (#592.7).
    function partiScarica(r) {
      try { return window.SN_ESEGUIBILI.partiScarica(r.filename, r.site, r.siteUncertain, r.servedBy); } catch (_) {}
      return ['Il file', { citazione: String(r.filename || '') }, 'è un programma. Scaricarlo?'];
    }

    function riempiDomanda(el, parti) {
      for (const p of parti) {
        if (typeof p === 'string') {
          if (!p.trim()) continue;
          const t = document.createElement('div');
          t.textContent = p.trim();
          el.appendChild(t);
        } else if (p && typeof p === 'object' && p.citazione != null) {
          const q = document.createElement('div');
          q.className = 'dl-row-ask-nome';
          q.textContent = String(p.citazione);
          el.appendChild(q);
        }
      }
    }

    // Apre il pannello (che fa spazio sopra la pagina) e porta in vista la riga.
    function mostraRiga(id) {
      if (panelOpen) renderPanel(); else openPanel();
      requestAnimationFrame(() => {
        const row = panel && Array.from(panel.querySelectorAll('.dl-row')).find((x) => x.dataset.id === id);
        try { row && row.scrollIntoView({ block: 'nearest' }); } catch (_) {}
      });
    }

    chiediApertura = (id, parti) => {
      const r = dls.get(id);
      let d = Array.isArray(parti) && parti.length ? parti : null;
      if (!d && r) { try { d = window.SN_ESEGUIBILI.partiApri(r.filename, r.site, r.siteUncertain, r.servedBy); } catch (_) {} }
      domandeApri.set(id, d || ['È un programma: aprirlo vuol dire eseguirlo.']);
      mostraRiga(id);
    };

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

  window.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 't') {
      e.preventDefault();
      // Con Shift riapre l'ultima scheda chiusa, come in ogni browser (#1476); tenuto premuto non svuota l'archivio.
      if (e.shiftKey) { if (!e.repeat) api.tabs.riapriChiusa(); } else api.tabs.open('filo://newtab/');
    } else if (meta && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      const a = activeTab(); if (a) api.tabs.close(a.id, 'ctrl_w');
    } else if (meta && e.key.toLowerCase() === 'l') {
      // L'indirizzo si digita dalla home: la stessa porta del tasto premuto in una pagina.
      e.preventDefault();
      const a = activeTab();
      if (a) api.tabs.scriviIndirizzo(a.id);
      else api.tabs.open('filo://newtab/');
    } else if (meta && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      const a = activeTab(); if (a) api.tabs.reload(a.id);
    } else {
      // Salto alla N-esima scheda, o alla vicina con Ctrl+Tab, col fuoco sulla barra (per le pagine ci pensa il main). La
      // combinazione la decide src/shared/tasti.js: regola in CLAUDE.md § Mac.
      const schede = state.tabs || [];
      let idx = TASTI ? TASTI.indiceSaltoScheda(e, undefined, schede.length) : null;
      if (idx == null && TASTI) idx = TASTI.indiceSchedaVicina(e, schede.findIndex((t) => t.id === state.activeId), schede.length);
      if (idx != null) {
        e.preventDefault();
        const tab = schede[idx];
        if (tab) api.tabs.activate(tab.id);
      }
    }
  });

  api.tabs.onUpdate((snap) => {
    fermaLarghezzeSeChiusa(snap);
    state = conIcone(snap);
    render();
  });
  api.tabs.snapshot().then((snap) => { state = conIcone(snap); render(); });

  // Il box feedback vive sulla pagina e da lì oscura solo la pagina: la barra la deve oscurare
  // la shell, o l'app resta a metà in penombra. Il velo intercetta anche i clic.
  if (api.onFeedbackDim) {
    let dimTabId = null;

    // Si disegna anche sulla barra, o l'annotazione coprirebbe solo mezza app.
    // Tratti identici a quelli della pagina: è lo stesso disegno.
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
      // "Cancella disegno" sulla pagina deve cancellare anche qui.
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
    // Cambiando scheda a box aperto, il content script di quella pagina non
    // riceve più eventi e la penombra resterebbe: la togliamo noi.
    api.tabs.onUpdate((snap) => {
      if (document.documentElement.dataset.feedbackDim && snap && snap.activeId !== dimTabId) {
        setDim(false);
      }
    });
  }

  // ─── Popup bloccato ────────────────────────────────────────────────────
  // Il main blocca un window.open() non richiesto e manda { tabId, url, host }: è un avviso della
  // pila in basso a destra, con «Apri» per aprirlo comunque (la chip sotto la barra la copriva la scheda).
  if (api.tabs.onPopupBlocked) {
    // Una pagina che riprova di continuo ha un avviso solo: i tentativi lo aggiornano senza allungarlo, e chiuso
    // dall'utente tace finché la scheda resta su quella pagina (#737.1 giro 3). Scaduto da solo torna dopo una pausa
    // dei tentativi: un blocco isolato si vede sempre, la catena no (giro 9). Una voce per scheda.
    const popupAvvisati = new Map();
    const PAUSA_POPUP_MS = 10000;
    api.tabs.onPopupBlocked((info) => {
      if (!info || !info.url) return;
      const { tabId } = info;
      const pagina = String(info.pagina || '');
      const da = info.host || '?';
      const testo = info.app === 'mailto' ? `Bloccata la posta aperta da ${da}`
        : info.app === 'tel' ? `Bloccata la chiamata avviata da ${da}`
          : info.app === 'sms' ? `Bloccato l'SMS aperto da ${da}`
            : `Bloccato popup da ${da}`;
      const ora = Date.now();
      const prima = popupAvvisati.get(tabId);
      if (prima && prima.pagina === pagina) {
        const dopoUnaPausa = ora - prima.ultimo >= PAUSA_POPUP_MS;
        prima.ultimo = ora;
        if (prima.carta && prima.carta.isConnected && prima.carta.dataset.closing !== '1') {
          prima.url = info.url;
          const msg = prima.carta.querySelector('.shell-notif-msg');
          if (msg && msg.textContent !== testo) msg.textContent = testo;
          return;
        }
        if (prima.chiusa || !dopoUnaPausa) return;
      }
      const voce = { pagina, url: info.url, carta: null, ultimo: ora, chiusa: false };
      popupAvvisati.set(tabId, voce);
      voce.carta = NOTIFS.show(testo, {
        durationSec: 8,
        tipo: 'popup_bloccato',
        actions: [{ label: 'Apri', onClick: () => { try { api.tabs.openBlockedPopup(voce.url, false, tabId); } catch (_) {} } }],
      });
      const x = voce.carta && voce.carta.querySelector('.shell-notif-close');
      if (x) x.addEventListener('click', () => { voce.chiusa = true; });
    });
    if (api.tabs.onUpdate) {
      api.tabs.onUpdate((snap) => {
        const vive = new Set(((snap && snap.tabs) || []).map((t) => t && t.id));
        for (const id of popupAvvisati.keys()) if (!vive.has(id)) popupAvvisati.delete(id);
      });
    }
  }

  // ─── Domande dei permessi (#591.1) ──────────────────────────────────────
  // Microfono, fotocamera, appunti, posizione: la pagina chiede, risponde l'utente qui, nella cornice, dove la pagina
  // non la copre e non la può imitare. Si vede solo la domanda della scheda in primo piano; le altre aspettano il loro turno.
  if (api.tabs.onPermesso && api.tabs.rispondiPermesso) {
    const domande = [];
    let bar = null;
    let mostrata = null;
    let attiva = null;

    let timerArma = null;

    const COSA = (d) => {
      if (d.tipo === 'appunti') return { testo: 'vuole leggere quello che hai copiato', icone: ['clipboard'] };
      if (d.tipo === 'posizione') return { testo: 'vuole sapere dove ti trovi', icone: ['location'] };
      if (d.tipo === 'notifiche') return { testo: 'vuole mandarti notifiche', icone: ['bell'] };
      if (d.tipo === 'schermi') return { testo: 'vuole usare tutti i tuoi schermi', icone: ['windowFrame'] };
      if (d.tipo === 'schermo') return { testo: 'vuole vedere il tuo schermo', icone: ['windowFrame'] };
      if (d.tipo === 'presenza') return { testo: 'vuole sapere quando sei al computer', icone: ['user'] };
      if (d.tipo === 'strumenti') return { testo: 'vuole comandare gli strumenti musicali collegati', icone: ['readAloud'] };
      if (d.tipo === 'rete') return { testo: 'vuole collegarsi agli apparecchi della tua rete', icone: ['wifi'] };
      if (d.tipo === 'file') {
        const o = d.oggetto || {};
        const nome = String(o.nome || '');
        if (!nome) return { testo: 'vuole modificare i tuoi file', icone: ['pencil'] };
        if (o.cartella) return { testo: 'vuole creare, modificare e cancellare file in', nome, percorso: o.percorso, icone: ['folder'] };
        return { testo: 'vuole modificare', nome, percorso: o.percorso, icone: ['pencil'] };
      }
      const parti = Array.isArray(d.parti) ? d.parti : [];
      const mic = parti.includes('audio');
      const cam = parti.includes('video');
      if (mic && cam) return { testo: 'vuole usare microfono e fotocamera', icone: ['mic', 'camera'] };
      if (cam) return { testo: 'vuole usare la fotocamera', icone: ['camera'] };
      return { testo: 'vuole usare il microfono', icone: ['mic'] };
    };

    const ensureBar = () => {
      if (bar) return bar;
      bar = document.createElement('div');
      bar.id = 'permesso-bar';
      bar.className = 'permesso-bar';
      bar.hidden = true;
      document.body.appendChild(bar);
      return bar;
    };

    const rispondiA = (d, si, fonte) => {
      const i = domande.indexOf(d);
      if (i >= 0) domande.splice(i, 1);
      api.tabs.rispondiPermesso(d.id, si, fonte).catch(() => {});
      mostraDomanda();
    };

    const creaConsenti = (d) => {
      const si = document.createElement('button');
      si.type = 'button';
      si.className = 'permesso-btn permesso-si';
      si.textContent = 'Consenti';
      si.addEventListener('click', () => rispondiA(d, true));
      return si;
    };

    const fontiDelloSchermo = (d) => (Array.isArray(d.fonti) ? d.fonti : []).map((f) => {
      const bt = document.createElement('button');
      bt.type = 'button';
      bt.className = 'permesso-btn permesso-fonte';
      bt.dataset.tipo = String(f.tipo || '');
      const nome = f.questa ? 'Questa scheda' : String(f.nome || '');
      bt.dataset.tip = nome;
      const vista = document.createElement('span');
      vista.className = 'permesso-fonte-vista';
      if (typeof f.anteprima === 'string' && f.anteprima.startsWith('data:image/')) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = f.anteprima;
        vista.appendChild(img);
      } else {
        setIcon(vista, f.tipo === 'scheda' ? 'globe' : 'windowFrame', 22);
      }
      const n = document.createElement('span');
      n.className = 'permesso-fonte-nome';
      n.textContent = nome;
      bt.append(vista, n);
      bt.addEventListener('click', () => rispondiA(d, true, String(f.id || '')));
      return bt;
    });

    // Funzioni come costanti: una dichiarazione dentro il blocco rimpiazzerebbe il `render` della shell.
    const mostraDomanda = () => {
      const d = domande.find((x) => x.tabId === attiva) || null;
      if (d === mostrata) return;
      mostrata = d;
      const b = ensureBar();
      clearTimeout(timerArma);
      if (!d) {
        b.hidden = true;
        b.replaceChildren();
        document.documentElement.style.removeProperty('--sopra-permessi');
        riservaSopra('permessi', 0);
        return;
      }
      const cosa = COSA(d);
      const icone = document.createElement('span');
      icone.className = 'permesso-icone';
      for (const n of cosa.icone) {
        const i = document.createElement('span');
        setIcon(i, n, 16);
        icone.appendChild(i);
      }
      const msg = document.createElement('span');
      msg.className = 'permesso-msg';
      // Il dominio registrato si legge sempre e la richiesta non si taglia: si accorcia solo la parte davanti.
      const chi = document.createElement('span');
      chi.className = 'permesso-chi';
      const sotto = String(d.sotto || '');
      if (sotto) {
        const s = document.createElement('span');
        s.className = 'permesso-sotto';
        s.textContent = (sotto.length > 24 ? '…' + sotto.slice(-23) : sotto) + '.';
        s.title = d.host || '';
        chi.appendChild(s);
      }
      const host = document.createElement('strong');
      host.textContent = d.dominio || d.host || '';
      chi.appendChild(host);
      const testo = document.createElement('span');
      testo.className = 'permesso-cosa';
      testo.textContent = cosa.testo;
      msg.append(chi, ' ', testo);
      if (cosa.nome) {
        // Un nome lunghissimo non spinge giù la pagina di righe: si accorcia in mezzo, l'estensione resta, intero al passaggio.
        const n = document.createElement('strong');
        n.className = 'permesso-oggetto';
        const c = Array.from(cosa.nome);
        n.textContent = '«' + (c.length > 60 ? c.slice(0, 40).join('') + '…' + c.slice(-19).join('') : cosa.nome) + '»';
        n.title = String(cosa.percorso || cosa.nome);
        msg.append(' ', n);
      }
      // Lo schermo (#586): ogni cosa che si può mostrare è il suo «Consenti», e la scelta vale per questa volta.
      const consensi = d.tipo === 'schermo' ? fontiDelloSchermo(d) : [creaConsenti(d)];
      // Consenti si arma dopo ARMA_MS senza clic sulla striscia: una raffica che continua lo tiene spento (#591, giro 20).
      const arma = () => {
        for (const c of consensi) c.disabled = true;
        clearTimeout(timerArma);
        timerArma = setTimeout(() => { if (mostrata === d) for (const c of consensi) c.disabled = false; }, ARMA_MS);
      };
      arma();
      b.onpointerdown = () => { if (consensi.some((c) => c.disabled)) arma(); };
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'permesso-btn permesso-no';
      no.textContent = 'Non consentire';
      no.addEventListener('click', () => rispondiA(d, false));
      b.classList.toggle('permesso-schermo', d.tipo === 'schermo');
      if (d.tipo === 'schermo') {
        const fila = document.createElement('div');
        fila.className = 'permesso-fonti';
        fila.append(...consensi);
        b.replaceChildren(icone, msg, no, fila);
      } else {
        b.replaceChildren(icone, msg, no, ...consensi);
      }
      b.hidden = false;
      requestAnimationFrame(() => {
        const h = Math.ceil(b.getBoundingClientRect().height);
        document.documentElement.style.setProperty('--sopra-permessi', h + 'px');
        riservaSopra('permessi', h);
      });
    };

    api.tabs.onPermesso((evento, info) => {
      if (!info || !info.id) return;
      if (evento === 'chiedi') {
        if (!domande.some((x) => x.id === info.id)) domande.push(info);
      } else {
        const i = domande.findIndex((x) => x.id === info.id);
        if (i >= 0) domande.splice(i, 1);
      }
      mostraDomanda();
    });
    try { api.tabs.snapshot().then((snap) => { if (attiva == null && snap) { attiva = snap.activeId || null; mostraDomanda(); } }).catch(() => {}); } catch (_) {}
    api.tabs.onUpdate((snap) => {
      attiva = (snap && snap.activeId) || null;
      if (snap && Array.isArray(snap.tabs)) {
        for (let i = domande.length - 1; i >= 0; i--) {
          if (!snap.tabs.some((t) => t.id === domande[i].tabId)) domande.splice(i, 1);
        }
      }
      mostraDomanda();
    });
  }

  // Il microfono di Filo per una pagina web (#586): si apre qui, nella cornice, e alla pagina vanno solo i campioni a
  // 16 kHz (services/microfonoDiFilo.js). Così il sito non riceve mai il permesso.
  if (api.tabs.onMicrofono) {
    const RATE = 16000;
    const aperti = new Map();
    const chiudiMic = (id) => {
      const m = aperti.get(id);
      aperti.delete(id);
      if (!m || !m.ctx) return;
      try { m.proc.onaudioprocess = null; m.proc.disconnect(); m.source.disconnect(); } catch (_) {}
      try { m.stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
      try { m.ctx.close(); } catch (_) {}
    };
    const apriMic = async (id) => {
      const Seg = window.SN_DICTATION_SEGMENTER;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      aperti.set(id, {});
      let stream;
      try {
        if (!Seg || !Ctx) throw Object.assign(new Error('mic'), { name: 'NotSupportedError' });
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        aperti.delete(id);
        api.tabs.microfonoEsito(id, { ok: false, errore: String((e && e.name) || 'NotAllowedError') });
        return;
      }
      // Chiuso mentre il sistema rispondeva: il microfono non resta acceso per nessuno.
      if (!aperti.has(id)) { try { stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {} return; }
      let ctx; let source; let proc;
      try {
        ctx = new Ctx();
        source = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (_) {}
      } catch (_) {
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
        try { if (ctx) ctx.close(); } catch (_) {}
        aperti.delete(id);
        api.tabs.microfonoEsito(id, { ok: false, errore: 'NotReadableError' });
        return;
      }
      aperti.set(id, { stream, ctx, source, proc });
      proc.onaudioprocess = (e) => {
        if (!aperti.has(id)) return;
        try { api.tabs.microfonoDati(id, Seg.downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate, RATE)); } catch (_) {}
      };
      source.connect(proc);
      proc.connect(ctx.destination);
      // Il microfono staccato a metà: la pagina lo sa, e non aspetta campioni che non arrivano.
      for (const tr of stream.getAudioTracks()) tr.addEventListener('ended', () => { if (aperti.has(id)) { chiudiMic(id); api.tabs.microfonoFine(id); } });
      api.tabs.microfonoEsito(id, { ok: true, rate: RATE });
    };
    api.tabs.onMicrofono(({ azione, id } = {}) => {
      const k = String(id || '');
      if (!k) return;
      if (azione === 'apri') apriMic(k);
      else if (azione === 'chiudi') chiudiMic(k);
    });
  }
})();
