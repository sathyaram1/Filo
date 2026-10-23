// Registro dei token estetici (#146.1): i token specifici ereditano da una CATEGORIA e
// l'override specifico vince. L'eredità è scritta due volte: nel CSS e qui in JS.
// SICUREZZA: finiscono in <style> su TUTTE le superfici, quindi `validate` è una whitelist.

(function (global) {
  'use strict';

  const FONT_DEFAULT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  // `css`: variabile --sn-* delle superfici; `shellCss`: le gemelle della shell, solo lì;
  // `dashCss`: le gemelle --dash-* della dashboard. `default` può essere { light, dark }.
  const TOKENS = {
    // categorie
    accent: {
      label: "Colore d'accento",
      type: 'color',
      css: '--sn-accent',
      shellCss: ['--accent'],
      // La dashboard ha una palette propria (--dash-*): senza `dashCss` un «rendi l'accento verde»
      // non si vedeva lì (#164). Solo per i token davvero sovrascritti, così i default restano.
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
    // `--bg-deep` e `--tab-bg` così «rendi la barra verde scuro» colora l'intera fascia (#184).
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
    // Il verde delle conferme: il gemello di `error` dall'altra parte. Nasce
    // dalla bacheca, dove il voto «funziona» aveva un verde scritto a mano,
    // uguale nei due temi: sul fondo scuro il conteggio scendeva a 2,9 volte il
    // fondo e il numero spariva appena votavi. Un colore che dice «è andata
    // bene» serve in più posti, quindi è un token e non una variabile di
    // pagina. Superficie di sola pagina, come `error`.
    success: {
      label: 'Colore delle conferme',
      type: 'color',
      css: '--sn-success',
      default: { light: '#1e8449', dark: '#5fd08a' },
    },
    // Sfondo al passaggio del mouse: la tinta che prendono voci di menu, righe,
    // bottoni secondari e azioni-carta in hover (theme.css `--sn-hover`). Era
    // l'unico colore di superficie delle pagine filo:// non ancora esposto come
    // token: senza, "rendi più evidente l'hover" o "fai l'evidenziazione del
    // menu verde" non avevano un appiglio. Superficie di sola pagina (la shell
    // deriva i suoi hover via color-mix dei propri token), quindi solo `css`.
    hover: {
      label: 'Sfondo al passaggio del mouse',
      type: 'color',
      css: '--sn-hover',
      default: { light: '#ffffff', dark: '#282725' },
    },
    // Sfondo di menu, popup, sidebar e dropdown: tinge SOLO le superfici sovrapposte, perciò
    // è distinto da `background`. Accetta rgba(...) per tenere la trasparenza.
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
    // Moltiplica OGNI durata di transition/animation (sentinella: tests/unit/motionSentinella.test.mjs).
    motion: {
      label: 'Durata delle animazioni',
      type: 'factor',
      css: '--sn-motion',
      shellCss: ['--sn-motion'],
      default: '1',
    },
    // Alfa dell'ombra di menu e popup; le altre ombre ne seguono la proporzione (--sn-ombra in theme.css).
    shadow: {
      label: 'Intensità delle ombre',
      type: 'opacity',
      css: '--sn-shadow-opacity',
      shellCss: ['--sn-shadow-opacity'],
      default: '0.18',
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
    // Senza override i link ereditano il font di chi li contiene (quindi `font`); con l'override esce anche
    // `regola`, solo sulle pagine di Filo (data-sn-pagina lo mette pageBootstrap, i siti non ce l'hanno).
    'link.font': {
      label: 'Font dei link',
      type: 'font',
      css: '--sn-link-font',
      category: 'font',
      regola: 'html[data-sn-pagina] a { font-family: var(--sn-link-font); }',
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
    // Il filo dell'attesa in chat (#578): le sue gemelle --dash-* hanno il predefinito in dashboard.css.
    'filo.trama.opacity': {
      label: 'Opacità del ragionamento che scorre in chat',
      type: 'opacity',
      css: '--sn-filo-trama-opacity',
      dashCss: ['--dash-trama-opacity'],
      default: '0.5',
    },
    'filo.nodo.durata': {
      label: 'Durata del nodo che si stringe in chat',
      type: 'time',
      css: '--sn-filo-nodo',
      dashCss: ['--dash-filo-nodo'],
      default: '450ms',
    },
    'filo.gomitolo.durata': {
      label: 'Durata del filo che si avvolge in gomitolo',
      type: 'time',
      css: '--sn-filo-gomitolo',
      dashCss: ['--dash-filo-gomitolo'],
      default: '850ms',
    },
    // I due segni del correttore (#1446): l'errore, di cui Filo è sicuro, e il suggerimento, che decide l'utente; il
    // dubbio è lo stesso segno sbiadito. Le gemelle letterali stanno in spellcheck.css e menu.css (tests/unit/correttoreSegni.test.mjs).
    'correttore.errori.color': {
      label: 'Colore degli errori del correttore',
      type: 'color',
      css: '--sn-spell-errore',
      default: { light: '#b4472c', dark: '#ea8a6b' },
    },
    'correttore.errori.stile': {
      label: 'Forma della sottolineatura degli errori del correttore',
      type: 'linea',
      css: '--sn-spell-errore-stile',
      default: 'wavy',
    },
    'correttore.suggerimenti.color': {
      label: 'Colore dei suggerimenti del correttore',
      type: 'color',
      css: '--sn-spell-suggerimento',
      default: { light: '#b07a14', dark: '#e2ad4d' },
    },
    'correttore.suggerimenti.stile': {
      label: 'Forma della sottolineatura dei suggerimenti del correttore',
      type: 'linea',
      css: '--sn-spell-suggerimento-stile',
      default: 'dotted',
    },
    'correttore.dubbio.opacita': {
      label: 'Quanto si vede un segno del correttore ancora in dubbio',
      type: 'opacity',
      css: '--sn-spell-dubbio',
      default: '0.4',
    },
    // Il tetto di ogni scheda nella fila in alto, attiva compresa (#1493): lo legge shell.js, nessuna variabile CSS.
    // Il minimo è quello della scheda attiva (tests/unit/tabLarghezzaMassima.test.mjs).
    'tab.larghezza': {
      label: 'Larghezza massima delle schede',
      type: 'pixel',
      min: 110,
      max: 1000,
      default: '240px',
    },
    // #1448 — il valore trovato per un segnaposto, sopra le x: la sua grandezza rispetto al testo del campo.
    'correttore.segnaposti.scala': {
      label: 'Grandezza del valore che il correttore propone sopra un segnaposto, rispetto al testo',
      type: 'factor',
      css: '--sn-spell-valore-scala',
      default: '0.62',
    },
    'correttore.segnaposti.velato': {
      label: 'Quanto si vede il valore di un segnaposto quando copre le parole della riga sopra',
      type: 'opacity',
      css: '--sn-spell-valore-velato',
      default: '0.45',
    },
  };

  // I valori di un token `linea`: quelli di text-decoration-style, nient'altro.
  const STILI_LINEA = Object.freeze(['dotted', 'dashed', 'wavy', 'solid', 'double']);

  function names() { return Object.keys(TOKENS); }
  function get(name) { return TOKENS[name] || null; }

  // validazione (whitelist per tipo)
  const RE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RE_RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
  const RE_SIZE = /^\d{1,4}(?:\.\d+)?(?:px|em|rem|%)$/;
  // Font: solo caratteri «da nome font» (lettere, numeri, spazi, trattini, virgole, apici).
  // Niente ';', '}', '(' ecc.
  const RE_FONT = /^[\w\s,'"-]{1,200}$/;
  // Durate: millisecondi interi o secondi, fino a dieci secondi. Zero spegne l'animazione.
  const RE_TIME = /^(\d{1,5})ms$|^(\d{1,2}(?:\.\d{1,3})?)s$/;
  // Moltiplicatore senza unità: finisce dentro calc(), quindi solo cifre e un punto.
  const RE_FACTOR = /^(?:\d(?:\.\d{1,3})?|\.\d{1,3})$/;
  const FACTOR_MAX = 3;

  // I numeri si scrivono come li scrive un italiano («1,5») o arrivano come numero dalla chat: la forma
  // canonica col punto è l'unica che si salva e finisce nel CSS.
  const NUMERICI = new Set(['opacity', 'factor']);
  function normalize(name, value) {
    const t = TOKENS[name];
    // «300», «300 px» o il numero della chat: la forma salvata è «300px».
    if (t && t.type === 'pixel') {
      const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().toLowerCase() : value;
      const m = typeof s === 'string' && s.match(/^(\d{1,4})\s*(?:px)?$/);
      return m ? `${Number(m[1])}px` : s;
    }
    if (t && NUMERICI.has(t.type)) {
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : value;
      if (typeof value === 'string') return value.trim().replace(/^(\d*),(\d+)$/, '$1.$2');
    }
    return typeof value === 'string' ? value.trim() : value;
  }

  function validate(name, value) {
    const t = TOKENS[name];
    const v = normalize(name, value);
    if (!t || typeof v !== 'string') return false;
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
      case 'linea': return STILI_LINEA.includes(v);
      case 'time': {
        const m = v.match(RE_TIME);
        if (!m) return false;
        const ms = m[1] !== undefined ? Number(m[1]) : Number(m[2]) * 1000;
        return ms >= 0 && ms <= 10000;
      }
      case 'factor': return RE_FACTOR.test(v) && Number(v) <= FACTOR_MAX;
      case 'pixel': {
        const m = v.match(/^(\d{1,4})px$/);
        return Boolean(m) && Number(m[1]) >= t.min && Number(m[1]) <= t.max;
      }
      default: return false;
    }
  }

  // L'errore puntuale per un valore rifiutato: lo mostrano le Preferenze e lo legge la chat.
  function errorMessage(name) {
    const t = TOKENS[name];
    switch (t && t.type) {
      case 'color': return 'Colore non valido: usa #rrggbb (o #rgb) oppure rgb(…)/rgba(…).';
      case 'size': return 'Misura non valida: usa un numero con unità, es. 6px, 0.5rem, 50%.';
      case 'opacity': return 'Opacità non valida: un numero fra 0 e 1, es. 0.3.';
      case 'time': return 'Durata non valida: millisecondi o secondi fino a 10 s, es. 450ms o 0.8s.';
      case 'font': return 'Font non valido: solo nomi di famiglie separati da virgola.';
      case 'linea': return 'Stile non valido: dotted, dashed, wavy, solid o double.';
      case 'factor': return `Valore non valido: un numero fra 0 e ${FACTOR_MAX}, es. 0 (nessuna animazione), 1 (normale) o 1,5.`;
      case 'pixel': return `Misura non valida: pixel interi fra ${t.min} e ${t.max}, es. ${t.default}.`;
      default: return t ? 'Valore non valido.' : 'Token sconosciuto.';
    }
  }

  // Il moltiplicatore delle durate in vigore su un documento, per le animazioni fatte in JS.
  function motionFactor(doc) {
    try {
      const d = doc || (typeof document !== 'undefined' ? document : null);
      if (!d || !d.documentElement || typeof getComputedStyle !== 'function') return 1;
      const raw = getComputedStyle(d.documentElement).getPropertyValue('--sn-motion').trim();
      if (!raw) return 1;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(FACTOR_MAX, Math.max(0, n)) : 1;
    } catch (_) { return 1; }
  }
  function motionMs(ms, doc) {
    return Math.round(Number(ms) * motionFactor(doc)) || 0;
  }
  // Lo scorrimento morbido è un'animazione anche lui: con le animazioni tolte si salta.
  function scrollBehavior(doc) {
    return motionFactor(doc) ? 'smooth' : 'auto';
  }

  // Tiene solo gli override validi: { clean, rejected: [nomi] }.
  function sanitize(overrides) {
    const clean = {};
    const rejected = [];
    for (const [name, value] of Object.entries(overrides || {})) {
      if (validate(name, value)) clean[name] = normalize(name, value);
      else rejected.push(name);
    }
    return { clean, rejected };
  }

  // Chi ha toccato pochi token manda solo quelli e si posano sulla mappa salvata adesso: la sua copia intera
  // cancellerebbe quelli cambiati altrove nel frattempo (#1343.1).
  function conModifica(salvati, modifica) {
    const out = { ...(salvati && typeof salvati === 'object' ? salvati : {}) };
    for (const [name, value] of Object.entries(modifica && typeof modifica === 'object' ? modifica : {})) {
      if (value == null || value === '') delete out[name];
      else out[name] = value;
    }
    return out;
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
    if (validate(name, o[name])) return normalize(name, o[name]);
    if (t.category && validate(t.category, o[t.category])) return normalize(t.category, o[t.category]);
    return defaultValue(name, theme);
  }

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

  // Leggibilità testo/sfondo per il gate dei livelli (#146.2): se il testo diventa quasi
  // uguale allo sfondo la modifica sale a livello 2. Rapporto WCAG: identici 1.0, max ~21.
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

  // Soglia vicina a 1 di proposito: solo i casi gravi (testo ≈ sfondo), non ogni basso
  // contrasto ancora leggibile — un popup a ogni ritocco sarebbe più fastidioso che utile.
  const LEGIBILITY_MIN_RATIO = 1.6;

  // Le coppie testo-su-superficie che contano per la leggibilità: il testo
  // globale sul suo sfondo, e il testo dei bottoni primari sul loro sfondo.
  const LEGIBILITY_PAIRS = [
    ['text', 'background'],
    ['button.fg', 'button.bg'],
  ];

  // Vero se l'override rende illeggibile una coppia testo/sfondo. Calcolato sul valore
  // EFFETTIVO, così prende sia «rendi il testo bianco» sia «rendi lo sfondo nero».
  function illegibleAfter(name, value, overrides, theme) {
    const next = { ...(overrides || {}) };
    if (validate(name, value)) next[name] = normalize(name, value);
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
  // la catena var(). html[data-sn-theme] (0,1,1) vince a prescindere dall'ordine dei fogli.
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
        // Gemelle --dash-* solo per i token sovrascritti: vedi sopra, `dashCss`.
        for (const v of t.dashCss || []) decls.push(`${v}: ${value};`);
      }
    }
    return decls;
  }

  // CSS per le superfici a tema --sn-* (pagine filo:// e pagine web esterne).
  function pageCss(overrides) {
    const decls = declsFor(overrides);
    if (!decls.length) return '';
    const regole = Object.keys(sanitize(overrides).clean).map((n) => TOKENS[n].regola).filter(Boolean);
    return [`html[data-sn-theme] {\n  ${decls.join('\n  ')}\n}`, ...regole].join('\n');
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
    STILI_LINEA,
    names,
    get,
    validate,
    normalize,
    errorMessage,
    motionFactor,
    motionMs,
    scrollBehavior,
    FACTOR_MAX,
    sanitize,
    conModifica,
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
