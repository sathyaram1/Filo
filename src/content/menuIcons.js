// Riga icone globali del menu: registro con id stabili, layout persistente fra primaria
// e secondaria, migrazioni del layout salvato e drag fra le due zone.
// Caricato dopo actions.js e prima di content.js, che gli passa lo stato a tutto schermo.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Menu = global.SN_MENU;
  const Translate = global.SN_TRANSLATE_PAGE;

  let deps = {
    isContentFullscreen: () => false,
  };

  // Dentro un riquadro incorporato le icone globali restano azioni sulla PAGINA (#405):
  // si rimandano al frame principale, o condividerebbero l'indirizzo del player.
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  function buildIconRegistry(navState) {
    const registry = buildLocalIconRegistry(navState);
    if (!IS_SUBFRAME) return registry;
    const out = {};
    for (const id of Object.keys(registry)) {
      // Il colore preso dallo strato (#1054) vale per lo schermo, non per la pagina: si copia da qui.
      const conColore = registry[id].nelloStrato === 'contagocce';
      out[id] = { ...registry[id], onClick: (scelto) => (conColore && scelto ? registry[id].onClick(scelto) : runInTopFrame(id)) };
    }
    // Il pannello Aiuto vive nel frame principale e qui il suo stato non si vede: da un riquadro l'icona lo apre, come la voce «Aiuto».
    if (out.help) out.help = { ...out.help, onClick: () => runInTopFrame(null, 'help') };
    return out;
  }

  // «Feedback» porta alla posta delle segnalazioni, che a un utente comune è un vicolo
  // cieco: icona del solo owner, nascosta finché il main non risponde (#583).
  let isOwner = false;
  function refreshOwner() {
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS }))
        .then((r) => {
          const now = !!(r && r.ok && r.signedIn && r.isAdmin);
          if (now === isOwner) return;
          isOwner = now;
          // Il menu può essere già aperto: le icone si ridisegnano da sole.
          try { redrawIconRows(); } catch (_) {}
        })
        .catch(() => {});
    } catch (_) {}
  }

  function runInTopFrame(iconId, surface = null) {
    try {
      Promise.resolve(chrome.runtime.sendMessage(surface ? { type: MSG.RUN_IN_TOP_FRAME, surface } : { type: MSG.RUN_IN_TOP_FRAME, iconId })).catch(() => {});
    } catch (_) {}
  }

  // Eseguita nel frame principale per le azioni rimandate da un riquadro: passa solo un id del
  // registro, nessun dato arbitrario attraversa il ponte.
  function runIconAction(iconId) {
    const entry = buildLocalIconRegistry(lastNavState)[String(iconId || '')];
    if (entry && typeof entry.onClick === 'function') entry.onClick();
  }

  function buildLocalIconRegistry(navState) {
    const Icons = global.SN_ICONS;
    const Actions = global.SN_ACTIONS;
    // Icone SVG a 18px: la guida di stile sta in src/shared/icons.js e src/styles/ICONS.md.
    const I = (name) => Icons[name](18);
    // Quattro stati, non due: senza traduzione, completa, interrotta a metà (#408), completa
    // ma con testo comparso dopo (#407). Negli ultimi due l'icona serve a CONTINUARE.
    const partialTranslation = typeof Translate.isPartial === 'function' && Translate.isPartial();
    const newContent = typeof Translate.hasNewContent === 'function' && Translate.hasNewContent();
    // Mentre traduce, l'icona è il modo di FERMARE: trovare solo «Traduci la pagina», che
    // non fa niente, è un vicolo cieco.
    const restore = typeof Translate.showsRestore === 'function'
      ? Translate.showsRestore()
      : (Translate.hasTranslation() && !(partialTranslation || newContent));
    const translateIcon = restore ? I('showOriginal') : I('translate');
    const translateLabel = restore
      ? I18n.t('menu_show_original')
      : partialTranslation
        ? I18n.t('menu_resume_translation')
        : newContent
          ? I18n.t('menu_translate_new_content')
          : I18n.t('menu_global_translate');
    const isFs = !!(document.fullscreenElement || deps.isContentFullscreen());
    // Quando navState non è disponibile (es. menu aperto da flussi che non lo
    // calcolano), lascia abilitati: meglio rispetto al falso "disabilitato".
    const canBack = navState ? !!navState.canBack : true;
    const canFwd = navState ? !!navState.canFwd : true;
    // Come nella barra laterale: l'icona dice cosa farà il clic sul pannello Aiuto di questa pagina (#1432).
    const statoAiuto = (typeof deps.aiutoStato === 'function' && deps.aiutoStato()) || {};
    const aiuto = Disp.aspettoAiuto({ ...statoAiuto, risposta: !!statoAiuto.nonLetta });
    // Spento in Preferenze: spenta come nella barra, e il nome dice perché.
    const aiutoSpento = typeof deps.aiutoAcceso === 'function' && !deps.aiutoAcceso();
    const registry = {
      help:          { id: 'help',          icon: I(aiutoSpento ? 'help' : aiuto.icona), iconName: aiutoSpento ? 'help' : aiuto.icona, label: I18n.t(aiutoSpento ? 'aiuto_spento_barra' : aiuto.etichetta), disabled: aiutoSpento, onClick: () => deps.aiutoPasso && deps.aiutoPasso() },
      translate:     { id: 'translate',     icon: translateIcon,    iconName: restore ? 'showOriginal' : 'translate', label: translateLabel, onClick: () => (restore ? Translate.restoreOriginal() : Translate.translatePage()) },
      screenshot:    { id: 'screenshot',    icon: I('screenshot'),  label: I18n.t('menu_screenshot'),        onClick: () => Actions.takeScreenshot() },
      screenshotCrop:{ id: 'screenshotCrop',icon: I('screenshotCrop'),label: I18n.t('menu_screenshot_crop'), onClick: () => Actions.takePartialScreenshot() },
      transcribe:    { id: 'transcribe',    icon: I('transcribe'),  label: I18n.t('menu_transcribe'),        onClick: () => Actions.transcribeRegion() },
      share:         { id: 'share',         icon: I('share'),       label: I18n.t('menu_share'),             onClick: () => Actions.shareCurrentPage() },
      saveForLater:  { id: 'saveForLater',  icon: I('saveForLater'),label: I18n.t('menu_save_for_later'),    onClick: () => Actions.savePage() },
      openForLater:  { id: 'openForLater',  icon: I('openForLater'),label: I18n.t('menu_open_for_later'),    onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_HOME }) },
      fullscreen:    { id: 'fullscreen',    icon: isFs ? I('shrink') : I('zoom'), label: isFs ? I18n.t('menu_exit_fullscreen') : I18n.t('menu_fullscreen'), tasto: global.SN_TASTI?.etichettaSchermoIntero(), onClick: () => Actions.toggleFullscreen() },
      back:          { id: 'back',          icon: I('back'),        label: I18n.t('menu_back'),              disabled: !canBack, onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_BACK }) },
      forward:       { id: 'forward',       icon: I('forward'),     label: I18n.t('menu_forward'),           disabled: !canFwd, onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_FORWARD }) },
      reload:        { id: 'reload',        icon: I('reload'),      label: I18n.t('menu_reload'),            onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_RELOAD }) },
      colorPicker:   { id: 'colorPicker',   icon: I('colorPicker'), label: I18n.t('menu_color_picker'),      nelloStrato: 'contagocce', onClick: (scelto) => Actions.pickColor(scelto) },
      closeTab:      { id: 'closeTab',      icon: I('close'),       label: I18n.t('menu_close_tab'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.CLOSE_TAB }) },
      newTab:        { id: 'newTab',        icon: I('filoLogo'),    label: I18n.t('menu_new_tab'),           onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_NEW_TAB }) },
      qrCode:        { id: 'qrCode',        icon: I('qrCode'),      label: I18n.t('menu_qr_code'),           onClick: () => Actions.showPageQrCode() },
      incognito:     { id: 'incognito',     icon: I('incognito'),   label: I18n.t('menu_incognito'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_INCOGNITO }) },
      openOptions:   { id: 'openOptions',   icon: I('options'),     label: I18n.t('menu_open_options'),      onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }) },
      home:          { id: 'home',          icon: I('home'),        label: I18n.t('menu_open_home'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.GO_HOME }) },
      editorApp:     { id: 'editorApp',     icon: I('editor'),      label: I18n.t('menu_open_editor'),       onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }) },
    };
    // Un id assente dal registro sparisce da solo anche dai layout salvati dall'utente: i
    // builder filtrano su `registry[id]`.
    if (isOwner) {
      registry.feedbackApp = { id: 'feedbackApp', icon: I('feedback'), label: I18n.t('menu_open_feedback'), onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }) };
    }
    for (const [id, voce] of Object.entries(registry)) contaIcona(id, voce);
    return registry;
  }

  // Le icone si misurano dal clic alla fine della loro azione (#1461). Quelle che chiedono al main una navigazione le
  // misura lui, fino alla pagina caricata (nav.js, o l'apertura della scheda per le pagine di Filo): qui sarebbero due.
  const CONTATE_DAL_MAIN = new Set(['back', 'forward', 'reload', 'closeTab', 'newTab', 'incognito', 'openOptions', 'home', 'editorApp',
    'feedbackApp']);
  function contaIcona(id, voce) {
    if (CONTATE_DAL_MAIN.has(id) || !voce || typeof voce.onClick !== 'function') return;
    const fa = voce.onClick;
    voce.onClick = (...args) => {
      const t0 = Date.now();
      const fine = () => { try { global.SN_POPUP?.conta?.({ misura: 'icona', icona: id, fineMs: Date.now() - t0 }); } catch (_) {} };
      let r;
      try { r = fa(...args); } catch (e) { fine(); throw e; }
      if (r && typeof r.then === 'function') r.then(fine, fine); else fine();
      return r;
    };
  }

  // Dove sta ogni icona (riga, «Altro…», barra laterale) lo decide src/shared/disposizioneIcone.js,
  // e lo scrive il main, uno solo: qui c'è la copia per disegnare subito (#871).
  const Disp = global.SN_DISPOSIZIONE_ICONE;
  const DEFAULT_ICON_LAYOUT = Disp.DEFAULT;

  let iconLayoutCache = null;
  // Stato di navigazione (canBack/canFwd) dell'ultima apertura menu: riusato
  // dai redraw post-drag per non perdere il grigio di avanti/indietro.
  let lastNavState = null;

  function setLayout(v) {
    if (!Disp.valida(v)) return false;
    iconLayoutCache = { primary: [...v.primary], secondary: [...v.secondary], bar: [...(v.bar || [])] };
    return true;
  }

  function loadIconLayout() {
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.ICON_LAYOUT_GET }))
        .then((r) => { if (r && r.ok) setLayout(r.layout); })
        .catch(() => {});
    } catch (_) {}
  }
  loadIconLayout();
  refreshOwner();

  function getIconLayout() {
    return iconLayoutCache || DEFAULT_ICON_LAYOUT;
  }

  // Cambiata altrove (un'altra scheda, la barra laterale): il menu aperto si ridisegna.
  function layoutCambiato(v) {
    if (setLayout(v)) { try { redrawIconRows(); } catch (_) {} }
  }

  // Il drop si vede subito qui, poi vale quello che il main ha scritto.
  function applyIconDrop({ id, target, beforeId }) {
    if (!id) return;
    const locale = Disp.applicaPosa(getIconLayout(), { id, target, beforeId: beforeId || null });
    if (locale) setLayout(locale);
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.ICON_LAYOUT_DROP, id, target, beforeId: beforeId || null }))
        .then((r) => { if (r && r.ok) layoutCambiato(r.layout); })
        .catch(() => {});
    } catch (_) {}
  }

  function buildPrimaryRowItems(navState) {
    const registry = buildIconRegistry(navState);
    const layout = getIconLayout();
    const primaryIds = (layout.primary || []).filter((id) => registry[id]);
    const secondaryIds = (layout.secondary || []).filter((id) => registry[id]);
    const items = primaryIds.map((id) => ({ ...registry[id], draggable: true }));
    items.push({
      kind: 'overflow',
      icon: '▸',
      label: I18n.t('menu_overflow'),
      onClick: (anchorEl) => {
        const gridItems = secondaryIds.map((id) => ({ ...registry[id], draggable: true }));
        Menu.openIconGridSubmenu(anchorEl, gridItems, {
          cols: 4,
          dropTarget: 'secondary',
          onDrop: (e) => { applyIconDrop(e); redrawIconRows(); },
        });
      },
    });
    return items;
  }

  function buildSecondaryGridItems(navState) {
    const registry = buildIconRegistry(navState);
    const layout = getIconLayout();
    const secondaryIds = (layout.secondary || []).filter((id) => registry[id]);
    return secondaryIds.map((id) => ({ ...registry[id], draggable: true }));
  }

  // Memorizza lo stato di navigazione dell'apertura corrente: serve a redrawIconRows() per i
  // rebuild dopo un drag.
  function buildGlobalIconRow(navState) {
    lastNavState = navState || null;
    refreshOwner();
    return {
      type: 'row',
      dropTarget: 'primary',
      onDrop: (e) => { applyIconDrop(e); redrawIconRows(); },
      items: buildPrimaryRowItems(navState),
    };
  }

  // Rigenera i bottoni in-place senza chiudere il menu, così l'utente può continuare a riordinare;
  // la griglia secondaria solo se è aperta.
  function redrawIconRows() {
    try { Menu.refreshIconRow?.(buildPrimaryRowItems(lastNavState)); } catch (_) {}
    try { Menu.refreshIconGrid?.(buildSecondaryGridItems(lastNavState)); } catch (_) {}
  }

  // ── la barra laterale, terza zona (#871) ─────────────────────────────────
  // Solo nel frame principale: le coordinate di un riquadro non sono quelle della barra.
  let barraAperta = null;
  let miraInviata = null;
  const trascina = (dati) => {
    try { return Promise.resolve(chrome.runtime.sendMessage({ type: MSG.BARRA_TRASCINA, ...dati })).catch(() => null); } catch (_) { return Promise.resolve(null); }
  };
  if (!IS_SUBFRAME) {
    Menu.setPonteBarra?.({
      inizio(id, menuSinistra) {
        barraAperta = null;
        miraInviata = null;
        trascina({ fase: 'inizio', id, menuSinistra }).then((r) => { if (r && r.ok) barraAperta = { larghezza: Number(r.larghezza) || 0 }; });
      },
      sopra(x, y) {
        const dentro = !!barraAperta && x <= barraAperta.larghezza;
        const mira = dentro ? Math.round(y) : null;
        if (mira !== miraInviata) { miraInviata = mira; trascina({ fase: 'sopra', y: mira }); }
        return dentro;
      },
      posa(id, x, y) {
        if (!barraAperta || x > barraAperta.larghezza) return false;
        trascina({ fase: 'posa', id, x: Math.round(x), y: Math.round(y) });
        return true;
      },
      fine() {
        barraAperta = null;
        miraInviata = null;
        trascina({ fase: 'fine' });
      },
    });
  }

  // Come si chiamano adesso, su questa pagina, le sue azioni che stanno nella barra laterale: la barra le
  // mostra con lo stesso nome e la stessa icona del menu («Traduci» o «Mostra originale»).
  function statoPerBarra(ids) {
    if (IS_SUBFRAME) return [];
    const reg = buildLocalIconRegistry(lastNavState);
    return (Array.isArray(ids) ? ids : []).map(String)
      .filter((id) => Disp.noto(id) && Disp.ICONE[id].tipo === 'pagina' && reg[id])
      .map((id) => ({ id, etichetta: String(reg[id].label || ''), icona: reg[id].iconName || Disp.ICONE[id].icona }));
  }

  // Un'icona portata fuori dalla barra sopra questa pagina: se il menu è aperto ci cade dentro.
  function dallaBarra(msg) {
    if (IS_SUBFRAME || !msg) return;
    const id = String(msg.id || '');
    const entry = Disp.noto(id) ? buildLocalIconRegistry(lastNavState)[id] : null;
    Menu.trascinaDaFuori?.({
      fase: String(msg.fase || ''), id,
      x: Number(msg.x) || 0, y: Number(msg.y) || 0,
      icon: entry ? entry.icon : '',
    });
  }

  function init(d) { deps = { ...deps, ...d }; }

  global.SN_MENU_ICONS = {
    init,
    buildGlobalIconRow,
    runIconAction,
    statoPerBarra,
    // Ridisegna le icone del menu già aperto. Serve quando lo stato che
    // decide il NOME di una voce cambia mentre il menu è sotto gli occhi: lo
    // schermo intero si spegne per un'altra strada (l'assistente, un gesto di
    // sistema, un'altra scheda) e la voce continuerebbe a promettere «Esci da
    // schermo intero» quando non c'è più niente da cui uscire (#514).
    redrawIconRows,
    layoutCambiato,
    dallaBarra,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
