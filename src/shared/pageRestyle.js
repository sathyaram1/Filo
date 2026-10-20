// Estetica del CONTENUTO della pagina via chat (#185).
//
// Quando l'utente chiede a Filo (chat) di cambiare l'aspetto del testo della
// pagina che sta guardando ("scrivi in grassetto tutti i titoli", "ingrandisci
// il testo", "metti i link in rosso"), Filo emette l'azione STILE_PAGINA con
// una o piu' regole { selettore, css }. Il main process inietta il CSS nella
// scheda web attiva (TabManager.applyPageStyle -> webContents.insertCSS), cosi'
// la modifica e' LIVE, riguarda SOLO la pagina che l'utente vede ed e'
// completamente reversibile (un reload o RIPRISTINA_STILE_PAGINA la toglie).
//
// Questo modulo e' la parte PURA: normalizza e SANIFICA le regole prodotte
// dall'LLM in un blocco CSS sicuro. E' condiviso (IIFE su globalThis) e non
// tocca ne' IPC ne' DOM, cosi' si testa in isolamento (tests/unit).
//
// Sicurezza by-design - il CSS arriva da un LLM, quindi va trattato come non
// fidato:
//   - niente graffe nel selettore o nelle dichiarazioni: impedisce di "uscire"
//     dalla regola e iniettarne altre arbitrarie;
//   - niente < / > : nessun tentativo di chiudere un contesto/markup;
//   - niente @import/@charset/altre at-rule e niente expression( : impedisce di
//     caricare fogli di stile esterni o vecchie expression IE;
//   - niente url( né image-set( / src( (che accettano l'indirizzo come stringa
//     nuda): nessuna richiesta di rete dal CSS iniettato, che porterebbe fuori
//     dati letti dal modello (#587); l'estetica del testo non ne ha bisogno;
//   - niente backslash: gli escape CSS (\75rl( , ur\6c( ) verrebbero decodificati
//     dal browser in un token vietato (es. url(), aggirando i divieti qui sopra;
//   - limiti di lunghezza su selettore, dichiarazioni e numero di regole.
// Una regola che non supera la sanificazione viene SCARTATA (non "aggiustata"):
//   meglio non applicare nulla che applicare qualcosa di inatteso.

(function (global) {
  'use strict';

  const MAX_RULES = 30;
  const MAX_SELECTOR_LEN = 400;
  const MAX_DECL_LEN = 600;

  // Token vietati ovunque (selettore o dichiarazioni): aprirebbero un vettore
  // di iniezione o una richiesta di rete. Case-insensitive.
  //
  // Il backslash e' vietato di per se': gli escape CSS (\75rl( , ur\6c( ,
  // @\69mport , javascript\3a ) verrebbero decodificati dal browser in un token
  // vietato, aggirando i controlli letterali qui sotto. L'estetica del testo non
  // ha bisogno di sequenze di escape, quindi qualunque backslash fa scartare la
  // regola: chiude l'intera classe di bypass senza dover normalizzare gli escape.
  const FORBIDDEN_RE = /[<>{}\\]|@import|@charset|@namespace|expression\s*\(|url\s*\(|image-set\s*\(|\bsrc\s*\(|javascript:/i;
  // Caratteri di controllo (NUL..0x1f, DEL): costruiti via stringa per non
  // mettere byte di controllo nel sorgente.
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
