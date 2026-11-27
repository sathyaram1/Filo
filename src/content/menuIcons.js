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
      colorPicker:   { id: 'colorPicker',   icon: I('colorPicker'), label: I18n.t('menu_color_picker'),      onClick: () => Actions.pickColor() },
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

  // Premuta nella barra: passa un id del registro.
  function runIconAction(iconId) {
    if (IS_SUBFRAME) return;
    // Il testo comparso senza toccare la pagina (una fisarmonica che si apre da sé) si ricontrolla qui: dal menu lo
    // faceva il menu stesso, entrando nella pagina.
    Translate.ricontrolla?.();
    const entry = registro()[String(iconId || '')];
    if (entry && typeof entry.onClick === 'function') entry.onClick();
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

  // ── Il menu a icone (#2555): un'icona per verbo, costruita dall'elenco unico ─────────────────────────────────────
  // Per un verbo l'elemento sotto il mouse può offrire più oggetti (`su`: { <oggetto>: { onClick, label?, bersaglio? } }):
  // il clic agisce sul primo nell'ordine dell'elenco, gli altri sono le varianti nel menu dell'icona.
  const ICONA_PX = () => (aperta && aperta.aspetto && aperta.aspetto.icona) || 20;
  const fraseOggetto = (o) => (aperta && aperta.oggetti && aperta.oggetti[o]) || Disp.OGGETTI[o] || '';
  const nomeConOggetto = (nome, oggetto) => [nome, oggetto].filter(Boolean).join(' ');

  // Le scelte di un verbo per gli oggetti che ha qui, in ordine. Un'azione con un solo `onClick` agisce sul primo
  // oggetto dell'elenco.
  function scelteDi(a, oggetti) {
    const su = a && a.su && typeof a.su === 'object' ? a.su : null;
    if (!su) return a && typeof a.onClick === 'function' ? [{ oggetto: oggetti[0] || 'elemento', ...a }] : [];
    const ordine = [...oggetti, ...Object.keys(su).filter((o) => !oggetti.includes(o))];
    return ordine.filter((o) => su[o] && typeof su[o].onClick === 'function').map((o) => ({ ...a, su: undefined, oggetto: o, ...su[o] }));
  }

  // La voce per `id`, o null se qui non si può fare: l'azione manca a questo elemento, o è un'icona della pagina
  // dentro un riquadro incorporato.
  function voce(id, azioni, regPagina, regFinestra) {
    const I = (name) => global.SN_ICONS[name](ICONA_PX());
    const d = Disp.descrizione(id);
    if (!d) return null;
    if (d.tipo === 'contesto') {
      const scelte = scelteDi(azioni[d.azione], d.oggetti);
      if (!scelte.length) return null;
      const [a, ...altre] = scelte;
      const icona = a.icona && typeof global.SN_ICONS[a.icona] === 'function' ? a.icona : d.icona;
      const nome = a.nome || d.nome;
      const oggetto = a.fraseOggetto || fraseOggetto(a.oggetto);
      // `verbo` è l'azione dell'elenco; `azione` quella del catalogo delle capacità, che il menu misura (#1461).
      const v = {
        id, verbo: d.azione, icon: I(icona), nome, oggetto, tasto: Disp.VERBI[d.azione]?.tasto || '',
        label: a.label || nomeConOggetto(nome, oggetto), onClick: a.onClick, tieneAperto: !!a.tieneAperto,
        disabled: !!a.disabled, draggable: true, bersaglio: a.bersaglio || bersaglioDi(a.oggetto),
      };
      if (typeof a.azione === 'string' && a.azione) v.azione = a.azione;
      if (typeof a.acceso === 'boolean') v.acceso = a.acceso;
      if (a.valore) v.valore = a.valore;
      if (a.iconaImg) v.iconaImg = a.iconaImg;
      if (a.cronologia) v.cronologia = a.cronologia;
      if (altre.length) {
        v.varianti = altre.map((x) => ({
          label: x.label || nomeConOggetto(nome, x.fraseOggetto || fraseOggetto(x.oggetto)),
          onClick: x.onClick, bersaglio: x.bersaglio || bersaglioDi(x.oggetto), disabled: !!x.disabled,
          ...(typeof x.azione === 'string' && x.azione ? { azione: x.azione } : {}),
        }));
      }
      if (Array.isArray(a.varianti)) v.varianti = [...(v.varianti || []), ...a.varianti];
      return v;
    }
    if (IS_SUBFRAME) return null;
    const r = d.tipo === 'pagina' ? regPagina[id] : regFinestra[id];
    if (!r) return null;
    return { ...r, nome: r.label, tasto: '', draggable: true };
  }

  const bersaglioDi = (oggetto) => (aperta && aperta.bersagli && aperta.bersagli[oggetto]) || null;

  // Le voci date come testo da una pagina di Filo (il messaggio della chat, una riga della home): il verbo dalla loro
  // etichetta, e quelle con lo stesso verbo diventano un'icona sola con le varianti. Una voce che nessun verbo riconosce
  // resta un'icona generica col suo nome: la sentinella tiene riconosciute quelle che il codice scrive.
  function vociScritte(lista) {
    const I = (name) => global.SN_ICONS[name](ICONA_PX());
    const perVerbo = new Map();
    for (const x of Array.isArray(lista) ? lista : []) {
      if (!x || typeof x.onClick !== 'function' || !x.label) continue;
      const r = (x.verbo && Disp.VERBI[x.verbo] ? { verbo: x.verbo, oggetto: x.oggetto || '' } : null) || Disp.verboDellEtichetta(x.label);
      const verbo = r ? r.verbo : `scritta:${x.label}`;
      if (!perVerbo.has(verbo)) perVerbo.set(verbo, []);
      perVerbo.get(verbo).push({ ...x, oggettoScritto: r ? r.oggetto : '' });
    }
    return [...perVerbo.entries()].map(([verbo, voci]) => {
      const d = Disp.VERBI[verbo] || null;
      const [a, ...altre] = voci;
      const nome = d ? d.nome : a.label;
      const misura = (x) => (typeof x.azione === 'string' && x.azione ? { azione: x.azione } : {});
      return {
        id: '', verbo: d ? verbo : '', icon: d ? I(a.icona && global.SN_ICONS[a.icona] ? a.icona : d.icona) : I('list'),
        nome, oggetto: d ? a.oggettoScritto : '', tasto: d ? d.tasto : '', label: a.label, onClick: a.onClick,
        disabled: !!a.disabled, bersaglio: a.bersaglio || null, draggable: false, ...misura(a),
        ...(a.nota ? { nota: String(a.nota) } : {}),
        ...(altre.length ? { varianti: altre.map((x) => ({ label: x.label, onClick: x.onClick, bersaglio: x.bersaglio || null, disabled: !!x.disabled, ...misura(x) })) } : {}),
      };
    });
  }

  // Un verbo che c'è già nella griglia prende la voce scritta come variante (con una selezione «Copia» copia la
  // selezione, e «Copia il messaggio» sta nel suo menu); le altre voci scritte vengono prima, sono dell'elemento.
  function unisci(scritte, inFila, inAltro) {
    const tutte = [...inFila, ...inAltro];
    const restano = [];
    for (const s of scritte) {
      const stessa = s.verbo && tutte.find((v) => v.verbo === s.verbo);
      if (!stessa) { restano.push(s); continue; }
      stessa.varianti = [...(stessa.varianti || []), { label: s.label, onClick: s.onClick, bersaglio: s.bersaglio, ...(s.azione ? { azione: s.azione } : {}) }, ...(s.varianti || [])];
    }
    return restano;
  }

  // Un tasto per icona: quello del verbo, o se è già preso una lettera del suo nome ancora libera.
  function tastiUnici(voci) {
    const presi = new Set();
    for (const v of voci) {
      if (!v || v.kind === 'overflow') continue;
      const vuole = String(v.tasto || '').toLowerCase();
      let t = vuole && !presi.has(vuole) ? vuole : '';
      if (!t) {
        const lettere = String(v.nome || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
        t = [...lettere].find((c) => !presi.has(c)) || '';
      }
      v.tasto = t;
      if (t) presi.add(t);
    }
  }

  function costruisci() {
    if (!aperta) return null;
    const { contesto, azioni } = aperta;
    const regPagina = registro();
    const regFinestra = registroFinestra();
    const { fila: ids, altro } = aperta.soloScritte ? { fila: [], altro: [] } : Disp.filaDi(disposizione(), contesto);
    const voci = (lista) => lista.map((id) => voce(id, azioni, regPagina, regFinestra)).filter(Boolean);
    const inFila = voci(ids);
    const inAltro = voci(altro);
    const scritte = unisci(vociScritte(aperta.scritte), inFila, inAltro);
    const griglia = [...scritte, ...inFila];
    tastiUnici([...griglia, ...inAltro]);
    const items = [...griglia, {
      kind: 'overflow',
      icon: global.SN_ICONS.plus(16),
      label: I18n.t('menu_overflow'),
      nome: I18n.t('menu_overflow'),
    }];
    return { items, inAltro, vuota: !griglia.length && !inAltro.length };
  }

  // La griglia per il menu che si sta aprendo. `azioni`: { <azione>: { onClick | su, label?, nome?, icona?, tieneAperto?,
  // disabled?, acceso?, valore?, iconaImg? } }, quelle che l'elemento sotto il mouse permette; `icona` e `nome` dicono lo
  // stato (Riproduci o Pausa), `acceso` uno stato acceso (Grassetto, l'audio), `valore` un'azione col valore come icona.
  // `opzioni`: { bersagli: { <oggetto>: [rect] }, oggetti: { <oggetto>: frase }, scritte: [voci delle pagine di Filo],
  // aspetto: { icona, colonne }, oggetto: la frase della riga del nome a riposo, rifai: () => azioni }.
  function fila(contesto, azioni = {}, opzioni = {}) {
    if (!Object.prototype.hasOwnProperty.call(Disp.CONTESTI, contesto)) { aperta = null; return null; }
    const o = opzioni && typeof opzioni === 'object' ? opzioni : {};
    // `rifai`: come rifare le azioni quando lo stato dell'elemento cambia a menu aperto (la velocità girata con la rotella).
    rifacitore = typeof o.rifai === 'function' ? o.rifai : null;
    aperta = {
      contesto, azioni: azioni || {}, bersagli: o.bersagli || {}, oggetti: o.oggetti || {}, scritte: o.scritte || [],
      aspetto: o.aspetto || {}, soloScritte: o.soloScritte === true,
    };
    const c = costruisci();
    return {
      type: 'row',
      contesto,
      dropTarget: aperta.soloScritte ? '' : Disp.zonaFila(contesto),
      onDrop: (e) => applyIconDrop(e),
      items: c.items,
      altro: { items: c.inAltro, dropTarget: aperta.soloScritte ? '' : Disp.zonaAltro(contesto), onDrop: (e) => applyIconDrop(e) },
      aspetto: aperta.aspetto,
      oggetto: String(o.oggetto || ''),
      vuota: c.vuota,
    };
  }

  // Sul posto, senza chiudere il menu: chi riordina continua a riordinare. Serve anche quando cambia lo stato che
  // decide il NOME di un'icona mentre il menu è sotto gli occhi (lo schermo intero spento da un'altra strada, #514), o
  // il valore girato con la rotella. `azioni` nuove, se lo stato dell'elemento è cambiato.
  let rifacitore = null;
  function ridisegna(azioni) {
    if (!aperta || !Menu.isOpen?.()) return;
    if (!azioni && rifacitore) { try { azioni = rifacitore(); } catch (_) { azioni = null; } }
    if (azioni && typeof azioni === 'object') aperta.azioni = azioni;
    const c = costruisci();
    if (!c) return;
    try { Menu.refreshIconRow?.(c.items, { vuota: c.vuota, altro: c.inAltro }); } catch (_) {}
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

  // ── Ogni menu del tasto destro è a icone (#2555) ────────────────────────────────────────────────────────────────
  // Una voce scritta rimasta fuori dalla griglia (il menu di un avviso, di un file trovato dall'Aiuto, il correttore)
  // ci entra per il suo verbo; restano testo solo le spiegazioni, le proposte e i dati (`dato: true`).
  const azioneScritta = (x) => !!x && (x.type === 'item' || !x.type) && !!x.label && typeof x.onClick === 'function' && !x.dato;
  function senzaSeparatoriVuoti(lista) {
    const out = [];
    for (const x of lista) {
      if (x && x.type === 'separator' && (!out.length || out[out.length - 1].type === 'separator' || out[out.length - 1].type === 'row')) continue;
      out.push(x);
    }
    while (out.length && out[out.length - 1] && out[out.length - 1].type === 'separator') out.pop();
    return out;
  }
  function aIcone(items) {
    const lista = Array.isArray(items) ? items.filter(Boolean) : [];
    const scritte = lista.filter(azioneScritta);
    if (!scritte.length) return lista;
    const resto = lista.filter((x) => !azioneScritta(x));
    const riga = resto.find((x) => x.type === 'row');
    if (riga && aperta) {
      aperta.scritte = [...aperta.scritte, ...scritte];
      const c = costruisci();
      Object.assign(riga, { items: c.items, altro: { ...(riga.altro || {}), items: c.inAltro }, vuota: c.vuota });
      return senzaSeparatoriVuoti(resto);
    }
    return senzaSeparatoriVuoti([fila('pagina', {}, { scritte, soloScritte: true, aspetto: deps.aspetto?.() || {} }), ...resto]);
  }

  // Il menu proprio di una pagina di Filo, a icone come quello del tasto destro (#2555): `voci` [{ label, onClick,
  // verbo?, icona?, disabled?, bersaglio? }], `elemento` quello su cui agisce, contornato passando sulle icone.
  // `sopra`: aperto da dentro un riquadro di Filo che sta già in cima (la spiegazione di una parola), il menu va sopra.
  function apriVoci({ x, y, voci, elemento = null, oggetto = '', spiegazione = '', alChiudere, sopra = false } = {}) {
    let bersaglio = null;
    try {
      const r = elemento && elemento.getBoundingClientRect ? elemento.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.height > 0) bersaglio = [{ x: r.left, y: r.top, w: r.width, h: r.height }];
    } catch (_) {}
    const scritte = (Array.isArray(voci) ? voci : []).filter(azioneScritta).map((v) => ({ bersaglio, ...v }));
    if (!scritte.length) return false;
    const griglia = fila('pagina', {}, { scritte, soloScritte: true, oggetto, aspetto: deps.aspetto?.() || {} });
    // `spiegazione`: una riga che spiega, sotto la griglia, come le spiegazioni del tasto destro.
    Menu.open({ x, y, alChiudere, items: [griglia, ...(spiegazione ? [{ type: 'inline', content: String(spiegazione) }] : [])] });
    return true;
  }
  {
    const apriPrima = Menu.open;
    Menu.open = (o) => apriPrima(o && Array.isArray(o.items) ? { ...o, items: aIcone(o.items) } : o);
  }

  // Lo stato delle icone della finestra è cambiato col menu aperto (lo schermo intero spento da un'altra strada, #514).
  function ridisegnaFinestra() {
    chiediFinestra().then(() => ridisegna(), () => ridisegna());
  }

  loadIconLayout();

  global.SN_MENU_ICONS = {
    init, fila, runIconAction, statoPerBarra, layoutCambiato, dallaBarra, aggiorna: () => ridisegna(), apriVoci,
    prepara: chiediFinestra,
    redrawIconRows: ridisegnaFinestra,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
