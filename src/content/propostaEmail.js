// L'email dell'account proposta nei campi di accesso dei siti (#1124): qui solo il campo, le sue misure e il riempimento.
// Se e dove proporla lo decide il main, che la disegna sopra la scheda: l'email arriva qui solo dopo la scelta.
// Regole: patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md

(function (global) {
  'use strict';
  if (global.SN_PROPOSTA_EMAIL) return;
  if (!/^https?:$/.test(location.protocol)) return;
  const C = global.SN_CAMPO_ACCESSO;
  const chrome = global.chrome;
  if (!C || !chrome || !chrome.runtime) return;

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T = MSG.PROPOSTA_EMAIL || 'proposta_email';
  const T_RIEMPI = MSG.PROPOSTA_EMAIL_RIEMPI || 'proposta_email_riempi';
  // Il campo che si sposta da solo (un'animazione della pagina, un riquadro che si apre sopra) si rimisura a questo passo.
  const PASSO_MS = 300;
  const ANELLI_MAX = 8;
  // Un campo che l'utente non vede non riceve la proposta: la pagina la farebbe comparire dove lui sta per cliccare.
  const OPACITA_MIN = 0.25;
  const LARGO_MIN = 20;
  const ALTO_MIN = 10;
  // Un fuoco nato da un clic dell'utente sul campo (o sulla sua etichetta) poco prima non l'ha deciso la pagina.
  const GESTO_MS = 1500;

  // Per campo: la sua chiave (stabile finché il nodo vive) e l'ultimo valore scritto dall'utente stesso.
  const perCampo = new WeakMap();
  let corrente = null;
  // La scelta può arrivare mentre il fuoco è sulla proposta, cioè a campo appena lasciato.
  let ultimo = null;

  // Il main scarta un messaggio di questo documento più vecchio dell'ultimo visto: l'ordine delle risposte non è garantito.
  let numero = 0;
  const istanza = chiave();
  function send(msg, cb) {
    try { chrome.runtime.sendMessage({ ...msg, istanza, n: ++numero }, cb); } catch (_) { if (cb) cb(null); }
  }

  function chiave() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function attivo() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  // Il campo vero anche dentro uno shadow root aperto: a livello del documento l'evento porta l'host.
  function bersaglio(e) {
    try {
      const p = e.composedPath();
      if (p && p[0] && p[0].nodeType === 1) return p[0];
    } catch (_) {}
    return e.target;
  }

  function idoneo(el) {
    if (!el || el.nodeType !== 1 || String(el.tagName).toLowerCase() !== 'input') return false;
    let label = '';
    try { const l = el.labels && el.labels[0]; if (l) label = l.textContent || ''; } catch (_) {}
    const attr = (n) => el.getAttribute(n) || '';
    let labelledBy = '';
    try {
      const radice = el.getRootNode();
      const cerca = radice && typeof radice.getElementById === 'function' ? radice : document;
      labelledBy = attr('aria-labelledby').split(/\s+/).filter(Boolean).slice(0, 8)
        .map((id) => { const n = cerca.getElementById(id); return n ? n.textContent || '' : ''; }).join(' ');
    } catch (_) {}
    return C.chiedeAccesso({
      tag: 'input', type: el.type, autocomplete: attr('autocomplete'), name: attr('name'), id: el.id || '',
      placeholder: attr('placeholder'), ariaLabel: attr('aria-label'), labelledBy, title: attr('title'), label,
      disabled: el.disabled, readOnly: el.readOnly,
    }, location.hostname);
  }

  // L'ultimo clic vero in questo documento, col percorso: dice se il fuoco a un campo l'ha dato l'utente.
  let gesto = null;
  function premuto(e) {
    if (!e.isTrusted) return;
    let p = [];
    try { p = e.composedPath(); } catch (_) { p = []; }
    gesto = { t: performance.now(), p };
    const c = corrente;
    if (c && attivo() === c.el && suCampo(p, c.el)) { c.dalUtente = true; c.muto = false; invia('clic'); }
  }

  function suCampo(percorso, el) {
    let labels = [];
    try { labels = Array.from(el.labels || []); } catch (_) { labels = []; }
    return percorso.some((n) => n === el || labels.includes(n));
  }

  function dalUtente(el) {
    return !!gesto && performance.now() - gesto.t < GESTO_MS && suCampo(gesto.p, el);
  }

  // Opacità vista dall'utente: quella di tutti gli antenati, anche attraverso gli shadow root, filtri compresi.
  function opacita(el) {
    let o = 1;
    for (let n = el, i = 0; n && i < 256; i++) {
      if (n.nodeType === 1) {
        let cs = null;
        try { cs = n.ownerDocument.defaultView.getComputedStyle(n); } catch (_) { cs = null; }
        if (cs) {
          if (n === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) return 0;
          const v = parseFloat(cs.opacity);
          if (Number.isFinite(v)) o *= v;
          for (const m of String(cs.filter || '').matchAll(/opacity\(\s*([\d.]+)\s*(%?)\s*\)/g)) {
            const f = parseFloat(m[1]);
            if (Number.isFinite(f)) o *= m[2] ? f / 100 : f;
          }
        }
      }
      n = n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
    }
    return o;
  }

  function tenue(el, r) {
    return r.width < LARGO_MIN || r.height < ALTO_MIN || opacita(el) < OPACITA_MIN;
  }

  // L'alfa di un colore calcolato (rgb(), rgba(), color(… / a), transparent); una forma ignota vale opaca.
  function alfa(c) {
    const s = String(c || '').trim();
    if (!s || s === 'transparent') return 0;
    const m = s.match(/^rgba?\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      return p.length >= 4 ? parsePct(p[3]) : 1;
    }
    const b = s.match(/\/\s*([\d.]+%?)\s*\)$/);
    return b ? parsePct(b[1]) : 1;
  }
  function parsePct(v) {
    const f = parseFloat(v);
    if (!Number.isFinite(f)) return 1;
    return /%$/.test(v) ? f / 100 : f;
  }
  const visto = (c) => alfa(c) > 0.1;

  // Un campo che non disegna niente di suo (fondo, bordo, contorno, ombra, testo, segnaposto, cursore) non si vede,
  // qualunque cosa ci stia sotto: la pagina lo posa sopra il suo «Accetta».
  function spoglio(el) {
    let cs = null;
    try { cs = el.ownerDocument.defaultView.getComputedStyle(el); } catch (_) { return false; }
    if (!cs) return false;
    if (visto(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')) return false;
    for (const lato of ['Top', 'Right', 'Bottom', 'Left']) {
      const st = cs[`border${lato}Style`];
      if (st !== 'none' && st !== 'hidden' && parseFloat(cs[`border${lato}Width`]) > 0 && visto(cs[`border${lato}Color`])) return false;
    }
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && visto(cs.outlineColor)) return false;
    if (cs.boxShadow && cs.boxShadow !== 'none' && (cs.boxShadow.match(/[a-z-]+\([^)]*\)/g) || ['rgb(0,0,0)']).some(visto)) return false;
    const testo = visto(cs.color) && visto(cs.webkitTextFillColor || cs.color);
    if (el.value && testo) return false;
    if (!el.value && el.placeholder) {
      let ph = null;
      try { ph = el.ownerDocument.defaultView.getComputedStyle(el, '::placeholder'); } catch (_) { ph = null; }
      if (!ph || visto(ph.color)) return false;
    }
    const cursore = !cs.caretColor || cs.caretColor === 'auto' ? cs.color : cs.caretColor;
    return !visto(cursore);
  }

  // Un velo che lascia passare i clic (pointer-events: none) non risponde ai punti: la ricerca per punti non lo vede,
  // eppure copre il campo. Si cercano, fra i nodi del documento, quelli opachi sopra ogni punto del campo.
  const NODI_MAX = 20000;
  const VELO_MS = 1000;
  const veli = new WeakMap();
  function velato(el, r, win, xs, ys, { dubbio = true } = {}) {
    const ora = performance.now();
    const prima = veli.get(el);
    if (prima && ora - prima.t < VELO_MS && prima.k === `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`) return prima.v;
    const v = cercaVelo(el, r, win, xs, ys, dubbio);
    veli.set(el, { t: ora, v, k: `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` });
    return v;
  }

  function cercaVelo(el, r, win, xs, ys, dubbio) {
    const punti = [];
    for (const fy of ys) for (const fx of xs) {
      const x = r.left + r.width * fx; const y = r.top + r.height * fy;
      if (x >= 0 && y >= 0 && x < win.innerWidth && y < win.innerHeight) punti.push({ x, y, coperto: false });
    }
    if (!punti.length) return false;
    const doc = el.ownerDocument;
    // Il campo dentro uno shadow root sta, per il documento, al posto del suo host.
    let cima = el;
    for (let i = 0; i < 32; i++) { const h = cima.getRootNode && cima.getRootNode().host; if (!h) break; cima = h; }
    let csCima = null;
    try { csCima = win.getComputedStyle(cima); } catch (_) { csCima = null; }
    const posCima = !!csCima && csCima.position !== 'static';
    const zCima = csCima ? (parseInt(csCima.zIndex, 10) || 0) : 0;
    let walker;
    try { walker = doc.createTreeWalker(doc.documentElement, 1); } catch (_) { return false; }
    let n = walker.currentNode; let contati = 0; let liberi = punti.length;
    for (; n; n = walker.nextNode()) {
      if (++contati > NODI_MAX) return dubbio;
      if (n === cima || n.contains(cima) || cima.contains(n)) continue;
      let b;
      try { b = n.getBoundingClientRect(); } catch (_) { continue; }
      if (b.width <= 0 || b.height <= 0) continue;
      const sotto = punti.filter((p) => !p.coperto && p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom);
      if (!sotto.length) continue;
      let cs;
      try { cs = win.getComputedStyle(n); } catch (_) { continue; }
      if (cs.pointerEvents !== 'none' || cs.visibility !== 'visible') continue;
      const pieno = visto(cs.backgroundColor) && alfa(cs.backgroundColor) >= 0.5
        || (cs.backgroundImage && cs.backgroundImage !== 'none')
        || /^(img|canvas|video|svg|picture|iframe|object|embed)$/i.test(n.tagName || '');
      if (!pieno || opacita(n) < 0.5) continue;
      const pos = cs.position !== 'static';
      const z = parseInt(cs.zIndex, 10) || 0;
      if (pos && z < 0) continue;
      const dopo = !!(cima.compareDocumentPosition(n) & 4);
      const sopra = dopo ? !(posCima && zCima > z) : (pos && (!posCima || z > zCima));
      if (!sopra) continue;
      for (const p of sotto) { p.coperto = true; liberi--; }
      if (!liberi) return true;
    }
    return false;
  }

  // Un nodo coperto da un altro (o tagliato via) non risponde ai punti dove sta: basta un punto che risponda.
  function scoperto(el, r, win, xs, ys) {
    const radice = el.getRootNode();
    const q = radice && typeof radice.elementFromPoint === 'function' ? radice : el.ownerDocument;
    for (const fy of ys) {
      const y = r.top + r.height * fy;
      if (y < 0 || y >= win.innerHeight) continue;
      for (const fx of xs) {
        const x = r.left + r.width * fx;
        if (x < 0 || x >= win.innerWidth) continue;
        let h = null;
        try { h = q.elementFromPoint(x, y); } catch (_) { h = null; }
        if (h && (h === el || suCampo([h, ...antenatiDi(h)], el))) return true;
      }
    }
    return false;
  }

  function antenatiDi(n) {
    const out = [];
    for (let p = n.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) out.push(p);
    return out;
  }

  const PUNTI_CAMPO = [[0.5, 0.25, 0.75, 0.1, 0.9], [0.5]];
  const PUNTI_RIQUADRO = [[0.5, 0.2, 0.8], [0.5, 0.2, 0.8]];

  // Un riquadro (iframe) che l'utente non vede, o che la pagina copre per intero, nasconde il campo che contiene.
  function riquadroVisto(fe, fr, win) {
    return !tenue(fe, fr) && scoperto(fe, fr, win, ...PUNTI_RIQUADRO) && !velato(fe, fr, win, ...PUNTI_RIQUADRO);
  }

  function fuoriVista(r, win) {
    return r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0 || r.top >= win.innerHeight || r.left >= win.innerWidth;
  }

  // Un rettangolo di `win` in px CSS della scheda, risalendo i riquadri della stessa origine. Al primo anello di
  // un'altra origine si ferma e ne restituisce la finestra in `ancora`: il resto lo misura il documento sopra.
  function risali(r, win) {
    if (fuoriVista(r, win)) return { fuori: true };
    let x = r.left; let y = r.top;
    for (let i = 0; win !== win.top; i++) {
      if (i >= ANELLI_MAX) return null;
      let fe = null;
      try { fe = win.frameElement; } catch (_) { fe = null; }
      if (!fe) return { x, y, s: 1, ancora: win };
      const sopra = fe.ownerDocument.defaultView;
      const fr = fe.getBoundingClientRect();
      if (fuoriVista(fr, sopra) || !riquadroVisto(fe, fr, sopra)) return { fuori: true };
      const cs = sopra.getComputedStyle(fe);
      x += fr.left + fe.clientLeft + (parseFloat(cs.paddingLeft) || 0);
      y += fr.top + fe.clientTop + (parseFloat(cs.paddingTop) || 0);
      win = sopra;
    }
    const vv = win.visualViewport;
    const s = vv && vv.scale > 0 ? vv.scale : 1;
    if (s !== 1) return { x: (x - vv.offsetLeft) * s, y: (y - vv.offsetTop) * s, s, ancora: null };
    return { x, y, s: 1, ancora: null };
  }

  // Il campo in px CSS della scheda (o del suo riquadro di un'altra origine, `ancora`); { w: 0 } se non si vede.
  // Coperto da un nodo che prende i clic conta solo se il fuoco l'ha dato la pagina: un clic vero arrivato al campo
  // dice che l'utente lo vede. Un velo che lascia passare i clic conta sempre: il clic l'ha attraversato.
  function rettangolo(el, { utente = false } = {}) {
    let r;
    try { r = el.getBoundingClientRect(); } catch (_) { return null; }
    if (tenue(el, r) || spoglio(el) || (!utente && !scoperto(el, r, window, ...PUNTI_CAMPO))
      || velato(el, r, window, ...PUNTI_CAMPO, { dubbio: !utente })) return { x: 0, y: 0, w: 0, h: 0, ancora: null };
    const p = risali(r, window);
    if (!p) return null;
    if (p.fuori) return { x: 0, y: 0, w: 0, h: 0, ancora: null };
    return { x: p.x, y: p.y, w: r.width * p.s, h: r.height * p.s, ancora: p.ancora };
  }

  // Dentro un riquadro di un'altra origine il documento sopra sa dove sta il riquadro: gli si manda un segno che
  // riconosce dalla finestra che lo spedisce, e lui ne dà la posizione al main.
  function segnaAncora(win, segno) {
    try { win.parent.postMessage({ filoPropostaEmail: segno }, '*'); } catch (_) {}
  }

  function invia(motivo) {
    const c = corrente;
    if (!c || c.muto) return;
    const r = rettangolo(c.el, { utente: c.dalUtente });
    if (!r) { c.muto = true; return; }
    const valore = String(c.el.value || '');
    const digitato = valore === c.dati.digitato;
    const firma = [r.x, r.y, r.w, r.h].map((n) => Math.round(n)).join(',') + `|${global.devicePixelRatio}|${digitato}|${valore}|${!!r.ancora}`;
    if (motivo === 'posto' && firma === c.firma) return;
    c.firma = firma;
    if (r.ancora) segnaAncora(r.ancora, c.ancora);
    send({
      type: T, fase: 'campo', campo: c.dati.campo, motivo, x: r.x, y: r.y, w: r.w, h: r.h, valore, digitato,
      ancora: r.ancora ? c.ancora : '',
    }, (res) => {
      if (res && res.segui === false && corrente === c) c.muto = true;
    });
  }

  function suInput(e) {
    const c = corrente;
    if (!c || bersaglio(e) !== c.el) return;
    if (e.isTrusted) c.dati.digitato = String(c.el.value || '');
    invia(e.isTrusted ? 'scrive' : 'input');
  }

  function passo() {
    const c = corrente;
    if (!c) return;
    if (!c.el.isConnected || attivo() !== c.el || !idoneo(c.el)) { chiudi(); return; }
    invia('posto');
  }

  function inizia(el) {
    let dati = perCampo.get(el);
    if (!dati) { dati = { campo: chiave(), digitato: '' }; perCampo.set(el, dati); }
    corrente = { el, dati, firma: '', muto: false, dalUtente: dalUtente(el), ancora: chiave(), timer: setInterval(passo, PASSO_MS) };
    el.addEventListener('input', suInput, true);
  }

  function chiudi() {
    const c = corrente;
    if (!c) return;
    corrente = null;
    clearInterval(c.timer);
    c.el.removeEventListener('input', suInput, true);
    ultimo = c;
    if (!c.muto) send({ type: T, fase: 'via', campo: c.dati.campo });
  }

  // Conta il campo che ha davvero il fuoco: un `focusin` fabbricato dalla pagina su un altro nodo non apre niente.
  function entra(el, motivo) {
    if (attivo() !== el) return;
    if (corrente && corrente.el === el) { corrente.muto = false; invia(motivo); return; }
    if (corrente) chiudi();
    if (!idoneo(el)) return;
    inizia(el);
    invia(motivo);
  }

  // Valore, `input` vero (execCommand: lo vedono i framework come una battitura) e `change`.
  function riempi(el, email) {
    try { el.focus({ preventScroll: true }); } catch (_) {}
    try { el.select(); } catch (_) {}
    let ok = false;
    try { ok = el.ownerDocument.execCommand('insertText', false, email); } catch (_) { ok = false; }
    if (!ok || el.value !== email) {
      try {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, email);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: email }));
      } catch (_) { return; }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  window.addEventListener('pointerdown', premuto, true);
  document.addEventListener('focusin', (e) => entra(bersaglio(e), 'focus'), true);
  document.addEventListener('focusout', (e) => {
    if (corrente && bersaglio(e) === corrente.el) chiudi();
  }, true);

  // I riquadri di un'altra origine con dentro un campo seguito, per segno: si rimisurano finché hanno il fuoco.
  const riquadri = new Map();
  let timerRiquadri = null;
  const SEGNO = /^[0-9a-f]{32}$/;

  function misuraRiquadro(segno, q) {
    let fr;
    try { fr = q.ifr.getBoundingClientRect(); } catch (_) { return; }
    let cs = null;
    try { cs = getComputedStyle(q.ifr); } catch (_) { return; }
    const left = fr.left + q.ifr.clientLeft + (parseFloat(cs.paddingLeft) || 0);
    const top = fr.top + q.ifr.clientTop + (parseFloat(cs.paddingTop) || 0);
    const p = risali({ left, top, right: fr.right, bottom: fr.bottom, width: fr.width, height: fr.height }, window);
    if (!p) return;
    const dati = p.fuori || !riquadroVisto(q.ifr, fr, window) ? { x: 0, y: 0, s: 0 } : { x: p.x, y: p.y, s: p.s };
    if (p.ancora) segnaAncora(p.ancora, q.su);
    const firma = `${Math.round(dati.x)},${Math.round(dati.y)},${dati.s}|${!!p.ancora}`;
    if (firma === q.firma) return;
    q.firma = firma;
    send({ type: T, fase: 'riquadro', ancora: segno, ...dati, su: p.ancora ? q.su : '' });
  }

  function seguiRiquadri() {
    const a = attivo();
    for (const [segno, q] of riquadri) {
      if (!q.ifr.isConnected || a !== q.ifr) riquadri.delete(segno);
      else misuraRiquadro(segno, q);
    }
    if (!riquadri.size && timerRiquadri) { clearInterval(timerRiquadri); timerRiquadri = null; }
  }

  // Vale solo il segno spedito dalla finestra di un riquadro di questo documento: chi lo spedisce non sceglie il riquadro.
  function riceviSegno(segno, sorgente) {
    if (typeof segno !== 'string' || !SEGNO.test(segno) || !sorgente || sorgente === window) return;
    const R = global.SN_RIQUADRI_IN_ARRIVO;
    if (!R) return;
    let ifr = attivo();
    if (!ifr || R.finestra(ifr) !== sorgente) ifr = R.riquadroDi(sorgente, document);
    if (!ifr) return;
    let q = riquadri.get(segno);
    if (!q || q.ifr !== ifr) {
      q = { ifr, su: chiave(), firma: '' };
      riquadri.set(segno, q);
      if (riquadri.size > 8) riquadri.delete(riquadri.keys().next().value);
    }
    misuraRiquadro(segno, q);
    if (!timerRiquadri) timerRiquadri = setInterval(seguiRiquadri, PASSO_MS);
  }
  window.addEventListener('message', (e) => {
    riceviSegno(e.data && typeof e.data === 'object' ? e.data.filoPropostaEmail : null, e.source);
  });

  let inCoda = false;
  const rimisura = () => {
    if ((!corrente && !riquadri.size) || inCoda) return;
    inCoda = true;
    requestAnimationFrame(() => {
      inCoda = false;
      invia('posto');
      for (const [segno, q] of riquadri) misuraRiquadro(segno, q);
    });
  };
  window.addEventListener('scroll', rimisura, { capture: true, passive: true });
  window.addEventListener('resize', rimisura, { passive: true });
  if (window === window.top && window.visualViewport) {
    window.visualViewport.addEventListener('scroll', rimisura, { passive: true });
    window.visualViewport.addEventListener('resize', rimisura, { passive: true });
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (!m || m.type !== T_RIEMPI || typeof m.email !== 'string' || !m.email) return;
    const s = [corrente, ultimo].find((x) => x && x.dati.campo === m.campo);
    if (!s || !s.el.isConnected) return;
    riempi(s.el, m.email);
    s.dati.digitato = String(s.el.value || '');
  });

  // Nei riquadri il content script arriva al primo gesto, a campo già preso; nella pagina, dopo un autofocus.
  try {
    const a = attivo();
    if (document.hasFocus() && a) entra(a, 'focus');
  } catch (_) {}

  // `segno`: il page-preload ci passa quello arrivato prima che Filo fosse montato in questo riquadro.
  global.SN_PROPOSTA_EMAIL = { segno: riceviSegno, _test: { idoneo, rettangolo, corrente: () => (corrente ? corrente.dati.campo : null) } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
