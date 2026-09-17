// Popup risposta AI: streaming, posa, trascinamento, conversazione.
// Più popup insieme: aprirne uno nuovo non chiude i precedenti.

(function (global) {
  'use strict';

  const { MSG, PORTS } = global.SN_MSG;
  const { PROMPTS, ACTIONS } = global.SN_CONST;
  const I18n = global.SN_I18N;

  // Stack di popup aperti. L'ultimo è il topmost.
  const popups = [];

  const Z_BASE = 2147483600;
  const Z_STEP = 1;

  // Calcolatrice locale: le espressioni si valutano qui, senza LLM — più affidabile e gratis.
  // Parser ricorsivo discendente: expr → term → power (destra-assoc.) → unary → postfix.
  function tryMathEval(input) {
    if (input == null) return { ok: false };
    let s = String(input).trim();
    if (!s) return { ok: false };

    s = s
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/[–—]/g, '-')
      .replace(/∕/g, '/')
      .replace(/√/g, 'sqrt')
      .replace(/π/g, 'pi')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/\*\*/g, '^');

    // Decimali italiani: virgola tra cifre -> punto
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    s = s.replace(/(\d)\s+(?=\d)/g, '$1');
    s = s.replace(/=\s*$/, '').trim();

    if (!/^[0-9+\-*/^%().\s a-zA-Z!]+$/.test(s)) return { ok: false };
    // Deve "sembrare" matematica: almeno un operatore, fattoriale, funzione o costante
    const hasMathToken = /[+\-*/^%!]/.test(s)
      || /\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|log|ln|exp|abs|floor|ceil|round|pi|e)\b/i.test(s);
    if (!hasMathToken) return { ok: false };

    let i = 0;
    const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const eat = (ch) => { skip(); if (s[i] === ch) { i++; return true; } return false; };

    function parseExpr() {
      let v = parseTerm();
      while (true) {
        if (eat('+')) v += parseTerm();
        else if (eat('-')) v -= parseTerm();
        else break;
      }
      return v;
    }
    function parseTerm() {
      let v = parsePower();
      while (true) {
        if (eat('*')) v *= parsePower();
        else if (eat('/')) v /= parsePower();
        else if (eat('%')) v %= parsePower();
        else break;
      }
      return v;
    }
    function parsePower() {
      let v = parseUnary();
      if (eat('^')) v = Math.pow(v, parsePower());
      return v;
    }
    function parseUnary() {
      skip();
      if (eat('+')) return parseUnary();
      if (eat('-')) return -parseUnary();
      return parsePostfix();
    }
    function parsePostfix() {
      let v = parseAtom();
      while (eat('!')) v = factorial(v);
      return v;
    }
    function parseAtom() {
      skip();
      const rest = s.slice(i);
      const numM = rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
      if (numM) { i += numM[0].length; return parseFloat(numM[0]); }
      const idM = rest.match(/^[a-zA-Z]+/);
      if (idM) {
        const name = idM[0].toLowerCase();
        i += idM[0].length;
        skip();
        if (s[i] === '(') {
          i++;
          const arg = parseExpr();
          if (!eat(')')) throw new Error('paren');
          return applyFunc(name, arg);
        }
        return applyConst(name);
      }
      if (eat('(')) {
        const v = parseExpr();
        if (!eat(')')) throw new Error('paren');
        return v;
      }
      throw new Error('atom');
    }
    function applyFunc(name, x) {
      switch (name) {
        case 'sqrt': return Math.sqrt(x);
        case 'cbrt': return Math.cbrt(x);
        case 'sin': return Math.sin(x);
        case 'cos': return Math.cos(x);
        case 'tan': return Math.tan(x);
        case 'asin': return Math.asin(x);
        case 'acos': return Math.acos(x);
        case 'atan': return Math.atan(x);
        case 'log': return Math.log10(x);
        case 'ln': return Math.log(x);
        case 'exp': return Math.exp(x);
        case 'abs': return Math.abs(x);
        case 'floor': return Math.floor(x);
        case 'ceil': return Math.ceil(x);
        case 'round': return Math.round(x);
      }
      throw new Error('fn');
    }
    function applyConst(name) {
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
      throw new Error('const');
    }
    function factorial(n) {
      if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('fact');
      let r = 1; for (let k = 2; k <= n; k++) r *= k; return r;
    }

    try {
      const value = parseExpr();
      skip();
      if (i !== s.length) return { ok: false };
      if (!Number.isFinite(value)) return { ok: false };
      return { ok: true, value, normalized: s };
    } catch (_) {
      return { ok: false };
    }
  }

  function formatMathResult(n) {
    if (Number.isInteger(n)) return String(n);
    // Limita precisione per evitare 0.30000000000000004
    let str = parseFloat(n.toPrecision(12)).toString();
    // Notazione italiana: punto -> virgola decimale
    if (str.includes('e')) return str; // notazione esponenziale: lascia invariata
    return str.replace('.', ',');
  }

  // Sostituisce i marker [[calc: …]] emessi dall'LLM col risultato calcolato qui.
  // In streaming i marker incompleti si nascondono con «…» per evitare lo sfarfallio.
  const CALC_MARKER_RE = /\[\[calc:\s*([^\[\]]+?)\s*\]\]/g;
  function resolveCalcMarkers(text) {
    if (!text) return text;
    let out = text.replace(CALC_MARKER_RE, (m, expr) => {
      const r = tryMathEval(expr);
      return r.ok ? formatMathResult(r.value) : m;
    });
    // Nasconde marker incompleti in coda durante lo streaming
    // (anche solo "[[", "[[c", "[[ca", ecc. mentre arrivano i delta)
    out = out.replace(/\[\[(?:c(?:a(?:l(?:c(?::[^\]]*)?)?)?)?)?$/, '…');
    return out;
  }

  // Markdown dalla sorgente unica SN_MARKDOWN (#418): popup, «Spiega», sidebar e chat uguali.
  const Md = global.SN_MARKDOWN;
  function renderMarkdown(text) {
    return Md ? Md.render(text) : (text || '');
  }

  // Un solo listener apre in una NUOVA SCHEDA i link resi da Filo: popup, «Spiega» e sidebar
  // vivono nello stesso documento. I link non sicuri li ha già scartati SN_MARKDOWN.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a.filo-md-link');
    if (!a) return;
    const url = a.getAttribute('href');
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
  });

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
    popup.root.remove();
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

  // La casella si allunga col testo; il tetto non si ricopia qui, lo tiene il foglio di stile
  // e la posa lo stringe. `scrollHeight` comprende l'imbottitura, `height` no (#502).
  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    let pad = 0;
    try {
      const cs = getComputedStyle(el);
      if (cs.boxSizing !== 'border-box') {
        pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      }
    } catch (_) {}
    el.style.height = `${Math.max(0, el.scrollHeight - pad)}px`;
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
    document.documentElement.appendChild(root);

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

    popup.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitFollowup(popup);
      }
    });
    popup.sendEl.addEventListener('click', () => submitFollowup(popup));
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

  // Scrive modello e costo nella riga in basso. Quando lo spazio è così poco che quella riga
  // sparisce, l'informazione resta comunque passando sopra l'intestazione.
  function setMeta(popup, testo) {
    if (!popup?.metaEl) return;
    popup.metaEl.textContent = testo;
    try { popup.root.querySelector('.sn-popup-header').title = testo; } catch (_) {}
  }

  // Avvia un turno di streaming; `messages` è la cronologia COMPLETA, compreso il messaggio
  // user finale.
  function startTurn(popup, messages, onAssistantDone) {
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
          bubble.text.innerHTML = renderMarkdown(resolveCalcMarkers(buf));
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
          if (popup.action === ACTIONS.EXPLAIN && /NESSUNA SPIEGAZIONE/i.test(resolved.trim())) {
            bubble.text.textContent = I18n.t('popup_no_explanation');
            bubble.wrap.classList.add('sn-msg-muted');
          } else {
            bubble.text.innerHTML = renderMarkdown(resolved);
          }
          setMeta(popup, `${I18n.t('popup_model')}: ${popup.model} • ${I18n.t('popup_estimated_cost')}: €${eur.toFixed(4)}`);
        });
        // Salva la versione risolta in conversazione: i follow-up vedono i numeri,
        // non i marker, così l'LLM non si confonde nei turni successivi.
        try { onAssistantDone && onAssistantDone(resolved); } catch (_) {}
        popup.activePort = null;
      } else if (m.type === 'error') {
        // L'errore va LETTO: è l'unica cosa rimasta da leggere, la vista ci va.
        scrollaConservando(popup, () => {
          bubble.text.textContent = m.message || I18n.t('err_provider_failed');
          bubble.wrap.classList.add('sn-msg-error');
        }, true);
        popup.activePort = null;
      }
    });

    port.postMessage({
      type: 'start',
      action: popup.action,
      payload: { messages },
      origin: location.href,
    });
  }

  function submitFollowup(popup) {
    const txt = popup.inputEl.value.trim();
    if (!txt) return;
    if (popup.activePort) return; // già in streaming
    popup.inputEl.value = '';
    popup.inputEl.style.height = 'auto';

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
    });
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

  function toastHost() {
    // `isConnected`: se la pagina rifà il DOM (SPA che rimpiazza il body) il
    // vecchio contenitore resta orfano e gli avvisi successivi sparirebbero.
    if (!toastHostEl || !toastHostEl.isConnected) {
      toastHostEl = document.createElement('div');
      toastHostEl.className = 'sn-toasts';
      global.SN_FILO_UI?.mark(toastHostEl);
      document.documentElement.appendChild(toastHostEl);
    }
    return toastHostEl;
  }

  // Sfratta subito gli avvisi più vecchi oltre il tetto. I `sticky` sono esenti: portano un
  // comando che esiste solo lì, e buttarli toglierebbe l'unico modo di usarlo.
  function enforceToastCap() {
    const host = toastHost();
    const live = Array.from(host.children).filter(
      (c) => c.dataset.snClosing !== '1' && c.dataset.snSticky !== '1',
    );
    const over = live.length - MAX_TOAST_STACK;
    for (let i = 0; i < over; i++) {
      const c = live[i]; // i più vecchi stanno in cima: si appende in coda
      if (typeof c._snDispose === 'function') { try { c._snDispose(); } catch (_) {} continue; }
      try { c.remove(); } catch (_) {}
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
  function mountToast(el, opts = {}) {
    if (!el) return el;
    if (opts.sticky) el.dataset.snSticky = '1';
    toastHost().appendChild(el);
    enforceToastCap();
    syncToastOverflow();
    return el;
  }

  // Da chiamare quando un elemento agganciato esce di scena: rimuove e
  // ricalcola l'overflow dello stack.
  function unmountToast(el) {
    try { el?.remove(); } catch (_) {}
    syncToastOverflow();
  }

  // `duration: 0` = resta finché non lo chiude il chiamante: «sto lavorando» dura quanto il
  // lavoro. Torna sempre un handle con close(), per sostituire l'avviso invece di impilarlo.
  function showToast(text, opts = {}) {
    const t = document.createElement('div');
    t.className = 'sn-toast';
    t.textContent = text;
    let closed = false;
    let timer = null;
    // Rimozione immediata usata dallo sfratto per tetto: niente animazione, ma
    // il timer va spento o continuerebbe a puntare a un elemento morto.
    t._snDispose = () => {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      unmountToast(t);
    };
    mountToast(t);
    requestAnimationFrame(() => t.classList.add('sn-toast-visible'));
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      // Marcato in uscita: non occupa più uno slot del tetto mentre sfuma.
      t.dataset.snClosing = '1';
      t.classList.remove('sn-toast-visible');
      setTimeout(() => unmountToast(t), 250);
    };
    const duration = opts.duration === 0 ? 0 : (opts.duration || 2200);
    if (duration > 0) timer = setTimeout(close, duration);
    return { close, el: t };
  }

  function close() { closeTopmost(); }

  global.SN_POPUP = {
    openStreaming,
    close,
    closeTopmost,
    showToast,
    mountToast,
    unmountToast,
    attachZoomCompensation,
    renderMarkdown,
    resolveCalcMarkers,
    registerStack,
    // C'è un riquadro aperto adesso? Lo chiede content.js per decidere di chi
    // è l'Esc quando si è a tutto schermo (#514).
    hasOpen: () => popups.length > 0,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
