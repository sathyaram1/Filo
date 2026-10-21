// Link sospetti: i segni che si leggono dall'indirizzo senza aprirlo, e le frasi con cui si dicono a chi legge.
// L'imitazione di un marchio la giudica il controllo di navigazione nel main (imitazioni.js) e arriva qui come codice:
// un verdetto solo per menu e apertura (#1375). Regole e frasi: tests/unit/linkSospetto.test.mjs.

(function (global) {
  'use strict';

  // Codici: 'url_invalido' | 'side_effect' | 'token_in_url' | 'alfabeto_ingannevole', più quelli del main per
  // l'imitazione di un marchio: 'typosquatting:<dominio>' | 'omografo:<dominio>' | 'nome_altrui:<dominio>|<dove porta>'.
  function analizza(rawUrl) {
    const flags = [];
    let u;
    try { u = new URL(rawUrl); } catch (_) { return ['url_invalido']; }
    const query = (u.search || '').toLowerCase();
    const AZIONI = /(^|[/?&=])(unsubscribe|optout|opt-out|logout|signout|sign-out|delete|remove|confirm|verify|reset|cancel)([/?&=]|$)/;
    // #725 — il percorso NON si abbassa a minuscole: un indirizzo che esegue
    // un'azione è minuscolo, «/wiki/Delete» è il titolo di una voce.
    if (AZIONI.test(u.pathname) || AZIONI.test(query)) flags.push('side_effect');
    if (haCredenziale(query)) flags.push('token_in_url');
    // #725.2 — si guarda il nome come lo vede chi legge (unicode), non come
    // viaggia (punycode): «xn--pypal-4ve» a schermo è «раypal».
    const host = daPunycode(u.hostname.toLowerCase().replace(/\.$/, '')).replace(/^www\./, '');
    if (alfabetoIngannevole(host)) flags.push('alfabeto_ingannevole');
    return flags;
  }

  // Il codice dell'imitazione che il main ha visto nel link: dice di più dell'alfabeto ingannevole, e ne prende il posto.
  function conImitazione(flags, codice) {
    const base = Array.isArray(flags) ? flags : [];
    if (typeof codice !== 'string' || !/^(typosquatting|omografo|nome_altrui):./.test(codice)) return base;
    return base.filter((f) => f !== 'alfabeto_ingannevole').concat(codice);
  }

  const STRANIERE = /[\u0370-\u03ff\u0400-\u04ff\u0500-\u052f\u0530-\u058f]/;
  // Domini dei Paesi che scrivono in cirillico, greco o armeno: lì una parola
  // intera come «рост» è una parola, non un travestimento.
  const TLD_LOCALI = new Set(['ru', 'su', 'by', 'ua', 'kz', 'bg', 'mk', 'rs', 'me', 'ba', 'kg', 'mn', 'tj', 'uz', 'gr', 'cy', 'am']);
  // Un'etichetta che mescola il latino con un alfabeto che gli somiglia, o che
  // sotto un dominio latino è fatta solo di lettere che sembrano latine.
  function alfabetoIngannevole(host) {
    const etichette = host.split('.');
    const tld = etichette[etichette.length - 1];
    const travestibile = /^[a-z]+$/.test(tld) && !TLD_LOCALI.has(tld);
    return etichette.some((e) => {
      if (!STRANIERE.test(e)) return false;
      if (/[a-z]/.test(e)) return true;
      if (!travestibile) return false;
      for (const ch of e) {
        if (ch.charCodeAt(0) >= 0x80 && !CONFONDIBILI.has(ch)) return false;
      }
      return true;
    });
  }

  // Sottoinsieme UTS-39 (stessa tabella del controllo di navigazione).
  const CONFONDIBILI = (() => {
    try {
      // eslint-disable-next-line no-undef
      if (typeof require === 'function') return require('../main/services/safebrowse/confusables.js').MAP;
    } catch (_) {}
    return new Map();
  })();

  // RFC 3492, solo decodifica: un'etichetta che non torna resta com'è.
  function daPunycode(host) {
    return host.split('.').map((l) => (l.startsWith('xn--') ? (decodificaPunycode(l.slice(4)) || l) : l)).join('.');
  }
  function decodificaPunycode(input) {
    const BASE = 36, T_MIN = 1, T_MAX = 26;
    const adatta = (delta, punti, primo) => {
      delta = primo ? Math.floor(delta / 700) : delta >> 1;
      delta += Math.floor(delta / punti);
      let k = 0;
      while (delta > ((BASE - T_MIN) * T_MAX) >> 1) { delta = Math.floor(delta / (BASE - T_MIN)); k += BASE; }
      return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + 38));
    };
    const cifra = (c) => {
      if (c >= 48 && c <= 57) return c - 22;
      if (c >= 65 && c <= 90) return c - 65;
      if (c >= 97 && c <= 122) return c - 97;
      return BASE;
    };
    const out = [];
    let n = 128, i = 0, bias = 72;
    const b = Math.max(0, input.lastIndexOf('-'));
    for (let j = 0; j < b; j++) {
      const c = input.charCodeAt(j);
      if (c >= 0x80) return null;
      out.push(c);
    }
    for (let idx = b > 0 ? b + 1 : 0; idx < input.length;) {
      const vecchio = i;
      let w = 1;
      for (let k = BASE; ; k += BASE) {
        if (idx >= input.length) return null;
        const d = cifra(input.charCodeAt(idx++));
        if (d >= BASE) return null;
        i += d * w;
        const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
        if (d < t) break;
        w *= BASE - t;
        if (w > 0x7fffffff || i > 0x7fffffff) return null;
      }
      bias = adatta(i - vecchio, out.length + 1, vecchio === 0);
      n += Math.floor(i / (out.length + 1));
      i %= out.length + 1;
      if (n > 0x10ffff) return null;
      out.splice(i, 0, n);
      i++;
    }
    try { return String.fromCodePoint(...out); } catch (_) { return null; }
  }

  // #725 — il nome del parametro da solo non basta: chiamarsi «t» o «hash» è
  // la norma nei segnatempo e nei contatori, e l'avviso accusava di portare una
  // chiave d'accesso un normalissimo link a un video. Serve anche un VALORE che
  // possa essere una credenziale: abbastanza lungo, e non un numero.
  const MIN_CREDENZIALE = 12;
  function haCredenziale(query) {
    for (const m of query.matchAll(/[?&](token|key|sig|signature|hash|auth|access_token)=([^&#]*)/g)) {
      const valore = m[2];
      if (valore.length >= MIN_CREDENZIALE && !/^\d+$/.test(valore)) return true;
    }
    return false;
  }

  // #725 — il codice interno («typosquatting:paypal.com») finiva davanti
  // all'utente così com'era. Chi legge un avviso di sicurezza deve capire, in
  // una frase, cosa c'è che non va e cosa rischia.
  const FRASI = {
    url_invalido: 'Questo non è un indirizzo valido: Filo non riesce a capire dove porterebbe.',
    side_effect: 'Aprirlo può bastare a eseguire qualcosa sul sito — disiscriverti, uscire, confermare o cancellare — senza chiederti altro.',
    token_in_url: 'Nell’indirizzo c’è un codice che può valere come una chiave d’accesso. Chi lo riceve potrebbe entrare al posto tuo.',
    alfabeto_ingannevole: 'Nel nome del sito ci sono lettere di un altro alfabeto che a schermo sembrano le nostre: potrebbe essere un’imitazione.',
  };

  function frasePerCodice(codice) {
    if (FRASI[codice]) return FRASI[codice];
    if (codice.startsWith('typosquatting:')) {
      const dominio = codice.slice('typosquatting:'.length).trim();
      if (dominio) return `L’indirizzo somiglia a ${dominio} ma non è quello: potrebbe essere un’imitazione.`;
    }
    if (codice.startsWith('omografo:')) {
      const dominio = codice.slice('omografo:'.length).trim();
      if (dominio) return `L’indirizzo sembra ${dominio}, ma alcune sue lettere sono solo simili a quelle vere: potrebbe essere un’imitazione.`;
    }
    if (codice.startsWith('nome_altrui:')) {
      const [dominio, dove] = codice.slice('nome_altrui:'.length).split('|').map((x) => (x || '').trim());
      if (dominio && dove) return `L’indirizzo usa il nome di ${dominio}, ma il sito a cui porta è ${dove}: potrebbe essere un’imitazione.`;
    }
    return '';
  }

  // Codici → frasi, senza doppioni e senza vuoti. Un codice che non conosciamo
  // si tace: meglio nessun avviso che un avviso incomprensibile.
  function frasi(codici) {
    const out = [];
    for (const c of (Array.isArray(codici) ? codici : [])) {
      if (typeof c !== 'string') continue;
      const f = frasePerCodice(c);
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  }

  // L'avviso intero, pronto da mostrare (stringa vuota se non c'è niente da dire).
  function avviso(codici) {
    const f = frasi(codici);
    return f.length ? '⚠️ ' + f.join(' ') : '';
  }

  global.SN_LINK_SOSPETTO = { analizza, conImitazione, frasi, avviso };
})(typeof globalThis !== 'undefined' ? globalThis : self);
