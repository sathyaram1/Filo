// Riga icone globali del menu contestuale: registro delle icone (con ID
// stabili), layout persistente primaria/secondaria, migrazioni del layout
// salvato e drag-and-drop fra le due zone.
//
// Estratto da content.js — viene caricato prima di lui dai preload (dopo
// actions.js, da cui prende gli onClick delle icone). content.js chiama
// init() passando lo stato "contenuto a tutto schermo" che resta suo.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Menu = global.SN_MENU;
  const Translate = global.SN_TRANSLATE_PAGE;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    isContentFullscreen: () => false,
  };

  // Registro delle icone globali, con ID stabili per drag-and-drop + persistenza
  // della disposizione utente. Le icone primarie occupano la riga in alto del
  // menu; le secondarie vivono nel sotto-menu "Altro…" (griglia 4 colonne).
  // #405 — girando dentro un riquadro incorporato (video, mappa, modulo) le
  // icone della riga globale continuano a rappresentare azioni sulla PAGINA:
  // "traduci", "condividi", "salva per dopo", il QR, lo screenshot. Eseguirle
  // qui dentro le applicherebbe al rettangolo dell'embed — si condividerebbe
  // l'indirizzo del player invece dell'articolo. Le rimandiamo quindi al frame
  // principale, che le esegue come se il menu fosse stato aperto sulla pagina.
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

  // #583 — «Feedback» fra le icone apre la POSTA delle segnalazioni, che da
  // quando i feedback li legge solo chi li gestisce non ha niente da mostrare a
  // un utente comune: una pagina vuota con un invito ad accedere come
  // amministratore, cosa che accedendo non si diventa. L'icona compare quindi
  // solo all'owner. Parte nascosta e si accende dopo la risposta del main:
  // sbagliare per difetto fa perdere un'icona a una persona sola, sbagliare per
  // eccesso manda tutti gli altri in un vicolo cieco.
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

  // Eseguita NEL frame principale quando un riquadro rimanda qui un'azione di
  // pagina. `iconId` è un id del registro, niente di più: nessun dato arbitrario
  // attraversa il ponte.
  function runIconAction(iconId) {
    const entry = buildLocalIconRegistry(lastNavState)[String(iconId || '')];
    if (entry && typeof entry.onClick === 'function') entry.onClick();
  }

  function buildLocalIconRegistry(navState) {
    const Icons = global.SN_ICONS;
    const Actions = global.SN_ACTIONS;
    // Tutte le icone della riga primaria/griglia sono SVG renderizzate a 18px.
    // Vedi src/shared/icons.js e src/styles/ICONS.md per la guida di stile.
    const I = (name) => Icons[name](18);
    // Quattro stati, non due: senza traduzione → "Traduci"; con traduzione
    // COMPLETA e ferma → "Mostra originale"; con traduzione interrotta a metà
    // (#408) → "Riprendi traduzione"; con traduzione completa ma testo comparso
    // dopo (#407: scorrimento infinito, schermate che cambiano senza ricaricare)
    // → "Traduci il testo nuovo". Negli ultimi due l'icona serve a CONTINUARE, e
    // il ritorno all'originale resta raggiungibile come voce etichettata (vedi
    // buildMenuItems in content.js). In tutti e due la traduzione completa solo
    // ciò che manca: quel che è già tradotto non torna al modello.
    const partialTranslation = typeof Translate.isPartial === 'function' && Translate.isPartial();
    const newContent = typeof Translate.hasNewContent === 'function' && Translate.hasNewContent();
    // Mentre traduce, l'icona è il modo di FERMARE: aprire il menu a lavoro in
    // corso e trovare solo "Traduci la pagina" (che non fa niente) non è una
    // scelta, è un vicolo cieco.
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
      translate:     { id: 'translate',     icon: translateIcon,    iconName: restore ? 'showOriginal' : 'translate', label: translateLabel, onClick: () => (restore ? Translate.restoreOriginal() : Translate.translatePage()) },
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
      // Scorciatoie a impostazioni, home e alle app interne (editor, feedback)
      // direttamente fra le icone del menu (feedback alpha).
      openOptions:   { id: 'openOptions',   icon: I('options'),     label: I18n.t('menu_open_options'),      onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }) },
      home:          { id: 'home',          icon: I('home'),        label: I18n.t('menu_open_home'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.GO_HOME }) },
      editorApp:     { id: 'editorApp',     icon: I('editor'),      label: I18n.t('menu_open_editor'),       onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }) },
    };
    // Solo all'owner (vedi refreshOwner sopra): a chiunque altro quella pagina
    // non ha niente da mostrare. Un id assente dal registro sparisce da solo
    // anche dai layout che l'utente si era salvato: i builder filtrano su
    // `registry[id]`.
    if (isOwner) {
      registry.feedbackApp = { id: 'feedbackApp', icon: I('feedback'), label: I18n.t('menu_open_feedback'), onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }) };
    }
    return registry;
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

  // Costruisce gli item della riga primaria (icone + bottone overflow).
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

  // Riga globale: prende le icone "primary" dal layout utente. L'overflow apre
  // la griglia secondaria come sotto-menu ancorato (senza chiudere il primo).
  // Memorizza anche lo stato di navigazione dell'apertura corrente, che serve
  // a redrawIconRows() per i rebuild post-drag.
  function buildGlobalIconRow(navState) {
    lastNavState = navState || null;
    // Chi apre il menu può essere entrato (o uscito) da quando la pagina è
    // stata caricata: si richiede, e se cambia le icone si ridisegnano.
    refreshOwner();
    return {
      type: 'row',
      dropTarget: 'primary',
      onDrop: (e) => { applyIconDrop(e); redrawIconRows(); },
      items: buildPrimaryRowItems(navState),
    };
  }

  // Dopo un drop, rigenera in-place i bottoni delle due zone (riga primaria e
  // griglia secondaria) senza chiudere il menu, così l'utente può continuare a
  // riordinare. La griglia secondaria viene aggiornata solo se è aperta.
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
