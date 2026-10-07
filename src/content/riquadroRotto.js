// Riquadro di terzi rotto dai cookie (#760). Dentro il riquadro: racconta al main cosa mostra, una volta fermo, e
// tiene lo stato per il tasto destro. Nella pagina: disegna sopra il riquadro la proposta che il main le manda.
// Decide tutto il main (src/main/services/riquadriRotti.js); questo file non sa quali servizi esistono.

(function (global) {
  'use strict';

  if (global.__snRiquadroRotto) return;
  global.__snRiquadroRotto = true;

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_SEGNALA = MSG.RIQUADRO_COOKIE_SEGNALA || 'riquadro_cookie_segnala';
  const T_STATO = MSG.RIQUADRO_COOKIE_STATO || 'riquadro_cookie_stato';
  const T_CAMBIA = MSG.RIQUADRO_COOKIE_CAMBIA || 'riquadro_cookie_cambia';
  const T_PROPONI = MSG.RIQUADRO_COOKIE_PROPONI || 'riquadro_cookie_proponi';
  const T_RITIRA = MSG.RIQUADRO_COOKIE_RITIRA || 'riquadro_cookie_ritira';
  const T_RISPOSTA = MSG.RIQUADRO_COOKIE_RISPOSTA || 'riquadro_cookie_risposta';
  const T_AGGIORNA = MSG.RIQUADRO_COOKIE_AGGIORNA || 'riquadro_cookie_aggiorna';

  const IS_TOP = (() => { try { return window.top === window.self; } catch (_) { return false; } })();
  const chrome = global.chrome;
  function ask(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r || null)); } catch (_) { resolve(null); }
    });
  }
  function t(key, ...args) {
    const I = global.SN_I18N;
    return I ? I.t(key, ...args) : key;
  }

  // ─── dentro il riquadro ──────────────────────────────────────────────────

  // Il segnaposto arriva dopo che il riquadro ha provato a caricare: si guarda quando è visibile e ha smesso di
  // cambiare, così un riquadro ancora a metà non sembra vuoto.
  const PAUSA_MS = 2500;
  const TENTATIVI = 5;
  let stato = null;
  // Il riquadro si presenta alla pagina con un segno: lei lo lega al suo elemento iframe, che resta quello anche
  // quando il riquadro finisce su un altro indirizzo (un rimando alla pagina d'accesso).
  const SEGNO = (() => { try { return crypto.randomUUID(); } catch (_) { return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; } })();
  const CHIAVE_SEGNO = '__filoRiquadroCookie';
  function presentati() {
    try { window.top.postMessage({ [CHIAVE_SEGNO]: SEGNO }, '*'); } catch (_) {}
  }

  function osserva() {
    const corpo = document.body;
    const testo = corpo ? String(corpo.innerText || '').replace(/\s+/g, ' ').trim() : '';
    let media = 0;
    try {
      for (const el of document.querySelectorAll('img, video, canvas, svg, picture, object, embed, iframe')) {
        const r = el.getBoundingClientRect();
        if (r.width >= 48 && r.height >= 48) media++;
        if (media > 20) break;
      }
    } catch (_) {}
    return {
      testo: testo.slice(0, 4000),
      parole: testo ? testo.split(' ').length : 0,
      media,
      password: !!document.querySelector('input[type="password"]'),
      larghezza: window.innerWidth,
      altezza: window.innerHeight,
    };
  }

  function stessa(a, b) { return !!(a && b) && a.testo === b.testo && a.media === b.media; }

  function aspettaFermo() {
    let prima = null;
    let n = 0;
    const giro = () => {
      const ora = osserva();
      if (stessa(prima, ora) || ++n >= TENTATIVI) {
        presentati();
        // Il main non è riuscito a fotografarlo (era già fuori dallo schermo): si riprova quando torna visibile.
        ask({ type: T_SEGNALA, ...ora, segno: SEGNO }).then((r) => { if (r && r.riprova) quandoVisibile(aspettaFermo); });
        return;
      }
      prima = ora;
      setTimeout(giro, PAUSA_MS);
    };
    setTimeout(giro, PAUSA_MS);
  }

  function quandoVisibile(fn) {
    if (typeof IntersectionObserver !== 'function' || !document.documentElement) { fn(); return; }
    const io = new IntersectionObserver((voci) => {
      if (!voci.some((v) => v.isIntersecting)) return;
      io.disconnect();
      fn();
    }, { threshold: 0.3 });
    io.observe(document.documentElement);
  }

  // Un riquadro dello stesso sito della pagina non è di terzi: non si guarda nemmeno.
  function diTerzi() {
    try {
      const anc = location.ancestorOrigins;
      const cima = anc && anc.length ? new URL(anc[anc.length - 1]).hostname : '';
      return !!cima && cima !== location.hostname;
    } catch (_) { return true; }
  }

  function aggiornaStato() {
    return ask({ type: T_STATO }).then((r) => { stato = r && r.ok ? r : null; return stato; });
  }

  function avviaRiquadro() {
    if (!/^https?:/i.test(location.href) || !diTerzi()) return;
    presentati();
    aggiornaStato();
    const via = () => quandoVisibile(aspettaFermo);
    if (document.readyState === 'complete') via();
    else window.addEventListener('load', via, { once: true });
  }

  // Le voci del tasto destro sul riquadro: riattivare e togliere passano dalla stessa porta.
  function voci() {
    if (IS_TOP || !stato || !stato.nome) return [];
    const cambia = (attiva) => () => { presentati(); ask({ type: T_CAMBIA, attiva, segno: SEGNO }).then(aggiornaStato); };
    if (stato.consentito) return [{ type: 'item', label: t('riquadro_cookie_menu_togli', stato.nome), onClick: cambia(false) }];
    if (stato.proponibile) return [{ type: 'item', label: t('riquadro_cookie_menu_attiva', stato.nome), onClick: cambia(true) }];
    return [];
  }

  // ─── nella pagina: la proposta sopra il riquadro ─────────────────────────

  const CSS = `
:host { all: initial; }
.bar {
  position: absolute;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  /* L'ospite è largo zero: la larghezza la dà il testo, il tetto lo mette il riquadro (posa). */
  width: max-content;
  box-sizing: border-box;
  padding: 7px 8px 7px 12px;
  font: 13px/1.35 var(--sn-font, system-ui, sans-serif);
  color: var(--sn-fg, #1a1918);
  background: var(--sn-overlay-bg, var(--sn-bg, #fbf8f3));
  border: 1px solid var(--sn-border, #e0dcd4);
  border-radius: var(--sn-radius, 6px);
  box-shadow: var(--sn-shadow, 0 4px 16px rgba(0,0,0,0.18));
  pointer-events: auto;
  animation: entra var(--sn-anim-fast, 160ms) ease-out;
}
@keyframes entra { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
/* Sotto questa misura il testo non sta accanto ai pulsanti senza spezzare le parole: i pulsanti vanno sotto. */
.testo { flex: 1 1 150px; min-width: 0; overflow-wrap: break-word; }
button {
  all: unset;
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 5px 12px;
  font: inherit;
  border-radius: var(--sn-radius, 6px);
  cursor: pointer;
  text-align: center;
  transition: background var(--sn-anim-fast, 160ms), opacity var(--sn-anim-fast, 160ms);
}
button:focus-visible { outline: 2px solid var(--sn-accent, #c45a3b); outline-offset: 1px; }
.si { background: var(--sn-accent, #c45a3b); color: var(--sn-on-accent, #fff); }
.si:hover { opacity: 0.85; }
.no { color: var(--sn-fg, #1a1918); }
.no:hover { background: var(--sn-hover, rgba(0,0,0,0.06)); }
.fatto .si, .fatto .no { display: none; }
`;

  const proposte = new Map(); // gettone → { host, bar, iframe, nome, url, origin, cercaFino }
  let foglio = null;

  // segno → iframe. Vince il primo: chi ripete un segno visto passare non sposta il legame su un altro riquadro.
  const segni = new Map();
  const MAX_SEGNI = 200;

  function iframeDi(sorgente) {
    let w = sorgente;
    try {
      for (let i = 0; w && i < 20 && w.parent !== window; i++) {
        if (w.parent === w) return null;
        w = w.parent;
      }
      if (!w || w.parent !== window) return null;
      return [...document.querySelectorAll('iframe, frame')].find((f) => f.contentWindow === w) || null;
    } catch (_) { return null; }
  }

  function ascoltaSegni() {
    window.addEventListener('message', (e) => {
      const d = e && e.data;
      const s = d && typeof d === 'object' ? d[CHIAVE_SEGNO] : null;
      if (typeof s !== 'string' || !/^[\w-]{8,64}$/.test(s) || segni.has(s)) return;
      const f = iframeDi(e.source);
      if (!f) return;
      segni.set(s, f);
      while (segni.size > MAX_SEGNI) segni.delete(segni.keys().next().value);
    });
  }

  function perSegno(segno) {
    const f = segno ? segni.get(segno) : null;
    return f && f.isConnected ? f : null;
  }

  function foglioCondiviso() {
    if (foglio) return foglio;
    try { foglio = new CSSStyleSheet(); foglio.replaceSync(CSS); } catch (_) { foglio = null; }
    return foglio;
  }

  function trovaRiquadro(url, origin, segno) {
    const delSegno = perSegno(segno);
    if (delSegno && ![...proposte.values()].some((p) => p.iframe === delSegno)) return delSegno;
    let tutti = [];
    try { tutti = [...document.querySelectorAll('iframe')]; } catch (_) { return null; }
    const pieno = (f) => { try { return new URL(f.src, location.href).href; } catch (_) { return ''; } };
    const orig = (f) => { try { return new URL(f.src, location.href).origin; } catch (_) { return ''; } };
    const libero = (f) => ![...proposte.values()].some((p) => p.iframe === f);
    return tutti.find((f) => url && pieno(f) === url && libero(f))
      || tutti.find((f) => origin && orig(f) === origin && libero(f)) || null;
  }

  function posa(p) {
    if (!p.iframe.isConnected) { togli(p.token); return; }
    const r = p.iframe.getBoundingClientRect();
    const sx = window.scrollX || 0;
    const sy = window.scrollY || 0;
    const scrivi = (k, v) => { if (p.bar.style[k] !== v) p.bar.style[k] = v; };
    scrivi('top', `${Math.round(r.top + sy + 8)}px`);
    scrivi('left', `${Math.round(r.left + sx + 8)}px`);
    scrivi('maxWidth', `${Math.max(160, Math.round(r.width - 16))}px`);
    const nascosto = r.width < 40 || r.height < 40;
    if (p.host.hidden !== nascosto) p.host.hidden = nascosto;
  }

  function togli(token) {
    const p = proposte.get(token);
    if (!p) return;
    proposte.delete(token);
    try { p.ro && p.ro.disconnect(); } catch (_) {}
    try { p.host.remove(); } catch (_) {}
    if (!proposte.size) staccaAscolti();
  }

  // La pagina può spostare il riquadro senza scorrere né ridimensionarsi (una pubblicità o un'immagine arrivata dopo,
  // sopra di lui): la pagina che cresce si sente subito, il resto lo raccoglie un controllo lento.
  const CONTROLLO_MS = 400;
  let ascolti = false;
  let roPagina = null;
  let controllo = null;
  function riposaTutte() { for (const p of [...proposte.values()]) posa(p); }
  function attaccaAscolti() {
    if (ascolti) return;
    ascolti = true;
    window.addEventListener('resize', riposaTutte, { passive: true });
    window.addEventListener('scroll', riposaTutte, { passive: true, capture: true });
    try {
      roPagina = new ResizeObserver(riposaTutte);
      roPagina.observe(document.documentElement);
      if (document.body) roPagina.observe(document.body);
    } catch (_) { roPagina = null; }
    controllo = setInterval(riposaTutte, CONTROLLO_MS);
  }
  function staccaAscolti() {
    if (!ascolti) return;
    ascolti = false;
    window.removeEventListener('resize', riposaTutte);
    window.removeEventListener('scroll', riposaTutte, true);
    try { roPagina && roPagina.disconnect(); } catch (_) {}
    roPagina = null;
    clearInterval(controllo);
    controllo = null;
  }

  function rispondi(p, si, e) {
    if (!e || !e.isTrusted) return;
    ask({ type: T_RISPOSTA, token: p.token, si });
    if (!si) { togli(p.token); return; }
    p.bar.classList.add('fatto');
    p.testo.textContent = t('riquadro_cookie_fatto', p.nome);
    setTimeout(() => togli(p.token), 1800);
  }

  function disegna(m, iframe) {
    const host = document.createElement('div');
    try { global.SN_FILO_UI && global.SN_FILO_UI.mark(host); } catch (_) {}
    host.setAttribute('data-filo-riquadro-cookie', '');
    host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;';
    const root = host.attachShadow({ mode: 'closed' });
    const css = foglioCondiviso();
    if (css) root.adoptedStyleSheets = [css];
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'dialog');
    const testo = document.createElement('span');
    testo.className = 'testo';
    testo.textContent = t('riquadro_cookie_domanda', m.nome);
    const si = document.createElement('button');
    si.className = 'si';
    si.textContent = t('riquadro_cookie_si');
    const no = document.createElement('button');
    no.className = 'no';
    no.textContent = t('riquadro_cookie_no');
    bar.append(testo, si, no);
    root.appendChild(bar);
    const p = { token: m.token, host, bar, testo, iframe, nome: m.nome, ro: null };
    si.addEventListener('click', (e) => rispondi(p, true, e));
    no.addEventListener('click', (e) => rispondi(p, false, e));
    proposte.set(m.token, p);
    (document.documentElement || document.body).appendChild(host);
    try { p.ro = new ResizeObserver(() => posa(p)); p.ro.observe(iframe); } catch (_) {}
    attaccaAscolti();
    p.si = si;
    p.no = no;
    posa(p);
  }

  // Il riquadro può comparire un attimo dopo la proposta (pagine che li montano da script): lo si cerca per poco.
  function proponi(m) {
    if (!m || !m.token || proposte.has(m.token)) return;
    const fino = Date.now() + 5000;
    const cerca = () => {
      const f = trovaRiquadro(m.url, m.origin, m.segno);
      if (f) { disegna(m, f); return; }
      if (Date.now() < fino) setTimeout(cerca, 250);
    };
    cerca();
  }

  if (IS_TOP) {
    ascoltaSegni();
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m && m.type === T_PROPONI) proponi(m);
        else if (m && m.type === T_RITIRA) togli(m.token);
      });
    } catch (_) {}
  } else {
    avviaRiquadro();
    try {
      chrome.runtime.onMessage.addListener((m) => { if (m && m.type === T_AGGIORNA && stato) aggiornaStato(); });
    } catch (_) {}
  }

  // Gli spec leggono la proposta dal mondo isolato (lo shadow è chiuso) e la cliccano col mouse vero.
  function rettangolo(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  // Le parole della domanda che vanno a capo a metà: ognuna dovrebbe stare in una riga sola.
  function spezzate(el) {
    const nodo = el.firstChild;
    if (!nodo || nodo.nodeType !== 3) return [];
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(nodo.data))) {
      const r = document.createRange();
      r.setStart(nodo, m.index);
      r.setEnd(nodo, m.index + m[0].length);
      if (new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size > 1) out.push(m[0]);
    }
    return out;
  }
  const _test = {
    proposte: () => [...proposte.values()].map((x) => ({
      testo: x.testo.textContent, visibile: !x.host.hidden, si: rettangolo(x.si), no: rettangolo(x.no), riquadro: rettangolo(x.iframe),
      domanda: rettangolo(x.testo), spezzate: spezzate(x.testo),
    })),
    stato: () => stato,
  };

  // Le chiamate del main (riquadriRotti.js): il rettangolo per la foto, e la ricarica all'indirizzo della pagina.
  function rettangoloDi(segno) {
    const f = perSegno(segno);
    if (!f) return null;
    const r = f.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(window.innerWidth, r.right) - x, h = Math.min(window.innerHeight, r.bottom) - y;
    return w >= 40 && h >= 40 ? { x, y, w, h } : null;
  }
  function ricaricaDi(segno) {
    const f = perSegno(segno);
    const src = f && f.getAttribute('src');
    if (!src) return false;
    f.setAttribute('src', src);
    return true;
  }

  global.SN_RIQUADRO_COOKIE = { voci, aggiornaStato, rettangolo: rettangoloDi, ricarica: ricaricaDi, _test };
})(typeof globalThis !== 'undefined' ? globalThis : self);
