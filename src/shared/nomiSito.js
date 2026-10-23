// Nomi dei siti scritti dall'utente (#590): come si riduce quello che incolla, quando un dominio è valido per
// una lista, e come si mostra un nome internazionale («xn--mnchen-3ya.de» → «münchen.de»). Logica pura.
// Regole: tests/unit/nomiSito.test.mjs.

(function (global) {
  'use strict';

  // Etichette non vuote («.sito.it» non è un host, e accettarlo non bloccherebbe niente); l'estensione
  // è di lettere, oppure la forma «xn--…» di un'estensione non latina (.рф, .中国).
  const VALIDO = /^(?:[a-z0-9-]+\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i;

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

  // Quello che l'utente scrive o incolla al posto di un sito («https://www.Docs.Google.com/x», «*.sito.it», «"sito.it",»)
  // ridotto al nome con cui il sito si confronta («docs.google.com»); '' se non è un sito. Una sola per tutti gli elenchi (#843).
  function daScritto(raw) {
    let s = String(raw == null ? '' : raw).trim().toLowerCase()
      .replace(/^["'«(]+|["'»),.;]+$/g, '').replace(/^([a-z]+:\/\/)?\*?\.+/, '$1');
    if (!s) return '';
    // URL scrive un nome accentato (münchen.de) nella forma ASCII con cui il sito si confronta.
    try {
      s = new URL(s.includes('://') ? s : `http://${s}`).hostname;
    } catch (_) {
      if (s.includes('://')) return '';
      s = s.split('/')[0].split('?')[0].split(':')[0];
    }
    s = s.replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
    return valido(s) ? s : '';
  }

  // Una riga coi siti incollati di fila («a.it, b.com», «a.it b.com»): un pezzo per sito, e quello che sta fra due siti
  // in un pezzo solo com'era scritto, perché l'avviso lo ridica intero («studio rossi», non «studio» e «rossi»).
  // Un indirizzo con virgole nei parametri, solo sulla riga, resta uno; con un altro sito accanto
  // («https://mail.google.com/x, bbc.co.uk») si divide, o il secondo sparirebbe. Le parole di `salta` (le «e» della
  // chat) separano due pezzi e non ne fanno parte.
  function pezziDi(riga, salta) {
    const intera = String(riga == null ? '' : riga).trim();
    if (!intera) return [];
    const out = [];
    let siti = 0;
    let da = -1;
    let a = -1;
    const chiudi = () => { if (da >= 0) out.push(intera.slice(da, a)); da = -1; };
    for (const m of intera.matchAll(/[^\s,;]+/g)) {
      if (daScritto(m[0])) { chiudi(); out.push(m[0]); siti++; continue; }
      if (salta && salta.has(m[0].toLowerCase())) { chiudi(); continue; }
      if (da < 0) da = m.index;
      a = m.index + m[0].length;
    }
    chiudi();
    return siti <= 1 && daScritto(intera) ? [intera] : out;
  }

  // Un elenco scritto a righe: i siti validi (ridotti, senza doppioni) e le righe scartate così com'erano, per dirle;
  // `scartate` le tiene col posto (quanti siti validi le precedevano), per ridarle dove l'utente le aveva scritte.
  // `riduci`, se c'è, dà a ogni sito la voce che l'elenco salva ('' la scarta): così fa la casella dei fidati.
  function elencoDaTesto(raw, riduci) {
    const valid = [];
    const invalid = [];
    const scartate = [];
    for (const line of String(raw == null ? '' : raw).split('\n')) {
      for (const riga of pezziDi(line)) {
        const scritto = daScritto(riga);
        const sito = scritto && typeof riduci === 'function' ? riduci(scritto) : scritto;
        if (!sito) { invalid.push(riga); scartate.push({ riga, dopo: valid.length }); continue; }
        if (!valid.includes(sito)) valid.push(sito);
      }
    }
    return { valid, invalid, scartate };
  }

  // Il contrario: i siti come li legge l'utente, una riga ciascuno, con le righe scartate al loro posto.
  function testoDaElenco(validi, scartate) {
    const v = (Array.isArray(validi) ? validi : []).filter((r) => typeof r === 'string' && r.trim());
    const s = (Array.isArray(scartate) ? scartate : [])
      .map((x) => (typeof x === 'string' ? { riga: x, dopo: v.length } : x))
      .filter((x) => x && typeof x.riga === 'string' && x.riga.trim());
    const posto = (x) => Math.max(0, Math.min(v.length, Math.floor(Number(x.dopo)) || 0));
    const out = [];
    for (let i = 0; i <= v.length; i++) {
      for (const x of s) if (posto(x) === i) out.push(x.riga);
      if (i < v.length) out.push(leggibile(v[i]));
    }
    return out.join('\n');
  }

  // Le voci di un elenco di siti salvato prima che lo si riducesse (#843): ognuna al suo nome, senza doppioni;
  // quella che non è un sito resta com'è, perché il confronto per nome intero la trova ancora.
  function ripulisciElenco(elenco) {
    if (!Array.isArray(elenco)) return elenco;
    const out = [];
    for (const x of elenco) {
      if (typeof x !== 'string' || !x.trim()) continue;
      const sito = daScritto(x) || x.trim().toLowerCase();
      if (!out.includes(sito)) out.push(sito);
    }
    return out;
  }

  // La voce dell'elenco copre il sito e i suoi sottodomini: lo stesso confronto del content script.
  function copre(voce, host) {
    const h = String(host || '').toLowerCase().replace(/\.+$/, '');
    return typeof voce === 'string' && !!voce && !!h && (h === voce || h.endsWith(`.${voce}`));
  }

  const api = { valido, leggibile, sitoDi, daScritto, pezziDi, elencoDaTesto, testoDaElenco, ripulisciElenco, copre };
  global.SN_NOMI_SITO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
