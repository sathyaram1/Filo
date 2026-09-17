// Estetica del CONTENUTO della pagina chiesta in chat: la parte PURA che normalizza e
// SANIFICA le regole CSS dell'LLM prima che il main le inietti. Il CSS non è fidato: una
// regola che non passa si SCARTA, non si aggiusta.

(function (global) {
  'use strict';

  const MAX_RULES = 30;
  const MAX_SELECTOR_LEN = 400;
  const MAX_DECL_LEN = 600;

  // Token vietati ovunque: graffe e < > fanno «uscire» dalla regola, @import/expression(/url(
  // caricano o chiamano fuori. Vietato anche il backslash: un escape li ricostruirebbe.
  const FORBIDDEN_RE = /[<>{}\\]|@import|@charset|@namespace|expression\s*\(|url\s*\(|javascript:/i;
  // Costruita via stringa per non mettere byte di controllo nel sorgente.
  const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]');

  function isBadChunk(s) {
    return FORBIDDEN_RE.test(s) || CONTROL_RE.test(s);
  }

  // Non si verifica che il selettore sia sintatticamente perfetto (il browser ignora ciò che
  // non sa parsare): interessa solo che sia SICURO.
  function cleanSelector(sel) {
    const s = String(sel == null ? '' : sel).trim();
    if (!s || s.length > MAX_SELECTOR_LEN) return null;
    if (isBadChunk(s)) return null;
    return s;
  }

  // Le graffe esterne si tolgono PRIMA del controllo, così una risposta tipo
  // «{ font-weight: bold }» non viene scartata per colpa loro.
  function cleanDeclarations(css) {
    let s = String(css == null ? '' : css).trim();
    if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).trim();
    if (!s || s.length > MAX_DECL_LEN) return null;
    if (isBadChunk(s)) return null;
    if (!/[a-z-]+\s*:[^;]+/i.test(s)) return null;
    // il ; finale serve a concatenare in sicurezza
    if (!s.endsWith(';')) s += ';';
    return s;
  }

  // Accetta i sinonimi di chiave che un LLM può produrre; null se non sanificabile.
  function cleanRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const selector = cleanSelector(
      rule.selettore ?? rule.selector ?? rule.elemento ?? rule.target,
    );
    const css = cleanDeclarations(
      rule.css ?? rule.stile ?? rule.style ?? rule.dichiarazioni ?? rule.declarations ?? rule.regola,
    );
    if (!selector || !css) return null;
    return { selector, css };
  }

  // Le forme che l'azione può avere: oggetto, { regole/rules }, array, singola regola.
  function normalizeRules(input) {
    let raw = input;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      raw = input.regole ?? input.rules ?? input.stili ?? input.styles ?? null;
      if (raw == null) raw = [input]; // forse e' gia' una singola regola
    }
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const r of arr) {
      if (out.length >= MAX_RULES) break;
      const c = cleanRule(r);
      if (c) out.push(c);
    }
    return out;
  }

  // !important SERVE: insertCSS applica a livello utente, più BASSO degli stili del sito, e
  // «scrivi in grassetto i titoli» perderebbe. L'utente l'ha chiesto: deve vincere.
  function importantify(decls) {
    return decls
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (/!important\s*$/i.test(d) ? d : `${d} !important`))
      .join('; ') + ';';
  }

  function buildCss(rules) {
    const norm = Array.isArray(rules) && rules.length && rules[0] && rules[0].selector
      ? rules
      : normalizeRules(rules);
    if (!norm.length) return '';
    return norm.map((r) => `${r.selector} { ${importantify(r.css)} }`).join('\n');
  }

  global.SN_PAGE_RESTYLE = { normalizeRules, buildCss, cleanSelector, cleanDeclarations };
})(typeof globalThis !== 'undefined' ? globalThis : self);
