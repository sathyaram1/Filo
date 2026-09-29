// Nomi dei siti scritti dall'utente (#590): quando un dominio è valido per una lista, e come
// si mostra un nome internazionale («xn--mnchen-3ya.de» → «münchen.de»). Logica pura.
// Regole: tests/unit/nomiSito.test.mjs.

(function (global) {
  'use strict';

  // L'estensione è di lettere, oppure la forma «xn--…» di un'estensione non latina (.рф, .中国).
  const VALIDO = /^[a-z0-9.-]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i;

  function valido(host) {
    return VALIDO.test(String(host || ''));
  }

  // Decodifica punycode di una sola etichetta (RFC 3492), senza il prefisso «xn--».
  const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, MAXINT = 2147483647;

  function adatta(delta, punti, primo) {
    let k = 0;
    delta = primo ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / punti);
    for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - TMIN));
    return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW));
  }

  function cifra(cp) {
    if (cp >= 0x30 && cp < 0x3a) return cp - 22;
    if (cp >= 0x41 && cp < 0x5b) return cp - 0x41;
    if (cp >= 0x61 && cp < 0x7b) return cp - 0x61;
    return BASE;
  }

  function decodifica(input) {
    const out = [];
    let i = 0, n = 128, bias = 72;
    let base = input.lastIndexOf('-');
    if (base < 0) base = 0;
    for (let j = 0; j < base; j++) {
      const c = input.charCodeAt(j);
      if (c >= 0x80) throw new Error('punycode');
      out.push(c);
    }
    for (let idx = base > 0 ? base + 1 : 0; idx < input.length;) {
      const vecchio = i;
      for (let w = 1, k = BASE; ; k += BASE) {
        if (idx >= input.length) throw new Error('punycode');
        const d = cifra(input.charCodeAt(idx++));
        if (d >= BASE || d > Math.floor((MAXINT - i) / w)) throw new Error('punycode');
        i += d * w;
        const t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
        if (d < t) break;
        if (w > Math.floor(MAXINT / (BASE - t))) throw new Error('punycode');
        w *= BASE - t;
      }
      const lung = out.length + 1;
      bias = adatta(i - vecchio, lung, vecchio === 0);
      if (Math.floor(i / lung) > MAXINT - n) throw new Error('punycode');
      n += Math.floor(i / lung);
      i %= lung;
      out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  }

  // Greco, cirillico, armeno e lettere fonetiche imitano le latine: con un'estensione latina
  // («аррӏе.com») il nome resta nella forma «xn--», come fanno i browser, per non spacciarsi per un altro.
  const IMITATORI = /[ɐ-ʯͰ-ϿЀ-ԯ԰-֏]/;

  function leggibile(host) {
    const s = String(host || '');
    if (!/(^|\.)xn--/i.test(s)) return s;
    const etichette = s.split('.').map((e) => {
      if (!/^xn--/i.test(e)) return e;
      try { return decodifica(e.slice(4).toLowerCase()) || e; } catch (_) { return e; }
    });
    const estensione = etichette[etichette.length - 1] || '';
    if (/^[\x00-\x7f]*$/.test(estensione) && etichette.some((e) => IMITATORI.test(e))) return s;
    return etichette.join('.');
  }

  // Il sito di un indirizzo come lo legge l'utente, porta compresa; '' se non è un indirizzo.
  function sitoDi(url) {
    try {
      const u = new URL(String(url));
      return u.hostname ? leggibile(u.hostname) + (u.port ? `:${u.port}` : '') : '';
    } catch (_) { return ''; }
  }

  const api = { valido, leggibile, sitoDi };
  global.SN_NOMI_SITO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
