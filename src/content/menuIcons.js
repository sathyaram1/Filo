// Le icone del content script: le azioni sulla pagina che la barra laterale manda alla scheda (#1246) e la fila
// contestuale in cima al tasto destro (#1434), col suo «Altro…» e i trascinamenti fra menu e barra. Dove stanno le
// icone lo decide src/shared/disposizioneIcone.js e lo scrive il main; qui la copia per disegnare subito.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Menu = global.SN_MENU;
  const Translate = global.SN_TRANSLATE_PAGE;
  const Disp = global.SN_DISPOSIZIONE_ICONE;

  // Le azioni sulla pagina le comandano solo la barra (via main) e il frame principale: un riquadro incorporato non ha
  // la pagina. Lo strato dei riquadri vale come lui.
  const IS_SUBFRAME = global.SN_FILO_UI?.nelloStrato === true || (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  let deps = {
    aiutoPasso: () => {},
    aiutoAcceso: () => true,
    aiutoStato: () => null,
  };
  const manda = (m) => { try { return Promise.resolve(chrome.runtime.sendMessage(m)).catch(() => null); } catch (_) { return Promise.resolve(null); } };

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

  // Le icone della finestra portate dalla barra nella fila (#1434): disegno, nome, se è spenta e chi la vede li dice il
  // main con la stessa regola della barra, e le esegue lui per la stessa strada (src/main/barraLaterale.js). Qui resta
  // l'Aiuto, che vive nella pagina e il cui aspetto viene da aspettoAiuto, come nella barra.
  let finestra = {};
  const finestraInFila = () => Disp.ZONE_FILA.some((z) => (disposizione()[z] || []).some((id) => Disp.noto(id) && Disp.ICONE[id].tipo === 'finestra'));
  function chiediFinestra() {
    if (IS_SUBFRAME || !finestraInFila()) return Promise.resolve();
    return manda({ type: MSG.FILA_FINESTRA }).then((r) => { finestra = r && r.ok && r.icone && typeof r.icone === 'object' ? r.icone : {}; });
  }

  function registroFinestra() {
    const I = (name) => global.SN_ICONS[name](18);
    const stato = (typeof deps.aiutoStato === 'function' && deps.aiutoStato()) || {};
    const aiuto = Disp.aspettoAiuto({ ...stato, risposta: !!stato.nonLetta });
    const spento = !deps.aiutoAcceso();
    const reg = {
      help: { id: 'help', icon: I(spento ? 'help' : aiuto.icona), label: I18n.t(spento ? 'aiuto_spento_barra' : aiuto.etichetta), disabled: spento, onClick: () => deps.aiutoPasso() },
    };
    // Un'icona che il main non ha descritto (del solo owner, o lui non ha risposto) non si disegna.
    for (const [id, f] of Object.entries(finestra)) {
      if (!Disp.noto(id) || Disp.ICONE[id].tipo !== 'finestra' || !f || typeof global.SN_ICONS[f.icona] !== 'function') continue;
      reg[id] = {
        id, icon: I(f.icona), label: String(f.etichetta || ''), tasto: f.tasto || undefined, disabled: !!f.spenta,
        ...(f.accesa ? { acceso: true } : {}),
        onClick: () => manda({ type: MSG.FILA_FINESTRA_ESEGUI, id }),
      };
    }
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

  // ── la disposizione: la scrive il main, uno solo (#871) ───────────────────
  let layout = null;
  const disposizione = () => layout || Disp.DEFAULT;
  function setLayout(v) {
    if (!Disp.valida(v)) return false;
    layout = Disp.migra(v).layout;
    return true;
  }
  function loadIconLayout() {
    manda({ type: MSG.ICON_LAYOUT_GET }).then((r) => { if (r && r.ok && setLayout(r.layout)) ridisegna(); });
  }

  // Cambiata altrove (un'altra scheda, la barra, la chat, un annullo): il menu aperto si ridisegna. Un'icona della
  // finestra appena arrivata nella fila ha l'aspetto solo dal main: si richiede, o la fila la perde (#1434.2).
  function layoutCambiato(v) {
    if (!setLayout(v)) return;
    ridisegna();
    if (aperta) ridisegnaFinestra();
  }

  // Il gesto si vede subito qui, poi vale quello che il main ha scritto. `source` 'bar': arriva dalla barra laterale.
  function applyIconDrop({ id, source, target, beforeId }) {
    if (!id || !Disp.ammessa(id, target)) return;
    const locale = Disp.applicaPosa(disposizione(), { id, target, beforeId: beforeId || null });
    if (locale) layout = locale;
    ridisegna();
    if (Disp.ICONE[id]?.tipo === 'finestra') ridisegnaFinestra();
    manda({ type: MSG.ICON_LAYOUT_DROP, id, source: source === 'bar' ? 'bar' : 'menu', target, beforeId: beforeId || null })
      .then((r) => { if (r && r.ok) layoutCambiato(r.layout); });
  }

  // ── la fila del tasto destro (#1434) ──────────────────────────────────────
  // Quella del menu aperto: il contesto e chi esegue le sue azioni, per ridisegnarla dopo un trascinamento.
  let aperta = null;

  // La voce per `id`, o null se qui non si può fare: l'azione manca a questo elemento, o è un'icona della pagina
  // dentro un riquadro incorporato.
  function voce(id, azioni, regPagina, regFinestra) {
    const I = (name) => global.SN_ICONS[name](18);
    const d = Disp.descrizione(id);
    if (!d) return null;
    if (d.tipo === 'contesto') {
      const a = azioni[d.azione];
      if (!a || typeof a.onClick !== 'function') return null;
      const icona = a.icona && typeof global.SN_ICONS[a.icona] === 'function' ? a.icona : d.icona;
      const v = { id, icon: I(icona), label: a.label || I18n.t(d.etichetta), onClick: a.onClick, tieneAperto: !!a.tieneAperto, disabled: !!a.disabled, draggable: true };
      if (typeof a.acceso === 'boolean') v.acceso = a.acceso;
      return v;
    }
    if (IS_SUBFRAME) return null;
    const r = d.tipo === 'pagina' ? regPagina[id] : regFinestra[id];
    return r ? { ...r, draggable: true } : null;
  }

  function costruisci() {
    if (!aperta) return null;
    const { contesto, azioni } = aperta;
    const regPagina = registro();
    const regFinestra = registroFinestra();
    const { fila: ids, altro } = Disp.filaDi(disposizione(), contesto);
    const voci = (lista) => lista.map((id) => voce(id, azioni, regPagina, regFinestra)).filter(Boolean);
    const inFila = voci(ids);
    const inAltro = voci(altro);
    const items = [...inFila, {
      kind: 'overflow',
      icon: global.SN_ICONS.plus(16),
      label: I18n.t('menu_overflow'),
      onClick: (anchorEl) => Menu.openIconGridSubmenu(anchorEl, inAltro, {
        cols: 4,
        dropTarget: Disp.zonaAltro(contesto),
        onDrop: (e) => applyIconDrop(e),
      }),
    }];
    return { items, inAltro, vuota: !inFila.length && !inAltro.length };
  }

  // La fila per il menu che si sta aprendo. `azioni`: { <azione>: { onClick, label?, icona?, tieneAperto?, disabled?,
  // acceso? } }, quelle che l'elemento sotto il mouse permette; `icona` e `label` dicono lo stato (Riproduci o Pausa),
  // `acceso` uno stile che la selezione ha già (Grassetto).
  function fila(contesto, azioni = {}) {
    if (!Object.prototype.hasOwnProperty.call(Disp.CONTESTI, contesto)) { aperta = null; return null; }
    aperta = { contesto, azioni: azioni || {} };
    const c = costruisci();
    return {
      type: 'row',
      contesto,
      dropTarget: Disp.zonaFila(contesto),
      onDrop: (e) => applyIconDrop(e),
      items: c.items,
      vuota: c.vuota,
    };
  }

  // Sul posto, senza chiudere il menu: chi riordina continua a riordinare. Serve anche quando cambia lo stato che
  // decide il NOME di un'icona mentre il menu è sotto gli occhi (lo schermo intero spento da un'altra strada, #514).
  function ridisegna() {
    if (!aperta || !Menu.isOpen?.()) return;
    const c = costruisci();
    if (!c) return;
    try { Menu.refreshIconRow?.(c.items, { vuota: c.vuota }); } catch (_) {}
    try { Menu.refreshIconGrid?.(c.inAltro); } catch (_) {}
  }

  // ── la barra laterale, terza zona (#871) ─────────────────────────────────
  // Solo nel frame principale: le coordinate di un riquadro non sono quelle della barra. Il gesto sta in menu.js.
  if (!IS_SUBFRAME) Menu.setPonteBarra?.((dati) => manda({ type: MSG.BARRA_TRASCINA, ...dati }));

  // Un'icona portata fuori dalla barra sopra questa pagina: se il menu è aperto ci cade dentro.
  function dallaBarra(msg) {
    if (IS_SUBFRAME || !msg) return;
    const id = String(msg.id || '');
    if (!Disp.noto(id)) return;
    const d = Disp.ICONE[id];
    const entry = d.tipo === 'pagina' ? registro()[id] : registroFinestra()[id];
    Menu.trascinaDaFuori?.({
      fase: String(msg.fase || ''), id,
      x: Number(msg.x) || 0, y: Number(msg.y) || 0,
      icon: entry ? entry.icon : global.SN_ICONS?.[d.icona]?.(18) || '',
    });
  }

  function init(d) { deps = { ...deps, ...d }; }

  // Lo stato delle icone della finestra è cambiato col menu aperto (lo schermo intero spento da un'altra strada, #514).
  function ridisegnaFinestra() {
    chiediFinestra().then(ridisegna, ridisegna);
  }

  loadIconLayout();

  global.SN_MENU_ICONS = {
    init, fila, runIconAction, statoPerBarra, layoutCambiato, dallaBarra,
    prepara: chiediFinestra,
    redrawIconRows: ridisegnaFinestra,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
