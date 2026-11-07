// Il fumetto di Filo dentro i documenti: ogni data-tip, ogni title e il nome dei tasti di sola icona escono in stile Filo.
// Sui siti tocca solo i pezzi di Filo (SN_FILO_UI), mai i title del sito; la shell ha il suo fumetto a finestra.
// Regole: patterns/un-etichetta-si-scrive-title-o-data-tip-e-la-mostra-filo.md; prove tests/suggerimento-filo.spec.mjs.

(function (global) {
  'use strict';

  const MARGINE = 4;
  const STACCO = 6;
  const CALDO_MS = 400;
  // Dove il nome del controllo è già scritto, il fumetto lo ripeterebbe: solo i tasti senza lettere né cifre.
  const CLICCABILE = 'button, [role="button"], a[href]';
  // Il title di un riquadro serve a chi legge con lo screen reader, e dentro c'è un altro documento: resta nativo.
  const INTOCCABILI = new Set(['IFRAME', 'FRAME', 'OBJECT', 'EMBED']);
  const COLORI = [
    ['fumetto.sfondo', '--sn-fumetto-sfondo', '--fumetto-sfondo'],
    ['fumetto.testo', '--sn-fumetto-testo', '--fumetto-testo'],
    ['fumetto.bordo', '--sn-fumetto-bordo', '--fumetto-bordo'],
  ];

  function senzaParole(testo) {
    return !/[\p{L}\p{N}]/u.test(String(testo || ''));
  }

  // Sotto l'ancora, centrato; capovolto sopra se sotto non ci sta; tenuto dentro la vista ai lati.
  function posiziona({ ancora, w, h, vw, vh, margine = MARGINE, stacco = STACCO }) {
    const centro = (ancora.left + ancora.right) / 2;
    const x = Math.max(margine, Math.min(centro - w / 2, vw - w - margine));
    let y = ancora.bottom + stacco;
    let sotto = true;
    if (y + h > vh - margine) {
      const su = ancora.top - stacco - h;
      if (su >= margine) { y = su; sotto = false; } else y = Math.max(margine, vh - h - margine);
    }
    return { x: Math.round(x), y: Math.round(y), sotto };
  }

  function msDi(valore, predefinito) {
    const T = global.SN_THEME_TOKENS;
    const n = T && typeof T.durataMs === 'function' ? T.durataMs(valore) : NaN;
    return Number.isFinite(n) ? n : predefinito;
  }

  const api = { posiziona, senzaParole, installa: () => {}, aperto: () => null };
  global.SN_SUGGERIMENTO = global.SN_SUGGERIMENTO || api;
  if (global.SN_SUGGERIMENTO !== api) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let installato = false;
  let ambito = () => true;
  let host = null;
  let tipEl = null;
  // Il pezzo che ha il fumetto (o lo aspetta): { el, origine: 'puntatore' | 'fuoco', punto }.
  let corrente = null;
  let visibile = false;
  let timer = null;
  let caldoFino = 0;
  // Dopo un clic o un Esc il fumetto di quel pezzo non torna finché il puntatore non va altrove.
  let zittito = null;
  let ultimoBersaglio = null;
  let ultimaCatena = [];
  const haTitolo = (el) => !!(el.getAttribute('title') || '').trim();
  // I title tolti al passaggio del puntatore, col valore da rimettere.
  const spogliati = new Map();
  let osservatore = null;

  function dentroAmbito(el) {
    try { return ambito(el); } catch (_) { return false; }
  }

  function sopra(el) {
    if (el.parentElement) return el.parentElement;
    const r = el.getRootNode && el.getRootNode();
    return r && r.host ? r.host : null;
  }

  // Dal pezzo in su; dentro l'ambito da quando un antenato lo è, anche oltre il confine di uno shadow chiuso (dove
  // `closest` di SN_FILO_UI.inside si ferma all'host).
  function catena(t) {
    const tutti = [];
    let el = t && t.nodeType === 1 ? t : t && t.parentElement;
    for (let giri = 0; el && giri < 80; giri++, el = sopra(el)) {
      if (el === document.documentElement) break;
      if (INTOCCABILI.has(el.tagName)) return [];
      tutti.push(el);
    }
    let i = tutti.length - 1;
    while (i >= 0 && !dentroAmbito(tutti[i])) i--;
    return tutti.slice(0, i + 1);
  }

  // null: niente da dire qui, si sale; '': questo pezzo ha scelto il silenzio, e anche chi lo contiene tace.
  function testoProprio(el) {
    if (el.hasAttribute('data-tip')) return (el.getAttribute('data-tip') || '').trim();
    // Il nome scritto accanto al tasto dal suo CSS (Copia, Rispondi sotto una risposta): un fumetto lo ripeterebbe.
    if (el.hasAttribute('data-etichetta')) return '';
    if (spogliati.has(el)) return String(spogliati.get(el) || '').trim();
    const titolo = el.getAttribute('title');
    if (titolo && titolo.trim()) return titolo.trim();
    if (el.matches && el.matches(CLICCABILE) && senzaParole(el.textContent)) {
      const nome = (el.getAttribute('aria-label') || '').trim();
      if (nome) return nome;
    }
    if (titolo !== null) return '';
    return null;
  }

  function etichettaDi(cat) {
    for (const el of cat) {
      const testo = testoProprio(el);
      if (testo === null) continue;
      return testo ? { el, testo } : null;
    }
    return null;
  }

  function spoglia(cat) {
    for (const el of cat) {
      const v = el.getAttribute('title');
      if (v === null || !v.trim()) continue;
      spogliati.set(el, v);
      el.removeAttribute('title');
    }
    if (spogliati.size) {
      osserva();
      for (const el of cat) osservaRadice(el);
    }
  }

  function restituisci(tranne) {
    for (const [el, v] of [...spogliati]) {
      if (tranne && tranne.includes(el)) continue;
      spogliati.delete(el);
      if (el.getAttribute('title') === null) el.setAttribute('title', v);
    }
    if (!spogliati.size && !corrente) smettiDiOsservare();
  }

  const OSSERVA = { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-tip', 'aria-label'] };
  // Il documento non vede le mutazioni dentro uno shadow: la radice del pezzo sotto il puntatore si osserva a parte.
  const radiciOsservate = new Set();
  function osserva() {
    if (osservatore || typeof MutationObserver !== 'function') return;
    osservatore = new MutationObserver(suMutazioni);
    try { osservatore.observe(document.documentElement, OSSERVA); } catch (_) { osservatore = null; }
  }
  function osservaRadice(el) {
    if (!osservatore) return;
    let r = null;
    try { r = el.getRootNode(); } catch (_) {}
    if (!r || r === document || radiciOsservate.has(r)) return;
    try { osservatore.observe(r, OSSERVA); radiciOsservate.add(r); } catch (_) {}
  }
  function smettiDiOsservare() {
    if (!osservatore) return;
    osservatore.disconnect();
    osservatore = null;
    radiciOsservate.clear();
  }

  // Un title riscritto dal codice mentre il puntatore è sopra: diventa il valore da rimettere, e il nativo resta zitto.
  function suMutazioni(ms) {
    let rinfresca = false;
    for (const m of ms) {
      if (m.type !== 'attributes') continue;
      const el = m.target;
      if (m.attributeName === 'title' && spogliati.has(el) && el.getAttribute('title') !== null) {
        spogliati.set(el, el.getAttribute('title'));
        el.removeAttribute('title');
      }
      if (corrente && corrente.el === el) rinfresca = true;
    }
    if (corrente && !corrente.el.isConnected) { nascondi(); return; }
    if (rinfresca && corrente) {
      const testo = testoProprio(corrente.el);
      if (!testo) nascondi();
      else if (visibile) disegna(testo);
    }
  }

  function tema() {
    const t = document.documentElement.dataset.snTheme;
    if (t === 'dark' || t === 'light') return t;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { return 'light'; }
  }

  function ritardo() {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue('--sn-fumetto-ritardo').trim(); } catch (_) {}
    const T = global.SN_THEME_TOKENS;
    return msDi(v || (T && T.defaultValue ? T.defaultValue('fumetto.ritardo') : ''), 350);
  }

  const FOGLIO = `
    .tip {
      box-sizing: border-box; display: block; max-width: 320px; max-height: var(--fumetto-altezza, 90vh); overflow: hidden;
      padding: 4px 8px; border-radius: var(--sn-radius, 6px);
      font: 12px/1.35 var(--sn-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
      white-space: pre-line; overflow-wrap: anywhere; text-align: left;
      border: 1px solid var(--fumetto-bordo, CanvasText); background: var(--fumetto-sfondo, Canvas); color: var(--fumetto-testo, CanvasText);
      box-shadow: 0 4px 16px rgba(0, 0, 0, calc(0.18 * var(--sn-ombra, 1)));
      animation: compare calc(90ms * var(--sn-motion, 1)) ease-out;
    }
    @keyframes compare { from { opacity: 0; } to { opacity: 1; } }
  `;
  const BASE = 'all:initial!important;position:fixed!important;right:auto!important;bottom:auto!important;margin:0!important;'
    + 'padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;'
    + 'pointer-events:none!important;z-index:2147483647!important;width:max-content!important;height:auto!important;'
    + 'max-width:none!important;max-height:none!important;inset:auto!important;';

  function bolla() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.setAttribute('data-sn-fumetto', '');
    try { global.SN_FILO_UI?.mark(host); } catch (_) {}
    try { host.setAttribute('popover', 'manual'); } catch (_) {}
    host.style.cssText = BASE + 'display:none!important;';
    const radice = host.attachShadow({ mode: 'open' });
    try {
      const foglio = new CSSStyleSheet();
      foglio.replaceSync(FOGLIO);
      radice.adoptedStyleSheets = [foglio];
    } catch (_) {
      const s = document.createElement('style');
      s.textContent = FOGLIO;
      radice.appendChild(s);
    }
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('role', 'tooltip');
    radice.appendChild(tipEl);
    document.documentElement.appendChild(host);
    return host;
  }

  function colora() {
    const T = global.SN_THEME_TOKENS;
    let cs = null;
    try { cs = getComputedStyle(document.documentElement); } catch (_) {}
    const t = tema();
    for (const [nome, varPagina, varBolla] of COLORI) {
      const v = (cs && cs.getPropertyValue(varPagina).trim()) || (T && T.defaultValue ? T.defaultValue(nome, t) : '');
      if (v) host.style.setProperty(varBolla, v);
      else host.style.removeProperty(varBolla);
    }
  }

  function disegna(testo) {
    bolla();
    colora();
    tipEl.textContent = testo;
    const zoom = Number(host.currentCSSZoom) || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    host.style.setProperty('--fumetto-altezza', `${Math.max(16, (vh - 2 * MARGINE) / zoom)}px`);
    host.style.setProperty('left', '0px', 'important');
    host.style.setProperty('top', '0px', 'important');
    host.style.setProperty('display', 'block', 'important');
    // Riaperto ogni volta: sale sopra a quello che è entrato nello strato più alto dopo di lui (una finestra modale).
    try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); } catch (_) {}
    const misura = host.getBoundingClientRect();
    const r = ancoraDi(corrente);
    const p = posiziona({ ancora: r, w: misura.width, h: misura.height, vw, vh });
    host.style.setProperty('left', `${p.x / zoom}px`, 'important');
    host.style.setProperty('top', `${p.y / zoom}px`, 'important');
    host.dataset.lato = p.sotto ? 'sotto' : 'sopra';
    visibile = true;
  }

  // Su un pezzo grande (una riga, un'immagine) il fumetto sta sotto il puntatore, non in fondo al pezzo.
  function ancoraDi(c) {
    const r = c.el.getBoundingClientRect();
    if (c.origine === 'puntatore' && c.punto && (r.height > 40 || r.width > 320)) {
      return { left: c.punto.x, right: c.punto.x, top: c.punto.y - 2, bottom: c.punto.y + 18 };
    }
    return r;
  }

  function mostra() {
    timer = null;
    if (!corrente || !corrente.el.isConnected) { nascondi(); return; }
    const testo = testoProprio(corrente.el);
    if (!testo) { nascondi(); return; }
    disegna(testo);
    // Chi conta le etichette lette (le icone del menu) lo sa dal pezzo stesso, anche dentro uno shadow chiuso.
    try { corrente.el.dispatchEvent(new CustomEvent('sn-fumetto-mostrato')); } catch (_) {}
  }

  function nascondi({ caldo = false } = {}) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (visibile && caldo) caldoFino = Date.now() + CALDO_MS;
    if (host) {
      try { if (host.matches(':popover-open')) host.hidePopover(); } catch (_) {}
      host.style.setProperty('display', 'none', 'important');
    }
    visibile = false;
    corrente = null;
    if (!spogliati.size) smettiDiOsservare();
  }

  function pianifica(el, origine, punto) {
    nascondi({ caldo: true });
    corrente = { el, origine, punto };
    osserva();
    osservaRadice(el);
    const attesa = Date.now() < caldoFino ? 0 : ritardo();
    timer = setTimeout(mostra, attesa);
  }

  // Un pezzo di Filo in uno shadow chiuso (la conferma, il riquadro su un sito) all'ascolto sul documento mostra solo
  // l'host: si scende col punto del puntatore, o col fuoco. Gli eventi del puntatore hanno detail 0, quindi qui e non
  // in SN_FILO_UI.bersaglio, che il punto lo usa solo per i clic.
  // Gli shadow chiusi nati fuori da SN_FILO_UI.ombra (gli allegati e la riga del sì/no dell'Aiuto) si dichiarano qui.
  const ombreProprie = new WeakMap();
  function radiceChiusa(el) {
    const ui = global.SN_FILO_UI;
    let r = null;
    try { r = (ui && typeof ui.ombraDi === 'function' && ui.ombraDi(el)) || ombreProprie.get(el) || null; } catch (_) {}
    return r && r !== el.shadowRoot ? r : null;
  }

  function bersaglio(e) {
    let t = null;
    try { t = (e.composedPath && e.composedPath()[0]) || e.target; } catch (_) { t = e.target; }
    const x = Number(e.clientX);
    const y = Number(e.clientY);
    const colPunto = Number.isFinite(x) && Number.isFinite(y) && /^pointer|^mouse/.test(e.type);
    for (let giri = 0; t && giri < 8; giri++) {
      const r = radiceChiusa(t);
      if (!r) break;
      let giu = null;
      try { giu = colPunto ? r.elementFromPoint(x, y) : r.activeElement; } catch (_) { giu = null; }
      if (!giu || giu === t) break;
      t = giu;
    }
    return t;
  }

  // Il nativo legge il title dopo che la pagina ha visto il movimento: toglierlo qui lo zittisce ogni volta.
  function suPuntatore(e) {
    if (!e.isTrusted || e.pointerType === 'touch' || e.buttons) return;
    const t = bersaglio(e);
    // Fermo sullo stesso pezzo si rifà il conto solo se nella sua catena è comparso un title (scritto dal codice
    // mentre il puntatore era già sopra): il nativo lo leggerebbe a questo movimento.
    if (e.type === 'pointermove' && t === ultimoBersaglio && !ultimaCatena.some(haTitolo)) return;
    ultimoBersaglio = t;
    const cat = catena(t);
    ultimaCatena = cat;
    spoglia(cat);
    restituisci(cat);
    const lab = etichettaDi(cat);
    if (!lab) {
      zittito = null;
      if (corrente && corrente.origine === 'puntatore') nascondi({ caldo: true });
      return;
    }
    if (zittito === lab.el) return;
    zittito = null;
    if (corrente && corrente.el === lab.el) {
      corrente.punto = { x: e.clientX, y: e.clientY };
      return;
    }
    pianifica(lab.el, 'puntatore', { x: e.clientX, y: e.clientY });
  }

  // Premuto, il pezzo si riprende il suo title: chi lo legge al clic (tasto destro, trascinamento, prove) lo trova.
  function suPressione() {
    zittito = corrente ? corrente.el : null;
    nascondi();
    restituisci(null);
    ultimoBersaglio = null;
  }

  function suUscita(e) {
    if (e.relatedTarget) return;
    ultimoBersaglio = null;
    zittito = null;
    if (corrente && corrente.origine === 'puntatore') nascondi();
    restituisci(null);
  }

  // Solo il fuoco portato dalla tastiera: un campo che si mette a fuoco da solo all'apertura non apre fumetti.
  let ultimoTasto = 0;
  function suFuoco(e) {
    if (Date.now() - ultimoTasto > 1000) return;
    const t = bersaglio(e);
    let visibileDaTastiera = false;
    try { visibileDaTastiera = t.matches(':focus-visible'); } catch (_) {}
    if (!visibileDaTastiera) return;
    const lab = etichettaDi(catena(t));
    if (!lab) return;
    pianifica(lab.el, 'fuoco', null);
  }

  function suSfuocato() {
    if (corrente && corrente.origine === 'fuoco') nascondi();
  }

  function suTasto(e) {
    if (e.isTrusted) ultimoTasto = Date.now();
    if (e.key !== 'Escape' || !corrente) return;
    zittito = corrente.el;
    nascondi();
  }

  function suScorrimento(e) {
    if (!corrente) return;
    const s = e.target;
    if (s === document || s === window || (s && s.contains && s.contains(corrente.el))) {
      nascondi();
      ultimoBersaglio = null;
    }
  }

  function installa(opzioni = {}) {
    if (installato) return;
    installato = true;
    if (typeof opzioni.ambito === 'function') ambito = opzioni.ambito;
    const cattura = { capture: true, passive: true };
    document.addEventListener('pointerover', suPuntatore, cattura);
    document.addEventListener('pointermove', suPuntatore, cattura);
    document.addEventListener('pointerout', suUscita, cattura);
    document.addEventListener('pointerdown', suPressione, cattura);
    document.addEventListener('mousedown', suPressione, cattura);
    document.addEventListener('keydown', suTasto, cattura);
    document.addEventListener('focusin', suFuoco, cattura);
    document.addEventListener('focusout', suSfuocato, cattura);
    document.addEventListener('scroll', suScorrimento, cattura);
    window.addEventListener('blur', () => { nascondi(); restituisci(null); ultimoBersaglio = null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { nascondi(); restituisci(null); } });
  }

  api.installa = installa;
  api.ombra = (host, radice) => { if (host && radice) ombreProprie.set(host, radice); };
  // Per chi sposta i pezzi sotto il puntatore (il menu che si riposiziona): il fumetto aperto resterebbe dov'era.
  api.nascondi = () => nascondi();
  // Quello che il fumetto direbbe su un pezzo ('' = niente): la spazzata degli hover mancanti lo chiede qui.
  api.testoPer = (el) => {
    const lab = el ? etichettaDi(catena(el)) : null;
    return lab ? lab.testo : '';
  };
  api.aperto = () => (visibile && corrente ? { testo: tipEl ? tipEl.textContent : '', el: corrente.el } : null);

  // Le pagine di Filo sono tutte sue; in un sito sono di Filo solo i pezzi che lui ha marcato.
  let diFilo = false;
  try { diFilo = location.protocol === 'filo:'; } catch (_) {}
  installa({ ambito: diFilo ? () => true : (el) => !!(global.SN_FILO_UI && global.SN_FILO_UI.inside(el)) });
})(typeof globalThis !== 'undefined' ? globalThis : self);
