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
//   - niente @import/@charset/altre at-rule e nessun selettore che cominci per
//     @ : impedisce di caricare fogli di stile esterni e di trasformare la
//     regola in un blocco @font-face;
//   - NESSUNA RICHIESTA DI RETE dal CSS iniettato. La regola non e' un elenco
//     di parole vietate (`url(` era vietato e `image-set("https://...")` faceva
//     la stessa cosa passando liscio: #533, decimo giro di verifica) ma una
//     LISTA DI FUNZIONI AMMESSE: una notazione funzionale che non sta li' fa
//     scartare la regola. Nessuna delle funzioni ammesse sa andare in rete;
//   - niente backslash: gli escape CSS (\75rl( , ur\6c( ) verrebbero decodificati
//     dal browser in un token ammesso, aggirando il controllo qui sopra;
//   - limiti di lunghezza su selettore, dichiarazioni e numero di regole.
// Una regola che non supera la sanificazione viene SCARTATA (non "aggiustata"):
//   meglio non applicare nulla che applicare qualcosa di inatteso.

(function (global) {
  'use strict';

  const MAX_RULES = 30;
  const MAX_SELECTOR_LEN = 400;
  const MAX_DECL_LEN = 600;

  // Token vietati ovunque (selettore o dichiarazioni): aprirebbero un vettore
  // di iniezione o uscirebbero dalla regola. Case-insensitive.
  //
  // Il backslash e' vietato di per se': gli escape CSS (\75rl( , ur\6c( ,
  // @\69mport , javascript\3a ) verrebbero decodificati dal browser in un token
  // diverso da quello scritto, aggirando i controlli qui sotto. L'estetica del
  // testo non ha bisogno di sequenze di escape, quindi qualunque backslash fa
  // scartare la regola: chiude l'intera classe di bypass senza dover
  // normalizzare gli escape.
  const FORBIDDEN_RE = /[<>{}\\]|@import|@charset|@namespace|javascript:/i;

  // Le sole notazioni funzionali che una dichiarazione puo' usare: nessuna di
  // queste sa andare in rete. Elenco di AMMESSE perche' l'elenco delle vietate
  // non finisce mai (#533, decimo giro: `url(` era vietato, `image-set("http…")`
  // no, e fa la stessa cosa).
  const FUNZIONI_OK = new Set([
    'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix',
    'calc', 'min', 'max', 'clamp', 'round', 'mod', 'abs',
    'linear-gradient', 'radial-gradient', 'conic-gradient',
    'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
    'translate', 'translatex', 'translatey', 'translatez', 'translate3d',
    'rotate', 'rotatex', 'rotatey', 'rotatez', 'rotate3d',
    'scale', 'scalex', 'scaley', 'scalez', 'scale3d',
    'skew', 'skewx', 'skewy', 'matrix', 'matrix3d', 'perspective',
    'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate',
    'invert', 'opacity', 'saturate', 'sepia',
    'cubic-bezier', 'steps', 'var', 'env',
  ]);

  // Ogni "(" preceduto da un nome dev'essere una funzione ammessa. Un "("
  // senza nome davanti e' solo una parentesi di raggruppamento dentro calc():
  // da sola non va da nessuna parte. Il prefisso del produttore si toglie
  // prima di cercare, cosi' -webkit-linear-gradient resta ammessa e
  // -webkit-image-set no.
  const FUNZIONE_RE = /([a-zA-Z_-][\w-]*)?\s*\(/g;
  function soloFunzioniAmmesse(s) {
    FUNZIONE_RE.lastIndex = 0;
    let m;
    while ((m = FUNZIONE_RE.exec(s))) {
      if (!m[1]) continue;
      const nome = m[1].toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '').replace(/^-+/, '');
      if (!FUNZIONI_OK.has(nome)) return false;
    }
    return true;
  }

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
    // Un selettore e' un selettore: con un at-rule davanti la regola diventa un
    // blocco (@font-face { src: ... }), cioe' un'altra cosa.
    if (s.startsWith('@')) return null;
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
    if (!soloFunzioniAmmesse(s)) return null;
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

  global.SN_PAGE_RESTYLE = { normalizeRules, buildCss, cleanSelector, cleanDeclarations, FUNZIONI_OK };
})(typeof globalThis !== 'undefined' ? globalThis : self);
