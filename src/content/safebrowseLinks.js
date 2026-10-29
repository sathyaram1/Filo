// I link della pagina ai controlli locali dei siti pericolosi appena compaiono (#965), prima quelli a schermo: al clic il
// verdetto è già nel main. Qui solo raccolta e ordine, a lotti e nei momenti liberi della pagina; il giudizio lo dà il
// main, che al clic giudica comunque anche un link che non è passato di qui.

(function (global) {
  'use strict';

  if (!/^https?:$/.test(global.location && global.location.protocol)) return;
  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const TIPO = MSG.SAFEBROWSE_LINKS || 'safebrowse_links';
  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { cb(null); }
  }

  // Link per messaggio, sotto il tetto del main (LOTTO_MAX in links.js); se il main ne vuole meno lo dice e si scende.
  let lotto = 200;
  const mandati = new Set();
  const visti = new WeakSet();
  // Tre code, in quest'ordine: i lotti da rifare, i link entrati nello schermo, tutti gli altri nell'ordine della pagina.
  let daRifare = [];
  const aSchermo = [];
  const resto = [];
  let aSchermoDa = 0;
  let restoDa = 0;

  // Gli altri link aspettano che l'osservatore abbia detto quali dei nuovi sono a schermo: su un computer lento il primo
  // lotto partiva prima, nell'ordine della pagina (#1792). Una pagina nascosta non si disegna e non aspetta.
  const ATTESA_SCHERMO_MS = 3000;
  let nonVisti = new WeakSet();
  let nonVistiN = 0;
  let attesa = null;
  const aspettaSchermo = () => nonVistiN > 0 && document.visibilityState !== 'hidden';

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((voci) => {
      for (const v of voci) {
        if (nonVisti.delete(v.target) && nonVistiN > 0) nonVistiN--;
        if (v.isIntersecting) { aSchermo.push(v.target); io.unobserve(v.target); }
      }
      if (!nonVistiN && attesa) { clearTimeout(attesa); attesa = null; }
      pianifica();
    }, { rootMargin: '50% 0px' })
    : null;

  function hrefDi(el) {
    try { return typeof el.href === 'string' ? el.href : ''; } catch (_) { return ''; }
  }

  // Tolto e rimesso: un elemento già osservato non darebbe un primo resoconto nuovo.
  function aggiungi(el) {
    resto.push(el);
    if (!io) return;
    try {
      io.unobserve(el);
      io.observe(el);
      if (!nonVisti.has(el)) { nonVisti.add(el); nonVistiN++; }
    } catch (_) {}
  }

  function raccogli() {
    const links = document.links;
    for (let i = 0; i < links.length; i++) {
      const el = links[i];
      if (visti.has(el)) continue;
      visti.add(el);
      aggiungi(el);
    }
    if (nonVistiN && !attesa) {
      attesa = setTimeout(() => { attesa = null; nonVisti = new WeakSet(); nonVistiN = 0; pianifica(); }, ATTESA_SCHERMO_MS);
    }
    pianifica();
  }

  function prossimoLotto() {
    const out = [];
    const prendi = (h) => {
      if (!h || mandati.has(h) || !/^https?:\/\//i.test(h)) return;
      mandati.add(h);
      out.push(h);
    };
    while (out.length < lotto && daRifare.length) prendi(daRifare.shift());
    while (out.length < lotto && aSchermoDa < aSchermo.length) prendi(hrefDi(aSchermo[aSchermoDa++]));
    while (out.length < lotto && restoDa < resto.length) {
      const el = resto[restoDa++];
      if (io) { try { io.unobserve(el); } catch (_) {} }
      prendi(hrefDi(el));
    }
    // Le code consumate si accorciano: una pagina che scorre all'infinito non tiene in memoria tutti i suoi link.
    if (aSchermoDa > 1000) { aSchermo.splice(0, aSchermoDa); aSchermoDa = 0; }
    if (restoDa > 1000) { resto.splice(0, restoDa); restoDa = 0; }
    return out;
  }

  let inVolo = false;
  let atteso = false;
  const quandoLibera = (fn) => (typeof global.requestIdleCallback === 'function'
    ? global.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 30));

  function pianifica(ms) {
    if (inVolo || atteso) return;
    atteso = true;
    const via = () => { atteso = false; manda(); };
    if (ms) setTimeout(() => quandoLibera(via), ms); else quandoLibera(via);
  }

  function rimetti(urls) {
    for (const h of urls) mandati.delete(h);
    daRifare = urls.concat(daRifare);
  }

  function manda() {
    if (inVolo) return;
    const urls = prossimoLotto();
    if (!urls.length) return;
    inVolo = true;
    send({ type: TIPO, urls }, (r) => {
      inVolo = false;
      if (r && r.ok === false && r.error === 'troppi' && r.max > 0) {
        lotto = Math.min(lotto, r.max);
        rimetti(urls);
      } else if (r && r.ok === false && r.error === 'occupato') {
        rimetti(urls);
        pianifica(500);
        return;
      }
      pianifica();
    });
  }

  // I link che arrivano dopo (scorrendo, aperti da un clic) e quelli a cui la pagina cambia indirizzo.
  let timer = null;
  function osserva() {
    if (typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver((voci) => {
      for (const v of voci) {
        if (v.type === 'attributes' && v.target && v.target.href !== undefined && visti.has(v.target)) aggiungi(v.target);
      }
      if (!timer) timer = setTimeout(() => { timer = null; raccogli(); }, 250);
    });
    try {
      mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    } catch (_) {}
  }

  // L'ultimo invio di un modulo, coi dati come li ha costruiti la pagina («formdata» passa anche da form.submit()): se
  // l'avviso ferma la pagina che ne nasce, confermato lo si rifà uguale. Un clic su un link dopo lo dimentica.
  let invio = null;
  let chiNomina = null;
  document.addEventListener('submit', (e) => { chiNomina = { form: e.target, el: e.submitter || null }; }, true);
  document.addEventListener('formdata', (e) => {
    const form = e.target;
    const el = chiNomina && chiNomina.form === form ? chiNomina.el : null;
    chiNomina = null;
    // Dal prototipo: un campo chiamato «action» o «method» copre la proprietà omonima del modulo.
    const delModulo = (p) => { try { return Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, p).get.call(form); } catch (_) { return ''; } };
    const da = (attr, pBottone, pModulo) => (el && el.hasAttribute(attr) ? el[pBottone] : delModulo(pModulo));
    invio = { dati: e.formData, action: da('formaction', 'formAction', 'action'),
      metodo: String(da('formmethod', 'formMethod', 'method')).toLowerCase(),
      enctype: da('formenctype', 'formEnctype', 'enctype'), charset: delModulo('acceptCharset') };
  }, true);
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('a[href], area[href]')) invio = null;
  }, true);

  const senzaAncora = (u) => { try { const x = new URL(u, location.href); x.hash = ''; return x.href; } catch (_) { return ''; } };
  global.SN_RIFAI_INVIO = (url) => {
    const i = invio;
    if (!i || i.metodo !== 'post' || !url || senzaAncora(i.action) !== senzaAncora(url)) return false;
    invio = null;
    const f = document.createElement('form');
    f.method = 'post';
    f.action = i.action;
    f.enctype = i.enctype;
    if (i.charset) f.acceptCharset = i.charset;
    f.target = '_self';
    f.style.display = 'none';
    for (const [k, v] of i.dati) {
      const input = document.createElement('input');
      input.name = k;
      if (typeof v === 'string') { input.type = 'hidden'; input.value = v; } else {
        input.type = 'file';
        try { const dt = new DataTransfer(); if (v && v.name) dt.items.add(v); input.files = dt.files; } catch (_) {}
      }
      f.appendChild(input);
    }
    (document.body || document.documentElement).appendChild(f);
    HTMLFormElement.prototype.submit.call(f);
    return true;
  };

  osserva();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', raccogli, { once: true });
  else raccogli();
})(typeof globalThis !== 'undefined' ? globalThis : self);
