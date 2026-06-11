// Logica pura del colore delle tab.
//
// Decide se un colore "ha identità" (croma sufficiente per rappresentare il
// brand del sito) oppure è solo chrome neutra — bianco/nero/grigio — che NON
// va usata come tinta della tab. È la stessa regola che il campionatore del
// favicon (src/content/content.js) applica già ai pixel: la centralizziamo qui
// così la usano in modo coerente il path theme-color, il path manifest e la
// shell, ed è unit-testabile senza Electron.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  // Soglia di croma (max-min sui canali RGB, scala 0..255). Sotto questa soglia
  // un colore è considerato grigio/bianco/nero → nessuna identità. Stesso valore
  // usato dal campionatore favicon, così i tre percorsi (theme-color, manifest,
  // favicon) concordano su cosa "conta" come colore identità.
  const IDENTITY_CHROMA_MIN = 24;

  // "rgb(r,g,b)" / "rgba(r,g,b,a)" → [r,g,b] | null. NON risolve named/hex:
  // i chiamanti passano già stringhe rgb() (risolte via getComputedStyle).
  function parseRgb(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || '');
    if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return [p[0], p[1], p[2]];
  }

  // Croma = differenza tra canale massimo e minimo. 0 = grigio puro.
  function chroma(str) {
    const p = parseRgb(str);
    if (!p) return 0;
    return Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  }

  // true se il colore ha abbastanza croma da rappresentare l'identità del sito.
  // Esempi: bianco/nero/grigio → false; rosso YouTube → true.
  function hasIdentity(str) {
    return chroma(str) >= IDENTITY_CHROMA_MIN;
  }

  global.SN_TAB_COLOR = { IDENTITY_CHROMA_MIN, parseRgb, chroma, hasIdentity };
})(typeof globalThis !== 'undefined' ? globalThis : self);
