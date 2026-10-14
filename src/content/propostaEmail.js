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
    return C.chiedeAccesso({
      tag: 'input', type: el.type, autocomplete: attr('autocomplete'), name: attr('name'), id: el.id || '',
      placeholder: attr('placeholder'), ariaLabel: attr('aria-label'), label, disabled: el.disabled, readOnly: el.readOnly,
    }, location.hostname);
  }

  function fuoriVista(r, win) {
    return r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0 || r.top >= win.innerHeight || r.left >= win.innerWidth;
  }

  // Il campo in px CSS della scheda: risale i riquadri della stessa origine; null se un anello è di un'altra origine,
  // { w: 0 } se il campo non si vede.
  function rettangolo(el) {
    let r;
    try { r = el.getBoundingClientRect(); } catch (_) { return null; }
    let win = window;
    if (fuoriVista(r, win)) return { x: 0, y: 0, w: 0, h: 0 };
    let x = r.left; let y = r.top;
    const w = r.width; const h = r.height;
    for (let i = 0; win !== win.top; i++) {
      let fe = null;
      try { fe = win.frameElement; } catch (_) { fe = null; }
      if (!fe || i >= ANELLI_MAX) return null;
      const sopra = fe.ownerDocument.defaultView;
      const fr = fe.getBoundingClientRect();
      if (fuoriVista(fr, sopra)) return { x: 0, y: 0, w: 0, h: 0 };
      const cs = sopra.getComputedStyle(fe);
      x += fr.left + fe.clientLeft + (parseFloat(cs.paddingLeft) || 0);
      y += fr.top + fe.clientTop + (parseFloat(cs.paddingTop) || 0);
      win = sopra;
    }
    const vv = win.visualViewport;
    const s = vv && vv.scale > 0 ? vv.scale : 1;
    if (s !== 1) return { x: (x - vv.offsetLeft) * s, y: (y - vv.offsetTop) * s, w: w * s, h: h * s };
    return { x, y, w, h };
  }

  function invia(motivo) {
    const c = corrente;
    if (!c || c.muto) return;
    const r = rettangolo(c.el);
    if (!r) { c.muto = true; return; }
    const valore = String(c.el.value || '');
    const digitato = valore === c.dati.digitato;
    const firma = [r.x, r.y, r.w, r.h].map((n) => Math.round(n)).join(',') + `|${global.devicePixelRatio}|${digitato}|${valore}`;
    if (motivo === 'posto' && firma === c.firma) return;
    c.firma = firma;
    send({ type: T, fase: 'campo', campo: c.dati.campo, motivo, x: r.x, y: r.y, w: r.w, h: r.h, valore, digitato }, (res) => {
      if (res && res.segui === false && corrente === c) c.muto = true;
    });
  }

  function suInput(e) {
    const c = corrente;
    if (!c || bersaglio(e) !== c.el) return;
    if (e.isTrusted) c.dati.digitato = String(c.el.value || '');
    invia('input');
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
    corrente = { el, dati, firma: '', muto: false, timer: setInterval(passo, PASSO_MS) };
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

  document.addEventListener('focusin', (e) => entra(bersaglio(e), 'focus'), true);
  document.addEventListener('focusout', (e) => {
    if (corrente && bersaglio(e) === corrente.el) chiudi();
  }, true);

  let inCoda = false;
  const rimisura = () => {
    if (!corrente || inCoda) return;
    inCoda = true;
    requestAnimationFrame(() => { inCoda = false; invia('posto'); });
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

  global.SN_PROPOSTA_EMAIL = { _test: { idoneo, rettangolo, corrente: () => (corrente ? corrente.dati.campo : null) } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
