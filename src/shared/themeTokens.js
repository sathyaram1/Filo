// Registro dei token estetici (#146.1): nome stabile, tipo, default e — per i token
// specifici — una CATEGORIA da cui ereditano, così si cambia il singolo elemento o l'intera
// categoria con una modifica sola (l'override specifico vince). Gli override vivono in
// `settings.themeTokens`, chiave in REPLACE_KEYS: ogni salvataggio sostituisce l'intera
// mappa, quindi togliere una chiave torna al predefinito. L'eredità è scritta DUE volte di
// proposito: nel CSS, perché il rendering segua la catena senza JS, e qui in
// `effectiveValue`, perché preferenze e test calcolino il valore effettivo senza DOM.
// SICUREZZA: finiscono in <style> iniettati in TUTTE le superfici, pagine web comprese,
// quindi `validate` è una whitelist severa per tipo: niente ';', '}', 'url('.

(function (global) {
  'use strict';

  const FONT_DEFAULT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  // name → { label, type, css, shellCss?, dashCss?, default | category }.
  // `css`: la variabile --sn-* delle superfici, shell esclusa. `shellCss`: le gemelle della
  // shell, che ha una palette propria, emesse SOLO lì. `dashCss`: le gemelle --dash-* della
  // dashboard, emesse fra le --sn-* così una modifica estetica si vede anche in home.
  // `default` può essere unico o { light, dark }; chi ha `category` ne eredita il default.
  const TOKENS = {
    // categorie
    accent: {
      label: "Colore d'accento",
      type: 'color',
      css: '--sn-accent',
      shellCss: ['--accent'],
      // La dashboard ha una palette propria (--dash-*): senza `dashCss` un «rendi l'accento
      // verde» non si vedeva lì (#164). Le gemelle si emettono solo per i token davvero
      // sovrascritti, così l'estetica «carta» di default resta.
      dashCss: ['--dash-accent'],
      // Emette anche la tripletta r,g,b usata dalle tinte rgba(…)
      rgbCss: '--sn-accent-rgb',
      shellRgbCss: '--accent-rgb',
      default: '#c45a3b',
    },
    background: {
      label: 'Colore di sfondo',
      type: 'color',
      css: '--sn-bg',
      shellCss: ['--bg', '--tab-active'],
      dashCss: ['--dash-paper', '--dash-card'],
      default: { light: '#f8f6f0', dark: '#1e1d1b' },
    },
    text: {
      label: 'Colore del testo',
      type: 'color',
      css: '--sn-fg',
      shellCss: ['--fg'],
      dashCss: ['--dash-ink'],
      default: { light: '#1a1918', dark: '#e5e3dc' },
    },
    // Barra in alto: superficie della SOLA shell, quindi solo `shellCss`. Mappa insieme
    // `--bg-deep` e `--tab-bg` così «rendi la barra verde scuro» colora l'intera fascia: prima
    // non c'era modo di cambiare solo la barra — `background` tingeva tutto e `colore_tab`
    // agiva sulle singole tab (#184).
    topbar: {
      label: 'Barra in alto',
      type: 'color',
      shellCss: ['--bg-deep', '--tab-bg'],
      default: { light: '#f5ead7', dark: '#14110e' },
    },
    muted: {
      label: 'Testo secondario',
      type: 'color',
      css: '--sn-muted',
      shellCss: ['--fg-soft'],
      dashCss: ['--dash-ink-soft', '--dash-ink-mute'],
      default: { light: '#6e6b63', dark: '#8a8780' },
    },
    border: {
      label: 'Colore dei bordi',
      type: 'color',
      css: '--sn-border',
      shellCss: ['--border'],
      dashCss: ['--dash-line', '--dash-line-strong'],
      default: { light: '#e0dcd4', dark: '#3a3835' },
    },
    error: {
      label: 'Colore degli errori',
      type: 'color',
      css: '--sn-error',
      default: { light: '#b91c1c', dark: '#ff6b6b' },
    },
    // Sfondo al passaggio del mouse (menu, righe, bottoni secondari): era l'unico colore di
    // superficie non esposto come token, e «rendi più evidente l'hover» non aveva appiglio.
    // Sola pagina: la shell deriva i suoi hover per color-mix.
    hover: {
      label: 'Sfondo al passaggio del mouse',
      type: 'color',
      css: '--sn-hover',
      default: { light: '#ffffff', dark: '#282725' },
    },
    // Sfondo di menu, popup, sidebar e dropdown: variante quasi-opaca dello sfondo (alpha 0.98
    // col blur dietro), distinta da `background` perché tinge SOLO le superfici sovrapposte.
    // Accetta rgba(...) per tenere la trasparenza.
    overlay: {
      label: 'Sfondo di menu e popup',
      type: 'color',
      css: '--sn-overlay-bg',
      default: { light: 'rgba(248, 246, 240, 0.98)', dark: 'rgba(30, 29, 27, 0.98)' },
    },
    font: {
      label: 'Font della UI',
      type: 'font',
      css: '--sn-font',
      shellCss: ['--font'],
      default: FONT_DEFAULT,
    },
    radius: {
      label: 'Raggio degli angoli',
      type: 'size',
      css: '--sn-radius',
      shellCss: ['--radius'],
      dashCss: ['--dash-radius'],
      default: '6px',
    },

    // token specifici (ereditano dalla categoria)
    'button.bg': {
      label: 'Sfondo dei bottoni primari',
      type: 'color',
      css: '--sn-btn-bg',
      category: 'text',
    },
    'button.fg': {
      label: 'Testo dei bottoni primari',
      type: 'color',
      css: '--sn-btn-fg',
      category: 'background',
    },
    'link.color': {
      label: 'Colore dei link',
      type: 'color',
      css: '--sn-link',
      category: 'accent',
    },
    'selection.color': {
      label: 'Colore della selezione',
      type: 'color',
      css: '--sn-selection-color',
      category: 'accent',
    },
    'selection.opacity': {
      label: 'Opacità della selezione',
      type: 'opacity',
      css: '--sn-selection-opacity',
      default: { light: '0.25', dark: '0.35' },
    },
  };

  function names() { return Object.keys(TOKENS); }
  function get(name) { return TOKENS[name] || null; }

  // validazione (whitelist per tipo)
  const RE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RE_RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
  const RE_SIZE = /^\d{1,4}(?:\.\d+)?(?:px|em|rem|%)$/;
  // Font: solo caratteri «da nome font» (lettere, numeri, spazi, trattini, virgole, apici).
  // Niente ';', '}', '(' ecc.
  const RE_FONT = /^[\w\s,'"-]{1,200}$/;

  function validate(name, value) {
    const t = TOKENS[name];
    if (!t || typeof value !== 'string') return false;
    const v = value.trim();
    if (!v) return false;
    switch (t.type) {
      case 'color': return RE_HEX.test(v) || RE_RGB.test(v);
      case 'opacity': {
        if (!/^(?:0|1|0?\.\d+)$/.test(v)) return false;
        const n = Number(v);
        return n >= 0 && n <= 1;
      }
      case 'size': return RE_SIZE.test(v);
      case 'font': return RE_FONT.test(v);
      default: return false;
    }
  }

  // Tiene solo gli override validi: { clean, rejected: [nomi] }.
  function sanitize(overrides) {
    const clean = {};
    const rejected = [];
    for (const [name, value] of Object.entries(overrides || {})) {
      if (validate(name, value)) clean[name] = String(value).trim();
      else rejected.push(name);
    }
    return { clean, rejected };
  }

  // risoluzione della gerarchia (per la UI delle preferenze e gli unit test)
  function defaultValue(name, theme) {
    const t = TOKENS[name];
    if (!t) return undefined;
    if (t.default !== undefined) {
      if (typeof t.default === 'object') return t.default[theme === 'dark' ? 'dark' : 'light'];
      return t.default;
    }
    if (t.category) return defaultValue(t.category, theme);
    return undefined;
  }

  function effectiveValue(name, overrides, theme) {
    const t = TOKENS[name];
    if (!t) return undefined;
    const o = overrides || {};
    if (validate(name, o[name])) return String(o[name]).trim();
    if (t.category && validate(t.category, o[t.category])) return String(o[t.category]).trim();
    return defaultValue(name, theme);
  }

  // colore → tripletta «r, g, b» per le tinte rgba
  function toRgbTriplet(color) {
    const v = String(color || '').trim();
    let m = v.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let hex = m[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split('').map((c) => c + c).join('');
      }
      if (hex.length >= 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `${r}, ${g}, ${b}`;
      }
      return null;
    }
    m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (m) return `${m[1]}, ${m[2]}, ${m[3]}`;
    return null;
  }

  // Leggibilità testo/sfondo per il gate dei livelli (#146.2/#146.4): se Filo rende il testo
  // quasi uguale allo sfondo, la modifica sale a livello 2 (conferma) invece di 1. Rapporto
  // di contrasto WCAG: colori identici 1.0, nero su bianco ~21.
  function _rgbArray(color) {
    const t = toRgbTriplet(color);
    if (!t) return null;
    const [r, g, b] = t.split(',').map((x) => parseInt(x, 10));
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return [r, g, b];
  }

  function relativeLuminance(color) {
    const rgb = _rgbArray(color);
    if (!rgb) return null;
    const lin = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  // Rapporto di contrasto WCAG fra due colori (1..21), oppure null se uno dei
  // due non è interpretabile come colore.
  function contrastRatio(c1, c2) {
    const l1 = relativeLuminance(c1);
    const l2 = relativeLuminance(c2);
    if (l1 == null || l2 == null) return null;
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Soglia di illeggibilità estrema, vicino a 1 di proposito: solo i casi gravi (testo ≈
  // sfondo), non ogni basso contrasto ancora leggibile — un popup a ogni ritocco sarebbe
  // più fastidioso che utile.
  const LEGIBILITY_MIN_RATIO = 1.6;

  // Le coppie testo-su-superficie che contano per la leggibilità: il testo
  // globale sul suo sfondo, e il testo dei bottoni primari sul loro sfondo.
  const LEGIBILITY_PAIRS = [
    ['text', 'background'],
    ['button.fg', 'button.bg'],
  ];

  // Vero se l'override rende illeggibile una delle coppie testo/sfondo. Calcolato sul valore
  // EFFETTIVO risultante, così cattura sia «rendi il testo bianco» su sfondo chiaro sia
  // «rendi lo sfondo nero» con testo già scuro.
  function illegibleAfter(name, value, overrides, theme) {
    const next = { ...(overrides || {}) };
    if (validate(name, value)) next[name] = String(value).trim();
    else if (name in next) delete next[name];
    for (const [fg, bg] of LEGIBILITY_PAIRS) {
      const r = contrastRatio(
        effectiveValue(fg, next, theme),
        effectiveValue(bg, next, theme),
      );
      if (r != null && r < LEGIBILITY_MIN_RATIO) return true;
    }
    return false;
  }

  // Emette SOLO le variabili sovrascritte: i default restano in theme.css e l'eredità la fa
  // la catena var(). html[data-sn-theme] (0,1,1) vince sui blocchi di theme.css (0,1,0) a
  // prescindere dall'ordine dei fogli.
  function declsFor(overrides, { shell = false } = {}) {
    const { clean } = sanitize(overrides);
    const decls = [];
    for (const [name, value] of Object.entries(clean)) {
      const t = TOKENS[name];
      if (shell) {
        for (const v of t.shellCss || []) decls.push(`${v}: ${value};`);
        if (t.shellRgbCss) {
          const rgb = toRgbTriplet(value);
          if (rgb) decls.push(`${t.shellRgbCss}: ${rgb};`);
        }
      } else {
        // Token di sola shell (es. `topbar`): niente da emettere sulle superfici --sn-*/--dash-*.
        if (!t.css) continue;
        decls.push(`${t.css}: ${value};`);
        if (t.rgbCss) {
          const rgb = toRgbTriplet(value);
          if (rgb) decls.push(`${t.rgbCss}: ${rgb};`);
        }
        // Gemelle --dash-* solo per i token sovrascritti, così la modifica chiesta in chat si vede
        // anche sulla dashboard, dove vive la chat (#164). Innocue dove non servono.
        for (const v of t.dashCss || []) decls.push(`${v}: ${value};`);
      }
    }
    return decls;
  }

  // CSS per le superfici a tema --sn-* (pagine filo:// e pagine web esterne).
  function pageCss(overrides) {
    const decls = declsFor(overrides);
    return decls.length ? `html[data-sn-theme] {\n  ${decls.join('\n  ')}\n}` : '';
  }

  // CSS per la shell del browser (palette propria, variabili senza prefisso).
  function shellCss(overrides) {
    const decls = declsFor(overrides, { shell: true });
    return decls.length ? `html:root {\n  ${decls.join('\n  ')}\n}` : '';
  }

  // Idempotente: la stessa funzione serve pageBootstrap, i content script e — con
  // shell:true — la shell.
  const STYLE_ID = 'sn-theme-tokens';
  function applyToDocument(doc, overrides, { shell = false } = {}) {
    try {
      const css = shell ? shellCss(overrides) : pageCss(overrides);
      let el = doc.getElementById(STYLE_ID);
      if (!css) { if (el) el.remove(); return; }
      if (!el) {
        el = doc.createElement('style');
        el.id = STYLE_ID;
        (doc.head || doc.documentElement).appendChild(el);
      }
      if (el.textContent !== css) el.textContent = css;
    } catch (_) {}
  }

  global.SN_THEME_TOKENS = {
    TOKENS,
    names,
    get,
    validate,
    sanitize,
    defaultValue,
    effectiveValue,
    toRgbTriplet,
    relativeLuminance,
    contrastRatio,
    illegibleAfter,
    LEGIBILITY_MIN_RATIO,
    pageCss,
    shellCss,
    applyToDocument,
    STYLE_ID,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
