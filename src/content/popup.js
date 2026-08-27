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
  function attachDrag(root, handle, onDragStart) {
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
      const w = root.offsetWidth, h = root.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left + w > vw) left = vw - w;
      if (top + h > vh) top = vh - h;
      root.style.left = left + 'px';
      root.style.top = top + 'px';
    }
    function onUp() {
      dragging = false;
      handle.classList.remove('sn-popup-dragging');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
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
  // Posa del riquadro — vedi PATTERNS.md § "Un riquadro che si riempie dopo si
  // ancora dal lato che non si muove"
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
  //   3. Il bordo ancorato lo tiene il FOGLIO DI STILE, non JavaScript: sotto
  //      la selezione si fissa `top` e il riquadro cresce verso il basso; sopra
  //      la selezione si fissa `bottom` e cresce verso l'alto da solo. Nessuno
  //      deve rimisurare niente perché niente si sposta: l'unica coordinata che
  //      cambia col contenuto è quella libera, e ci pensa il browser.
  //
  // Resta un guardiano per i casi che la matematica non copre (finestra troppo
  // bassa perché il riquadro ci stia nemmeno al minimo): stringe ancora il
  // tetto invece di spostare il riquadro, quindi va in una sola direzione e non
  // può oscillare. Solo quando il tetto è già al minimo e il riquadro sborda lo
  // stesso lo riporta dentro a forza.
  //
  // Dopo che l'utente lo ha trascinato la posa è sua: non lo riportiamo sul
  // punto ancorato, ci limitiamo a non farlo uscire dallo schermo.
  const POSE_MARGIN = 8;   // aria fra riquadro e bordi della finestra
  const POSE_GAP = 8;      // stacco fra riquadro e punto ancorato
  const POSE_MIN_H = 160;  // sotto quest'altezza il riquadro non è più usabile
  const POSE_FLOOR_H = 60; // fondo assoluto a cui può scendere il guardiano
  const POSE_MAX_H_FALLBACK = 480;

  // Il tetto lo tiene il foglio di stile: lo leggiamo invece di ricopiarlo, così
  // se cambia lì la posa lo segue da sola.
  function styleMaxHeight(root) {
    let v = NaN;
    try { v = parseFloat(getComputedStyle(root).maxHeight); } catch (_) {}
    return Number.isFinite(v) && v > 0 ? v : POSE_MAX_H_FALLBACK;
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
    const rawX = Number.isFinite(anchor?.x) ? anchor.x : POSE_MARGIN;
    const rawY = Number.isFinite(anchor?.y) ? anchor.y : POSE_MARGIN;
    const dentro = (v, max) => Math.max(POSE_MARGIN, Math.min(max - POSE_MARGIN, v));
    const ax = () => dentro(rawX, window.innerWidth);
    const ay = () => dentro(rawY, window.innerHeight);
    // Letto PRIMA di scrivere il tetto inline: dopo rileggeremmo il nostro
    // stesso valore e lo stringeremmo a ogni giro.
    const maxH = styleMaxHeight(root);
    let side = null;
    let dragged = false;
    let ro = null;

    const roomBelow = () => window.innerHeight - (ay() + POSE_GAP) - POSE_MARGIN;
    const roomAbove = () => ay() - POSE_GAP - POSE_MARGIN;

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

    function chooseSide() {
      const want = (maxH + boxExtra()) * scale();  // ingombro pieno raggiungibile
      const below = roomBelow(), above = roomAbove();
      if (below >= want) return 'below';   // ci sta tutto sotto: preferenza naturale
      if (above >= want) return 'above';
      return above > below ? 'above' : 'below'; // nessuno dei due basta: il più capiente
    }

    function capHeight() {
      const room = (side === 'above' ? roomAbove() : roomBelow()) / scale() - boxExtra();
      const cap = Math.min(maxH, Math.max(POSE_MIN_H, room));
      root.style.maxHeight = `${Math.floor(cap)}px`;
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
      if (side === 'above') {
        // Il fondo resta incollato sopra la selezione e la crescita va in su.
        root.style.top = 'auto';
        root.style.bottom = `${Math.round(vh - (ay() - POSE_GAP))}px`;
      } else {
        root.style.bottom = 'auto';
        root.style.top = `${Math.round(ay() + POSE_GAP)}px`;
      }
    }

    // Rete di sicurezza. Con il tetto stretto allo spazio disponibile il
    // riquadro non dovrebbe mai sbordare; se succede lo stesso — le altezze
    // minime dei pezzi interni non stanno nel tetto, finestra bassissima — si
    // stringe ANCORA il tetto. Solo in una direzione: non può oscillare.
    function guard() {
      if (dragged) {
        // Trascinato: lì la posa è dell'utente, si sposta solo se esce.
        const vw = window.innerWidth, vh = window.innerHeight;
        const r = root.getBoundingClientRect();
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
        const next = Math.max(POSE_FLOOR_H, Math.floor(cur - libero / scale()));
        // Rileggere subito costa un layout, ma senza non sapremmo se lo
        // stringimento è bastato.
        if (next < cur) { root.style.maxHeight = `${next}px`; r = root.getBoundingClientRect(); }
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

    // Finestra ridimensionata o zoom cambiato: lo spazio disponibile è un altro,
    // il tetto va ricalcolato da capo (anche verso l'alto) e la posa riscritta.
    const vv = window.visualViewport;
    const onViewport = () => { if (!dragged) capHeight(); refresh(); };
    window.addEventListener('resize', onViewport);
    vv?.addEventListener('resize', onViewport);

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
      },
      dispose() {
        try { ro?.disconnect(); } catch (_) {}
        window.removeEventListener('resize', onViewport);
        try { vv?.removeEventListener('resize', onViewport); } catch (_) {}
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
  }

  function closeTopmost() {
    if (popups.length) closePopup(popups[popups.length - 1]);
  }

  // ----------------------------------------------------------------
  // Crea un popup vuoto (header + body conversazione + input follow-up)
  // ----------------------------------------------------------------
  function createPopup({ title, anchor }) {
    const root = document.createElement('div');
    root.className = 'sn-popup';
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
    attachDrag(root, root.querySelector('.sn-popup-header'), () => popup.pose?.markDragged());

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
      popup.inputEl.style.height = 'auto';
      popup.inputEl.style.height = Math.min(popup.inputEl.scrollHeight, 120) + 'px';
      // Anche la casella che si allarga alza il riquadro: stessa regola.
      reflow(popup);
    });

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
    popup.bodyEl.appendChild(wrap);
    popup.bodyEl.scrollTop = popup.bodyEl.scrollHeight;
    reflow(popup);
    return { wrap, text };
  }

  // Il riquadro è appena diventato più alto: rimettilo in posa.
  function reflow(popup) {
    try { popup?.pose?.reflow(); } catch (_) {}
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
        popup.metaEl.textContent = `${I18n.t('popup_model')}: ${popup.model}`;
      } else if (m.type === 'delta') {
        if (firstDelta) {
          bubble.text.innerHTML = '';
          firstDelta = false;
        }
        buf += m.delta;
        bubble.text.innerHTML = renderMarkdown(resolveCalcMarkers(buf));
        popup.bodyEl.scrollTop = popup.bodyEl.scrollHeight;
        // Ogni delta allunga il riquadro: la posa va rifatta ADESSO, non al
        // prossimo disegno (#502).
        reflow(popup);
      } else if (m.type === 'reset') {
        // Il provider è caduto a metà risposta e il sistema riparte da zero su
        // un fallback: butta il testo parziale e torna allo stato "in attesa",
        // così il messaggio finale è SOLO la risposta del provider che riesce.
        buf = '';
        firstDelta = true;
        bubble.text.innerHTML = '';
        const retry = document.createElement('span');
        retry.className = 'sn-msg-loading';
        retry.textContent = I18n.t('popup_loading');
        bubble.text.appendChild(retry);
        reflow(popup);
      } else if (m.type === 'done') {
        if (firstDelta) {
          // nessun delta arrivato (es. cache vuota errore)
          bubble.text.textContent = '';
        }
        const resolved = resolveCalcMarkers(buf);
        if (popup.action === ACTIONS.EXPLAIN && /NESSUNA SPIEGAZIONE/i.test(resolved.trim())) {
          bubble.text.textContent = I18n.t('popup_no_explanation');
          bubble.wrap.classList.add('sn-msg-muted');
        } else {
          bubble.text.innerHTML = renderMarkdown(resolved);
        }
        const eur = m.costEur || 0;
        popup.metaEl.textContent = `${I18n.t('popup_model')}: ${popup.model} • ${I18n.t('popup_estimated_cost')}: €${eur.toFixed(4)}`;
        reflow(popup);
        // Salva la versione risolta in conversazione: i follow-up vedono i numeri,
        // non i marker, così l'LLM non si confonde nei turni successivi.
        try { onAssistantDone && onAssistantDone(resolved); } catch (_) {}
        popup.activePort = null;
      } else if (m.type === 'error') {
        bubble.text.textContent = m.message || I18n.t('err_provider_failed');
        bubble.wrap.classList.add('sn-msg-error');
        reflow(popup);
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
