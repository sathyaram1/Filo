// Un clic vero su una voce del menu conta solo se l'utente la vedeva: un velo del sito che lascia passare il mouse
// non ferma un gesto vero (#589.11). Lo dice il browser (IntersectionObserver v2), interrogato su una sonda
// trasparente sopra ogni voce. Regole: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md

(function (global) {
  'use strict';

  const DOC = global.document;
  const PAGINA_DI_FILO = (() => { try { return global.location.protocol === 'filo:'; } catch (_) { return false; } })();
  const ATTIVO = !!DOC && !PAGINA_DI_FILO && typeof global.IntersectionObserver === 'function'
    && typeof global.IntersectionObserverEntry === 'function'
    && 'isVisible' in global.IntersectionObserverEntry.prototype;

  const VOCI = 'button, a[href]';
  // Una voce appena scoperta aspetta mezzo secondo: un velo tolto mentre la mano parte non lascia il tempo di
  // vedere cosa c'è sotto (la stessa misura del popup di conferma).
  const RITARDO_MS = 500;
  // Scoperta da un pezzo nostro che se ne va (avviso, conferma): niente attesa, se il browser lo dice entro questo
  // tempo; oltre, a coprire era qualcun altro.
  const SCARTO_NOSTRO_MS = 300;
  // Sonde allo stesso piano del menu e DOPO di lui: le copre tutto ciò che copre il menu, mai i pezzi del menu.
  const Z = '2147483646';
  const STILE_OSPITE = 'all:initial!important;display:block!important;position:fixed!important;top:0!important;'
    + 'left:0!important;width:0!important;height:0!important;z-index:' + Z + '!important;pointer-events:none!important;';
  const STILE_SONDA = 'position:fixed;display:block;margin:0;padding:0;border:0;background:transparent;pointer-events:none;';
  // Una voce nascosta porta la sua sonda fuori dallo schermo, mai a display:none: nascoderebbe la catena sotto.
  const FUORI = 'left:-99999px;top:-99999px;width:1px;height:1px;';

  // 'ok' | 'attesa' (il browser non ha ancora risposto) | 'coperta' | 'presto' (scoperta da meno di RITARDO_MS).
  function giudica(rec, t) {
    if (!rec || rec.stato === 'attesa') return 'attesa';
    if (rec.stato !== 'visibile') return 'coperta';
    return t - rec.da >= RITARDO_MS ? 'ok' : 'presto';
  }

  // Una risposta del browser su una sonda. `interseca` falso = voce non a schermo (nascosta, fuori dalla lista):
  // quando ricompare è una comparsa, non una scoperta.
  function aggiorna(rec, { interseca, visibile, tempo, nostra }) {
    if (!interseca) {
      rec.stato = 'attesa'; rec.da = -Infinity; rec.nostra = false;
      return rec;
    }
    if (!visibile) {
      if (rec.stato !== 'coperta') { rec.nostra = !!nostra; if (nostra) rec.ultimaNostra = tempo; }
      rec.stato = 'coperta';
      return rec;
    }
    if (rec.stato !== 'visibile') {
      const libera = rec.stato === 'attesa' || (rec.nostra && tempo - rec.ultimaNostra <= SCARTO_NOSTRO_MS);
      rec.da = libera ? -Infinity : tempo;
      rec.stato = 'visibile';
      rec.nostra = false;
    }
    return rec;
  }

  function nuovoStato() {
    return { stato: 'attesa', da: -Infinity, nostra: false, ultimaNostra: -Infinity };
  }

  const voci = new Map();
  const perSonda = new WeakMap();
  const pannelli = new Map();
  // I nostri pezzi montati prima delle sonde (menu, sotto-menu, etichette, anteprima del trascinamento).
  const sotto = new WeakSet();
  let ospite = null;
  let ombra = null;
  let metronomo = null;
  let stileOspite = '';
  let genitore = null;
  let moGenitore = null;
  let io = null;
  let raf = 0;
  let battito = 0;

  function osservatore() {
    if (!io) io = new global.IntersectionObserver(risposte, { trackVisibility: true, delay: 100 });
    return io;
  }

  function creaOspite() {
    ospite = DOC.createElement('div');
    ospite.setAttribute('aria-hidden', 'true');
    ospite.style.cssText = STILE_OSPITE;
    stileOspite = ospite.getAttribute('style');
    ombra = ospite.attachShadow({ mode: 'closed' });
    // Il browser ricalcola le coperture solo se qualcosa cambia forma: uno z-index alzato da solo passerebbe
    // inosservato. Un pixel che va e viene a ogni fotogramma lo costringe a guardare.
    metronomo = DOC.createElement('div');
    metronomo.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;';
    ombra.appendChild(metronomo);
    // Uno script del sito che alza le sonde sopra il suo velo (stile, o il livello più alto con popover) le
    // rende cieche: si rimettono a posto prima del disegno.
    new MutationObserver(() => {
      if (ospite.hasAttribute('popover')) ospite.removeAttribute('popover');
      if (ospite.getAttribute('style') !== stileOspite) ospite.style.cssText = STILE_OSPITE;
    }).observe(ospite, { attributes: true, attributeFilter: ['style', 'popover'] });
  }

  // Un filtro sul contenitore del menu (la pagina in scala di grigi) per il browser nasconde anche le sonde: vale per
  // menu e velo insieme, quindi non nasconde il menu più del sito, e si sospende finché il menu è aperto. Il filtro
  // torna sulla pagina da un nostro fondo sotto il menu (backdrop-filter): la pagina non cambia aspetto.
  const EFFETTI = [['filter', 'none'], ['opacity', '1'], ['transform', 'none'], ['mix-blend-mode', 'normal']];
  let sospesi = null;
  function sospendiEffetti(el) {
    if (sospesi?.el === el) return;
    rimettiEffetti();
    let cs;
    try { cs = global.getComputedStyle(el); } catch (_) { return; }
    const vecchi = [];
    let filtro = '';
    for (const [p, neutro] of EFFETTI) {
      const v = cs.getPropertyValue(p);
      if (!v || v === neutro || (p === 'transform' && /^matrix\(1, 0, 0, 1, [^,]+, [^,]+\)$/.test(v))) continue;
      if (p === 'filter') filtro = v;
      vecchi.push([p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      el.style.setProperty(p, neutro, 'important');
    }
    sospesi = { el, vecchi, fondo: null };
    if (filtro && el === genitore) sospesi.fondo = fondoFiltrato(filtro);
  }
  function fondoFiltrato(filtro) {
    const f = DOC.createElement('div');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;inset:0!important;'
      + 'z-index:' + Z + '!important;pointer-events:none!important;backdrop-filter:' + filtro + '!important;';
    let primo = null;
    for (const n of genitore.children) if (sotto.has(n)) { primo = n; break; }
    sotto.add(f);
    genitore.insertBefore(f, primo || ospite);
    return f;
  }
  function rimettiEffetti() {
    if (!sospesi) return;
    const { el, vecchi, fondo } = sospesi;
    sospesi = null;
    try { fondo?.remove(); } catch (_) {}
    for (const [p, v, pr] of vecchi) {
      try { if (v) el.style.setProperty(p, v, pr); else el.style.removeProperty(p); } catch (_) {}
    }
  }

  // Il nodo prima del quale montare un pezzo del menu in `parent` (null se la guardia è spenta).
  function prima(parent, el) {
    if (!ATTIVO || !parent) return null;
    if (!ospite) creaOspite();
    if (genitore !== parent) {
      genitore = parent;
      try { moGenitore?.disconnect(); } catch (_) {}
      moGenitore = new MutationObserver(riordina);
      moGenitore.observe(parent, { childList: true });
    }
    if (ospite.parentNode !== parent) parent.appendChild(ospite);
    if (el) sotto.add(el);
    return ospite;
  }

  // Fra il primo pezzo nostro e le sonde non sta niente del sito: un suo velo infilato lì coprirebbe il menu
  // restando sotto le sonde. I nostri pezzi tornano contigui, subito prima delle sonde.
  function riordina() {
    if (!ospite || !genitore || !pannelli.size) return;
    if (ospite.parentNode !== genitore) genitore.appendChild(ospite);
    let primo = null;
    for (const n of genitore.children) if (sotto.has(n)) { primo = n; break; }
    if (!primo) return;
    let fuoriPosto = false;
    for (let n = primo.nextElementSibling; n && n !== ospite; n = n.nextElementSibling) {
      if (!sotto.has(n)) { fuoriPosto = true; break; }
    }
    for (let n = ospite.nextElementSibling; n && !fuoriPosto; n = n.nextElementSibling) if (sotto.has(n)) fuoriPosto = true;
    if (!fuoriPosto) return;
    for (const n of [...genitore.children]) if (sotto.has(n)) genitore.insertBefore(n, ospite);
  }

  // Posizione e piano del pannello li decide Filo: un foglio del sito che lo abbassa sotto un suo velo, o lo
  // toglie dal piano, lascerebbe il velo fra il menu e le sonde.
  function blindaPiano(el) {
    let display = 'block';
    try {
      const d = global.getComputedStyle(el).display;
      if (d && !['none', 'contents', 'inline'].includes(d)) display = d;
    } catch (_) {}
    const voluti = [['position', 'fixed'], ['z-index', Z], ['display', display]];
    const fissa = () => {
      for (const [p, v] of voluti) {
        if (el.style.getPropertyValue(p) !== v || el.style.getPropertyPriority(p) !== 'important') el.style.setProperty(p, v, 'important');
      }
    };
    fissa();
    const mo = new MutationObserver(fissa);
    mo.observe(el, { attributes: true, attributeFilter: ['style'] });
    return mo;
  }

  // `radice`: il nodo del pannello che sta nel documento del sito, quando il pannello vive in uno shadow root.
  function sorveglia(pannello, opts = {}) {
    if (!ATTIVO || !pannello || pannelli.has(pannello) || !ospite) return;
    const reg = { bloccato: opts.bloccato, premuta: null, detto: false, mo: null, moPiano: null };
    pannelli.set(pannello, reg);
    if (genitore) sospendiEffetti(genitore);
    for (const tipo of ['pointerdown', 'mousedown', 'click', 'auxclick']) {
      pannello.addEventListener(tipo, (e) => filtra(e, pannello, reg), true);
    }
    reg.mo = new MutationObserver(() => rileggi(pannello));
    reg.mo.observe(pannello, { childList: true, subtree: true });
    if (!opts.radice) reg.moPiano = blindaPiano(pannello);
    rileggi(pannello);
    riordina();
    avvia();
  }

  function rileggi(pannello) {
    if (!pannelli.has(pannello)) return;
    const presenti = new Set(pannello.querySelectorAll(VOCI));
    const morte = [];
    for (const [v, rec] of voci) {
      if (rec.pannello === pannello && !presenti.has(v)) { voci.delete(v); morte.push(rec); }
    }
    const nuove = [];
    for (const v of presenti) {
      if (voci.has(v)) continue;
      const rec = Object.assign(nuovoStato(), {
        voce: v, pannello, sonda: DOC.createElement('div'), clip: ritagli(v, pannello), chiave: null, r: null,
      });
      rec.sonda.style.cssText = STILE_SONDA + FUORI;
      voci.set(v, rec);
      perSonda.set(rec.sonda, rec);
      nuove.push(rec);
    }
    incatena();
    for (const rec of morte) {
      try { io?.unobserve(rec.sonda); } catch (_) {}
      rec.sonda.remove();
    }
    for (const rec of nuove) { posa(rec); osservatore().observe(rec.sonda); }
  }

  // Le sonde si sovrappongono dove i pannelli si toccano, e una sonda sopra l'altra la farebbe sembrare coperta.
  // In catena, ognuna dentro la precedente, nessuna copre l'altra: il browser non conta i discendenti.
  function incatena() {
    let padre = ombra;
    for (const rec of voci.values()) {
      if (rec.sonda.parentNode !== padre) padre.appendChild(rec.sonda);
      padre = rec.sonda;
    }
  }

  // Gli antenati che tagliano la voce (la lista che scorre, il pannello): la sonda copre solo la parte a schermo.
  function ritagli(v, pannello) {
    const out = [];
    for (let n = v.parentElement; n; n = n.parentElement) {
      if (n === pannello) { out.push(n); break; }
      try {
        const cs = global.getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push(n);
      } catch (_) {}
    }
    return out;
  }

  function posa(rec) {
    let r = rec.voce.getBoundingClientRect();
    let l = r.left, t = r.top, d = r.right, b = r.bottom;
    for (const c of rec.clip) {
      r = c.getBoundingClientRect();
      l = Math.max(l, r.left); t = Math.max(t, r.top); d = Math.min(d, r.right); b = Math.min(b, r.bottom);
    }
    const vuota = !rec.voce.isConnected || d - l < 1 || b - t < 1;
    const chiave = vuota ? '' : `${l},${t},${d},${b}`;
    if (chiave === rec.chiave) return;
    rec.chiave = chiave;
    const s = rec.sonda.style;
    if (vuota) { rec.r = null; s.cssText = STILE_SONDA + FUORI; return; }
    rec.r = { left: l, top: t, right: d, bottom: b };
    s.left = l + 'px'; s.top = t + 'px'; s.width = (d - l) + 'px'; s.height = (b - t) + 'px';
  }

  // Un nostro pezzo sopra il menu (avviso, conferma): copre anche lui, ma non è il sito.
  function coperturaNostra(r) {
    const Ui = global.SN_FILO_UI;
    if (!r || !Ui || typeof Ui.aperti !== 'function') return false;
    for (const el of Ui.aperti()) {
      if (sotto.has(el)) continue;
      let q, z;
      try { q = el.getBoundingClientRect(); z = Number(global.getComputedStyle(el).zIndex); } catch (_) { continue; }
      if (!(z > Number(Z)) || !q.width || !q.height) continue;
      if (q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom) return true;
    }
    return false;
  }

  function risposte(entries) {
    for (const en of entries) {
      const rec = perSonda.get(en.target);
      if (!rec || voci.get(rec.voce) !== rec) continue;
      const coperta = en.isIntersecting && !en.isVisible;
      aggiorna(rec, {
        interseca: en.isIntersecting, visibile: en.isVisible, tempo: en.time,
        nostra: coperta && coperturaNostra(en.boundingClientRect),
      });
    }
  }

  function avvia() {
    if (!raf) raf = global.requestAnimationFrame(giro);
  }

  function giro() {
    raf = 0;
    for (const p of [...pannelli.keys()]) if (!p.isConnected) congeda(p);
    if (!pannelli.size) { smonta(); return; }
    if (ospite.parentNode !== genitore) genitore.appendChild(ospite);
    riordina();
    const ora = global.performance.now();
    for (const rec of voci.values()) {
      posa(rec);
      if (rec.stato === 'coperta' && rec.nostra && coperturaNostra(rec.r)) rec.ultimaNostra = ora;
    }
    battito ^= 1;
    metronomo.style.width = battito + 'px';
    raf = global.requestAnimationFrame(giro);
  }

  function congeda(p) {
    const reg = pannelli.get(p);
    pannelli.delete(p);
    try { reg?.mo?.disconnect(); reg?.moPiano?.disconnect(); } catch (_) {}
    const morte = [];
    for (const [v, rec] of voci) if (rec.pannello === p) { voci.delete(v); morte.push(rec); }
    incatena();
    for (const rec of morte) {
      try { io?.unobserve(rec.sonda); } catch (_) {}
      rec.sonda.remove();
    }
  }

  function smonta() {
    try { moGenitore?.disconnect(); } catch (_) {}
    moGenitore = null;
    genitore = null;
    rimettiEffetti();
    try { ospite?.remove(); } catch (_) {}
  }

  function vocePer(target, pannello) {
    let el = target;
    if (el && el.nodeType !== 1) el = el.parentElement;
    const v = el && el.closest ? el.closest(VOCI) : null;
    return v && pannello.contains(v) ? v : null;
  }

  // Si giudica alla pressione, quando l'utente decide; il rilascio passa solo se la voce è rimasta scoperta.
  // Un clic da tastiera (Invio, Spazio) non ha pressione e si giudica lì.
  function filtra(e, pannello, reg) {
    if (!e.isTrusted) return;
    const voce = vocePer(e.target, pannello);
    if (!voce) return;
    const rec = voci.get(voce);
    const ora = global.performance.now();
    const p = reg.premuta;
    const stessa = !!p && p.voce === voce && ora - p.t < 5000;
    let esito;
    if (e.type === 'pointerdown') {
      esito = giudica(rec, ora);
      reg.premuta = { voce, esito, t: ora };
    } else if (e.type === 'mousedown') {
      esito = stessa ? p.esito : giudica(rec, ora);
    } else {
      if (!stessa) esito = giudica(rec, ora);
      else if (p.esito !== 'ok') esito = p.esito;
      else esito = rec && rec.stato === 'visibile' ? 'ok' : 'coperta';
      if (e.type === 'click') reg.premuta = null;
    }
    if (esito === 'ok') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (esito === 'attesa' || reg.detto) return;
    reg.detto = true;
    try { reg.bloccato?.(esito); } catch (_) {}
  }

  global.SN_VISTO = {
    ATTIVO, RITARDO_MS, SCARTO_NOSTRO_MS,
    prima, sorveglia, giudica, aggiorna, nuovoStato,
    // Per gli spec: la voce conterebbe un clic adesso?
    _test: {
      stato: (el) => voci.get(el)?.stato ?? null,
      pronta: (el) => !ATTIVO || giudica(voci.get(el), global.performance.now()) === 'ok',
      // A schermo per la guardia: la sonda ha un'area. Una riga tagliata dal bordo della lista sotto il pixel no.
      aSchermo: (el) => !!voci.get(el)?.r,
      // Scoperta senza attesa: comparsa così, o liberata da un pezzo nostro.
      libera: (el) => { const r = voci.get(el); return !!r && r.stato === 'visibile' && r.da === -Infinity; },
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
