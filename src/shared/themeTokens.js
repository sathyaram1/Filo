// Registro centralizzato dei token estetici di Filo (#146.1).
//
// Ogni variabile estetica dell'app è un token con nome stabile, tipo, valore
// predefinito e (per i token specifici) una CATEGORIA da cui eredita. La
// gerarchia è a due livelli: i token di categoria (es. `accent`) danno il
// default ai token specifici (es. `selection.color`), così l'utente può
// cambiare sia il singolo elemento sia l'intera categoria con una modifica
// sola. Un override sul token specifico vince sull'eredità di categoria.
//
// Gli override dell'utente vivono in `settings.themeTokens` (storage.json),
// come mappa { nomeToken: valore }. La chiave è in REPLACE_KEYS dello storage:
// ogni salvataggio sostituisce l'intera mappa, quindi rimuovere una chiave
// equivale a tornare al predefinito.
//
// L'eredità categoria→specifico è implementata DUE volte, di proposito:
// - nel CSS (theme.css definisce p.es. `--sn-selection-color: var(--sn-accent)`),
//   così il rendering segue la catena senza JS;
// - qui in JS (`effectiveValue`), così la UI delle preferenze e i test possono
//   calcolare il valore effettivo di ogni token senza interrogare il DOM.
//
// SICUREZZA: i valori degli override finiscono dentro <style> iniettati in
// TUTTE le superfici (incluse pagine web esterne). `validate` è quindi una
// whitelist severa per tipo: niente ';', '}', 'url(' o altro che permetta di
// uscire dalla dichiarazione CSS.

(function (global) {
  'use strict';

  const FONT_DEFAULT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  // name → { label, type, css, shellCss?, default | category }
  // - `css` è la variabile applicata alle superfici --sn-* (shell esclusa).
  // - `shellCss` sono le variabili gemelle della shell (src/renderer/shell.css),
  //   che ha una palette propria: vengono emesse SOLO nella shell.
  // - `default` può essere un valore unico o { light, dark }.
  // - i token con `category` ereditano il default dal token di categoria.
  const TOKENS = {
    // ── categorie ──────────────────────────────────────────────────────────
    accent: {
      label: "Colore d'accento",
      type: 'color',
      css: '--sn-accent',
      shellCss: ['--accent'],
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
      default: { light: '#f8f6f0', dark: '#1e1d1b' },
    },
    text: {
      label: 'Colore del testo',
      type: 'color',
      css: '--sn-fg',
      shellCss: ['--fg'],
      default: { light: '#1a1918', dark: '#e5e3dc' },
    },
    muted: {
      label: 'Testo secondario',
      type: 'color',
      css: '--sn-muted',
      shellCss: ['--fg-soft'],
      default: { light: '#6e6b63', dark: '#8a8780' },
    },
    border: {
      label: 'Colore dei bordi',
      type: 'color',
      css: '--sn-border',
      shellCss: ['--border'],
      default: { light: '#e0dcd4', dark: '#3a3835' },
    },
    error: {
      label: 'Colore degli errori',
      type: 'color',
      css: '--sn-error',
      default: { light: '#b91c1c', dark: '#ff6b6b' },
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
      default: '6px',
    },

    // ── token specifici (ereditano dalla categoria) ────────────────────────
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

  // ── validazione (whitelist per tipo) ─────────────────────────────────────
  const RE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RE_RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
  const RE_SIZE = /^\d{1,4}(?:\.\d+)?(?:px|em|rem|%)$/;
  // Font: lista di famiglie, solo caratteri "da nome font" (lettere, numeri,
  // spazi, trattini, virgole, apici). Niente ';', '}', '(' ecc.
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

  // ── risoluzione gerarchia (per UI preferenze e unit test) ────────────────
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

  // ── conversione colore → tripletta "r, g, b" (per le tinte rgba) ─────────
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

  // ── emissione CSS ─────────────────────────────────────────────────────────
  // Emette SOLO le variabili sovrascritte: i default restano in theme.css e
  // l'eredità categoria→specifico la fa la catena var() nativa. Il selettore
  // html[data-sn-theme] (0,1,1) vince sui blocchi di theme.css (0,1,0) a
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
        decls.push(`${t.css}: ${value};`);
        if (t.rgbCss) {
          const rgb = toRgbTriplet(value);
          if (rgb) decls.push(`${t.rgbCss}: ${rgb};`);
        }
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

  // Applica (upsert) lo style degli override a un Document. Idempotente: la
  // stessa funzione serve pageBootstrap (pagine filo://), content script
  // (pagine esterne) e — con shell:true — la shell.
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
    pageCss,
    shellCss,
    applyToDocument,
    STYLE_ID,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
