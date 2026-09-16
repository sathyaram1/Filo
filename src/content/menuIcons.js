// Riga icone globali del menu contestuale: registro con ID stabili, layout persistente primaria/secondaria, migrazioni del layout salvato e drag fra le due zone.
// I preload lo caricano dopo actions.js (da cui prende gli onClick) e prima di content.js, che poi chiama init() passandogli lo stato "contenuto a tutto schermo".

(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Menu = global.SN_MENU;
  const Translate = global.SN_TRANSLATE_PAGE;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    isContentFullscreen: () => false,
  };

  // Le primarie stanno nella riga in alto del menu, le secondarie nel sotto-menu "Altro…".
  // Dentro un riquadro incorporato (video, mappa, modulo) le icone globali restano azioni sulla PAGINA (#405): eseguirle lì condividerebbe l'indirizzo del player invece dell'articolo.
  // Quindi si rimandano al frame principale, che le esegue come se il menu fosse stato aperto sulla pagina.
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  function buildIconRegistry(navState) {
    const registry = buildLocalIconRegistry(navState);
    if (!IS_SUBFRAME) return registry;
    const out = {};
    for (const id of Object.keys(registry)) {
      out[id] = { ...registry[id], onClick: () => runInTopFrame(id) };
    }
    return out;
  }

  // «Feedback» apre la posta delle segnalazioni, che a un utente comune ha solo un invito ad accedere come amministratore — cosa che accedendo non si diventa: l'icona è quindi del solo owner (#583).
  // Parte nascosta e si accende alla risposta del main: sbagliare per difetto costa un'icona a una persona, per eccesso manda tutti gli altri in un vicolo cieco.
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

  function runInTopFrame(iconId) {
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.RUN_IN_TOP_FRAME, iconId })).catch(() => {});
    } catch (_) {}
  }

  // Eseguita nel frame principale per le azioni rimandate da un riquadro: passa solo un id del registro, nessun dato arbitrario attraversa il ponte.
  function runIconAction(iconId) {
    const entry = buildLocalIconRegistry(lastNavState)[String(iconId || '')];
    if (entry && typeof entry.onClick === 'function') entry.onClick();
  }

  function buildLocalIconRegistry(navState) {
    const Icons = global.SN_ICONS;
    const Actions = global.SN_ACTIONS;
    // Icone SVG a 18px: la guida di stile sta in src/shared/icons.js e src/styles/ICONS.md.
    const I = (name) => Icons[name](18);
    // Quattro stati, non due: senza traduzione → «Traduci»; completa e ferma → «Mostra originale»; interrotta a metà (#408) → «Riprendi»; completa ma con testo comparso dopo (#407: scorrimento infinito, schermate che cambiano senza ricaricare) → «Traduci il testo nuovo».
    // Negli ultimi due l'icona serve a CONTINUARE, e il ritorno all'originale resta una voce etichettata (buildMenuItems in content.js); si traduce solo ciò che manca, il già tradotto non torna al modello.
    const partialTranslation = typeof Translate.isPartial === 'function' && Translate.isPartial();
    const newContent = typeof Translate.hasNewContent === 'function' && Translate.hasNewContent();
    // Mentre traduce, l'icona è il modo di FERMARE: aprire il menu a lavoro in corso e trovarci solo «Traduci la pagina», che non fa niente, è un vicolo cieco.
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
    const registry = {
      translate:     { id: 'translate',     icon: translateIcon,    label: translateLabel,                   onClick: () => (restore ? Translate.restoreOriginal() : Translate.translatePage()) },
      screenshot:    { id: 'screenshot',    icon: I('screenshot'),  label: I18n.t('menu_screenshot'),        onClick: () => Actions.takeScreenshot() },
      screenshotCrop:{ id: 'screenshotCrop',icon: I('screenshotCrop'),label: I18n.t('menu_screenshot_crop'), onClick: () => Actions.takePartialScreenshot() },
      transcribe:    { id: 'transcribe',    icon: I('transcribe'),  label: I18n.t('menu_transcribe'),        onClick: () => Actions.transcribeRegion() },
      share:         { id: 'share',         icon: I('share'),       label: I18n.t('menu_share'),             onClick: () => Actions.shareCurrentPage() },
      saveForLater:  { id: 'saveForLater',  icon: I('saveForLater'),label: I18n.t('menu_save_for_later'),    onClick: () => Actions.savePage() },
      openForLater:  { id: 'openForLater',  icon: I('openForLater'),label: I18n.t('menu_open_for_later'),    onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_HOME }) },
      fullscreen:    { id: 'fullscreen',    icon: isFs ? I('shrink') : I('zoom'), label: isFs ? I18n.t('menu_exit_fullscreen') : I18n.t('menu_fullscreen'), onClick: () => Actions.toggleFullscreen() },
      back:          { id: 'back',          icon: I('back'),        label: I18n.t('menu_back'),              disabled: !canBack, onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_BACK }) },
      forward:       { id: 'forward',       icon: I('forward'),     label: I18n.t('menu_forward'),           disabled: !canFwd, onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_FORWARD }) },
      reload:        { id: 'reload',        icon: I('reload'),      label: I18n.t('menu_reload'),            onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_RELOAD }) },
      colorPicker:   { id: 'colorPicker',   icon: I('colorPicker'), label: I18n.t('menu_color_picker'),      onClick: () => Actions.pickColor() },
      closeTab:      { id: 'closeTab',      icon: I('close'),       label: I18n.t('menu_close_tab'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.CLOSE_TAB }) },
      newTab:        { id: 'newTab',        icon: I('filoLogo'),    label: I18n.t('menu_new_tab'),           onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_NEW_TAB }) },
      qrCode:        { id: 'qrCode',        icon: I('qrCode'),      label: I18n.t('menu_qr_code'),           onClick: () => Actions.showPageQrCode() },
      incognito:     { id: 'incognito',     icon: I('incognito'),   label: I18n.t('menu_incognito'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_INCOGNITO }) },
      openOptions:   { id: 'openOptions',   icon: I('options'),     label: I18n.t('menu_open_options'),      onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }) },
      home:          { id: 'home',          icon: I('home'),        label: I18n.t('menu_open_home'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.GO_HOME }) },
      editorApp:     { id: 'editorApp',     icon: I('editor'),      label: I18n.t('menu_open_editor'),       onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }) },
    };
    // Solo all'owner. Un id assente dal registro sparisce da solo anche dai layout che l'utente si era salvato: i builder filtrano su `registry[id]`.
    if (isOwner) {
      registry.feedbackApp = { id: 'feedbackApp', icon: I('feedback'), label: I18n.t('menu_open_feedback'), onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }) };
    }
    return registry;
  }

  // Layout di default: le primarie nella riga, le altre nella griglia "Altro…".
  const DEFAULT_ICON_LAYOUT = {
    primary: ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'],
    secondary: ['openOptions', 'home', 'editorApp', 'feedbackApp', 'incognito', 'screenshotCrop', 'transcribe', 'colorPicker', 'closeTab', 'fullscreen', 'back', 'forward', 'reload'],
  };

  // Promozione una-tantum di `qrCode` nella riga primaria: il QR è un'azione rapida, non va sepolto in "Altro…". Una volta sola per chi aveva già un layout salvato, poi è libero di rispostarla.
  const QR_PRIMARY_MARKER = 'sn_qr_in_primary_migrated';

  // Icone ritirate dal registro: vanno purgate dal layout salvato per non
  // generare bottoni "fantasma" (registry lookup miss).
  const RETIRED_ICONS = new Set(['openForLater']);

  // Vecchio default (prima del cambio a 5 slot): se trovo esattamente questo
  // layout in storage, è il default che non è mai stato customizzato — migro.
  const LEGACY_DEFAULT_LAYOUT = {
    primary: ['translate', 'screenshot', 'share', 'saveForLater'],
    secondary: ['openForLater', 'fullscreen', 'back', 'forward', 'reload'],
  };

  function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isLegacyDefault(v) {
    return v && arraysEqual(v.primary, LEGACY_DEFAULT_LAYOUT.primary)
            && arraysEqual(v.secondary, LEGACY_DEFAULT_LAYOUT.secondary);
  }

  let iconLayoutCache = null;
  // Stato di navigazione dell'ultima apertura del menu: senza, i redraw dopo un drag girerebbero con navState=undefined e avanti/indietro tornerebbero non grigi.
  let lastNavState = null;
  function loadIconLayout() {
    try {
      chrome.storage.local.get([STORAGE_KEYS.ICON_LAYOUT, QR_PRIMARY_MARKER], (out) => {
        let v = out?.[STORAGE_KEYS.ICON_LAYOUT];
        const qrPromoted = !!out?.[QR_PRIMARY_MARKER];
        if (v && Array.isArray(v.primary) && Array.isArray(v.secondary)) {
          if (isLegacyDefault(v)) {
            iconLayoutCache = DEFAULT_ICON_LAYOUT;
            try { chrome.storage.local.set({ [STORAGE_KEYS.ICON_LAYOUT]: DEFAULT_ICON_LAYOUT, [QR_PRIMARY_MARKER]: true }); } catch (_) {}
          } else {
            // Migrazione idempotente: purga le icone ritirate e aggiunge quelle introdotte dopo il salvataggio, così l'utente non perde le novità.
            const filterRetired = (arr) => (arr || []).filter((id) => !RETIRED_ICONS.has(id));
            const beforePrim = (v.primary || []).join('|');
            const beforeSec = (v.secondary || []).join('|');
            v = { ...v, primary: filterRetired(v.primary), secondary: filterRetired(v.secondary) };
            const known = new Set([...v.primary, ...v.secondary]);
            const additions = ['incognito', 'qrCode', 'colorPicker', 'closeTab', 'screenshotCrop', 'transcribe', 'newTab', 'openOptions', 'home', 'editorApp', 'feedbackApp'].filter((id) => !known.has(id));
            if (additions.length) {
              v = { ...v, secondary: [...additions, ...v.secondary] };
            }
            if (!qrPromoted && !v.primary.includes('qrCode')
                && v.secondary.includes('qrCode')
                && v.primary.length < MAX_PRIMARY_ICONS) {
              v = {
                ...v,
                primary: [...v.primary, 'qrCode'],
                secondary: v.secondary.filter((id) => id !== 'qrCode'),
              };
            }
            const changed = beforePrim !== v.primary.join('|') || beforeSec !== v.secondary.join('|');
            if (changed || !qrPromoted) {
              try {
                chrome.storage.local.set({ [STORAGE_KEYS.ICON_LAYOUT]: v, [QR_PRIMARY_MARKER]: true });
              } catch (_) {}
            }
            iconLayoutCache = v;
          }
        } else {
          iconLayoutCache = DEFAULT_ICON_LAYOUT;
          try { chrome.storage.local.set({ [QR_PRIMARY_MARKER]: true }); } catch (_) {}
        }
      });
    } catch (_) { iconLayoutCache = DEFAULT_ICON_LAYOUT; }
  }
  loadIconLayout();
  refreshOwner();

  function getIconLayout() {
    return iconLayoutCache || DEFAULT_ICON_LAYOUT;
  }

  function saveIconLayout(layout) {
    iconLayoutCache = layout;
    try { chrome.storage.local.set({ [STORAGE_KEYS.ICON_LAYOUT]: layout }); } catch (_) {}
  }

  // Le icone che sforano la riga primaria traboccano nella griglia secondaria.
  const MAX_PRIMARY_ICONS = 6;

  // beforeId = icona davanti alla quale inserire, null = in fondo. Se la primaria sfora il limite, l'ultima viene spinta in cima alla secondaria (di fatto uno scambio).
  function applyIconDrop({ id, source, target, beforeId }) {
    if (!id) return;
    const layout = { ...getIconLayout() };
    layout.primary = (layout.primary || []).slice().filter((x) => x !== id);
    layout.secondary = (layout.secondary || []).slice().filter((x) => x !== id);
    if (target === 'primary') {
      const idx = beforeId ? layout.primary.indexOf(beforeId) : -1;
      if (idx >= 0) layout.primary.splice(idx, 0, id);
      else layout.primary.push(id);
      while (layout.primary.length > MAX_PRIMARY_ICONS) {
        const popped = layout.primary.pop();
        if (popped && !layout.secondary.includes(popped)) layout.secondary.unshift(popped);
      }
    } else {
      const idx = beforeId ? layout.secondary.indexOf(beforeId) : -1;
      if (idx >= 0) layout.secondary.splice(idx, 0, id);
      else layout.secondary.push(id);
    }
    saveIconLayout(layout);
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

  // Memorizza lo stato di navigazione dell'apertura corrente: serve a redrawIconRows() per i rebuild dopo un drag.
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

  // Rigenera i bottoni in-place senza chiudere il menu, così l'utente può continuare a riordinare; la griglia secondaria solo se è aperta.
  function redrawIconRows() {
    try { Menu.refreshIconRow?.(buildPrimaryRowItems(lastNavState)); } catch (_) {}
    try { Menu.refreshIconGrid?.(buildSecondaryGridItems(lastNavState)); } catch (_) {}
  }

  function init(d) { deps = { ...deps, ...d }; }

  global.SN_MENU_ICONS = {
    init,
    buildGlobalIconRow,
    runIconAction,
    // Ridisegna le icone del menu già aperto quando cambia lo stato che decide il NOME di una voce (#514): lo schermo intero può spegnersi per un'altra strada,
    // e la voce continuerebbe a promettere «Esci da schermo intero» quando non c'è più niente da cui uscire.
    redrawIconRows,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
