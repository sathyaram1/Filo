// Il menu del tasto destro come dati, per disegnarlo nello strato sopra la scheda (#1054): le funzioni restano a chi le
// ha scritte, tenute per numero, e il clic torna come numero. Pura: niente DOM, niente chrome.*.
// Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md; prove: tests/unit/menuDescritto.test.mjs

(function (global) {
  'use strict';

  // Le voci del menu sono annidate di pochi livelli (sottomenu, griglia): oltre, è un ciclo o un oggetto che non c'entra.
  const PROFONDITA_MAX = 16;

  // `op.speciale(v)`: il sostituto di un valore che JSON non porta (una funzione, un elemento) o undefined per il giro
  // normale. Un valore che non è dato (elemento, simbolo, oggetto con un prototipo suo) diventa null.
  function descrivi(v, op = {}, prof = 0) {
    if (prof > PROFONDITA_MAX) return null;
    if (op.speciale) {
      const s = op.speciale(v);
      if (s !== undefined) return s;
    }
    if (v == null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'number') return Number.isFinite(v) ? v : null;
    if (t !== 'object') return null;
    if (Array.isArray(v)) return v.map((x) => descrivi(x, op, prof + 1));
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return null;
    const out = {};
    for (const k of Object.keys(v)) {
      const d = descrivi(v[k], op, prof + 1);
      if (d !== undefined) out[k] = d;
    }
    return out;
  }

  // L'inverso: `{ $fn: n }` → op.funzione(n), `{ $ancora: s }` → op.ancora(s). Le chiavi con `$` le scrive solo descrivi.
  function ricostruisci(v, op = {}, prof = 0) {
    if (prof > PROFONDITA_MAX || v == null) return v == null ? v : null;
    if (Array.isArray(v)) return v.map((x) => ricostruisci(x, op, prof + 1));
    if (typeof v !== 'object') return v;
    if (Number.isInteger(v.$fn)) return op.funzione ? op.funzione(v.$fn) : null;
    if (typeof v.$ancora === 'string') return op.ancora ? op.ancora(v.$ancora) : null;
    const out = {};
    for (const k of Object.keys(v)) out[k] = ricostruisci(v[k], op, prof + 1);
    return out;
  }

  // Il cammino di un nodo dentro una radice, come indici fra i figli elemento: lo strato e il content script tengono la
  // stessa forma (lo strato non toglie elementi, li cambia), quindi un cammino trova lo stesso bottone dall'altra parte.
  function cammino(radice, nodo) {
    const out = [];
    let n = nodo;
    while (n && n !== radice) {
      const p = n.parentElement;
      if (!p) return null;
      out.unshift(Array.prototype.indexOf.call(p.children, n));
      n = p;
    }
    return n === radice ? out : null;
  }

  function trova(radice, indici) {
    if (!Array.isArray(indici)) return null;
    let n = radice;
    for (const i of indici) {
      if (!n || !Number.isInteger(i) || i < 0) return null;
      n = n.children[i] || null;
    }
    return n;
  }

  global.SN_MENU_DESCRITTO = { descrivi, ricostruisci, cammino, trova, PROFONDITA_MAX };
})(typeof globalThis !== 'undefined' ? globalThis : self);
