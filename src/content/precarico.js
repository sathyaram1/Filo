// Il precarico dei link della pagina (#1985): al passaggio del mouse e alla pressione (livello 1), e a rete ferma i link
// a schermo (livello 2). Lo fa Chromium con le speculation rules; qui solo quali indirizzi dargli e quando. Quali link
// e quali tetti: src/shared/precarico.js; se il livello 2 può partire lo dice il main.

(function (global) {
  'use strict';

  if (!/^https?:$/.test(global.location && global.location.protocol)) return;
  const R = global.SN_PRECARICO;
  if (!R) return;
  const { LIMITI } = R;
  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};

  let deps = null;
  const spento = () => !deps || (typeof deps.spento === 'function' && deps.spento());

  // «Stesso sito» vuole la Public Suffix List: si carica al primo link da giudicare, non a ogni pagina.
  let pslPronta = false;
  function regole() {
    if (!pslPronta) {
      pslPronta = true;
      if (!global.SN_STESSO_SITO) { try { require('../shared/stessoSito.js'); } catch (_) {} }
    }
    return R;
  }

  function linkDi(el) {
    for (let n = el; n && n !== document; n = n.parentNode || n.host) {
      if (n.nodeType === 1 && (n.localName === 'a' || n.localName === 'area') && typeof n.href === 'string' && n.href) return n;
    }
    return null;
  }

  function daGiudicare(a) {
    return { href: a.href, rel: a.getAttribute('rel'), download: a.hasAttribute('download'), target: a.getAttribute('target') };
  }

  function adatto(a) {
    return !regole().motivoEscluso(daGiudicare(a), location.href);
  }

  // Le due liste che Chromium riceve. Un indirizzo che resta da una scrittura all'altra non riparte; uno che esce si
  // ferma se è ancora in corso.
  let passati = [];
  let visibili = [];
  let regola = null;

  function scrivi() {
    const urls = Array.from(new Set(visibili.concat(passati)));
    const radice = document.head || document.documentElement;
    if (!radice) return;
    let nuova = null;
    if (urls.length) {
      nuova = document.createElement('script');
      nuova.type = 'speculationrules';
      nuova.setAttribute('data-filo-precarico', '');
      nuova.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls }] });
      radice.appendChild(nuova);
    }
    if (regola) { try { regola.remove(); } catch (_) {} }
    regola = nuova;
  }

  // La connessione verso l'origine del link, come Chrome alla pressione: serve anche dove il precarico non parte.
  const connesse = new Set();
  function preconnetti(url) {
    let origine = '';
    try { origine = new URL(url).origin; } catch (_) { return; }
    if (!origine || origine === 'null' || origine === location.origin || connesse.has(origine)) return;
    connesse.add(origine);
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = origine;
    l.setAttribute('data-filo-precarico', '');
    try { (document.head || document.documentElement).appendChild(l); } catch (_) {}
  }

  function precarica(a) {
    if (spento() || !/^https?:/i.test(a.href)) return;
    preconnetti(a.href);
    if (!adatto(a)) return;
    const url = R.indirizzoDaPrecaricare(a.href);
    if (!url) return;
    if (passati[passati.length - 1] === url) return;
    passati = passati.filter((u) => u !== url);
    passati.push(url);
    if (passati.length > LIMITI.PASSAGGI_TENUTI) passati = passati.slice(-LIMITI.PASSAGGI_TENUTI);
    scrivi();
  }

  // ── livello 1: passaggio del mouse e pressione ─────────────────────────────
  let sopra = null;
  let timerSopra = null;

  function suPassaggio(e) {
    const a = linkDi(e.composedPath ? e.composedPath()[0] : e.target);
    if (a === sopra) return;
    clearTimeout(timerSopra);
    sopra = a;
    if (!a) return;
    timerSopra = setTimeout(() => { timerSopra = null; if (sopra === a) precarica(a); }, LIMITI.ATTESA_PASSAGGIO_MS);
  }

  function suUscita(e) {
    if (!sopra) return;
    const verso = e.relatedTarget;
    if (verso && sopra.contains(verso)) return;
    clearTimeout(timerSopra);
    sopra = null;
  }

  function suPressione(e) {
    if (e.type === 'pointerdown' && e.pointerType === 'mouse' && e.button !== 0) return;
    const a = linkDi(e.composedPath ? e.composedPath()[0] : e.target);
    if (a) precarica(a);
  }

  // Un clic che porta via la pagina: gli altri precarichi non servono più e si fermano, quello del link cliccato resta.
  function suClic(e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = linkDi(e.composedPath ? e.composedPath()[0] : e.target);
    if (!a || !/^https?:/i.test(a.href)) return;
    const t = String(a.getAttribute('target') || '').trim().toLowerCase();
    if (t && t !== '_self' && t !== '_top' && t !== '_parent') return;
    const url = R.indirizzoDaPrecaricare(a.href);
    const qui = R.indirizzoDaPrecaricare(location.href);
    if (!url || url === qui) return;
    const tieni = (u) => u === url;
    passati = passati.filter(tieni);
    visibili = visibili.filter(tieni);
    fermo = true;
    scrivi();
  }

  // ── livello 2: i link a schermo, a rete ferma ──────────────────────────────
  let fermo = false;
  let fatti = new Set();
  let contati = 0;
  let paginaContata = '';
  let timerPasso = null;
  let attesaIdle = false;

  function quandoLibera(fn) {
    if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 50);
  }

  function pianifica(ms) {
    if (fermo || timerPasso || attesaIdle) return;
    timerPasso = setTimeout(() => {
      timerPasso = null;
      attesaIdle = true;
      quandoLibera(() => { attesaIdle = false; passo(); });
    }, ms == null ? LIMITI.PASSO_MS : ms);
  }

  // Un osservatore e non l'elenco delle risorse: quello si riempie a 250 voci e da lì sembrerebbe tutto fermo.
  let ultimaRisorsa = 0;
  function seguiRisorse() {
    try {
      new PerformanceObserver((lista) => {
        for (const r of lista.getEntries()) if (r.responseEnd > ultimaRisorsa) ultimaRisorsa = r.responseEnd;
      }).observe({ type: 'resource', buffered: true });
    } catch (_) {}
  }

  function reteFerma() {
    return document.readyState === 'complete' && performance.now() - ultimaRisorsa >= LIMITI.RETE_FERMA_MS;
  }

  function candidatiAschermo() {
    const out = [];
    const alto = global.innerHeight || 0;
    const largo = global.innerWidth || 0;
    const links = document.links;
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      let url = '';
      try { url = R.indirizzoDaPrecaricare(a.href); } catch (_) { continue; }
      if (!url || fatti.has(url)) continue;
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.right <= 0 || r.top >= alto || r.left >= largo) continue;
      if (!adatto(a)) continue;
      out.push({ url, top: r.top, left: r.left });
    }
    return out;
  }

  function chiediPermesso() {
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ type: MSG.PRECARICO_STATO })).catch(() => null);
    } catch (_) { return Promise.resolve(null); }
  }

  async function passo() {
    if (fermo || spento() || document.visibilityState !== 'visible') return;
    // Una pagina che cambia indirizzo da sé (le app di una pagina sola) è una pagina nuova anche per il tetto.
    const qui = R.indirizzoDaPrecaricare(location.href);
    if (qui !== paginaContata) { paginaContata = qui; contati = 0; }
    if (contati >= LIMITI.TETTO_VISIBILI) return;
    if (R.reteARisparmio(navigator.connection)) return;
    if (!reteFerma()) { pianifica(); return; }
    const r = await chiediPermesso();
    if (fermo || spento()) return;
    if (!r || r.visibili !== true) {
      if (r && r.motivo !== 'spento' && r.motivo !== 'incognito') pianifica(LIMITI.RIPROVA_PERMESSO_MS);
      return;
    }
    const c = R.prossimo(candidatiAschermo(), fatti);
    if (!c) return;
    fatti.add(c.url);
    contati++;
    if (!visibili.includes(c.url) && !passati.includes(c.url)) {
      visibili.push(c.url);
      scrivi();
    }
    pianifica();
  }

  function riprendi() { pianifica(); }

  function avvia(d) {
    if (deps) return;
    deps = d || {};
    seguiRisorse();
    const opz = { capture: true, passive: true };
    document.addEventListener('mouseover', suPassaggio, opz);
    document.addEventListener('mouseout', suUscita, opz);
    document.addEventListener('pointerdown', suPressione, opz);
    document.addEventListener('touchstart', suPressione, opz);
    global.addEventListener('click', suClic, { passive: true });
    global.addEventListener('scroll', riprendi, { passive: true });
    global.addEventListener('resize', riprendi, { passive: true });
    document.addEventListener('visibilitychange', riprendi);
    try { navigator.connection && navigator.connection.addEventListener('change', riprendi); } catch (_) {}
    // Indietro e avanti ridanno la pagina com'era: il clic l'aveva fermata.
    global.addEventListener('pageshow', (e) => { if (e.persisted) { fermo = false; riprendi(); } });
    if (document.readyState === 'complete') riprendi();
    else global.addEventListener('load', riprendi, { once: true });
  }

  global.SN_PRECARICO_PAGINA = { avvia };
})(globalThis);
