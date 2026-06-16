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
//   - niente url( : nessuna richiesta di rete dal CSS iniettato (font/img
//     remoti, beacon); l'estetica del testo non ne ha bisogno;
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
  const FORBIDDEN_RE = /[<>{}]|@import|@charset|@namespace|expression\s*\(|url\s*\(|javascript:/i;
  // Caratteri di controllo (NUL..0x1f, DEL): costruiti via stringa per non
  // mettere byte di controllo nel sorgente.
  const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]');

  function isBadChunk(s) {
    return FORBIDDEN_RE.test(s) || CONTROL_RE.test(s);
  }

  // Selettore valido: non vuoto, entro il limite, senza token vietati. Non
  // verifichiamo che sia un selettore CSS sintatticamente perfetto (il browser
  // ignora le regole che non sa parsare): ci interessa solo che sia SICURO.
  function cleanSelector(sel) {
    const s = String(sel == null ? '' : sel).trim();
    if (!s || s.length > MAX_SELECTOR_LEN) return null;
    if (isBadChunk(s)) return null;
    return s;
  }

  // Dichiarazioni valide: "prop: valore; prop2: valore2". Togliamo eventuali
  // graffe che l'LLM potrebbe aver incluso per errore prima del check (cosi' una
  // risposta tipo "{ font-weight: bold }" non viene scartata per via delle
  // graffe esterne), poi sanifichiamo il resto.
  function cleanDeclarations(css) {
    let s = String(css == null ? '' : css).trim();
    // togli UNA coppia di graffe esterne se avvolge tutto il blocco
    if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).trim();
    if (!s || s.length > MAX_DECL_LEN) return null;
    if (isBadChunk(s)) return null;
    // deve contenere almeno una coppia prop:valore
    if (!/[a-z-]+\s*:[^;]+/i.test(s)) return null;
    // garantisci il ; finale per concatenare in sicurezza
    if (!s.endsWith(';')) s += ';';
    return s;
  }

  // Estrae { selector, css } da una singola regola, accettando i sinonimi che
  // un LLM puo' produrre. Ritorna null se non sanificabile.
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

  // Normalizza l'input dell'azione (oggetto azione, { regole/rules: [...] },
  // array, o singola regola) in un array di regole sicure { selector, css }.
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

  // Aggiunge !important a ogni dichiarazione che non ce l'ha gia'. SERVE: il
  // main inietta il CSS con webContents.insertCSS, che lo applica a livello
  // user-agent/user — piu' BASSO degli stili author del sito (il suo <style>).
  // Senza !important, "scrivi in grassetto i titoli" perderebbe contro la regola
  // del sito h1{font-weight:400} e non si vedrebbe nulla. L'utente ha chiesto
  // esplicitamente questa estetica: deve vincere sulla pagina.
  function importantify(decls) {
    return decls
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (/!important\s*$/i.test(d) ? d : `${d} !important`))
      .join('; ') + ';';
  }

  // Compone il blocco CSS finale da iniettare. Vuoto se non c'e' nulla di valido.
  function buildCss(rules) {
    const norm = Array.isArray(rules) && rules.length && rules[0] && rules[0].selector
      ? rules
      : normalizeRules(rules);
    if (!norm.length) return '';
    return norm.map((r) => `${r.selector} { ${importantify(r.css)} }`).join('\n');
  }

  global.SN_PAGE_RESTYLE = { normalizeRules, buildCss, cleanSelector, cleanDeclarations };
})(typeof globalThis !== 'undefined' ? globalThis : self);
