// Popup risposta AI: streaming, posa, trascinamento, conversazione.
// Più popup insieme: aprirne uno nuovo non chiude i precedenti.

(function (global) {
  'use strict';

  const { MSG, PORTS } = global.SN_MSG;
  const { PROMPTS, ACTIONS, spiegazioneDaMostrare } = global.SN_CONST;
  const I18n = global.SN_I18N;

  // Stack di popup aperti. L'ultimo è il topmost.
  const popups = [];

  // Un errore dell'AI detto all'utente, dalla risposta dell'IPC (`error`) o
  // dello stream (`message`). La regola sta in SN_CHAT_ERRORS, una volta sola:
  // ricomporla qui faceva arrivare la riga grezza del servizio (#663).
  function frasePerLUtente(res) {
    const generico = I18n.t('err_provider_failed');
    const CE = global.SN_CHAT_ERRORS;
    if (!CE) return (res && (res.error || res.message)) || generico;
    const r = { ...(res || {}) };
    if (!r.error && r.message) r.error = r.message;
    return CE.sentence(CE.fromResponse(r, generico));
  }

  // Il tasto che toglie l'ostacolo, sotto la frase che lo nomina. Su una pagina
  // web «riscattalo nella pagina Crediti» è un'indicazione senza strada: da lì
  // l'utente a quella pagina non sa arrivare (#663). `dopo`: chi lo ospita si chiude (il menu, l'avviso).
  function paginaDelRimedio(res) {
    const CE = global.SN_CHAT_ERRORS;
    return CE && CE.rimedioPagina ? CE.rimedioPagina(res) : null;
  }
  function apriRimedio(pagina) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: pagina.url })).catch(() => {}); } catch (_) {}
  }
  function mostraRimedio(host, res, { dopo = null } = {}) {
    const pagina = paginaDelRimedio(res);
    if (!host || !pagina) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-msg-rimedio';
    btn.textContent = pagina.label;
    if (pagina.title) btn.title = pagina.title;
    btn.addEventListener('click', (e) => {
      // Il tasto sta nel documento del sito: un clic finto della pagina non apre schede.
      const vero = global.SN_FILO_UI?.veroONostro ? global.SN_FILO_UI.veroONostro(e) : e.isTrusted;
      if (!vero) return;
      e.stopPropagation();
      apriRimedio(pagina);
      if (typeof dopo === 'function') dopo();
    });
    host.appendChild(btn);
    return btn;
  }

  // Un errore dell'AI mostrato in un riquadro: la frase e, sotto, la strada per togliere l'ostacolo. Viaggiano
  // insieme da qui perché ogni superficie che scriveva solo la frase lasciava l'utente senza strada (#663).
  function scriviErrore(host, res, opts) {
    if (!host) return null;
    conta({ misura: 'errore-modello', code: String((res && (res.code || res.errorCode)) || ''), status: Number(res && res.status) || 0 });
    host.textContent = frasePerLUtente(res);
    return mostraRimedio(host, res, opts);
  }

  // z-index iniziale e step per stacking deterministico
  const Z_BASE = 2147483600;
  const Z_STEP = 1;

  // ----------------------------------------------------------------
  // Calcolatrice locale e marker [[calc: ...]]: logica pura, sta in
  // src/shared/calcMarkers.js (regole di formato in tests/unit/).
  // ----------------------------------------------------------------
  const Calc = global.SN_CALC;
  const resolveCalcMarkers = (text, opts) => (Calc ? Calc.resolveCalcMarkers(text, opts) : (text || ''));

  // Il risultato va in innerHTML e il testo del modello non è fidato: senza
  // SN_MARKDOWN (#418) si mostra come testo, mai come HTML (#853).
  const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function renderMarkdown(text) {
    const Md = global.SN_MARKDOWN;
    if (Md) return Md.render(text);
    return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ESCAPE[c]).replace(/\n/g, '<br>');
  }

  // I collegamenti che un modello scrive qui (popup, «Spiega», assistente di pagina: classe filo-md-link) li apre il
  // main dopo la porta delle uscite (#810), per ogni gesto: un window.open da qui sembrerebbe della pagina e non passa.
  function paroleAccanto(el) {
    if (el.closest && el.closest('.sn-sidebar')) {
      try { return global.SN_SIDEBAR?.paroleUtente?.() || []; } catch (_) { return []; }
    }
    const p = popups.find((x) => x.root && x.root.contains(el));
    // Il primo messaggio lo compone Filo dalla selezione: è testo della pagina, non parole dell'utente.
    return p ? p.conversation.slice(1).filter((m) => m && m.role === 'user').map((m) => String(m.content || '')) : [];
  }

  function avvisaFermata(el, frase) {
    if (el.closest && el.closest('.sn-sidebar') && global.SN_SIDEBAR?.notaFermata) {
      global.SN_SIDEBAR.notaFermata(frase);
      return;
    }
    showToast(frase.charAt(0).toUpperCase() + frase.slice(1), { duration: 6000 });
  }

  // Scritto da un modello (src/shared/filoMarkdown.js): nelle pagine di Filo, senza verdetto, chiede l'OK (#1505).
  const conVerdetto = (el) => (global.SN_MARKDOWN?.scrittoDaUnModello
    ? global.SN_MARKDOWN.scrittoDaUnModello(el)
    : !!(el && el.closest && el.closest('a.filo-md-link, [data-filo-verdetti]')));

  // Un OK che il main chiede si dà qui; `false` se l'utente dice di no.
  async function chiediOk(r) {
    const Ui = global.SN_CONFIRM_UI;
    return Ui ? Ui.confirm({ title: 'Filo chiede conferma', text: String(r.conferma), parti: r.parti }) : false;
  }

  async function apriCollegamento(a, { sfondo = false } = {}) {
    const url = a && a.getAttribute ? a.getAttribute('href') : '';
    if (!url) return;
    const msg = { type: MSG.APRI_COLLEGAMENTO_FILO, url, parole: paroleAccanto(a), sfondo, proposta: conVerdetto(a) };
    let r = null;
    try { r = await chrome.runtime.sendMessage(msg); } catch (_) {}
    // Un dato dell'utente in un link scritto sopra una pagina chiede l'OK, come se lo aprisse l'assistente (#868.6).
    if (r && r.conferma) {
      if (!(await chiediOk(r))) return;
      try { r = await chrome.runtime.sendMessage({ ...msg, confermato: true }); } catch (_) { r = null; }
    }
    if (r && r.frase && !r.avvisato) avvisaFermata(a, r.frase);
  }

  // Lo scaricamento di un collegamento scritto da un modello passa dalla stessa porta, e chiede lo stesso OK.
  async function scaricaCollegamento(a) {
    const url = a && a.getAttribute ? a.getAttribute('href') : '';
    if (!url) return null;
    const msg = { type: MSG.DOWNLOAD_LINK, url, diFilo: true, parole: paroleAccanto(a), proposta: conVerdetto(a) };
    let r = null;
    try { r = await chrome.runtime.sendMessage(msg); } catch (_) {}
    if (r && r.conferma) {
      if (!(await chiediOk(r))) return { ok: false, annullato: true };
      try { r = await chrome.runtime.sendMessage({ ...msg, confermato: true }); } catch (_) { r = null; }
    }
    if (r && r.frase) { if (!r.avvisato) avvisaFermata(a, r.frase); } else if (!r || r.ok === false) toastErrore('toast_file_save_failed');
    return r;
  }

  // Nelle pagine di Filo la chat ha la sua porta: lì il clic arriva in bolla, dopo quella, e chiede al main come sui
  // siti, col segno del modello (#1505). Nelle pagine web in cattura sulla finestra: un antenato che fermasse il clic
  // lascerebbe al collegamento l'apertura da sé, senza porta. Il tasto centrale ovunque: lasciato al browser apriva
  // senza il segno del modello, quindi senza l'OK che il clic chiede.
  const inPaginaDiFilo = location.protocol === 'filo:';
  const suCollegamento = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    const t = global.SN_FILO_UI?.bersaglio ? global.SN_FILO_UI.bersaglio(e) : e.target;
    const a = t && t.closest && t.closest('a.filo-md-link');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    // Sui siti un clic fabbricato sull'host di un riquadro chiuso arriva qui col bersaglio sotto le sue coordinate:
    // il collegamento lo apre solo il clic dell'utente (#1071).
    if (!inPaginaDiFilo && !global.SN_FILO_UI?.veroONostro?.(e)) return;
    apriCollegamento(a, { sfondo: e.type === 'auxclick' || e.ctrlKey || e.metaKey });
  };
  if (inPaginaDiFilo) {
    document.addEventListener('click', suCollegamento);
    document.addEventListener('auxclick', suCollegamento);
  } else {
    window.addEventListener('click', suCollegamento, true);
    window.addEventListener('auxclick', suCollegamento, true);
  }

  // In un sito i riquadri che portano parole dell'utente o dei modelli stanno in uno shadow root chiuso, chiusi ai gesti
  // finti: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md. L'host non genera un box.
  const FOGLI_RIQUADRO = ['theme.css', 'menu.css', 'popup.css', 'feedback.css', 'redteam-attack.css', 'spellcheck.css'];
  const FONT_SOLO_GENERICO = '*, ::before, ::after, ::placeholder { font-family: system-ui, sans-serif !important; }';
  let fogliRiquadro = null;
  function fogliDelRiquadro() {
    if (fogliRiquadro) return fogliRiquadro;
    let testo = '';
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      testo = FOGLI_RIQUADRO.map((f) => fs.readFileSync(path.join(__dirname, '..', 'styles', f), 'utf8')).join('\n');
    } catch (_) {}
    testo += '\n' + FONT_SOLO_GENERICO;
    const foglio = new CSSStyleSheet();
    try { foglio.replaceSync(testo); } catch (_) {}
    fogliRiquadro = [foglio];
    return fogliRiquadro;
  }
  function riquadro(contenuto) {
    if (inPaginaDiFilo) return contenuto;
    const UI = global.SN_FILO_UI;
    const host = document.createElement('div');
    UI?.mark(host);
    host.style.cssText = 'all:initial!important;display:contents!important;';
    const radice = UI?.ombra ? UI.ombra(host) : host.attachShadow({ mode: 'closed' });
    try { radice.adoptedStyleSheets = fogliDelRiquadro(); } catch (_) {}
    // I tasti scritti qui dentro il sito non li vede: SN_FILO_UI.tastoNelRiquadro.
    UI?.soloGestiVeri(contenuto);
    radice.appendChild(contenuto);
    return host;
  }
  function togliRiquadro(contenuto) {
    const host = contenuto && contenuto.getRootNode && contenuto.getRootNode().host;
    try { (host || contenuto).remove(); } catch (_) {}
  }

  // Compensazione zoom (Ctrl +/-, pinch). Identica per popup e menu.
  function attachZoomCompensation(root) {
    const vv = window.visualViewport;
    const baselineDpr = window.devicePixelRatio || 1;
    const baselineVv = vv?.scale || 1;
    const apply = () => {
      const curDpr = window.devicePixelRatio || 1;
      const curVv = vv?.scale || 1;
      const zoomRatio = (curDpr / baselineDpr) * (curVv / baselineVv);
      const scale = 1 / zoomRatio;
      root.style.transform = scale === 1 ? '' : `scale(${scale})`;
      // Scala dal bordo ANCORATO alla selezione, non sempre dall'alto: un riquadro agganciato
      // col fondo si staccherebbe dal punto appena l'utente cambia zoom.
      const bottomAnchored = root.style.bottom && root.style.bottom !== 'auto';
      root.style.transformOrigin = bottomAnchored ? 'bottom left' : 'top left';
    };
    apply();
    const onResize = () => apply();
    window.addEventListener('resize', onResize);
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    let mql = null;
    try {
      mql = window.matchMedia(`(resolution: ${baselineDpr}dppx)`);
      mql.addEventListener?.('change', onResize);
    } catch (_) {}
    return () => {
      window.removeEventListener('resize', onResize);
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
      try { mql?.removeEventListener?.('change', onResize); } catch (_) {}
    };
  }

  // ESC chiude solo il topmost. Listener globale registrato una volta.
  let escInstalled = false;
  function installEscOnce() {
    if (escInstalled) return;
    escInstalled = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || popups.length === 0) return;
      const top = popups[popups.length - 1];
      // Le entry esterne (es. feedback) gestiscono la propria chiusura
      if (top.isExternal) return;
      closePopup(top);
      e.stopPropagation();
    }, true);
  }

  function attachDrag(root, handle, onDragStart, onDragEnd) {
    let dx = 0, dy = 0;
    let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sn-popup-close')) return;
      bringToFront(rootToPopup(root));
      const rect = root.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      dragging = true;
      handle.classList.add('sn-popup-dragging');
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      e.preventDefault();
    });
    function onMove(e) {
      if (!dragging) return;
      // Il riquadro si è MOSSO davvero (un clic sull'intestazione non conta): da qui la posa è
      // dell'utente, e chi rimisura si limita a tenerlo dentro lo schermo.
      try { onDragStart && onDragStart(); } catch (_) {}
      let left = e.clientX - dx;
      let top = e.clientY - dy;
      // L'ingombro si misura VISIBILE (`getBoundingClientRect`), non di layout: la compensazione
      // zoom mette una `scale()` e le due misure coincidono solo al 100% (#502).
      const r = root.getBoundingClientRect();
      const w = r.width, h = r.height;
      const vw = window.innerWidth, vh = window.innerHeight;
      // Stesso ORDINE del guardiano: il bordo di sopra vince su quello di sotto. Se il riquadro
      // è più alto della finestra a cedere dev'essere il fondo, o esce l'intestazione.
      if (left + w > vw) left = vw - w;
      if (top + h > vh) top = vh - h;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      root.style.left = left + 'px';
      root.style.top = top + 'px';
    }
    function onUp() {
      dragging = false;
      handle.classList.remove('sn-popup-dragging');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      // Lasciato il riquadro, l'ultima parola è del guardiano: se è più alto della finestra il
      // limite del mouse può solo spostarlo, mentre lui sa anche stringergli il tetto.
      try { onDragEnd && onDragEnd(); } catch (_) {}
    }
  }

  function rootToPopup(root) {
    return popups.find((p) => p.root === root);
  }
  function bringToFront(popup) {
    if (!popup) return;
    const idx = popups.indexOf(popup);
    if (idx < 0) return;
    if (idx === popups.length - 1) return;
    popups.splice(idx, 1);
    popups.push(popup);
    popups.forEach((p, i) => { p.root.style.zIndex = String(Z_BASE + i * Z_STEP); });
  }

  // Registra un elemento esterno (la modale feedback) nello stack, così partecipa allo
  // z-ordering condiviso. La chiusura resta del chiamante.
  function registerStack(root) {
    if (!root) return null;
    const entry = { root, isExternal: true };
    popups.push(entry);
    root.style.zIndex = String(Z_BASE + (popups.length - 1) * Z_STEP);
    const onMd = () => bringToFront(entry);
    root.addEventListener('mousedown', onMd, true);
    return {
      bringToFront: () => bringToFront(entry),
      unregister: () => {
        const idx = popups.indexOf(entry);
        if (idx >= 0) popups.splice(idx, 1);
            try { root.removeEventListener('mousedown', onMd, true); } catch (_) {}
      },
    };
  }

  // Posa: il lato si sceglie subito e non cambia più, il bordo ancorato lo tiene il CSS.
  // Il racconto: patterns/un-riquadro-che-si-riempie-dopo-si-ancora-dal-lato.md.
  const POSE_MARGIN = 8;   // aria fra riquadro e bordi della finestra
  const POSE_GAP = 8;      // stacco fra riquadro e punto ancorato
  const POSE_MAX_H_FALLBACK = 480;
  const POSE_W_FALLBACK = 380;
  // Stati di compressione, definiti nel foglio di stile: il corpo perde il suo minimo e
  // scorre; poi va via anche la riga del costo.
  const POSE_TIGHT = 'sn-popup-tight';
  const POSE_BARE = 'sn-popup-bare';

  // Il tetto lo tiene il foglio di stile: lo leggiamo invece di ricopiarlo, così
  // se cambia lì la posa lo segue da sola.
  function styleMaxHeight(root) {
    let v = NaN;
    try { v = parseFloat(getComputedStyle(root).maxHeight); } catch (_) {}
    return Number.isFinite(v) && v > 0 ? v : POSE_MAX_H_FALLBACK;
  }

  // La larghezza naturale sta in una variabile del foglio di stile e non in `width`: quella
  // è già clampata dal max-width, e rileggerla terrebbe la misura di quando c'era meno posto.
  function styleWidth(root) {
    let v = NaN;
    try { v = parseFloat(getComputedStyle(root).getPropertyValue('--sn-popup-w')); } catch (_) {}
    return Number.isFinite(v) && v > 0 ? v : POSE_W_FALLBACK;
  }

  function attachPose(root, anchor) {
    // Il punto ancorato si ritaglia sulla finestra a OGNI misura: zoom e ridimensionamento lo
    // lasciano fuori. Sopra si misura dalla CIMA della parola, sotto dal suo FONDO.
    const rawX = Number.isFinite(anchor?.x) ? anchor.x : POSE_MARGIN;
    const rawY = Number.isFinite(anchor?.y) ? anchor.y : POSE_MARGIN;
    const rawYSopra = Number.isFinite(anchor?.top) ? anchor.top : rawY;
    const rawYSotto = Number.isFinite(anchor?.bottom) ? anchor.bottom : rawY;
    const dentro = (v, max) => Math.max(POSE_MARGIN, Math.min(max - POSE_MARGIN, v));
    const ax = () => dentro(rawX, window.innerWidth);
    const ayCima = () => dentro(rawYSopra, window.innerHeight);
    const ayFondo = () => dentro(rawYSotto, window.innerHeight);
    // Letto PRIMA di scrivere il tetto inline: dopo rileggeremmo il nostro
    // stesso valore e lo stringeremmo a ogni giro.
    const maxH = styleMaxHeight(root);
    const baseW = styleWidth(root);
    let side = null;
    let dragged = false;
    let ro = null;

    const roomBelow = () => window.innerHeight - (ayFondo() + POSE_GAP) - POSE_MARGIN;
    const roomAbove = () => ayCima() - POSE_GAP - POSE_MARGIN;

    // La compensazione zoom mette una `scale()` sul riquadro: il tetto è in px di layout, lo
    // spazio sullo schermo in px visibili, e senza la scala sarebbe sbagliato del fattore zoom.
    function scale() {
      try {
        const t = getComputedStyle(root).transform;
        if (!t || t === 'none') return 1;
        const m = new DOMMatrixReadOnly(t);
        return m.a > 0 ? m.a : 1;
      } catch (_) { return 1; }
    }

    // `max-height` misura il CONTENUTO quando il box è content-box: bordi e imbottitura stanno
    // fuori da quel numero, mentre lo spazio sullo schermo li comprende.
    function boxExtra() {
      try {
        const cs = getComputedStyle(root);
        if (cs.boxSizing === 'border-box') return 0;
        return (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
          + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      } catch (_) { return 0; }
    }

    function boxExtraX() {
      try {
        const cs = getComputedStyle(root);
        if (cs.boxSizing === 'border-box') return 0;
        return (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
          + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      } catch (_) { return 0; }
    }

    // Chi cede quando lo spazio si stringe (#502): prima il corpo, che scorre fino a sparire,
    // poi la riga del costo. Intestazione e riga per scrivere non cedono mai.
    const headerEl = root.querySelector('.sn-popup-header');
    const bodyEl = root.querySelector('.sn-popup-body');
    const footerEl = root.querySelector('.sn-popup-footer');
    const composeEl = root.querySelector('.sn-popup-compose');
    // In px di LAYOUT: sullo schermo la compensazione zoom li scala.
    const altezza = (el) => (el ? el.getBoundingClientRect().height / (scale() || 1) : 0);

    // Quanto occupa il corpo al minimo in ogni gradino, letto ORA dal foglio di stile e non
    // ricopiato: `min-height: 0` lascia un residuo di imbottitura che va messo in bilancio.
    const residuoCorpo = (classi) => {
      if (!bodyEl) return 0;
      const messe = classi.filter((c) => !root.classList.contains(c));
      messe.forEach((c) => root.classList.add(c));
      let v = 0;
      try {
        const cs = getComputedStyle(bodyEl);
        v = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
          + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      } catch (_) { v = 0; }
      messe.forEach((c) => root.classList.remove(c));
      return v;
    };
    const bodyComfort = (() => {
      if (!bodyEl) return 0;
      let mh = 0, bordo = residuoCorpo([]);
      try {
        const cs = getComputedStyle(bodyEl);
        mh = parseFloat(cs.minHeight) || 0;
        return cs.boxSizing === 'border-box' ? Math.max(mh, bordo) : mh + bordo;
      } catch (_) { return bordo; }
    })();
    const bodyStretto = residuoCorpo([POSE_TIGHT]);
    const bodyNudo = residuoCorpo([POSE_TIGHT, POSE_BARE]);
    // Idem per la riga del costo: da nascosta misurerebbe zero e non tornerebbe più. Nasce
    // vuota, ma il foglio di stile le dà già l'altezza che avrà piena.
    const footerH = altezza(footerEl);

    // Quello che non cede mai. Misurato ogni volta: la riga per scrivere si
    // allarga quando la domanda è lunga.
    const incomprimibile = () => altezza(headerEl) + altezza(composeEl);

    // Minimo e tetto naturale della casella, letti UNA VOLTA e prima di scriverci sopra il
    // tetto ristretto: dopo rileggeremmo il nostro stesso valore, stringendolo a ogni giro.
    const inputEl = root.querySelector('.sn-popup-input');
    const misuraStile = (el, prop, ripiego) => {
      let v = NaN;
      try { v = parseFloat(getComputedStyle(el)[prop]); } catch (_) {}
      return Number.isFinite(v) && v > 0 ? v : ripiego;
    };
    const inputMin = inputEl ? misuraStile(inputEl, 'minHeight', 30) : 30;
    const inputMax = inputEl ? misuraStile(inputEl, 'maxHeight', 120) : 120;

    // I tre gradini, dal più comodo al più stretto: quanto misura il riquadro AL MINIMO in
    // ciascuno. Sotto quel numero i pezzi escono dal bordo invece di comprimersi.
    const minComodo = () => incomprimibile() + footerH + bodyComfort;
    const minStretto = () => incomprimibile() + footerH + bodyStretto;
    const minNudo = () => incomprimibile() + bodyNudo;

    // Il livello di compressione dipende SOLO dal tetto e da misure prese una volta: a parità
    // di spazio dà sempre la stessa risposta, quindi non può rincorrersi.
    function comprimi(cap) {
      root.classList.toggle(POSE_TIGHT, cap < minComodo() - 0.5);
      root.classList.toggle(POSE_BARE, cap < minStretto() - 0.5);
    }

    // Il pavimento del tetto non è una costante: è il minimo del gradino più stretto, cioè
    // quanto misurano i pezzi che non cedono mai.
    const pavimento = () => minNudo();

    function chooseSide() {
      const want = (maxH + boxExtra()) * scale();  // ingombro pieno raggiungibile
      const below = roomBelow(), above = roomAbove();
      if (below >= want) return 'below';   // ci sta tutto sotto: preferenza naturale
      if (above >= want) return 'above';
      // Nessuno dei due lati basta al riquadro pieno: si prende il più capiente. Ma se lì non ci
      // sta nemmeno il minimo il punto ancorato non è onorabile, e lo spazio è la finestra intera.
      const migliore = above > below ? 'above' : 'below';
      const spazio = Math.max(above, below);
      const minimo = (pavimento() + boxExtra()) * scale();
      if (spazio < minimo) return 'dentro';
      // Il punto ancorato si onora finché lascia LEGGERE la risposta, cioè finché il corpo tiene
      // il minimo del foglio di stile. Sotto, meglio staccarsi e appoggiarsi al bordo.
      const comodo = (minComodo() + boxExtra()) * scale();
      if (spazio >= comodo) return migliore;
      // Staccarsi costa: il riquadro copre la parola. Si fa solo se frutta almeno un corpo
      // comodo di spazio in più, o una finestra appena bassa la coprirebbe per otto pixel.
      const guadagno = (window.innerHeight - POSE_MARGIN * 2) - spazio;
      return guadagno >= bodyComfort * scale() ? 'dentro' : migliore;
    }

    // Larghezza: stesso ragionamento del tetto d'altezza sull'altro asse. In un riquadro
    // incorporato lo «schermo» è il riquadro (#405) e il tasto di invio finiva tagliato.
    function capWidth() {
      const room = (window.innerWidth - POSE_MARGIN * 2) / scale() - boxExtraX();
      root.style.maxWidth = `${Math.max(0, Math.floor(Math.min(baseW, room)))}px`;
    }

    // Da ancorato lo spazio è quello del lato scelto, da trascinato la finestra intera: la
    // posizione è dell'utente, l'ingombro no. L'altezza si rifà come già fa la larghezza.
    function roomForCap() {
      if (dragged) return window.innerHeight - POSE_MARGIN * 2;
      // 'dentro': il punto ancorato non era onorabile, il riquadro sta dove ci
      // sta e lo spazio è tutta la finestra — come da trascinato.
      if (side === 'dentro') return window.innerHeight - POSE_MARGIN * 2;
      return side === 'above' ? roomAbove() : roomBelow();
    }

    // Anche la CASELLA della domanda ha un tetto: cresce mentre si scrive e non cede mai,
    // quindi sarebbe lei a spingere fuori il tasto di invio dopo che tutto il resto ha ceduto.
    function capInput() {
      if (!inputEl) return;
      // Imbottitura e bordo della riga: quello che la riga occupa OLTRE la casella. È una
      // differenza, quindi non risente del tetto che stiamo per scrivere.
      const contorno = Math.max(0, altezza(composeEl) - altezza(inputEl));
      const room = roomForCap() / scale() - boxExtra();
      const disponibile = room - altezza(headerEl) - contorno - bodyNudo;
      const tetto = Math.max(inputMin, Math.min(inputMax, disponibile));
      inputEl.style.maxHeight = `${Math.floor(tetto)}px`;
    }

    // La riga per scrivere CRESCE con la domanda, e allora il bilancio dell'altezza è vecchio:
    // a uscire dal bordo è la riga in basso col tasto di invio (#502).
    let bilancioSu = -1;
    const bilancioVecchio = () => Math.abs(incomprimibile() - bilancioSu) > 0.5;

    // Si rifà da capo a ogni misura, in tutte e due le direzioni: un tetto che sa solo
    // stringere lascia il riquadro schiacciato per sempre quando lo spazio torna.
    function capHeight() {
      capInput();
      const room = roomForCap() / scale() - boxExtra();
      const cap = Math.min(maxH, Math.max(pavimento(), room));
      comprimi(cap);
      root.style.maxHeight = `${Math.floor(cap)}px`;
      // Preso DOPO aver stretto la casella: è l'altezza su cui questo bilancio
      // vale, e finché non cambia non c'è niente da rifare.
      bilancioSu = incomprimibile();
    }

    // Scrive le coordinate. Non dipendono dall'altezza corrente ma solo dal punto ancorato e
    // dalla finestra: finché non cambia sono costanti, e riscriverle non muove niente.
    function place() {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (dragged) return;
      const w = root.getBoundingClientRect().width || root.offsetWidth;
      let left = ax();
      if (left + w + POSE_MARGIN > vw) left = vw - w - POSE_MARGIN;
      if (left < POSE_MARGIN) left = POSE_MARGIN;
      root.style.left = `${Math.round(left)}px`;
      if (side === 'dentro') {
        // Il punto ancorato non era onorabile: il riquadro si appoggia in cima alla finestra e il
        // tetto lo tiene dentro. Anche questa coordinata resta costante.
        root.style.bottom = 'auto';
        root.style.top = `${POSE_MARGIN}px`;
      } else if (side === 'above') {
        // Il fondo resta incollato sopra la CIMA della selezione (non sopra il
        // suo fondo, o il riquadro coprirebbe la parola) e la crescita va in su.
        root.style.top = 'auto';
        root.style.bottom = `${Math.round(vh - (ayCima() - POSE_GAP))}px`;
      } else {
        root.style.bottom = 'auto';
        root.style.top = `${Math.round(ayFondo() + POSE_GAP)}px`;
      }
    }

    // Rete di sicurezza: col tetto stretto non dovrebbe sbordare, ma se succede si stringe
    // ANCORA. Solo in una direzione: non può oscillare.
    function guard() {
      // Se a cambiare è ciò che NON cede — la riga per scrivere che si allunga — il bilancio è
      // vecchio e va rifatto. Rifarlo solo quando quel numero cambia evita di rincorrersi.
      if (bilancioVecchio()) capHeight();
      if (dragged) {
        // Trascinato: lì la posa è dell'utente, si sposta solo se esce.
        const vw = window.innerWidth, vh = window.innerHeight;
        let r = root.getBoundingClientRect();
        // Ma prima di spostarlo va fatto STARE: da trascinato non c'è un bordo ancorato, quindi se
        // non ci sta è perché è più alto della finestra, e va stretto il tetto.
        const fuori = r.height - vh;
        if (fuori > 0.5) {
          const cur = parseFloat(root.style.maxHeight) || root.offsetHeight;
          const next = Math.max(pavimento(), Math.floor(cur - fuori / scale()));
          comprimi(next);
          if (next < cur) { root.style.maxHeight = `${Math.floor(next)}px`; }
          r = root.getBoundingClientRect();
        }
        let left = parseFloat(root.style.left) || 0;
        let top = parseFloat(root.style.top) || 0;
        if (top + r.height > vh) top = vh - r.height;
        if (left + r.width > vw) left = vw - r.width;
        if (top < 0) top = 0;
        if (left < 0) left = 0;
        root.style.left = `${Math.round(left)}px`;
        root.style.top = `${Math.round(top)}px`;
        return;
      }
      const vh = window.innerHeight;
      let r = root.getBoundingClientRect();
      // Guarda TUTTI E DUE i bordi: sul lato libero sborda il contenuto e si stringe il tetto,
      // sul lato ancorato stringere non serve e va riportato dentro di peso.
      const libero = side === 'above'
        ? POSE_MARGIN - r.top
        : r.bottom - (vh - POSE_MARGIN);
      if (libero > 0.5) {
        const cur = parseFloat(root.style.maxHeight) || root.offsetHeight;
        const next = Math.max(pavimento(), Math.floor(cur - libero / scale()));
        // Stringere il tetto senza far cedere nessuno non stringe niente: il livello di
        // compressione va rifatto sul tetto nuovo, anche quando era già al pavimento.
        comprimi(next);
        // Rileggere subito costa un layout, ma senza non sapremmo se lo
        // stringimento è bastato.
        if (next < cur) { root.style.maxHeight = `${Math.floor(next)}px`; }
        r = root.getBoundingClientRect();
      }
      if (POSE_MARGIN - r.top <= 1 && r.bottom - (vh - POSE_MARGIN) <= 1) return;
      // Sborda ancora: o il tetto è al minimo, o a sbordare è il bordo ancorato. Meglio coprire
      // il punto ancorato che restare fuori dallo schermo, dove non si clicca.
      const top = Math.max(0, Math.min(vh - r.height, r.top));
      root.style.bottom = 'auto';
      root.style.top = `${Math.round(top)}px`;
    }

    function refresh() { place(); guard(); }

    capWidth();
    side = chooseSide();
    capHeight();
    place();
    // La prima misura utile arriva dopo il layout del contenuto iniziale.
    requestAnimationFrame(refresh);

    // Rete: ogni cambio d'altezza — delta in arrivo, bolla di follow-up,
    // casella di testo che si allarga — ripassa dal guardiano.
    try {
      ro = new ResizeObserver(() => guard());
      ro.observe(root);
    } catch (_) {}

    // Finestra ridimensionata o zoom cambiato: il tetto si rifà DA CAPO, anche verso l'alto,
    // e la posa si riscrive sul punto ancorato ritagliato sulla finestra di adesso.
    const vv = window.visualViewport;
    // Larghezza E altezza si rifanno sempre, anche da trascinato: la posa è dell'utente,
    // l'ingombro non l'ha scelto nessuno.
    const onViewport = () => { capWidth(); capHeight(); refresh(); };
    window.addEventListener('resize', onViewport);
    vv?.addEventListener('resize', onViewport);
    // Lo zoom della pagina cambia la risoluzione: rete per i casi in cui `resize` non arriva.
    // Registrata DOPO la compensazione zoom, così alla rimisura la `scale()` è già quella nuova.
    let mql = null;
    try {
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mql.addEventListener?.('change', onViewport);
    } catch (_) {}

    return {
      // Ripassa SUBITO, in modo sincrono: il ResizeObserver consegna solo al passo di rendering,
      // che in una scheda in secondo piano è strozzato. Chi allunga il contenuto chiama questa.
      reflow: refresh,
      markDragged() {
        if (dragged) return;
        dragged = true;
        // Da qui in poi comanda `top`: con `top` e `bottom` insieme e altezza
        // automatica il riquadro verrebbe stirato fra i due bordi.
        const r = root.getBoundingClientRect();
        root.style.bottom = 'auto';
        root.style.top = `${Math.round(r.top)}px`;
        // Cambiato il bordo ancorato cambia anche il punto da cui scala la compensazione zoom:
        // si anticipa qui, o passa un fotogramma in cui i conti parlano di un posto sbagliato.
        root.style.transformOrigin = 'top left';
        // Preso in mano, lo spazio non è più quello del lato ancorato ma la finestra intera:
        // rifare il tetto qui gli ridà l'altezza che lo spazio consente.
        capHeight();
      },
      dispose() {
        try { ro?.disconnect(); } catch (_) {}
        window.removeEventListener('resize', onViewport);
        try { vv?.removeEventListener('resize', onViewport); } catch (_) {}
        try { mql?.removeEventListener?.('change', onViewport); } catch (_) {}
      },
    };
  }

  function closePopup(popup) {
    if (!popup) return;
    try { popup.activePort?.disconnect(); } catch (_) {}
    try { popup.cleanupZoom?.(); } catch (_) {}
    try { popup.pose?.dispose(); } catch (_) {}
    togliRiquadro(popup.root);
    const idx = popups.indexOf(popup);
    if (idx >= 0) popups.splice(idx, 1);
    // Rimette la selezione che il fuoco della riga per scrivere aveva spento, pronta per la
    // cosa dopo. Solo se nel frattempo l'utente non ne ha fatta una sua, che comanda lei.
    try {
      const sel = window.getSelection();
      if (popup.savedRange && sel && (sel.rangeCount === 0 || sel.isCollapsed)) {
        sel.removeAllRanges();
        sel.addRange(popup.savedRange);
      }
    } catch (_) {}
  }

  function closeTopmost() {
    if (popups.length) closePopup(popups[popups.length - 1]);
  }

  // La casella della domanda si allunga con quello che ci si scrive dentro.
  // Due cose che sembrano dettagli e non lo sono:
  //  • il TETTO non si ricopia qui. Lo tiene il foglio di stile, e la posa lo
  //    stringe allo spazio che c'è quando la finestra è bassa — un numero
  //    ricopiato terrebbe il tetto pieno anche dove non ci sta, ed è così che
  //    la riga per scrivere finiva fuori dal riquadro (#502);
  //  • `scrollHeight` comprende l'IMBOTTITURA, `height` (se il box è
  //    content-box) no. Scriverlo tal quale lasciava la casella più alta del
  //    suo testo di quei pixel, e non li restituiva più: cancellata la domanda
  //    la casella restava gonfia e la risposta non si riprendeva lo spazio;
  //  • vuota torna alla misura con cui è nata: misurata, andrebbe a capo col
  //    segnaposto lungo e resterebbe una riga più alta di prima di scrivere.
  function autoGrow(el) {
    if (!el) return;
    if (!el.value) { el.style.height = ''; return; }
    el.style.height = 'auto';
    // scrollHeight è contenuto più imbottitura: in border-box mancano i bordi, e la riga che usciva di 2px
    // accendeva la barra (#853.1).
    let correzione = 0;
    try {
      const cs = getComputedStyle(el);
      const somma = (a, b) => (parseFloat(cs[a]) || 0) + (parseFloat(cs[b]) || 0);
      correzione = cs.boxSizing === 'border-box'
        ? somma('borderTopWidth', 'borderBottomWidth')
        : -somma('paddingTop', 'paddingBottom');
    } catch (_) {}
    el.style.height = `${Math.max(0, el.scrollHeight + correzione)}px`;
  }

  function createPopup({ title, anchor }) {
    const root = document.createElement('div');
    root.className = 'sn-popup';
    global.SN_FILO_UI?.mark(root);
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    root.style.zIndex = String(Z_BASE + popups.length * Z_STEP);
    root.innerHTML = `
      <div class="sn-popup-header">
        <span class="sn-popup-title"></span>
        <button class="sn-popup-close" type="button" aria-label="${I18n.t('popup_close')}">×</button>
      </div>
      <div class="sn-popup-body"></div>
      <div class="sn-popup-footer">
        <span class="sn-popup-meta"></span>
      </div>
      <div class="sn-popup-compose">
        <textarea class="sn-popup-input" rows="1" placeholder="${I18n.t('popup_followup_placeholder')}"></textarea>
        <button class="sn-popup-send" type="button" aria-label="${I18n.t('popup_send')}">↑</button>
      </div>
    `;
    root.querySelector('.sn-popup-title').textContent = title;
    document.documentElement.appendChild(riquadro(root));

    const cleanupZoom = attachZoomCompensation(root);
    const pose = attachPose(root, anchor);

    const popup = {
      root,
      cleanupZoom,
      pose,
      activePort: null,
      conversation: [],     // [{role, content}]
      action: null,         // ACTIONS.*
      model: '',
      provider: '',
      bodyEl: root.querySelector('.sn-popup-body'),
      metaEl: root.querySelector('.sn-popup-meta'),
      inputEl: root.querySelector('.sn-popup-input'),
      sendEl: root.querySelector('.sn-popup-send'),
    };

    root.querySelector('.sn-popup-close').addEventListener('click', () => closePopup(popup));
    attachDrag(
      root,
      root.querySelector('.sn-popup-header'),
      () => popup.pose?.markDragged(),
      () => reflow(popup),
    );

    root.addEventListener('mousedown', () => bringToFront(popup), true);

    // Send su Enter (senza Shift); Shift+Enter inserisce nuova riga. Una domanda spende una chiamata: parte solo
    // da un tasto o da un clic dell'utente, mai da uno fabbricato (#1071).
    popup.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (global.SN_FILO_UI?.veroONostro ? global.SN_FILO_UI.veroONostro(e) : e.isTrusted) submitFollowup(popup);
      }
    });
    popup.sendEl.addEventListener('click', (e) => { if (e.isTrusted) submitFollowup(popup); });
    // Auto-grow textarea
    popup.inputEl.addEventListener('input', () => {
      autoGrow(popup.inputEl);
      // Anche la casella che si allarga alza il riquadro: stessa regola.
      reflow(popup);
    });

    // Dare il fuoco alla casella spegne la selezione della pagina, ma la parola su cui si è
    // chiesta la spiegazione serve ancora dopo: ce la teniamo da parte e gliela rimettiamo.
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) popup.savedRange = sel.getRangeAt(0).cloneRange();
    } catch (_) {}

    // Il cursore va SUBITO nella riga per scrivere: chi ha chiesto con la tastiera doveva
    // passare al mouse. `preventScroll`, o un riquadro incorporato farebbe scorrere la pagina.
    try { popup.inputEl.focus({ preventScroll: true }); } catch (_) {}

    popups.push(popup);
    return popup;
  }

  function appendBubble(popup, role) {
    const wrap = document.createElement('div');
    wrap.className = `sn-msg sn-msg-${role}`;
    const text = document.createElement('div');
    text.className = 'sn-msg-text';
    wrap.appendChild(text);
    // Bolla nuova = turno nuovo, e il turno lo apre l'utente: è l'eccezione «vai comunque in
    // fondo», vuole vedere quello che ha chiesto.
    scrollaConservando(popup, () => popup.bodyEl.appendChild(wrap), true);
    return { wrap, text };
  }

  // Il corpo si aggiorna senza strappare la lettura: si segue il fondo solo se l'utente ci
  // era rimasto — patterns/liste-chat-che-si-ricostruiscono-in-streaming-auto-follow.md.
  const POPUP_FOLLOW_PX = 48;
  function scrollaConservando(popup, muta, vaiInFondo) {
    const el = popup?.bodyEl;
    if (!el) { muta(); reflow(popup); return; }
    const prevTop = el.scrollTop;
    // La tolleranza si adatta all'altezza: da compresso il corpo è alto pochi
    // pixel, e una soglia fissa di 48px direbbe "sei in fondo" sempre.
    const tolleranza = Math.min(POPUP_FOLLOW_PX, Math.max(8, el.clientHeight / 3));
    const segui = vaiInFondo || (el.scrollHeight - prevTop - el.clientHeight < tolleranza);
    muta();
    reflow(popup);
    el.scrollTop = segui ? el.scrollHeight : prevTop;
  }

  function reflow(popup) {
    try { popup?.pose?.reflow(); } catch (_) {}
  }

  // La risposta l'hanno pagata i crediti di Filo perché OpenRouter ha rifiutato
  // la chiave dell'utente: la stessa riga che la chat mette sotto la risposta (#662).
  // Vale come detta solo se `el`, dove sta la frase, resta a schermo il tempo di leggerla: un riquadro
  // chiuso prima, o appena compare, lascia partire l'avviso (che il main tiene fermo 4 s).
  const RIPIEGO_LETTO_MS = 1500;
  function ripiegoMostrato(el) {
    if (!el || !el.isConnected) return;
    setTimeout(() => {
      if (!el.isConnected) return;
      try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.KEY_FALLBACK_SHOWN })).catch(() => {}); } catch (_) {}
    }, RIPIEGO_LETTO_MS);
  }
  function notaRipiego(parent, keyFallback) {
    if (!parent || !keyFallback || !keyFallback.line) return null;
    const el = document.createElement('div');
    el.className = 'sn-key-fallback';
    el.textContent = keyFallback.line;
    parent.appendChild(el);
    ripiegoMostrato(el);
    return el;
  }

  // Una risposta fermata dal tetto di lunghezza (#1097.3) non passa per intera: lo si dice sotto, e dove la
  // conversazione può andare avanti c'è «Continua».
  function notaInterrotta(parent, finishReason, onContinua = null) {
    const CE = global.SN_CHAT_ERRORS;
    const frase = CE && CE.rispostaInterrotta ? CE.rispostaInterrotta(finishReason) : '';
    if (!parent || !frase) return null;
    const el = document.createElement('div');
    el.className = 'sn-key-fallback sn-risposta-interrotta';
    el.textContent = frase;
    if (typeof onContinua === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-msg-rimedio';
      btn.textContent = 'Continua';
      btn.title = 'Continua la risposta da dove si è interrotta';
      btn.addEventListener('click', () => { btn.remove(); onContinua(); });
      el.appendChild(btn);
    }
    parent.appendChild(el);
    return el;
  }

  // «Copia» sotto ogni risposta: una traduzione si chiede quasi sempre per usarla altrove (#846). Nasce a risposta
  // finita, quindi non copia mai un pezzo, e copia il testo come si legge, senza marcature né note sotto.
  const COPIATO_MS = 1600;
  // Gli appunti li scrive il main, che mette il testo anche in cronologia come il «Copia» del tasto destro: in un
  // riquadro incorporato di un altro sito la pagina non ne ha il permesso. Se il main dice no, ci prova la pagina.
  async function copiaTesto(testo) {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.COPY_TEXT_TO_CLIPBOARD, text: testo });
      if (r && r.ok) return true;
    } catch (_) {}
    try { await navigator.clipboard.writeText(testo); return true; } catch (_) { return false; }
  }
  const iconaCopia = (nome) => (global.SN_ICONS && typeof global.SN_ICONS[nome] === 'function' ? global.SN_ICONS[nome](14) : '');
  function tastoCopia(wrap, sorgente) {
    const Md = global.SN_MARKDOWN;
    const testo = Md && Md.testo ? Md.testo(sorgente) : String(sorgente || '');
    if (!wrap || !testo.trim()) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-msg-copia';
    const mostra = (stato) => {
      const chiave = stato === 'ok' ? 'popup_copied' : stato === 'no' ? 'popup_copy_failed' : 'popup_copy';
      btn.dataset.etichetta = I18n.t(chiave);
      btn.setAttribute('aria-label', I18n.t(chiave));
      btn.classList.toggle('sn-copiato', stato === 'ok');
      btn.classList.toggle('sn-non-copiato', stato === 'no');
      const svg = iconaCopia(stato === 'ok' ? 'check' : 'copy');
      if (svg) btn.innerHTML = svg; else btn.textContent = I18n.t(chiave);
    };
    mostra(null);
    let timer = null;
    // Il fuoco resta nella riga per scrivere: copiare non vuol dire aver finito di fare domande.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      const ok = await copiaTesto(testo);
      clearTimeout(timer);
      mostra(ok ? 'ok' : 'no');
      timer = setTimeout(() => mostra(null), COPIATO_MS);
    });
    const riga = document.createElement('div');
    riga.className = 'sn-msg-azioni';
    riga.appendChild(btn);
    wrap.appendChild(riga);
    return btn;
  }

  // Scrive modello e costo nella riga in basso. Quando lo spazio è così poco
  // che quella riga deve sparire (dentro un riquadro incorporato basso, vedi la
  // posa), l'informazione resta comunque: passando sopra l'intestazione.
  function setMeta(popup, testo) {
    if (!popup?.metaEl) return;
    popup.metaEl.textContent = testo;
    try { popup.root.querySelector('.sn-popup-header').title = testo; } catch (_) {}
  }

  // ----------------------------------------------------------------
  // Avvia un turno di streaming. messages è la cronologia COMPLETA
  // (incluso il nuovo messaggio user finale).
  // ----------------------------------------------------------------
  function startTurn(popup, messages, onAssistantDone, opts) {
    // Disconnetti eventuale port precedente
    try { popup.activePort?.disconnect(); } catch (_) {}

    const bubble = appendBubble(popup, 'assistant');
    const loading = document.createElement('span');
    loading.className = 'sn-msg-loading';
    loading.textContent = I18n.t('popup_loading');
    bubble.text.appendChild(loading);

    let port;
    try {
      port = chrome.runtime.connect({ name: PORTS.AI_STREAM });
    } catch (_) {
      bubble.text.textContent = I18n.t('err_provider_failed');
      bubble.wrap.classList.add('sn-msg-error');
      return;
    }
    popup.activePort = port;
    let buf = '';
    let firstDelta = true;

    port.onMessage.addListener((m) => {
      if (m.type === 'meta') {
        popup.model = m.model; popup.provider = m.provider;
        // Il prompt vero è quello composto dal main: le domande successive
        // devono ripartire da lì, non dalla copia locale senza cambi (#724).
        if (Array.isArray(m.messages) && m.messages.length) popup.conversation = m.messages.slice();
        setMeta(popup, `${I18n.t('popup_model')}: ${popup.model}`);
      } else if (m.type === 'delta') {
        if (firstDelta) {
          bubble.text.innerHTML = '';
          firstDelta = false;
        }
        buf += m.delta;
        // Ogni delta allunga il riquadro: la posa va rifatta subito, non al prossimo disegno
        // (#502), e la lettura resta dov'è se l'utente era tornato su a rileggere.
        scrollaConservando(popup, () => {
          bubble.text.innerHTML = renderMarkdown(resolveCalcMarkers(buf, { streaming: true }));
        });
      } else if (m.type === 'reset') {
        // Il provider è caduto a metà risposta e si riparte su un ripiego: il testo parziale si
        // butta, così il messaggio finale è SOLO la risposta del provider che riesce.
        buf = '';
        firstDelta = true;
        // Si riparte da zero su un altro provider: il testo parziale sparisce e
        // non c'è più niente da rileggere lì, quindi la vista torna in fondo.
        scrollaConservando(popup, () => {
          bubble.text.innerHTML = '';
          const retry = document.createElement('span');
          retry.className = 'sn-msg-loading';
          retry.textContent = I18n.t('popup_loading');
          bubble.text.appendChild(retry);
        }, true);
      } else if (m.type === 'done') {
        const vuota = firstDelta;   // nessun delta arrivato (es. cache vuota errore)
        const resolved = resolveCalcMarkers(buf);
        const eur = m.costEur || 0;
        // L'ultima riscrittura può ACCORCIARE il testo (markdown completo al posto del parziale):
        // senza rimettere la posizione, chi stava rileggendo viene sbalzato dal clamp del browser.
        scrollaConservando(popup, () => {
          if (vuota) bubble.text.textContent = '';
          const daMostrare = popup.action === ACTIONS.EXPLAIN
            ? spiegazioneDaMostrare(resolved) : resolved;
          if (popup.action === ACTIONS.EXPLAIN && !daMostrare) {
            bubble.text.textContent = I18n.t('popup_no_explanation');
            bubble.wrap.classList.add('sn-msg-muted');
          } else {
            bubble.text.innerHTML = renderMarkdown(daMostrare);
            tastoCopia(bubble.wrap, daMostrare);
          }
          notaRipiego(bubble.text, m.keyFallback);
          notaInterrotta(bubble.text, m.finishReason, () => continuaRisposta(popup));
          setMeta(popup, `${I18n.t('popup_model')}: ${popup.model} • ${I18n.t('popup_estimated_cost')}: €${eur.toFixed(4)}`);
        });
        // Salva la versione risolta in conversazione: i follow-up vedono i numeri,
        // non i marker, così l'LLM non si confonde nei turni successivi.
        try { onAssistantDone && onAssistantDone(resolved); } catch (_) {}
        popup.activePort = null;
      } else if (m.type === 'error') {
        // L'errore va LETTO: è l'unica cosa rimasta da leggere, la vista ci va.
        // E va letto in italiano: la riga grezza del servizio («OpenRouter 402:
        // {…}») non dice niente a chi ha finito i crediti (#663).
        scrollaConservando(popup, () => {
          scriviErrore(bubble.text, m);
          bubble.wrap.classList.add('sn-msg-error');
        }, true);
        popup.activePort = null;
      }
    });

    port.postMessage({
      type: 'start',
      action: popup.action,
      payload: (opts && opts.payload) || { messages },
      origin: location.href,
    });
  }

  function submitFollowup(popup) {
    const txt = popup.inputEl.value.trim();
    if (!txt) return;
    if (popup.activePort) return; // già in streaming
    popup.inputEl.value = '';
    popup.inputEl.style.height = 'auto';
    chiedi(popup, txt);
  }

  // «Continua» sotto una risposta interrotta è una domanda come le altre, già scritta.
  const CONTINUA_RISPOSTA = global.SN_CHAT_ERRORS?.CHIEDI_SEGUITO || 'Continua da dove ti sei interrotto, senza ripetere quello che hai già scritto.';
  function continuaRisposta(popup) {
    if (!popup || popup.activePort) return;
    chiedi(popup, CONTINUA_RISPOSTA);
  }

  function chiedi(popup, txt) {
    // Mostra bolla utente
    const userBubble = appendBubble(popup, 'user');
    userBubble.text.textContent = txt;

    popup.conversation.push({ role: 'user', content: txt });
    startTurn(popup, popup.conversation, (assistantText) => {
      popup.conversation.push({ role: 'assistant', content: assistantText });
    });
  }

  function openStreaming({ action, payload, anchor, title }) {
    installEscOnce();
    const popup = createPopup({ title, anchor });
    popup.action = action;

    const initialPrompt = buildInitialPrompt(action, payload);
    popup.conversation.push({ role: 'user', content: initialPrompt });

    startTurn(popup, popup.conversation, (assistantText) => {
      popup.conversation.push({ role: 'assistant', content: assistantText });
    }, { payload: payloadDaComporreNelMain(action, payload) });
  }

  // I cambi del giorno li ha solo il main: «Spiega» e «Approfondisci» gli
  // mandano il testo selezionato e si fanno comporre il prompt da lui, come già
  // fa la spiegazione nel menu del tasto destro. Qui il prompt si costruisce
  // comunque, ma solo come storia da cui ripartono le domande successive
  // finché non torna quella vera. #724
  function payloadDaComporreNelMain(action, payload) {
    if (action !== ACTIONS.EXPLAIN && action !== ACTIONS.EXPLAIN_DEEP) return null;
    const sel = payload?.selection || '';
    return { selection: sel, sentence: payload?.sentence || sel };
  }

  function buildInitialPrompt(action, payload) {
    const sel = payload?.selection || '';
    const sent = payload?.sentence || sel;
    if (action === ACTIONS.EXPLAIN) return PROMPTS.explain({ selection: sel, sentence: sent });
    if (action === ACTIONS.EXPLAIN_DEEP) return PROMPTS.explainDeep({ selection: sel, sentence: sent });
    if (action === ACTIONS.TRANSLATE_SELECTION) return PROMPTS.translateSelection({ selection: sel });
    return sel || '';
  }

  // Stack degli avvisi in pagina (#409): tutto ciò che Filo ancora in basso a destra vive in
  // UN contenitore che li impila, o due avvisi ravvicinati finiscono uno sopra l'altro.
  let toastHostEl = null;

  // Tetto al numero di avvisi vivi insieme: senza, una raffica riempie lo schermo e spinge i
  // più vecchi fuori dal viewport. Teniamo i più recenti.
  const MAX_TOAST_STACK = 4;

  // Col puntatore su un avviso della pila i tempi di tutti aspettano (regola in avvisiTempo.js).
  let tempiPila = null;
  function tempi() {
    if (!tempiPila) tempiPila = global.SN_AVVISI.orologio();
    return tempiPila;
  }

  function toastHost() {
    // `isConnected`: se la pagina rifà il DOM (SPA che rimpiazza il body) il
    // vecchio contenitore resta orfano e gli avvisi successivi sparirebbero.
    if (!toastHostEl || !toastHostEl.isConnected) {
      toastHostEl = document.createElement('div');
      toastHostEl.className = 'sn-toasts';
      toastHostEl.classList.toggle('sn-toasts-sotto-menu', pilaSottoMenu);
      global.SN_FILO_UI?.mark(toastHostEl);
      document.documentElement.appendChild(toastHostEl);
    }
    return toastHostEl;
  }

  // Il menu del tasto destro è l'ultima cosa chiesta dall'utente: finché è aperto la pila gli sta sotto, o un
  // avviso gli coprirebbe le voci e la guardia dei clic le fermerebbe (#1453).
  let pilaSottoMenu = false;
  function sottoIlMenu(on) {
    pilaSottoMenu = !!on;
    if (toastHostEl) toastHostEl.classList.toggle('sn-toasts-sotto-menu', pilaSottoMenu);
  }

  // Sfratta subito (senza attendere il timeout) gli avvisi più vecchi oltre il
  // tetto. Gli elementi marcati `sticky` sono esenti: portano un comando che
  // esiste solo lì (la pill che ferma la dettatura, la conferma che apre la
  // lista), buttarli via toglierebbe all'utente l'unico modo di usarlo.
  function enforceToastCap() {
    const host = toastHost();
    const live = Array.from(host.children).filter(
      (c) => c.dataset.snClosing !== '1' && c.dataset.snSticky !== '1',
    );
    const over = live.length - MAX_TOAST_STACK;
    for (let i = 0; i < over; i++) {
      const c = live[i]; // i più vecchi stanno in cima: si appende in coda
      if (typeof c._snDispose === 'function') { try { c._snDispose(); } catch (_) {} continue; }
      unmountToast(c);
    }
  }

  // L'animazione d'ingresso alza l'avviso di 8px: senza tolleranza uno stack che ci sta
  // comodo sembrerebbe in overflow, e lo scroll emette un evento che chiude il tasto destro.
  const TOAST_ENTER_SHIFT_PX = 8;

  // Finestra molto bassa: anche col tetto lo stack può eccedere. Si rende scrollabile, si
  // tiene in vista il più recente e i pointer-events si riaccendono solo lì.
  function syncToastOverflow() {
    const host = toastHost();
    const scrollable = host.scrollHeight > host.clientHeight + TOAST_ENTER_SHIFT_PX + 1;
    host.classList.toggle('scrolling', scrollable);
    // Solo se cambia davvero: assegnare scrollTop emette un evento `scroll`.
    if (scrollable && host.scrollTop !== host.scrollHeight) host.scrollTop = host.scrollHeight;
  }

  // API per gli altri avvisi in pagina ancorati allo stesso angolo: li aggancia
  // allo stack invece che direttamente al documento.
  // Tutto ciò che entra nella pila risponde al tasto destro col suo menu (regola in avvisiTempo.js):
  // `chiudi` e `azioni` li dà chi lo mostra; senza, «Chiudi» lo toglie dalla pila.
  function mountToast(el, opts = {}) {
    if (!el) return el;
    if (opts.sticky) el.dataset.snSticky = '1';
    global.SN_AVVISI.chiudibile(el, opts.chiudi || (() => unmountToast(el)), opts.azioni);
    tempi().segui(el);
    toastHost().appendChild(el);
    tempi().ripulisci();
    enforceToastCap();
    syncToastOverflow();
    return el;
  }

  // Da chiamare quando un elemento agganciato esce di scena: rimuove e
  // ricalcola l'overflow dello stack.
  function unmountToast(el) {
    try { el?.remove(); } catch (_) {}
    if (el) tempi().lascia(el);
    syncToastOverflow();
  }

  // Il tempo di un avviso agganciato alla pila: in scala con la durata delle Preferenze, fermo col
  // puntatore sopra. `ms` è quello che vale con la durata standard; 0 = resta finché non lo si chiude.
  // `deveScadere`: alla scadenza succede qualcosa (si chiude la scheda), e la durata 0 non lo rimanda per sempre.
  function tempoAvviso(ms, onScade, { deveScadere = false } = {}) {
    const d = global.SN_AVVISI.durata(ms);
    return tempi().avvia(d || (deveScadere ? ms : 0), onScade);
  }

  // ----------------------------------------------------------------
  // Toast (per feedback brevi)
  // ----------------------------------------------------------------
  // `duration: 0` = il toast resta finché non lo chiude il chiamante (operazioni
  // lunghe: l'avviso "sto lavorando" deve durare quanto il lavoro). Ritorna
  // sempre un handle con close(), così chi mostra un avviso di avanzamento può
  // sostituirlo con l'esito invece di impilarci sopra un secondo riquadro.
  // `rimedio`: la risposta d'errore dell'IPC (o l'errore ricomposto) di una frase che nomina dove si rimedia; l'avviso
  // porta il tasto per andarci (#663) e resta abbastanza da arrivarci col puntatore, che lo ferma.
  const DURATA_CON_RIMEDIO_MS = 15000;
  function showToast(text, opts = {}) {
    const t = document.createElement('div');
    t.className = 'sn-toast';
    t.textContent = text;
    const pagina = opts.rimedio ? paginaDelRimedio(opts.rimedio) : null;
    let closed = false;
    let tempo = null;
    // Rimozione immediata usata dallo sfratto per tetto: niente animazione, ma
    // il timer va spento o continuerebbe a puntare a un elemento morto.
    t._snDispose = () => {
      closed = true;
      if (tempo) { tempo.annulla(); tempo = null; }
      unmountToast(t);
    };
    mountToast(t);
    requestAnimationFrame(() => t.classList.add('sn-toast-visible'));
    const close = () => {
      if (closed) return;
      closed = true;
      if (tempo) { tempo.annulla(); tempo = null; }
      // Marcato in uscita: non occupa più uno slot del tetto mentre sfuma.
      t.dataset.snClosing = '1';
      t.classList.remove('sn-toast-visible');
      setTimeout(() => unmountToast(t), self.SN_THEME_TOKENS?.motionMs(250) ?? 250);
    };
    // Sotto il puntatore il toast prende i clic: chiuderlo è la risposta, e l'unica strada con la durata a 0.
    // Chi ne sta selezionando il testo non lo perde.
    t.addEventListener('click', () => {
      const sel = t.ownerDocument.getSelection && t.ownerDocument.getSelection();
      if (sel && !sel.isCollapsed && t.contains(sel.anchorNode)) return;
      close();
    });
    let azioni;
    let durata = opts.duration === 0 ? 0 : (opts.duration || 2200);
    if (pagina) {
      mostraRimedio(t, opts.rimedio, { dopo: close });
      // Dal tasto destro sull'avviso la stessa strada: il clic che il menu girerebbe al tasto non è vero.
      azioni = [{ label: pagina.label, fn: () => { apriRimedio(pagina); close(); } }];
      if (durata) durata = Math.max(durata, DURATA_CON_RIMEDIO_MS);
    }
    // `segnala`: la segnalazione già scritta da Filo (#1478). Un avviso che dice «Segnalalo» porta il tasto per farlo.
    const segnala = typeof opts.segnala === 'string' && opts.segnala.trim() && global.SN_FEEDBACK_UI ? opts.segnala : '';
    if (segnala) {
      const apri = () => { try { global.SN_FEEDBACK_UI?.open({ testo: segnala }); } catch (_) {} close(); };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-msg-rimedio';
      btn.textContent = I18n.t('toast_segnala');
      btn.addEventListener('click', (e) => {
        const vero = global.SN_FILO_UI?.veroONostro ? global.SN_FILO_UI.veroONostro(e) : e.isTrusted;
        if (!vero) return;
        e.stopPropagation();
        apri();
      });
      t.appendChild(btn);
      azioni = [...(azioni || []), { label: I18n.t('toast_segnala'), fn: apri }];
      if (durata) durata = Math.max(durata, DURATA_CON_RIMEDIO_MS);
    }
    global.SN_AVVISI.chiudibile(t, close, azioni);
    tempo = tempoAvviso(durata, close);
    return { close, el: t };
  }

  // Un errore dell'AI detto con un avviso (le strade senza un riquadro dove scriverlo): frase e tasto insieme.
  function avvisoErrore(res, opts = {}) {
    conta({ misura: 'errore-modello', code: String((res && (res.code || res.errorCode)) || ''), status: Number(res && res.status) || 0 });
    return showToast(frasePerLUtente(res), { duration: 9000, ...opts, rimedio: res });
  }

  // Un avviso d'errore per chiave del testo: chi lo vede lo legge tradotto, i contatori ne sanno la chiave e basta (#1461).
  function toastErrore(chiave, opts = {}, ...args) {
    conta({ misura: 'avviso', chiave: String(chiave || '') });
    return showToast(I18n.t(chiave, ...args), opts);
  }

  // Un gesto contato dove la persona lo fa (#1461): solo nomi da elenchi chiusi e numeri, li controlla il main.
  function conta(evento) {
    try {
      const r = chrome.runtime.sendMessage({ ...evento, type: MSG.CONTATORI_EVENTO });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) {}
  }

  // Disfare nel campo che Filo ha appena cambiato (una correzione, una riscrittura) si conta col tempo passato, e il
  // main decide se era «subito dopo» (#1461). Si ascolta l'annullo e non il tasto: su Mac Cmd+Z lo prende il menu.
  let ultimaModifica = null;
  function modificaDiFilo(el, tipo) { ultimaModifica = el ? { el, tipo, t: Date.now() } : null; }
  // Chi scrive dopo la modifica di Filo, col suo Ctrl+Z disfa prima quello che ha scritto lui: non è un annullo di Filo.
  document.addEventListener('input', (e) => {
    const m = ultimaModifica;
    if (!m || !e.isTrusted) return;
    const qui = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
    if (qui !== m.el && !(m.el.contains && m.el.contains(qui))) return;
    ultimaModifica = null;
    if (e.inputType === 'historyUndo') conta({ misura: 'annullato', tipo: m.tipo, msDopo: Date.now() - m.t });
  }, true);

  // close API legacy: chiude il topmost (compatibilità con codice che chiamava SN_POPUP.close())
  function close() { closeTopmost(); }

  global.SN_POPUP = {
    toastErrore,
    conta,
    modificaDiFilo,
    openStreaming,
    notaRipiego, ripiegoMostrato, notaInterrotta,
    close,
    closeTopmost,
    showToast,
    mountToast,
    unmountToast,
    sottoIlMenu,
    tempoAvviso,
    attachZoomCompensation,
    renderMarkdown,
    resolveCalcMarkers,
    registerStack,
    riquadro,
    togliRiquadro,
    apriCollegamento,
    scaricaCollegamento,
    frasePerLUtente,
    mostraRimedio,
    scriviErrore,
    avvisoErrore,
    // C'è un riquadro aperto adesso? Lo chiede content.js per decidere di chi
    // è l'Esc quando si è a tutto schermo (#514).
    hasOpen: () => popups.length > 0,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
