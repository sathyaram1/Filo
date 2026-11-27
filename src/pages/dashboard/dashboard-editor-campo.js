// Il campo della chat che diventa l'Editor (#2389): la bozza passa al main, un velo cresce dal campo fino a tutta la
// finestra e finisce dove l'editor disegna testo e Aiuto; tornando dall'editor si restringe nel campo. Mai una bozza
// persa. Regia nel main: src/main/services/editorDalCampo.js; prove: tests/editor-dal-campo.spec.mjs.
(function (global) {
  'use strict';

  let d = null;
  let MSG = null;
  let velo = null;
  let inCorso = false;
  // Dove l'editor ha disegnato l'ultima volta, a questa misura di finestra: il velo ci va dritto, senza correzione.
  const ARRIVO_KEY = 'filo.home.editorArrivo';
  const CORREZIONE_MS = 160;

  function durata() {
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0; } catch (_) {}
    let base = 450;
    try {
      const m = getComputedStyle(document.documentElement).getPropertyValue('--dash-editor-campo').trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/);
      if (m) base = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
    } catch (_) {}
    const f = global.SN_THEME_TOKENS && global.SN_THEME_TOKENS.motionFactor ? global.SN_THEME_TOKENS.motionFactor(document) : 1;
    return Math.max(0, Math.min(10000, Math.round(base * (Number.isFinite(f) ? f : 1))));
  }

  // Un colore CSS (anche una variabile) come [r, g, b, a].
  function rgba(valore) {
    const prova = document.createElement('div');
    prova.style.cssText = 'position:fixed;width:0;height:0;visibility:hidden';
    prova.style.backgroundColor = valore;
    document.body.appendChild(prova);
    const c = getComputedStyle(prova).backgroundColor;
    prova.remove();
    return parseRgba(c);
  }
  function parseRgba(c) {
    const m = String(c || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
  }
  const css = (c) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(c[3] * 1000) / 1000})`;

  // Lo stato del velo nel campo: il riquadro del campo e il testo dove lo mostra la textarea.
  function nelCampo() {
    const f = d.form.getBoundingClientRect();
    const i = d.input.getBoundingClientRect();
    const cf = getComputedStyle(d.form);
    const ci = getComputedStyle(d.input);
    const pl = parseFloat(ci.paddingLeft) || 0;
    const pr = parseFloat(ci.paddingRight) || 0;
    return {
      box: { left: f.left, top: f.top, width: f.width, height: f.height, raggio: parseFloat(cf.borderTopLeftRadius) || 0 },
      sfondo: parseRgba(cf.backgroundColor),
      bordo: parseRgba(cf.borderTopColor),
      testo: { left: i.left + pl, top: i.top + (parseFloat(ci.paddingTop) || 0) - d.input.scrollTop, width: Math.max(0, i.width - pl - pr) },
      font: { size: parseFloat(ci.fontSize) || 15, lineHeight: parseFloat(ci.lineHeight) || 21, spazio: 0, colore: parseRgba(ci.color), famiglia: ci.fontFamily },
      colonna: null,
    };
  }

  // Dove l'editor disegnerà: quello che ha detto lui, o quello che ha detto l'ultima volta a questa misura, o la stima
  // dalle misure dell'editor (foglio di 720 px, Aiuto di 360 a destra); la differenza la corregge il velo all'arrivo.
  function arrivo(geometria) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let g = geometria;
    if (!g) { try { g = JSON.parse(localStorage.getItem(ARRIVO_KEY) || 'null'); } catch (_) { g = null; } }
    if (g && (g.vw !== vw || g.vh !== vh)) g = null;
    const fondo = rgba('var(--sn-bg, #f8f6f0)');
    if (!g) {
      const pannello = vw - 384;
      const largo = Math.max(200, Math.min(720, pannello - 127));
      g = {
        testo: { left: Math.max(56, (pannello - largo) / 2), top: 32, width: largo },
        font: { size: 16, lineHeight: 27.2, spazio: 11.2 },
        colonna: { left: vw - 376, top: 16, width: 360, height: vh - 32 },
      };
    }
    const f = g.font || {};
    const col = g.colonna;
    return {
      box: { left: 0, top: 0, width: vw, height: vh, raggio: 0 },
      sfondo: g.sfondo ? parseRgba(g.sfondo) : fondo,
      bordo: [0, 0, 0, 0],
      testo: { left: g.testo.left, top: g.testo.top, width: g.testo.width },
      font: {
        size: f.size || 16, lineHeight: f.lineHeight || 27.2, spazio: f.spazio == null ? 11.2 : f.spazio,
        colore: f.colore ? parseRgba(f.colore) : rgba('var(--sn-fg, #1a1918)'),
      },
      colonna: col ? {
        left: col.left, top: col.top, width: col.width, height: col.height,
        raggio: col.raggio == null ? 6 : col.raggio,
        sfondo: col.sfondo ? parseRgba(col.sfondo) : rgba('var(--sn-overlay-bg, rgba(248, 246, 240, 0.98))'),
        bordo: col.bordo ? parseRgba(col.bordo) : rgba('var(--sn-border, rgba(0, 0, 0, 0.12))'),
      } : null,
    };
  }

  function crea(testo, da) {
    const el = document.createElement('div');
    el.className = 'dash-velo-editor';
    el.setAttribute('aria-hidden', 'true');
    const colonna = document.createElement('div');
    colonna.className = 'dash-velo-colonna';
    const scritto = document.createElement('div');
    scritto.className = 'dash-velo-testo';
    scritto.style.fontFamily = da.font.famiglia || '';
    // Il velo mostra solo quello che sta in una finestra: una bozza enorme non si ridisegna a ogni fotogramma.
    for (const riga of String(testo || '').slice(0, 6000).replace(/\r\n?/g, '\n').split('\n').slice(0, 120)) {
      const p = document.createElement('p');
      p.textContent = riga || '​';
      scritto.appendChild(p);
    }
    el.append(colonna, scritto);
    // Un velo rimasto lì dopo la consegna non tiene ferma la home: un clic lo toglie. Mentre cresce, un doppio clic
    // sul bottone non lo deve interrompere.
    el.addEventListener('pointerdown', () => { if (velo && velo.stato === 'aperto') togli(); });
    document.body.appendChild(el);
    return { el, colonna, scritto };
  }

  const mix = (a, b, t) => a + (b - a) * t;
  const mixC = (a, b, t) => [0, 1, 2, 3].map((k) => mix(a[k], b[k], t));
  const morbida = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Un fotogramma del velo fra `da` e `a`; `col` dice quanto si vede la colonna dell'Aiuto.
  function disegna(v, da, a, t) {
    const b = { left: mix(da.box.left, a.box.left, t), top: mix(da.box.top, a.box.top, t), width: mix(da.box.width, a.box.width, t), height: mix(da.box.height, a.box.height, t) };
    const s = v.el.style;
    s.left = `${b.left}px`; s.top = `${b.top}px`; s.width = `${b.width}px`; s.height = `${b.height}px`;
    s.borderRadius = `${mix(da.box.raggio, a.box.raggio, t)}px`;
    s.backgroundColor = css(mixC(da.sfondo, a.sfondo, t));
    s.boxShadow = `inset 0 0 0 1px ${css(mixC(da.bordo, a.bordo, t))}`;
    const w = v.scritto.style;
    w.left = `${mix(da.testo.left, a.testo.left, t) - b.left}px`;
    w.top = `${mix(da.testo.top, a.testo.top, t) - b.top}px`;
    w.width = `${mix(da.testo.width, a.testo.width, t)}px`;
    w.fontSize = `${mix(da.font.size, a.font.size, t)}px`;
    w.lineHeight = `${mix(da.font.lineHeight, a.font.lineHeight, t)}px`;
    w.color = css(mixC(da.font.colore, a.font.colore, t));
    w.setProperty('--velo-spazio', `${mix(da.font.spazio, a.font.spazio, t)}px`);
    const c = a.colonna || da.colonna;
    const vis = a.colonna && da.colonna ? 1 : a.colonna ? Math.max(0, (t - 0.35) / 0.65) : da.colonna ? Math.max(0, 1 - t / 0.65) : 0;
    const k = v.colonna.style;
    if (!c || vis <= 0) { k.display = 'none'; return; }
    k.display = 'block';
    k.left = `${c.left - b.left + (1 - vis) * 24}px`;
    k.top = `${c.top - b.top}px`;
    k.width = `${c.width}px`;
    k.height = `${c.height}px`;
    k.borderRadius = `${c.raggio}px`;
    k.backgroundColor = css(c.sfondo);
    k.boxShadow = `inset 0 0 0 1px ${css(c.bordo)}, 0 12px 32px rgba(0, 0, 0, calc(0.22 * var(--sn-ombra, 1)))`;
    k.opacity = String(vis);
  }

  // Il tempo parte dal primo fotogramma vero: una home nascosta non disegna, e il ritorno comincia quando si vede.
  function corri(v, da, verso, ms, fine) {
    v.corsa = (v.corsa || 0) + 1;
    const mia = v.corsa;
    let t0 = null;
    const passo = (ora) => {
      if (velo !== v || v.corsa !== mia) return;
      if (t0 == null) t0 = ora;
      const t = ms > 0 ? Math.min(1, (ora - t0) / ms) : 1;
      disegna(v, da, verso(), morbida(t));
      if (t < 1) requestAnimationFrame(passo);
      else fine();
    };
    requestAnimationFrame(passo);
  }

  function cresce(id, testo, da) {
    togli();
    const v = { ...crea(testo, da), id, stato: 'apre', geometria: null, arrivato: false, corretto: false, ora: null };
    velo = v;
    disegna(v, da, arrivo(null), 0);
    const verso = () => arrivo(v.geometria);
    corri(v, da, verso, durata(), () => { v.arrivato = true; v.ora = verso(); finisciArrivo(v); });
  }

  // Arrivato e con la geometria vera: se la stima era diversa una correzione breve, poi l'editor viene davanti.
  function finisciArrivo(v) {
    if (velo !== v || !v.arrivato || !v.geometria || v.stato !== 'apre') return;
    const vero = arrivo(v.geometria);
    const fatto = () => {
      if (velo !== v) return;
      v.stato = 'aperto';
      v.ora = vero;
      try { Promise.resolve(d.send({ type: MSG.EDITOR_VELO_PRONTO, id: v.id })).catch(() => {}); } catch (_) {}
    };
    const scarto = Math.abs(vero.testo.left - v.ora.testo.left) + Math.abs(vero.testo.top - v.ora.testo.top) + Math.abs(vero.testo.width - v.ora.testo.width);
    if (scarto < 1) { disegna(v, vero, vero, 1); fatto(); return; }
    const da = v.ora;
    corri(v, da, () => vero, Math.min(CORREZIONE_MS, durata()), fatto);
  }

  function chiude() {
    const v = velo;
    if (!v || v.stato === 'chiude') return;
    v.stato = 'chiude';
    v.scritto.replaceChildren();
    const da = v.ora || arrivo(v.geometria);
    corri(v, da, () => nelCampo(), durata(), () => { togli(); try { d.input.focus({ preventScroll: true }); } catch (_) {} });
  }

  function togli() {
    if (!velo) return;
    velo.el.remove();
    velo = null;
  }

  // Clic su Editor: con una bozza nel campo, la bozza diventa un documento nuovo e il campo si svuota; senza, falso
  // (l'Editor si apre come sempre). Il testo lascia il campo solo quando il main l'ha preso.
  function apri() {
    const testo = d.input.value;
    if (!testo.trim()) return false;
    if (inCorso) return true;
    inCorso = true;
    const ms = durata();
    const da = nelCampo();
    const sfondo = css(rgba('var(--sn-bg, #f8f6f0)'));
    Promise.resolve(d.send({ type: MSG.EDITOR_DAL_CAMPO, testo, sfondo, velo: ms > 0 })).then((r) => {
      inCorso = false;
      if (!r || !r.ok) { d.apriEditor(); return; }
      if (d.input.value === testo) d.svuota();
      if (ms > 0) cresce(r.id, testo, da);
    }, () => { inCorso = false; d.apriEditor(); });
    return true;
  }

  function riceviGeometria(id, g) {
    if (!velo || velo.id !== id || !g) return;
    velo.geometria = g;
    try { localStorage.setItem(ARRIVO_KEY, JSON.stringify(g)); } catch (_) {}
    finisciArrivo(velo);
  }

  function init(deps) {
    d = deps;
    MSG = global.SN_MSG.MSG;
    chrome.runtime.onMessage.addListener((m) => {
      if (!m) return;
      if (m.type === MSG.EDITOR_ARRIVO) riceviGeometria(m.id, m.geometria);
      else if (m.type === MSG.EDITOR_RIENTRO && velo) { if (m.daEditor && velo.stato !== 'apre') chiude(); else if (!m.daEditor) togli(); }
      else if (m.type === MSG.EDITOR_BOZZA_RESA && typeof m.testo === 'string') {
        if (velo && velo.id === m.id) togli();
        d.riempi(m.testo);
      }
    });
    // Tornata davanti senza che il main l'abbia detto (non dovrebbe succedere): il velo non resta sopra la home.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !velo || velo.stato !== 'aperto') return;
      const v = velo;
      setTimeout(() => { if (velo === v && v.stato === 'aperto') chiude(); }, 500);
    });
  }

  global.SN_DASH_EDITOR_CAMPO = { init, apri, _stato: () => (velo ? { stato: velo.stato, id: velo.id } : null) };
})(globalThis);
