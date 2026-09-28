// Aritmetica dello zoom della pagina: passo, limiti, livello↔percentuale.
// Non applica niente: lo fa chi ha il webFrame (src/preload/wheel-zoom.js).
// Regole e limiti: tests/unit/zoomPagina.test.mjs.

(function (global) {
  'use strict';

  // Chromium ricava il fattore dal livello come 1.2^livello: è la stessa base
  // che usano getZoomLevel/getZoomFactor di Electron, quindi le due grandezze
  // sono convertibili senza chiedere niente al motore.
  const BASE = 1.2;
  const PASSO = 0.5;            // un passo di Ctrl +/- in "zoom level"
  const MIN_PERCENTUALE = 25;   // gli stessi estremi di Chrome: chi chiede il
  const MAX_PERCENTUALE = 500;  // 400% lo ottiene invece di fermarsi al 250%

  function percentuale(livello) {
    return Math.round(Math.pow(BASE, Number(livello) || 0) * 100);
  }

  function livello(perc) {
    return Math.log(Number(perc) / 100) / Math.log(BASE);
  }

  const MIN_LIVELLO = livello(MIN_PERCENTUALE);
  const MAX_LIVELLO = livello(MAX_PERCENTUALE);

  function limita(l) {
    const n = Number(l);
    if (!Number.isFinite(n)) return 0;
    return Math.max(MIN_LIVELLO, Math.min(MAX_LIVELLO, n));
  }

  // Una percentuale come la scrive un umano o un modello: 150, "150", "150%",
  // "150 %". Fuori da questo, niente: meglio non fare nulla che zoomare a caso.
  function leggiPercentuale(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    if (typeof v !== 'string') return null;
    const m = v.replace(/\s+/g, '').match(/^(\d+(?:[.,]\d+)?)%?$/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const VERSI = ['in', 'out', 'reset'];

  // `corrente` è il livello di adesso; `richiesta` è {verso} oppure
  // {percentuale}. Ritorna null se la richiesta non dice niente di eseguibile.
  // `limitato` marca SOLO la percentuale chiesta e non ottenibile: chi zooma a
  // passi si aspetta di fermarsi al limite, chi chiede «al 900%» deve saperlo.
  function risolvi(corrente, richiesta) {
    const base = Number.isFinite(Number(corrente)) ? Number(corrente) : 0;
    const r = richiesta && typeof richiesta === 'object' ? richiesta : {};
    const chiesta = leggiPercentuale(r.percentuale != null ? r.percentuale : r.percent);
    if (chiesta != null) {
      const grezzo = livello(chiesta);
      const finale = limita(grezzo);
      return {
        livello: finale,
        percentuale: percentuale(finale),
        richiesto: Math.round(chiesta),
        limitato: Math.abs(grezzo - finale) > 1e-9,
        min: MIN_PERCENTUALE,
        max: MAX_PERCENTUALE,
      };
    }
    const verso = String(r.verso != null ? r.verso : r.direzione || '').trim().toLowerCase();
    if (!VERSI.includes(verso)) return null;
    let finale;
    if (verso === 'reset') finale = 0;
    else finale = limita(base + (verso === 'in' ? PASSO : -PASSO));
    return {
      livello: finale,
      percentuale: percentuale(finale),
      richiesto: null,
      limitato: false,
      min: MIN_PERCENTUALE,
      max: MAX_PERCENTUALE,
    };
  }

  // Il tasto dello zoom, da un keydown del DOM o da un `before-input-event`
  // del main (che lo vede per primo, in qualunque riquadro): una regola sola.
  function tastoZoom(t) {
    if (!t) return null;
    const ctrl = !!(t.ctrlKey || t.metaKey || t.control || t.meta);
    const alt = !!(t.altKey || t.alt);
    if (!ctrl || alt) return null;
    const k = String(t.key || '');
    const c = String(t.code || '');
    if (k === '+' || k === '=' || c === 'NumpadAdd') return 'in';
    if (k === '-' || k === '_' || c === 'NumpadSubtract') return 'out';
    if (k === '0' || c === 'Numpad0') return 'reset';
    return null;
  }

  // Un riquadro incorporato non zooma da sé: passa il gesto al frame
  // principale attraverso il main, che lo lascia passare solo in questa forma.
  const GESTI = ['medio', 'rotella', 'ctrl', 'esci', 'reset'];
  function gestoValido(g) {
    if (!g || typeof g !== 'object' || !GESTI.includes(g.tipo)) return null;
    if (g.tipo !== 'rotella' && g.tipo !== 'ctrl') return { tipo: g.tipo };
    const dy = Number(g.dy);
    if (!Number.isFinite(dy) || dy === 0) return null;
    return { tipo: g.tipo, dy: Math.max(-1000, Math.min(1000, dy)) };
  }

  // Il campo della percentuale lo scrivono solo i tasti veri dell'utente: il
  // suo valore nel documento lo può cambiare anche il sito (#686.1). `fresco`
  // vale per il primo tasto dopo il clic, che sostituisce invece di accodare.
  const CIFRE_CAMPO = 6;
  function tastoCampo(stato, key) {
    const s = stato || {};
    const valore = String(s.valore == null ? '' : s.valore);
    const fresco = !!s.fresco;
    const k = String(key || '');
    if (k === 'Enter' || k === 'Tab') return { valore, fresco: false, azione: 'applica' };
    if (k === 'Escape') return { valore, fresco: false, azione: 'annulla' };
    if (k === 'Backspace') return { valore: fresco ? '' : valore.slice(0, -1), fresco: false, azione: null };
    if (k === 'Delete') return { valore: '', fresco: false, azione: null };
    if (/^[0-9]$/.test(k)) {
      const base = fresco ? '' : valore;
      return { valore: base.length >= CIFRE_CAMPO ? base : base + k, fresco: false, azione: null };
    }
    return { valore, fresco, azione: null };
  }

  // Mentre si batte il numero i tasti sono del campo, presi dal main prima di
  // qualunque frame: il fuoco lo può spostare anche il sito, pure dentro un suo
  // riquadro (#686.1 giro 7). 'incolla', 'tasto', o null: va dove andrebbe.
  function tastoPerCampo(t) {
    if (!t) return null;
    const k = String(t.key || '');
    const ctrl = !!(t.ctrlKey || t.metaKey || t.control || t.meta);
    const alt = !!(t.altKey || t.alt);
    if (ctrl && !alt && k.toLowerCase() === 'v') return 'incolla';
    if (ctrl || alt) return null;
    if (!k || k === 'Unidentified' || /^F\d{1,2}$/.test(k)) return null;
    return 'tasto';
  }

  global.SN_ZOOM = {
    BASE, PASSO, VERSI, GESTI, CIFRE_CAMPO,
    MIN_LIVELLO, MAX_LIVELLO, MIN_PERCENTUALE, MAX_PERCENTUALE,
    percentuale, livello, limita, leggiPercentuale, risolvi,
    tastoZoom, gestoValido, tastoCampo, tastoPerCampo,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
