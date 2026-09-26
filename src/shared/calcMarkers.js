// Calcolatrice locale e marker [[calc: ...]] che l'LLM emette al posto dei conti.
// Logica pura: niente DOM, niente rete. Le regole di formato stanno in
// tests/unit/calcMarkers.test.mjs.

(function (global) {
  'use strict';

  // ----------------------------------------------------------------
  // Calcolatrice locale: valuta espressioni matematiche client-side senza
  // chiamare l'LLM. Più affidabile e gratis. Parser ricorsivo discendente.
  // Grammatica:
  //   expr   = term  (('+'|'-') term)*
  //   term   = power (('*'|'/'|'%') power)*
  //   power  = unary ('^' power)?              (^ destra-associativo, ** alias)
  //   unary  = ('+'|'-') unary | postfix
  //   postfix= atom ('!')*
  //   atom   = number | '(' expr ')' | ident ['(' expr ')'] | ident
  // ----------------------------------------------------------------
  function tryMathEval(input) {
    if (input == null) return { ok: false };
    let s = String(input).trim();
    if (!s) return { ok: false };

    // Normalizza simboli matematici Unicode tipici
    s = s
      .replace(/×/g, '*')     // ×
      .replace(/÷/g, '/')     // ÷
      .replace(/−/g, '-')     // −
      .replace(/[–—]/g, '-') // – —
      .replace(/∕/g, '/')     // ∕
      .replace(/√/g, 'sqrt')  // √
      .replace(/π/g, 'pi')    // π
      .replace(/²/g, '^2')    // ²
      .replace(/³/g, '^3')    // ³
      .replace(/\*\*/g, '^');

    // Decimali italiani: virgola tra cifre -> punto
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    // Separatori delle migliaia con spazi tra cifre: rimuovili
    s = s.replace(/(\d)\s+(?=\d)/g, '$1');
    // Rimuovi un eventuale segno '=' finale (es. "2+2=")
    s = s.replace(/=\s*$/, '').trim();

    // Whitelist caratteri ammessi
    if (!/^[0-9+\-*/^%().\s a-zA-Z!]+$/.test(s)) return { ok: false };
    // Deve "sembrare" matematica: almeno un operatore, fattoriale, funzione o costante
    const hasMathToken = /[+\-*/^%!]/.test(s)
      || /\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|log|ln|exp|abs|floor|ceil|round|pi|e)\b/i.test(s);
    if (!hasMathToken) return { ok: false };

    let i = 0;
    const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const eat = (ch) => { skip(); if (s[i] === ch) { i++; return true; } return false; };

    function parseExpr() {
      let v = parseTerm();
      while (true) {
        if (eat('+')) v += parseTerm();
        else if (eat('-')) v -= parseTerm();
        else break;
      }
      return v;
    }
    function parseTerm() {
      let v = parsePower();
      while (true) {
        if (eat('*')) v *= parsePower();
        else if (eat('/')) v /= parsePower();
        else if (eat('%')) v %= parsePower();
        else break;
      }
      return v;
    }
    function parsePower() {
      let v = parseUnary();
      if (eat('^')) v = Math.pow(v, parsePower());
      return v;
    }
    function parseUnary() {
      skip();
      if (eat('+')) return parseUnary();
      if (eat('-')) return -parseUnary();
      return parsePostfix();
    }
    function parsePostfix() {
      let v = parseAtom();
      while (eat('!')) v = factorial(v);
      return v;
    }
    function parseAtom() {
      skip();
      const rest = s.slice(i);
      const numM = rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
      if (numM) { i += numM[0].length; return parseFloat(numM[0]); }
      const idM = rest.match(/^[a-zA-Z]+/);
      if (idM) {
        const name = idM[0].toLowerCase();
        i += idM[0].length;
        skip();
        if (s[i] === '(') {
          i++;
          const arg = parseExpr();
          if (!eat(')')) throw new Error('paren');
          return applyFunc(name, arg);
        }
        return applyConst(name);
      }
      if (eat('(')) {
        const v = parseExpr();
        if (!eat(')')) throw new Error('paren');
        return v;
      }
      throw new Error('atom');
    }
    function applyFunc(name, x) {
      switch (name) {
        case 'sqrt': return Math.sqrt(x);
        case 'cbrt': return Math.cbrt(x);
        case 'sin': return Math.sin(x);
        case 'cos': return Math.cos(x);
        case 'tan': return Math.tan(x);
        case 'asin': return Math.asin(x);
        case 'acos': return Math.acos(x);
        case 'atan': return Math.atan(x);
        case 'log': return Math.log10(x);
        case 'ln': return Math.log(x);
        case 'exp': return Math.exp(x);
        case 'abs': return Math.abs(x);
        case 'floor': return Math.floor(x);
        case 'ceil': return Math.ceil(x);
        case 'round': return Math.round(x);
      }
      throw new Error('fn');
    }
    function applyConst(name) {
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
      throw new Error('const');
    }
    function factorial(n) {
      if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('fact');
      let r = 1; for (let k = 2; k <= n; k++) r *= k; return r;
    }

    try {
      const value = parseExpr();
      skip();
      if (i !== s.length) return { ok: false };
      if (!Number.isFinite(value)) return { ok: false };
      return { ok: true, value, normalized: s };
    } catch (_) {
      return { ok: false };
    }
  }

  // Le valute si scrivono come prezzi: due decimali. «27,4473924977 €» non è
  // una cifra che qualcuno legge, e il modello il conto non lo rifà (#724).
  // Sotto il centesimo due decimali darebbero «0,00»: lì si tengono le cifre
  // che lasciano il numero un numero, perché un importo azzerato è una bugia.
  function formatMathResult(n, opts) {
    if (!Number.isFinite(n)) return String(n);
    const valuta = !!(opts && opts.valuta);
    let str;
    if (valuta) {
      str = (n === 0 || Math.abs(n) >= 0.005)
        ? n.toFixed(2)
        : String(parseFloat(n.toPrecision(2)));
    } else if (Number.isInteger(n)) {
      str = String(n);
    } else {
      // Limita precisione per evitare 0.30000000000000004
      str = String(parseFloat(n.toPrecision(12)));
    }
    if (str.includes('e') || str.includes('E')) return str.replace('.', ',');
    let [intero, decimali] = str.split('.');
    // Le migliaia si separano da mille in su per un importo, da diecimila in su
    // per un numero nudo: un risultato di quattro cifre senza valuta accanto è
    // spesso un anno, e «2.026» non è un anno.
    if (Math.abs(n) >= (valuta ? 1000 : 10000)) intero = raggruppaMigliaia(intero);
    // Notazione italiana: punto -> virgola decimale
    return decimali ? `${intero},${decimali}` : intero;
  }

  function raggruppaMigliaia(intero) {
    return intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Com'è scritta accanto al risultato la valuta in cui il conto è finito: il
  // prompt chiede di metterla subito dopo il marker, ma «€27,45» esiste. Le
  // sigle si elencano perché un [A-Z]{3} qualunque prenderebbe anche "KM".
  const SIGLE = 'EUR|USD|GBP|CHF|JPY|CNY|CAD|AUD|SEK|NOK|DKK|INR|BRL|MXN|TRY|PLN|HUF|CZK|KRW|ZAR|THB|ILS|IDR|ISK|MYR|NZD|PHP|RON|SGD|HKD|BGN|RUB';
  const SIMBOLI = '€|\\$|£|¥|₹|₩|₪|₫|₱|₺|₽|฿|R\\$|zł|Kč|kr';
  const VALUTA_DOPO = new RegExp(`^[\\s\\u00A0]*(?:${SIMBOLI}|(?:${SIGLE})\\b|euro\\b|euri\\b)`);
  const VALUTA_PRIMA = new RegExp(`(?:${SIMBOLI})[\\s\\u00A0]*$`);

  // ----------------------------------------------------------------
  // Sostituisce i marker [[calc: <espressione>]] emessi dall'LLM
  // con il risultato calcolato in locale. I marker incompleti
  // (in streaming, "]]" non ancora arrivato) vengono nascosti con "…"
  // per evitare flicker visivo. Marker invalidi restano visibili.
  // ----------------------------------------------------------------
  const CALC_MARKER_RE = /\[\[calc:\s*([^\[\]]+?)\s*\]\]/g;
  function resolveCalcMarkers(text, opts) {
    if (!text) return text;
    const streaming = !!(opts && opts.streaming);
    let out = text.replace(CALC_MARKER_RE, (m, expr, offset, full) => {
      const dopo = full.slice(offset + m.length);
      // In streaming la valuta arriva un pezzo DOPO il marker: finché dietro
      // non c'è niente non si sa se il risultato è un prezzo, e un numero a
      // dodici cifre che un istante dopo diventa «27,45 €» è uno sfarfallio.
      if (streaming && /^[\s\u00A0]*$/.test(dopo)) return '…';
      const r = tryMathEval(expr);
      if (!r.ok) return m;
      const valuta = VALUTA_DOPO.test(dopo) || VALUTA_PRIMA.test(full.slice(0, offset));
      return formatMathResult(r.value, { valuta });
    });
    // Nasconde marker incompleti in coda durante lo streaming
    // (anche solo "[[", "[[c", "[[ca", ecc. mentre arrivano i delta)
    out = out.replace(/\[\[(?:c(?:a(?:l(?:c(?::[^\]]*)?)?)?)?)?$/, '…');
    return out;
  }

  global.SN_CALC = { tryMathEval, formatMathResult, resolveCalcMarkers };
})(typeof globalThis !== 'undefined' ? globalThis : self);
