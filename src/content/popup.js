// Popup risposta AI: streaming, posizionamento smart, drag, conversazione (follow-up).
// Supporta più popup contemporanei: aprire un nuovo popup non chiude quelli precedenti.

(function (global) {
  'use strict';

  const { MSG, PORTS } = global.SN_MSG;
  const { PROMPTS, ACTIONS } = global.SN_CONST;
  const I18n = global.SN_I18N;

  // Stack di popup aperti. L'ultimo è il topmost.
  const popups = [];
  // z-index iniziale e step per stacking deterministico
  const Z_BASE = 2147483600;
  const Z_STEP = 1;

  // ----------------------------------------------------------------
  // Calcolatrice locale: valuta espressioni matematiche client-side senza
  // chiamare l'LLM. Più affidabile e gratis. Parser ricorsivo discendente.
  // Grammatica:
  //   expr   = term  (('+'|'-') term)*
  //   term   = power (('*'|'/'|'%') power)*
  //   power  = unary ('^' power)?              (^ destra-associativo, ** alias)
  //   unary  = ('+'|'-') unary | postfix
  //   postfix= atom ('!')*
  //   atom   = number | '(' expr ')' | ident ['(' expr ')'] | ident
  // ----------------------------------------------------------------
  function tryMathEval(input) {
    if (input == null) return { ok: false };
    let s = String(input).trim();
    if (!s) return { ok: false };

    // Normalizza simboli matematici Unicode tipici
    s = s
      .replace(/×/g, '*')     // ×
      .replace(/÷/g, '/')     // ÷
      .replace(/−/g, '-')     // −
      .replace(/[–—]/g, '-') // – —
      .replace(/∕/g, '/')     // ∕
      .replace(/√/g, 'sqrt')  // √
      .replace(/π/g, 'pi')    // π
      .replace(/²/g, '^2')    // ²
      .replace(/³/g, '^3')    // ³
      .replace(/\*\*/g, '^');

    // Decimali italiani: virgola tra cifre -> punto
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    // Separatori delle migliaia con spazi tra cifre: rimuovili
    s = s.replace(/(\d)\s+(?=\d)/g, '$1');
    // Rimuovi un eventuale segno '=' finale (es. "2+2=")
    s = s.replace(/=\s*$/, '').trim();

    // Whitelist caratteri ammessi
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

  // ----------------------------------------------------------------
  // Sostituisce i marker [[calc: <espressione>]] emessi dall'LLM
  // con il risultato calcolato in locale. I marker incompleti
  // (in streaming, "]]" non ancora arrivato) vengono nascosti con "…"
  // per evitare flicker visivo. Marker invalidi restano visibili.
  // ----------------------------------------------------------------
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

  // ----------------------------------------------------------------
  // Renderer Markdown: delega alla sorgente unica condivisa SN_MARKDOWN (#418),
  // così popup, riquadro "Spiega", sidebar e chat della home rendono la stessa
  // formattazione leggera (grassetto/corsivo/codice/elenchi/titoli + LINK).
  // ----------------------------------------------------------------
  const Md = global.SN_MARKDOWN;
  function renderMarkdown(text) {
    return Md ? Md.render(text) : (text || '');
  }

  // Un solo listener a livello di documento apre i link renderizzati da Filo
  // (classe filo-md-link) in una NUOVA SCHEDA — vale per il popup, il riquadro
  // "Spiega" e la sidebar, che vivono tutti nello stesso documento. I link
  // non-sicuri (filo://, javascript:, relativi) non arrivano qui: SN_MARKDOWN li
  // ha già scartati in fase di render.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a.filo-md-link');
    if (!a) return;
    const url = a.getAttribute('href');
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
  });

  // ----------------------------------------------------------------
  // Compensazione zoom (Ctrl+/-, pinch). Identica per popup e menu.
  // ----------------------------------------------------------------
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
      // Scala dal bordo ANCORATO alla selezione, non sempre dall'alto: un
      // riquadro agganciato col fondo (posato sopra la selezione) altrimenti si
      // staccherebbe dal punto appena l'utente cambia zoom.
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

  // ----------------------------------------------------------------
  // ESC chiude solo il topmost. Listener globale registrato una volta.
  // ----------------------------------------------------------------
  let escInstalled = false;
  function installEscOnce() {
    if (escInstalled) return;
    escInstalled = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || popups.length === 0) return;
      const top = popups[popups.length - 1];
      // Le entry esterne (es. feedback) gestiscono la propria chiusura
      if (top.isExternal) return;
      // Se il focus è dentro il popup topmost, ESC chiude
      closePopup(top);
      e.stopPropagation();
    }, true);
  }

  // ----------------------------------------------------------------
  // Drag dell'header
  // ----------------------------------------------------------------
  function attachDrag(root, handle, onDragStart, onDragEnd) {
    let dx = 0, dy = 0;
    let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sn-popup-close')) return;
      // Porta in primo piano il popup trascinato
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
      // Il riquadro si è MOSSO davvero (un clic sull'intestazione per portarlo
      // davanti non conta): da qui in poi la posa è dell'utente, chi rimisura
      // smette di riportarlo sul punto ancorato e si limita a tenerlo dentro
      // lo schermo.
      try { onDragStart && onDragStart(); } catch (_) {}
      let left = e.clientX - dx;
      let top = e.clientY - dy;
      // L'ingombro si misura VISIBILE (`getBoundingClientRect`), non di layout
      // (`offsetWidth/Height`): la compensazione zoom mette una `scale()` sul
      // riquadro, e le due misure coincidono solo al 100%. Con la pagina
      // rimpicciolita (Ctrl+meno) la scala è maggiore di 1 e il riquadro occupa
      // PIÙ di quanto dice `offsetHeight`: il limite lasciava passare la
      // differenza e la riga per scrivere finiva sotto il fondo dello schermo —
      // 148px al 75%, 464px al 50% — dove nessuno la riportava dentro, perché
      // senza cambi di dimensione il guardiano non gira. Con la pagina
      // ingrandita valeva la faccia opposta: il riquadro si fermava prima del
      // bordo, in una fascia di schermo che c'era. Stessa asimmetria del
      // difetto (#502): un rimedio che tiene in un verso e non nell'altro.
      const r = root.getBoundingClientRect();
      const w = r.width, h = r.height;
      const vw = window.innerWidth, vh = window.innerHeight;
      // Stesso ORDINE del guardiano: il bordo di sopra vince su quello di sotto.
      // Se il riquadro è più alto della finestra i due limiti non possono valere
      // insieme, e a cedere dev'essere il fondo: con l'ordine invertito è
      // l'intestazione a uscire dalla cima, cioè l'unica presa che l'utente ha
      // per rimetterlo a posto.
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
      // Lasciato il riquadro, l'ultima parola è del guardiano: se è più alto
      // della finestra il limite del mouse può solo spostarlo, mentre lui sa
      // anche stringergli il tetto.
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
    // Riassegna z-index
    popups.forEach((p, i) => { p.root.style.zIndex = String(Z_BASE + i * Z_STEP); });
  }

  // Registra un elemento esterno (es. modale feedback) nello stack dei popup,
  // così partecipa al z-ordering condiviso: appare sopra i box aperti prima e
  // sotto quelli aperti dopo. Il chiamante resta responsabile della propria
  // chiusura (ESC, ecc.).
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

  // ----------------------------------------------------------------
  // Posa del riquadro — un riquadro che si riempie dopo si ancora dal lato che
  // non si muove: patterns/un-riquadro-che-si-riempie-dopo-si-ancora-dal-lato-che-non.md
  // ----------------------------------------------------------------
  // Il riquadro nasce VUOTO (circa 300px) e si riempie dopo, mentre la risposta
  // arriva, fino al tetto d'altezza del foglio di stile. Una posa calcolata una
  // volta sola alla nascita è calcolata sull'altezza sbagliata:
  // il fondo — cioè la riga dove si scrive la domanda successiva — finisce
  // fuori dallo schermo e non si può più chiedere niente (#502).
  //
  // La cura NON è inseguire l'altezza spostando il riquadro a ogni delta: così
  // la posa dipende da quanto ci mette il modello a rispondere e il riquadro
  // balla. È tenere fermo il bordo ANCORATO alla selezione e lasciare che sia
  // la crescita a essere limitata:
  //
  //   1. Il LATO si sceglie SUBITO, sulla massima altezza che il riquadro potrà
  //      raggiungere e non su quella che ha adesso, e da lì non cambia più.
  //   2. Il tetto d'altezza viene STRETTO allo spazio di quel lato: più alto di
  //      così il riquadro non può diventare. Il corpo si accorcia e scorre, la
  //      riga per scrivere resta raggiungibile.
  //   2b. Ma un tetto stringe solo finché sta sopra la somma dei minimi dei
  //      pezzi interni: sotto, i pezzi escono dal bordo del riquadro invece di
  //      comprimersi. Quindi quando lo spazio si stringe qualcuno deve cedere
  //      DAVVERO: prima il minimo del corpo, poi la riga del costo.
  //      Intestazione e riga per scrivere non cedono mai.
  //   3. Il bordo ancorato lo tiene il FOGLIO DI STILE, non JavaScript: sotto
  //      la selezione si fissa `top` e il riquadro cresce verso il basso; sopra
  //      la selezione si fissa `bottom` e cresce verso l'alto da solo. Nessuno
  //      deve rimisurare niente perché niente si sposta: l'unica coordinata che
  //      cambia col contenuto è quella libera, e ci pensa il browser.
  //
  // Resta un guardiano per i casi che la matematica non copre (finestra troppo
  // bassa perché il riquadro ci stia nemmeno al minimo): stringe ancora il
  // tetto invece di spostare il riquadro, quindi va in una sola direzione e non
  // può oscillare. Guarda tutti e due i bordi, non solo quello verso cui il
  // riquadro cresce: quando lo spazio si accorcia dopo la posa a uscire può
  // essere il bordo ANCORATO, e lì stringere non serve a niente perché quel
  // bordo sta fermo. In quel caso, e quando il tetto è già al minimo, lo riporta
  // dentro a forza.
  //
  // Il punto ancorato, infine, si ritaglia sulla finestra a ogni misura e non
  // una volta sola: lo zoom e il ridimensionamento lo lasciano fuori dal bordo,
  // e un riquadro posato rispetto a un punto che non c'è più esce con lui.
  //
  // Dopo che l'utente lo ha trascinato la posa è sua: non lo riportiamo sul
  // punto ancorato, ci limitiamo a non farlo uscire dallo schermo.
  const POSE_MARGIN = 8;   // aria fra riquadro e bordi della finestra
  const POSE_GAP = 8;      // stacco fra riquadro e punto ancorato
  const POSE_MAX_H_FALLBACK = 480;
  const POSE_W_FALLBACK = 380;
  // Stati di compressione, definiti nel foglio di stile (§ "chi cede quando lo
  // spazio si stringe"): il corpo perde il suo minimo e scorre; poi va via
  // anche la riga del costo.
  const POSE_TIGHT = 'sn-popup-tight';
  const POSE_BARE = 'sn-popup-bare';

  // Il tetto lo tiene il foglio di stile: lo leggiamo invece di ricopiarlo, così
  // se cambia lì la posa lo segue da sola.
  function styleMaxHeight(root) {
    let v = NaN;
    try { v = parseFloat(getComputedStyle(root).maxHeight); } catch (_) {}
    return Number.isFinite(v) && v > 0 ? v : POSE_MAX_H_FALLBACK;
  }

  // La larghezza naturale sta in una variabile del foglio di stile e non in
  // `width`: quella, dentro un riquadro stretto, è già stata clampata dal
  // `max-width` di rete, e rileggerla vorrebbe dire tenersi la misura di quando
  // c'era meno posto anche dopo che il posto è tornato.
  function styleWidth(root) {
    let v = NaN;
    try { v = parseFloat(getComputedStyle(root).getPropertyValue('--sn-popup-w')); } catch (_) {}
    return Number.isFinite(v) && v > 0 ? v : POSE_W_FALLBACK;
  }

  function attachPose(root, anchor) {
    // Il punto ancorato va riportato DENTRO la finestra prima di ragionarci
    // sopra. Non è teoria: la scorciatoia ancora al fondo del rettangolo della
    // selezione, e una selezione che continua sotto la piega ha il fondo fuori
    // dallo schermo. Con un punto fuori, "sopra il punto" è a sua volta fuori e
    // il riquadro nasce già sbordato.
    //
    // E non basta farlo all'APERTURA: lo spazio cambia anche dopo — zoom della
    // pagina (in Filo si usa di continuo: Ctrl +/-, pinch, rotella) e finestra
    // ridimensionata accorciano la finestra sotto un punto che era dentro. Se il
    // punto resta quello di prima, ormai oltre il bordo, il riquadro viene
    // riposato rispetto a un posto che non esiste più e torna fuori dallo
    // schermo, con la riga per scrivere di nuovo irraggiungibile — lo stesso
    // sintomo del difetto, da un'altra porta. Quindi il punto grezzo si tiene e
    // si riporta dentro a OGNI misura: `ax()`/`ay()` sono funzioni, non costanti.
    // (Lo zoom della pagina non muove il contenuto nelle coordinate CSS: cambia
    // quanto viewport ci sta. Il punto grezzo resta quello giusto, va solo
    // ritagliato sulla finestra di adesso.)
    //
    // E il punto ancorato non è UN punto: è la parola. Una parola ha un'altezza,
    // e il riquadro va staccato dal bordo che gli sta di fronte — sopra la
    // parola si misura dalla sua CIMA, sotto dal suo FONDO. Ancorando tutti e
    // due i lati al solo fondo, il riquadro posato sopra si appoggiava otto
    // pixel sopra il fondo della parola, cioè DENTRO la parola: su una riga alta
    // 19px ne copriva gli ultimi 11, e la parola diventava illeggibile proprio
    // mentre l'utente leggeva cosa vuol dire. Chi passa un punto solo (il tasto
    // destro, dove l'ancora è il puntatore) lo usa per tutti e due i lati, che
    // per un punto è la stessa cosa.
    const rawX = Number.isFinite(anchor?.x) ? anchor.x : POSE_MARGIN;
    const rawY = Number.isFinite(anchor?.y) ? anchor.y : POSE_MARGIN;
    const rawYSopra = Number.isFinite(anchor?.top) ? anchor.top : rawY;
    const rawYSotto = Number.isFinite(anchor?.bottom) ? anchor.bottom : rawY;
    const dentro = (v, max) => Math.max(POSE_MARGIN, Math.min(max - POSE_MARGIN, v));
    const ax = () => dentro(rawX, window.innerWidth);
    // Il bordo della parola da cui si stacca il riquadro, a seconda del lato.
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

    // La compensazione zoom mette una `scale()` sul riquadro: il tetto è in px
    // di layout, lo spazio sullo schermo è in px visibili. Senza la scala il
    // tetto sarebbe stretto (o largo) del fattore di zoom.
    function scale() {
      try {
        const t = getComputedStyle(root).transform;
        if (!t || t === 'none') return 1;
        const m = new DOMMatrixReadOnly(t);
        return m.a > 0 ? m.a : 1;
      } catch (_) { return 1; }
    }

    // `max-height` misura il CONTENUTO quando il box è content-box: bordi e
    // imbottitura stanno fuori da quel numero, mentre lo spazio sullo schermo
    // li comprende.
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

    // ── Chi cede quando lo spazio si stringe (#502, seconda porta) ─────────
    //
    // Stringere il tetto funziona finché il tetto resta sopra la somma dei
    // minimi dei pezzi interni. Sotto quella soglia il riquadro NON si accorcia
    // più: i pezzi escono dal suo bordo. In pagina si vedono lo stesso; dentro
    // un riquadro incorporato — dove per un elemento `position: fixed` lo
    // "schermo" È il riquadro (#405: lì dentro tasto destro e Alt+E funzionano
    // apposta) — il browser li taglia via, e la riga per scrivere non si
    // raggiunge né scorrendo né spostando il riquadro altrove.
    //
    // Quindi il tetto da solo non basta: qualcuno deve cedere DAVVERO. A cedere
    // è il corpo della risposta, che si accorcia e scorre fino a sparire; poi,
    // se ancora non basta, la riga del costo (che resta leggibile passando
    // sopra l'intestazione). Intestazione e riga per scrivere restano sempre.
    const headerEl = root.querySelector('.sn-popup-header');
    const bodyEl = root.querySelector('.sn-popup-body');
    const footerEl = root.querySelector('.sn-popup-footer');
    const composeEl = root.querySelector('.sn-popup-compose');
    // In px di LAYOUT: sullo schermo la compensazione zoom li scala.
    const altezza = (el) => (el ? el.getBoundingClientRect().height / (scale() || 1) : 0);

    // Quanto occupa il corpo al minimo, in ciascuno dei gradini di
    // compressione. Si legge ORA, una volta, prima che il riquadro sia posato:
    // a decidere in corsa sul proprio esito la posa oscillerebbe.
    //
    // Il numero che mancava è il RESIDUO: quello che resta del corpo quando il
    // suo contenuto è già a zero. `min-height: 0` azzera il contenuto, non
    // l'ingombro — imbottitura e bordi restano, e sono una ventina di pixel che
    // il riquadro continua a occupare quando ormai non mostra più niente. Non
    // metterli in bilancio ERA il difetto all'estremo della scala: il conto
    // prometteva un riquadro più basso di quello che il browser sa disegnare,
    // il tetto restava largo di quei pixel e a uscire dal bordo era la riga per
    // scrivere.
    //
    // Si LEGGONO dal foglio di stile accendendo per un attimo le classi, invece
    // di ricopiarli qui: è il foglio di stile a decidere quanto cede il corpo, e
    // un numero ricopiato in JS ricomincerebbe a mentire al primo ritocco — che
    // è la forma esatta di questo difetto. Nessun fotogramma viene disegnato in
    // mezzo, quindi non si vede niente.
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
    // Da comodo: il minimo dichiarato più il suo contorno.
    const bodyComfort = (() => {
      if (!bodyEl) return 0;
      let mh = 0, bordo = residuoCorpo([]);
      try {
        const cs = getComputedStyle(bodyEl);
        mh = parseFloat(cs.minHeight) || 0;
        return cs.boxSizing === 'border-box' ? Math.max(mh, bordo) : mh + bordo;
      } catch (_) { return bordo; }
    })();
    // Da stretto (il corpo scorre) e da nudo (il corpo è sparito del tutto).
    const bodyStretto = residuoCorpo([POSE_TIGHT]);
    const bodyNudo = residuoCorpo([POSE_TIGHT, POSE_BARE]);
    // Idem per la riga del costo: da nascosta misurerebbe zero e non tornerebbe
    // più. (Nasce vuota ma il foglio di stile le dà già l'altezza che avrà
    // piena, così questa misura vale anche dopo.)
    const footerH = altezza(footerEl);

    // Quello che non cede mai. Misurato ogni volta: la riga per scrivere si
    // allarga quando la domanda è lunga.
    const incomprimibile = () => altezza(headerEl) + altezza(composeEl);

    // La casella della domanda: il suo minimo e il suo tetto naturale, letti dal
    // foglio di stile UNA VOLTA e prima di scriverci sopra il tetto ristretto —
    // dopo rileggeremmo il nostro stesso valore e lo stringeremmo a ogni giro.
    // (Stessa storia del tetto del riquadro: il numero sta nel foglio di stile,
    // non ricopiato qui.)
    const inputEl = root.querySelector('.sn-popup-input');
    const misuraStile = (el, prop, ripiego) => {
      let v = NaN;
      try { v = parseFloat(getComputedStyle(el)[prop]); } catch (_) {}
      return Number.isFinite(v) && v > 0 ? v : ripiego;
    };
    const inputMin = inputEl ? misuraStile(inputEl, 'minHeight', 30) : 30;
    const inputMax = inputEl ? misuraStile(inputEl, 'maxHeight', 120) : 120;

    // I tre gradini, dal più comodo al più stretto: quanto misura il riquadro
    // AL MINIMO in ciascuno. Sotto quel numero, in quello stato, non si accorcia
    // più — i pezzi escono dal bordo invece di comprimersi, e dentro un riquadro
    // incorporato il browser li taglia. Nell'ultimo il corpo ha ceduto anche
    // l'imbottitura, quindi sparisce per intero.
    const minComodo = () => incomprimibile() + footerH + bodyComfort;
    const minStretto = () => incomprimibile() + footerH + bodyStretto;
    const minNudo = () => incomprimibile() + bodyNudo;

    // Il livello di compressione è funzione SOLO del tetto e di misure prese
    // una volta sola: a parità di spazio dà sempre la stessa risposta, quindi
    // non può rincorrersi. Ogni soglia è il minimo VERO dello stato di sopra:
    // si passa al gradino dopo appena il tetto scende sotto quello che il
    // gradino di adesso sa disegnare.
    function comprimi(cap) {
      root.classList.toggle(POSE_TIGHT, cap < minComodo() - 0.5);
      root.classList.toggle(POSE_BARE, cap < minStretto() - 0.5);
    }

    // Il pavimento del tetto non è una costante: è il minimo del gradino più
    // stretto, cioè quanto misurano i pezzi che non cedono mai. Più in basso il
    // tetto non stringe più niente.
    const pavimento = () => minNudo();

    function chooseSide() {
      const want = (maxH + boxExtra()) * scale();  // ingombro pieno raggiungibile
      const below = roomBelow(), above = roomAbove();
      if (below >= want) return 'below';   // ci sta tutto sotto: preferenza naturale
      if (above >= want) return 'above';
      // Nessuno dei due basta al riquadro pieno: si prende il più capiente e il
      // tetto si stringe a quello. Ma se in quel lato non ci sta nemmeno il
      // MINIMO, il punto ancorato non è onorabile: il riquadro finirebbe fuori
      // dal bordo e andrebbe staccato comunque (meglio coprire la parola che
      // restare dove non si clicca). Tanto vale saperlo subito e dire che lo
      // spazio è la finestra INTERA: stringendo il tetto al solo lato si
      // butterebbe via posto che c'è, e nei riquadri incorporati più bassi il
      // corpo della risposta finiva a zero — la spiegazione richiesta non si
      // leggeva per niente.
      const migliore = above > below ? 'above' : 'below';
      const spazio = Math.max(above, below);
      const minimo = (pavimento() + boxExtra()) * scale();
      if (spazio < minimo) return 'dentro';
      // …ma "ci sta il riquadro ridotto all'osso" è la soglia sbagliata, perché
      // all'osso della risposta non si vede NIENTE. Il punto ancorato si onora
      // finché lascia LEGGERE la risposta, cioè finché il corpo tiene il minimo
      // che gli dà il foglio di stile: sotto, il riquadro si aggrappa alla
      // parola e paga tutto lo spazio che quel lato non ha, mentre metà del
      // riquadro incorporato resta vuota — in un box commenti (230-420px, la
      // misura tipica) della spiegazione appena chiesta restavano pochi pixel
      // da scorrere con la rotella. Sotto quella soglia conviene staccarsi e
      // appoggiarsi al bordo, dove lo spazio c'è tutto.
      const comodo = (minComodo() + boxExtra()) * scale();
      if (spazio >= comodo) return migliore;
      // Staccarsi però costa: il riquadro copre la parola. Lo si fa solo quando
      // frutta davvero — almeno un corpo comodo di spazio in più. Senza questa
      // condizione una finestra appena troppo bassa faceva coprire la parola per
      // guadagnare gli otto pixel dello stacco.
      const guadagno = (window.innerHeight - POSE_MARGIN * 2) - spazio;
      return guadagno >= bodyComfort * scale() ? 'dentro' : migliore;
    }

    // Larghezza: stesso ragionamento del tetto d'altezza, sull'altro asse.
    // Dentro un riquadro incorporato lo "schermo" è il riquadro (#405), e i box
    // dei commenti sono spesso stretti: con la larghezza fissa il tasto di
    // invio finisce oltre il bordo destro, dove il browser lo taglia — stesso
    // danno del difetto, altra direzione. Qui non deve cedere nessuno: basta
    // stringere la larghezza allo spazio che c'è. Si rifà da capo a ogni
    // misura, anche verso l'alto, così quando il posto torna torna anche la
    // larghezza piena.
    function capWidth() {
      const room = (window.innerWidth - POSE_MARGIN * 2) / scale() - boxExtraX();
      root.style.maxWidth = `${Math.max(0, Math.floor(Math.min(baseW, room)))}px`;
    }

    // Lo spazio in altezza su cui si stringe il tetto. Finché il riquadro è
    // ancorato è quello del lato scelto. Dopo che l'utente lo ha TRASCINATO è
    // tutta la finestra: la posizione è sua, l'ingombro no — quello non l'ha
    // scelto nessuno, e un riquadro più alto della finestra sborda comunque.
    // (È la stessa regola che la larghezza applicava già: `capWidth()` si rifà
    // anche da trascinato. L'altezza no, e quell'asimmetria ERA il difetto —
    // finestra rimpicciolita e riquadro spostato: smetteva di accorciarsi, si
    // appoggiava in cima e il fondo usciva, con la riga per scrivere fuori.)
    function roomForCap() {
      if (dragged) return window.innerHeight - POSE_MARGIN * 2;
      // 'dentro': il punto ancorato non era onorabile, il riquadro sta dove ci
      // sta e lo spazio è tutta la finestra — come da trascinato.
      if (side === 'dentro') return window.innerHeight - POSE_MARGIN * 2;
      return side === 'above' ? roomAbove() : roomBelow();
    }

    // Anche la CASELLA della domanda ha un tetto, e va stretto allo spazio come
    // quello del riquadro. Cresce mentre l'utente scrive (fino a 120px di
    // foglio di stile) e non cede mai — quindi in una finestra bassa, o dentro
    // un riquadro incorporato, sarebbe lei a spingere fuori il tasto di invio
    // anche dopo che tutto il resto ha ceduto. Il suo tetto è quanto resta
    // quando ha ceduto ANCHE il corpo, ridotto all'osso: da lì in giù la
    // casella smette di allungarsi e scorre al suo interno — il cursore resta
    // in vista perché il browser segue chi scrive, e nessun pezzo esce dal
    // bordo. Si rifà a ogni misura, in tutte e due le direzioni: quando lo
    // spazio torna, la casella torna a potersi allungare.
    function capInput() {
      if (!inputEl) return;
      // Imbottitura e bordo della riga: quello che la riga occupa OLTRE la
      // casella. È una differenza, quindi non risente del tetto che stiamo per
      // scrivere.
      const contorno = Math.max(0, altezza(composeEl) - altezza(inputEl));
      const room = roomForCap() / scale() - boxExtra();
      const disponibile = room - altezza(headerEl) - contorno - bodyNudo;
      const tetto = Math.max(inputMin, Math.min(inputMax, disponibile));
      inputEl.style.maxHeight = `${Math.floor(tetto)}px`;
    }

    // Su quale altezza incomprimibile è stato fatto il bilancio dell'altezza.
    // La riga per scrivere CRESCE con la domanda, e quando cresce il bilancio è
    // vecchio: il corpo resta al minimo comodo che aveva, non cede un pixel, e
    // a uscire dal bordo del riquadro è proprio la riga in basso — col tasto di
    // invio, che sotto il cursore non c'è più. Era la stessa asimmetria di
    // sempre, un tasto più in là: il conto si rifaceva quando cambiava la
    // finestra, mai quando a crescere era la domanda (#502).
    let bilancioSu = -1;
    const bilancioVecchio = () => Math.abs(incomprimibile() - bilancioSu) > 0.5;

    // Si rifà da capo a ogni misura, in tutte e due le direzioni: stringe
    // quando lo spazio manca e RIALLARGA quando torna. Un tetto che sa solo
    // stringere lascia il riquadro schiacciato per sempre — la seconda faccia
    // dello stesso difetto: spostato mentre lo spazio era poco, restava alto
    // 194px anche con la finestra tornata a 900.
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

    // Scrive le coordinate. Non dipendono dall'altezza corrente — solo dal punto
    // ancorato e dalla finestra — quindi finché la finestra non cambia sono
    // COSTANTI: riscriverle mille volte non muove il riquadro di un pixel.
    function place() {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (dragged) return;
      const w = root.getBoundingClientRect().width || root.offsetWidth;
      let left = ax();
      if (left + w + POSE_MARGIN > vw) left = vw - w - POSE_MARGIN;
      if (left < POSE_MARGIN) left = POSE_MARGIN;
      root.style.left = `${Math.round(left)}px`;
      if (side === 'dentro') {
        // Il punto ancorato non era onorabile: il riquadro si appoggia in cima
        // alla finestra e il tetto lo tiene dentro. Anche questa coordinata non
        // dipende dall'altezza corrente, quindi resta costante come le altre.
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

    // Rete di sicurezza. Con il tetto stretto allo spazio disponibile il
    // riquadro non dovrebbe mai sbordare; se succede lo stesso — le altezze
    // minime dei pezzi interni non stanno nel tetto, finestra bassissima — si
    // stringe ANCORA il tetto. Solo in una direzione: non può oscillare.
    function guard() {
      // Prima di guardare i bordi: se a cambiare è stato ciò che NON cede — la
      // riga per scrivere che si allunga o si riaccorcia con la domanda — il
      // bilancio è vecchio e va rifatto da capo, esattamente come quando cambia
      // la finestra. Rifarlo solo quando quel numero è cambiato è ciò che
      // impedisce di rincorrere lo stringimento in più che questo stesso
      // guardiano applica qui sotto.
      if (bilancioVecchio()) capHeight();
      if (dragged) {
        // Trascinato: lì la posa è dell'utente, si sposta solo se esce.
        const vw = window.innerWidth, vh = window.innerHeight;
        let r = root.getBoundingClientRect();
        // Ma prima di spostarlo va fatto STARE: da trascinato non c'è un bordo
        // ancorato, quindi il riquadro è libero di scorrere su e giù — se non
        // ci sta è perché è più ALTO della finestra, e allora si stringe il
        // tetto, come sul lato libero di un riquadro ancorato. Senza questo
        // passo il riquadro più alto della finestra si appoggia in cima e il
        // fondo (la riga per scrivere) resta fuori: spostarlo non basta.
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
      // Guarda TUTTI E DUE i bordi, non solo quello da cui ci si aspetta lo
      // sbordo. Sul lato LIBERO — quello verso cui il riquadro cresce — sborda
      // il contenuto: lì la cura è stringere ancora il tetto. Sul lato ANCORATO
      // stringere non serve a niente, perché quel bordo sta fermo: va riportato
      // dentro di peso. Guardare il solo lato previsto lasciava passare proprio
      // il caso in cui lo spazio si accorcia DOPO l'apertura: un riquadro
      // agganciato in alto che finisce sotto il fondo non lo vedeva nessuno.
      const libero = side === 'above'
        ? POSE_MARGIN - r.top
        : r.bottom - (vh - POSE_MARGIN);
      if (libero > 0.5) {
        const cur = parseFloat(root.style.maxHeight) || root.offsetHeight;
        const next = Math.max(pavimento(), Math.floor(cur - libero / scale()));
        // Stringere il tetto senza far cedere nessuno non stringe niente:
        // il livello di compressione va rifatto sul tetto nuovo, anche quando
        // il tetto era già al pavimento (è il caso in cui a sbordare sono
        // proprio i minimi interni).
        comprimi(next);
        // Rileggere subito costa un layout, ma senza non sapremmo se lo
        // stringimento è bastato.
        if (next < cur) { root.style.maxHeight = `${Math.floor(next)}px`; }
        r = root.getBoundingClientRect();
      }
      // Dentro tutti e due i bordi: finito.
      if (POSE_MARGIN - r.top <= 1 && r.bottom - (vh - POSE_MARGIN) <= 1) return;
      // Sborda ancora: o il tetto è già al minimo (finestra più bassa del
      // riquadro), o a sbordare è il bordo ancorato. Meglio coprire il punto
      // ancorato che restare fuori dal bordo, dove non si clicca. Passa
      // all'aggancio dall'alto per non litigare con `bottom`; `place()` lo
      // riscriverà e questo lo ricorreggerà, sempre allo stesso valore.
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

    // Finestra ridimensionata o zoom cambiato: lo spazio disponibile è un altro.
    // Il tetto va rifatto DA CAPO — anche verso l'alto: quando lo spazio torna
    // (zoom rimesso a 100%, finestra riallargata) il riquadro deve poter tornare
    // alto com'era, non restare stretto per sempre — e la posa riscritta sul
    // punto ancorato ritagliato sulla finestra di adesso.
    const vv = window.visualViewport;
    // Larghezza E altezza si rifanno sempre, anche se l'utente lo ha
    // trascinato: la posa è sua, l'ingombro non lo ha scelto nessuno. Rifarne
    // una sola delle due era il difetto — di larghezza il riquadro spostato si
    // stringeva, di altezza no.
    const onViewport = () => { capWidth(); capHeight(); refresh(); };
    window.addEventListener('resize', onViewport);
    vv?.addEventListener('resize', onViewport);
    // Lo zoom della pagina (Ctrl +/-, pinch, rotella) cambia la risoluzione:
    // stessa rete della compensazione zoom, per i casi in cui `resize` da solo
    // non arriva. Registrata DOPO quella della compensazione, così quando
    // rimisuriamo la `scale()` del riquadro è già quella nuova.
    let mql = null;
    try {
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mql.addEventListener?.('change', onViewport);
    } catch (_) {}

    return {
      // Ripassa SUBITO, in modo sincrono. Il ResizeObserver consegna solo al
      // passo di rendering: in una scheda in secondo piano quel passo è
      // strozzato. Chi allunga il contenuto chiama questa.
      reflow: refresh,
      markDragged() {
        if (dragged) return;
        dragged = true;
        // Da qui in poi comanda `top`: con `top` e `bottom` insieme e altezza
        // automatica il riquadro verrebbe stirato fra i due bordi.
        const r = root.getBoundingClientRect();
        root.style.bottom = 'auto';
        root.style.top = `${Math.round(r.top)}px`;
        // Cambiato il bordo ancorato cambia anche il punto da cui scala la
        // compensazione zoom: restando `bottom left` il riquadro si disegnerebbe
        // alto quanto la scala lo allunga sopra il suo `top`, e ogni conto fatto
        // su `style.top` (il limite del trascinamento, il guardiano) parlerebbe
        // di un posto dove il riquadro non è. La compensazione ricava la stessa
        // cosa da `bottom: auto` al prossimo cambio di zoom: qui la anticipiamo
        // nello stesso istante, così non passa nemmeno un fotogramma storto.
        root.style.transformOrigin = 'top left';
        // Lo spazio disponibile è cambiato nell'istante stesso in cui è stato
        // preso in mano: non è più quello del lato ancorato, è la finestra
        // intera. Rifare il tetto qui è ciò che gli ridà l'altezza che lo
        // spazio consente, invece di tenersi quella di quando era appeso al
        // punto della selezione.
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

  // ----------------------------------------------------------------
  // Chiusura
  // ----------------------------------------------------------------
  function closePopup(popup) {
    if (!popup) return;
    try { popup.activePort?.disconnect(); } catch (_) {}
    try { popup.cleanupZoom?.(); } catch (_) {}
    try { popup.pose?.dispose(); } catch (_) {}
    popup.root.remove();
    const idx = popups.indexOf(popup);
    if (idx >= 0) popups.splice(idx, 1);
    // Rimette la selezione che il fuoco della riga per scrivere aveva spento:
    // la parola torna selezionata com'era, pronta per la cosa dopo. Solo se
    // nel frattempo l'utente non ne ha fatta una sua, che comanda lei.
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
  //    la casella restava gonfia e la risposta non si riprendeva lo spazio.
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

  // ----------------------------------------------------------------
  // Crea un popup vuoto (header + body conversazione + input follow-up)
  // ----------------------------------------------------------------
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

    // Quando l'utente clicca dentro il popup, portalo in primo piano
    root.addEventListener('mousedown', () => bringToFront(popup), true);

    // Send su Enter (senza Shift); Shift+Enter inserisce nuova riga
    popup.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitFollowup(popup);
      }
    });
    popup.sendEl.addEventListener('click', () => submitFollowup(popup));
    // Auto-grow textarea
    popup.inputEl.addEventListener('input', () => {
      autoGrow(popup.inputEl);
      // Anche la casella che si allarga alza il riquadro: stessa regola.
      reflow(popup);
    });

    // Dare il fuoco alla casella spegne la selezione della pagina: un documento
    // ha una selezione sola, e prenderla dentro il riquadro vuol dire lasciarla
    // fuori. La parola su cui l'utente ha chiesto la spiegazione però gli serve
    // ancora quando il riquadro si chiude (tradurla, copiarla, cercarla), e
    // rifarla a mano è lo stesso attrito da cui stiamo scappando: ce la teniamo
    // da parte e gliela rimettiamo alla chiusura.
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) popup.savedRange = sel.getRangeAt(0).cloneRange();
    } catch (_) {}

    // Il cursore va SUBITO nella riga per scrivere. Chi ha chiesto la
    // spiegazione con la tastiera (Alt+E) doveva passare al mouse — o scoprire
    // Tab — per fare la domanda dopo: attrito puro su una strada che è tutta di
    // tastiera. Le due strade fanno la stessa cosa, quindi vale anche per la
    // freccetta del menu del tasto destro. `preventScroll` perché dare il fuoco
    // a un elemento dentro un riquadro incorporato farebbe scorrere la pagina
    // che lo contiene, e il riquadro appena aperto scapperebbe di vista.
    try { popup.inputEl.focus({ preventScroll: true }); } catch (_) {}

    popups.push(popup);
    return popup;
  }

  // ----------------------------------------------------------------
  // Aggiunge una "bolla" messaggio al body. Ritorna l'elemento di testo.
  // ----------------------------------------------------------------
  function appendBubble(popup, role) {
    const wrap = document.createElement('div');
    wrap.className = `sn-msg sn-msg-${role}`;
    const text = document.createElement('div');
    text.className = 'sn-msg-text';
    wrap.appendChild(text);
    // Bolla nuova = turno nuovo, e il turno lo apre sempre l'utente (ha aperto
    // il riquadro o ha appena inviato una domanda): questa è l'eccezione
    // esplicita "vai comunque in fondo", vuole vedere quello che ha chiesto.
    scrollaConservando(popup, () => popup.bodyEl.appendChild(wrap), true);
    return { wrap, text };
  }

  // Aggiorna il corpo della risposta senza STRAPPARE la lettura —
  // vedi patterns/liste-chat-che-si-ricostruiscono-in-streaming-auto-follow.md
  //
  // Il corpo del riquadro è una finestrella che scorre, e quando lo spazio è
  // poco si accorcia parecchio: leggere scorrendo mentre la risposta arriva è
  // il modo normale di usarla. Portare la vista in fondo a ogni pezzo che
  // arriva vuol dire che chi torna su a rileggere viene sbalzato giù di nuovo,
  // e a ogni pezzo — cioè non può rileggere finché il modello non ha finito.
  //
  // Quindi: si segue il fondo solo se l'utente ci era rimasto, altrimenti la
  // lettura si lascia dov'è. La posizione si RIMETTE, non basta non toccarla:
  // se il contenuto si accorcia (il riquadro si comprime, la risposta finale
  // rirenderizzata è più corta del parziale) il browser clampa `scrollTop` e la
  // vista salta da sola.
  //
  // Il ritaglio va fatto DOPO la posa: `reflow` può accorciare il corpo, e con
  // esso lo scorrimento massimo.
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

  // Il riquadro è appena diventato più alto: rimettilo in posa.
  function reflow(popup) {
    try { popup?.pose?.reflow(); } catch (_) {}
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
  function startTurn(popup, messages, onAssistantDone) {
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
        setMeta(popup, `${I18n.t('popup_model')}: ${popup.model}`);
      } else if (m.type === 'delta') {
        if (firstDelta) {
          bubble.text.innerHTML = '';
          firstDelta = false;
        }
        buf += m.delta;
        // Ogni delta allunga il riquadro: la posa va rifatta ADESSO, non al
        // prossimo disegno (#502). E la lettura resta dov'è se l'utente era
        // tornato su a rileggere.
        scrollaConservando(popup, () => {
          bubble.text.innerHTML = renderMarkdown(resolveCalcMarkers(buf));
        });
      } else if (m.type === 'reset') {
        // Il provider è caduto a metà risposta e il sistema riparte da zero su
        // un fallback: butta il testo parziale e torna allo stato "in attesa",
        // così il messaggio finale è SOLO la risposta del provider che riesce.
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
        // L'ultima riscrittura è quella che può ACCORCIARE il testo (markdown
        // completo al posto del parziale): senza rimettere la posizione, chi
        // stava rileggendo a metà si ritrova sbalzato dal clamp del browser.
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

  // ----------------------------------------------------------------
  // Submit di una domanda di follow-up
  // ----------------------------------------------------------------
  function submitFollowup(popup) {
    const txt = popup.inputEl.value.trim();
    if (!txt) return;
    if (popup.activePort) return; // già in streaming
    popup.inputEl.value = '';
    popup.inputEl.style.height = 'auto';

    // Mostra bolla utente
    const userBubble = appendBubble(popup, 'user');
    userBubble.text.textContent = txt;

    // Aggiungi alla conversazione e avvia turno
    popup.conversation.push({ role: 'user', content: txt });
    startTurn(popup, popup.conversation, (assistantText) => {
      popup.conversation.push({ role: 'assistant', content: assistantText });
    });
  }

  // ----------------------------------------------------------------
  // openStreaming: API pubblica. Apre un nuovo popup (stack), avvia il primo turno.
  // ----------------------------------------------------------------
  function openStreaming({ action, payload, anchor, title }) {
    installEscOnce();
    const popup = createPopup({ title, anchor });
    popup.action = action;

    // Costruisci il prompt iniziale specifico per l'action
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

  // ----------------------------------------------------------------
  // Stack degli avvisi in pagina (#409)
  // ----------------------------------------------------------------
  // TUTTO ciò che Filo ancora nell'angolo in basso a destra della pagina
  // visitata (toast, pill della dettatura, conferma cliccabile di "Salva per
  // dopo") vive dentro UN solo contenitore che li impila. Prima ogni avviso era
  // `position: fixed` sullo stesso angolo: due ravvicinati — anche solo
  // "sto lavorando" seguito dall'esito — finivano uno sopra l'altro e non si
  // leggeva nessuno dei due. Stesso pattern della shell (NOTIFS) e dell'editor
  // (.ed-toasts), vedi PATTERNS.md § "Stack di overlay impilati".
  let toastHostEl = null;

  // Tetto al numero di avvisi vivi insieme: senza, una raffica (una pagina che
  // salva venti immagini di fila) riempie lo schermo e spinge i più vecchi
  // fuori dal viewport. Teniamo i più recenti, che sono i più rilevanti.
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
      try { c.remove(); } catch (_) {}
    }
  }

  // L'animazione d'ingresso fa salire l'avviso di 8px: dentro un contenitore
  // scrollabile quello sposto allarga anche l'area scrollabile. Senza tolleranza
  // uno stack che ci sta comodo verrebbe dichiarato "in overflow" — e non è un
  // dettaglio estetico: attivare lo scroll fa partire un evento `scroll` che
  // altre superfici di Filo (il menu del tasto destro) leggono come "la pagina
  // si è mossa" e si chiudono da sole.
  const TOAST_ENTER_SHIFT_PX = 8;

  // Finestra molto bassa: anche col tetto lo stack può eccedere l'altezza
  // disponibile. Lo rendiamo scrollabile, teniamo in vista il più recente e
  // riattiviamo i pointer-events solo lì (di base sono spenti per non rubare i
  // click alla pagina sotto).
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

  // ----------------------------------------------------------------
  // Toast (per feedback brevi)
  // ----------------------------------------------------------------
  // `duration: 0` = il toast resta finché non lo chiude il chiamante (operazioni
  // lunghe: l'avviso "sto lavorando" deve durare quanto il lavoro). Ritorna
  // sempre un handle con close(), così chi mostra un avviso di avanzamento può
  // sostituirlo con l'esito invece di impilarci sopra un secondo riquadro.
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

  // close API legacy: chiude il topmost (compatibilità con codice che chiamava SN_POPUP.close())
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
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
