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

  // ------------------------------------------------------------
  // Estrazione colore identità dal favicon (spec "Colore identità delle tab")
  // ------------------------------------------------------------
  // Pipeline a due path sui pixel del favicon (scalato es. 64×64):
  //  - cromatico: clustering per tinta + punteggio saturazione×centralità, il
  //    bucket vincente dà il colore (così giallo+blu di Poste non si annullano);
  //  - acromatico (nessun pixel saturo): grigio della luminosità media (X,
  //    Wikipedia, GitHub restano bianchi/neri invece di sparire).
  // È logica pura: i chiamanti (pageColor.js) le passano gli RGBA del canvas,
  // così è unit-testabile senza Electron.

  // I sei parametri della spec. Default = tab dal colore vivace e riconoscibile.
  // I primi cinque governano l'ESTRAZIONE dal favicon (qui sotto); il sesto,
  // `opacita_tab`, governa il BLEND del colore sullo sfondo della barra delle
  // schede ed è applicato dalla shell (src/renderer/shell.js): non entra
  // nell'estrazione, quindi non sta in IDENTITY_PARAMS (i soli parametri letti
  // da extractIdentityFromPixels) ma è descritto nel meta più sotto.
  const IDENTITY_PARAMS = {
    soglia_saturazione: 0.30, // 0–0.5: sotto questa saturazione il pixel è ignorato dal path cromatico
    peso_centralita: 5.0,     // 0–10: forza del bias gaussiano verso il centro del favicon
    bucket_tinta: 2,          // 2–48: divisioni della ruota cromatica per il clustering
    saturazione_tab: 1.0,     // 0–1: saturazione del colore cromatico adattato
    luminosita_tab: 0.5,      // 0–1: luminosità del colore cromatico adattato
  };

  // Meta dei SEI parametri: è l'unica fonte di verità per i default, i range, le
  // etichette e i commenti mostrati nelle Preferenze avanzate (la "zona codice")
  // e per la validazione quando li si cambia (a voce dalla chat o nelle prefs).
  // `stage`: 'extract' = usato dall'estrazione del favicon; 'blend' = usato dalla
  // shell per il mix col fondo del tab bar.
  const IDENTITY_PARAM_META = [
    { key: 'soglia_saturazione', def: 0.30, min: 0, max: 0.5, step: 0.01, stage: 'extract',
      label: 'Soglia saturazione',
      comment: 'Sotto questa saturazione un pixel del favicon è considerato grigio e ignorato. Alzala se la tab prende un colore sbagliato da uno sfondo poco saturo (es. il giallo chiaro di Poste invece del verde del logo).' },
    { key: 'peso_centralita', def: 5.0, min: 0, max: 10, step: 0.1, stage: 'extract',
      label: 'Peso centralità',
      comment: 'Quanto contano di più i pixel vicini al centro del favicon. Alzalo per dare priorità al logo centrale rispetto a bordi/cornici.' },
    { key: 'bucket_tinta', def: 2, min: 2, max: 48, step: 1, stage: 'extract',
      label: 'Bucket tinta',
      comment: 'In quante fasce si divide la ruota dei colori per scegliere la tinta dominante. Pochi bucket = colori raggruppati; molti = distinzione più fine fra tinte simili.' },
    { key: 'saturazione_tab', def: 1.0, min: 0, max: 1, step: 0.05, stage: 'extract',
      label: 'Saturazione tab',
      comment: 'Quanto è viva la tinta finale applicata alla tab. 0 = grigia, 1 = piena.' },
    { key: 'luminosita_tab', def: 0.5, min: 0, max: 1, step: 0.05, stage: 'extract',
      label: 'Luminosità tab',
      comment: 'Quanto è chiara la tinta finale. 0 = scura, 1 = chiara.' },
    { key: 'opacita_tab', def: 0.6, min: 0, max: 1, step: 0.05, stage: 'blend',
      label: 'Opacità tab',
      comment: 'Quanto il colore copre lo sfondo della barra delle schede. 0 = nessun colore, 1 = tinta piena.' },
  ];

  // Oggetto coi sei valori predefiniti.
  function defaultParams() {
    const o = {};
    for (const m of IDENTITY_PARAM_META) o[m.key] = m.def;
    return o;
  }

  // Normalizza un set di parametri (parziale o completo) ai sei validi, dentro i
  // range, riempiendo i mancanti coi default. `bucket_tinta` viene arrotondato.
  function clampParams(params) {
    const out = {};
    for (const m of IDENTITY_PARAM_META) {
      let v = params && params[m.key];
      v = (typeof v === 'number' && Number.isFinite(v)) ? v : m.def;
      v = Math.max(m.min, Math.min(m.max, v));
      if (m.step >= 1) v = Math.round(v);
      out[m.key] = v;
    }
    return out;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
  }

  // pixels: RGBA (Uint8ClampedArray o Array) di un'immagine width×height.
  // Ritorna "rgb(r,g,b)" del colore identità, oppure null se il favicon è
  // vuoto/interamente trasparente.
  function extractIdentityFromPixels(pixels, width, height, opts) {
    if (!pixels || !width || !height) return null;
    const p = Object.assign({}, IDENTITY_PARAMS, opts || {});
    const bucketCount = Math.max(2, Math.round(p.bucket_tinta));
    const buckets = new Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) buckets[i] = { score: 0, r: 0, g: 0, b: 0 };
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const halfW = Math.max(1, (width - 1) / 2), halfH = Math.max(1, (height - 1) / 2);
    let lumSum = 0, lumCount = 0, anyChroma = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (pixels[idx + 3] < 128) continue; // trasparente → ignora
        const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
        const [h, s, l] = rgbToHsl(r, g, b);
        lumSum += l; lumCount++;
        // Pixel cromatico: saturazione sopra soglia e non quasi-bianco/quasi-nero.
        if (s >= p.soglia_saturazione && l >= 0.07 && l <= 0.93) {
          anyChroma = true;
          const dx = (x - cx) / halfW, dy = (y - cy) / halfH; // [-1, 1]
          const centrality = Math.exp(-(dx * dx + dy * dy) * p.peso_centralita);
          const score = s * centrality;
          let bi = Math.floor(h * bucketCount);
          if (bi >= bucketCount) bi = bucketCount - 1;
          const bk = buckets[bi];
          bk.score += score; bk.r += r * score; bk.g += g * score; bk.b += b * score;
        }
      }
    }

    if (!lumCount) return null; // favicon interamente trasparente

    if (anyChroma) {
      let win = buckets[0];
      for (let i = 1; i < bucketCount; i++) if (buckets[i].score > win.score) win = buckets[i];
      if (win.score > 0) {
        // Media pesata del bucket vincente → tinta brand. Adattamento palette:
        // mantieni la tinta, sostituisci saturazione e luminosità coi parametri,
        // così il colore cachato è canonico e vivace (la shell poi lo attenua).
        const [h] = rgbToHsl(win.r / win.score, win.g / win.score, win.b / win.score);
        const [ar, ag, ab] = hslToRgb(h, p.saturazione_tab, p.luminosita_tab);
        return `rgb(${ar}, ${ag}, ${ab})`;
      }
    }

    // Fallback acromatico: grigio della luminosità media (nessuna centralità —
    // per un sito acromatico conta l'impressione d'area, non il logo centrale).
    const v = Math.round((lumSum / lumCount) * 255);
    return `rgb(${v}, ${v}, ${v})`;
  }

  global.SN_TAB_COLOR = {
    IDENTITY_CHROMA_MIN, parseRgb, chroma, hasIdentity,
    IDENTITY_PARAMS, IDENTITY_PARAM_META, defaultParams, clampParams,
    rgbToHsl, hslToRgb, extractIdentityFromPixels,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
