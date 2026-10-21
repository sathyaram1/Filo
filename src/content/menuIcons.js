// Il lato pagina delle icone della barra laterale (#871, #1246): nomi, disegni e azioni delle icone, eseguite qui
// quando la barra le preme. Nel menu del tasto destro non entrano più. Caricato dopo actions.js.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Translate = global.SN_TRANSLATE_PAGE;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    isContentFullscreen: () => false,
  };

  // Le azioni sono della PAGINA (#405): risponde e agisce solo il frame principale, mai un riquadro incorporato.
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

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
          isOwner = now;
        })
        .catch(() => {});
    } catch (_) {}
  }

  // Eseguita NEL frame principale quando la barra preme un'azione della pagina. `iconId` è un id del registro, e
  // `colore` solo un #rrggbb preso dal contagocce della barra, che ha il gesto vero: nient'altro attraversa il ponte.
  function runIconAction(iconId, colore) {
    if (IS_SUBFRAME) return;
    const entry = buildLocalIconRegistry(null)[String(iconId || '')];
    if (!entry || typeof entry.onClick !== 'function') return;
    const scelto = entry.nelloStrato === 'contagocce' && /^#[0-9a-f]{6}$/i.test(String(colore || '')) ? String(colore) : undefined;
    if (scelto) entry.onClick(scelto);
    else entry.onClick();
  }

  function buildLocalIconRegistry(navState) {
    const Icons = global.SN_ICONS;
    const Actions = global.SN_ACTIONS;
    // Tutte le icone sono SVG renderizzate a 18px.
    // Vedi src/shared/icons.js e src/styles/ICONS.md per la guida di stile.
    const I = (name) => Icons[name](18);
    // Quattro stati, non due: senza traduzione → "Traduci"; con traduzione
    // COMPLETA e ferma → "Mostra originale"; con traduzione interrotta a metà
    // (#408) → "Riprendi traduzione"; con traduzione completa ma testo comparso
    // dopo (#407: scorrimento infinito, schermate che cambiano senza ricaricare)
    // → "Traduci il testo nuovo". Negli ultimi due l'icona serve a CONTINUARE, e
    // il ritorno all'originale resta raggiungibile come voce etichettata del tasto
    // destro (vedi buildMenuItems in content.js). In tutti e due la traduzione completa solo
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
      // Scorciatoie a impostazioni, home e alle app interne (editor, feedback).
      openOptions:   { id: 'openOptions',   icon: I('models'),      label: I18n.t('menu_open_options'),      onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }) },
      home:          { id: 'home',          icon: I('home'),        label: I18n.t('menu_open_home'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.GO_HOME }) },
      editorApp:     { id: 'editorApp',     icon: I('editor'),      label: I18n.t('menu_open_editor'),       onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }) },
    };
    // Solo all'owner (vedi refreshOwner sopra): a chiunque altro quella pagina
    // non ha niente da mostrare.
    if (isOwner) {
      registry.feedbackApp = { id: 'feedbackApp', icon: I('feedback'), label: I18n.t('menu_open_feedback'), onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }) };
    }
    return registry;
  }

  const Disp = global.SN_DISPOSIZIONE_ICONE;
  refreshOwner();

  // Come si chiamano adesso, su questa pagina, le sue azioni che stanno nella barra laterale: la barra le
  // mostra col nome e l'icona di adesso («Traduci» o «Mostra originale»).
  function statoPerBarra(ids) {
    if (IS_SUBFRAME) return [];
    if ((Array.isArray(ids) ? ids : []).includes('translate')) { try { Translate.rivedi?.(); } catch (_) {} }
    const reg = buildLocalIconRegistry(null);
    return (Array.isArray(ids) ? ids : []).map(String)
      .filter((id) => Disp.noto(id) && Disp.ICONE[id].tipo === 'pagina' && reg[id])
      .map((id) => ({ id, etichetta: String(reg[id].label || ''), icona: reg[id].iconName || Disp.ICONE[id].icona }));
  }

  function init(d) { deps = { ...deps, ...d }; }

  global.SN_MENU_ICONS = {
    init,
    runIconAction,
    statoPerBarra,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
