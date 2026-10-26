// Le azioni sulla pagina che la barra laterale manda alla scheda (#1246): registro con id stabili, eseguito qui
// perché agisce sul documento. Dove stanno le icone lo decide src/shared/disposizioneIcone.js, non questo file.
// Caricato dopo actions.js e prima di content.js.

(function (global) {
  'use strict';

  const I18n = global.SN_I18N;
  const Translate = global.SN_TRANSLATE_PAGE;
  const Disp = global.SN_DISPOSIZIONE_ICONE;

  // Le comandano solo la barra (via main) e il frame principale: un riquadro incorporato non ha la pagina.
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  function registro() {
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
    const translateLabel = restore
      ? I18n.t('menu_show_original')
      : partialTranslation
        ? I18n.t('menu_resume_translation')
        : newContent
          ? I18n.t('menu_translate_new_content')
          : I18n.t('menu_global_translate');
    const reg = {
      translate:     { id: 'translate',     icon: I(restore ? 'showOriginal' : 'translate'), iconName: restore ? 'showOriginal' : 'translate', label: translateLabel, onClick: () => (restore ? Translate.restoreOriginal() : Translate.translatePage()) },
      screenshot:    { id: 'screenshot',    icon: I('screenshot'),  label: I18n.t('menu_screenshot'),        onClick: () => Actions.takeScreenshot() },
      screenshotCrop:{ id: 'screenshotCrop',icon: I('screenshotCrop'),label: I18n.t('menu_screenshot_crop'), onClick: () => Actions.takePartialScreenshot() },
      transcribe:    { id: 'transcribe',    icon: I('transcribe'),  label: I18n.t('menu_transcribe'),        onClick: () => Actions.transcribeRegion() },
      share:         { id: 'share',         icon: I('share'),       label: I18n.t('menu_share'),             onClick: () => Actions.shareCurrentPage() },
      saveForLater:  { id: 'saveForLater',  icon: I('saveForLater'),label: I18n.t('menu_save_for_later'),    onClick: () => Actions.savePage() },
      colorPicker:   { id: 'colorPicker',   icon: I('colorPicker'), label: I18n.t('menu_color_picker'),      onClick: (scelto) => Actions.pickColor(scelto) },
      qrCode:        { id: 'qrCode',        icon: I('qrCode'),      label: I18n.t('menu_qr_code'),           onClick: () => Actions.showPageQrCode() },
    };
    for (const [id, voce] of Object.entries(reg)) contaIcona(id, voce);
    return reg;
  }

  // Le icone si misurano dal clic alla fine della loro azione (#1461). Quelle della finestra le esegue e le misura il
  // main (src/main/barraLaterale.js), fino alla pagina caricata: qui ci sono solo quelle della pagina.
  function contaIcona(id, voce) {
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

  // Premuta nella barra: passa un id del registro e, per il contagocce, il colore che la barra ha già preso (pickColor
  // lo accetta solo nella forma #rrggbb).
  function runIconAction(iconId, colore) {
    if (IS_SUBFRAME) return;
    // Il testo comparso senza toccare la pagina (una fisarmonica che si apre da sé) si ricontrolla qui: dal menu lo
    // faceva il menu stesso, entrando nella pagina.
    Translate.ricontrolla?.();
    const entry = registro()[String(iconId || '')];
    if (entry && typeof entry.onClick === 'function') entry.onClick(colore);
  }

  // Come si chiamano adesso, su questa pagina, le sue azioni che stanno nella barra laterale («Traduci» o
  // «Mostra originale»): la barra le mostra con questo nome e questa icona.
  function statoPerBarra(ids) {
    if (IS_SUBFRAME) return [];
    Translate.ricontrolla?.();
    const reg = registro();
    return (Array.isArray(ids) ? ids : []).map(String)
      .filter((id) => Disp.noto(id) && Disp.ICONE[id].tipo === 'pagina' && reg[id])
      .map((id) => ({ id, etichetta: String(reg[id].label || ''), icona: reg[id].iconName || Disp.ICONE[id].icona }));
  }

  global.SN_MENU_ICONS = { runIconAction, statoPerBarra };
})(typeof globalThis !== 'undefined' ? globalThis : self);
