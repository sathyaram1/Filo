// Link sospetti: euristica sull'indirizzo e le frasi con cui si dicono a chi legge.
// Non apre il link e non interroga nessun servizio: guarda solo l'indirizzo.
// Regole e frasi: tests/unit/linkSospetto.test.mjs.

(function (global) {
  'use strict';

  // #725.8 — chi imita un marchio lo decide il controllo che gira all'apertura della pagina: un elenco solo
  // di marchi e domini ufficiali, e un link non è pulito qui e sospetto quando lo apri.
  let imitazione = null;
  let sitoNominato = null;
  let LEGIT_DOMAINS = null;
  // Un dominio sta in più marchi (google.com anche in Gmail): lo nomina quello di cui è il sito principale.
  const PRINCIPALI = new Map();
  try {
    if (typeof require === 'function') {
      ({ imitazione, sitoNominato } = require('../main/services/safebrowse/engine.js'));
      const marchi = require('../main/services/safebrowse/brands.js');
      LEGIT_DOMAINS = marchi.LEGIT_DOMAINS;
      for (const b of marchi.BRANDS) if (!PRINCIPALI.has(b.domains[0])) PRINCIPALI.set(b.domains[0], b);
    }
  } catch (e) { console.error('[linkSospetto] controllo dei marchi non caricato', e); }

  // Codici: 'url_invalido' | 'side_effect' | 'token_in_url' | 'alfabeto_ingannevole'
  // | 'typosquatting:<dominio>' | 'omografo:<dominio>' | 'nome_altrui:<dominio>|<dove porta>'.
  function analizza(rawUrl, rinvii = 0) {
    const flags = [];
    let u;
    try { u = new URL(rawUrl); } catch (_) { return ['url_invalido']; }
    const query = (u.search || '').toLowerCase();
    const AZIONI = /(^|[/?&=])(unsubscribe|optout|opt-out|logout|signout|sign-out|delete|remove|confirm|verify|reset|cancel)([/?&=]|$)/;
    // #725 — il percorso NON si abbassa a minuscole: un indirizzo che esegue
    // un'azione è minuscolo, «/wiki/Delete» è il titolo di una voce.
    if (AZIONI.test(u.pathname) || AZIONI.test(query)) flags.push('side_effect');
    if (haCredenziale(query)) flags.push('token_in_url');

    const aggiungi = (c) => { if (c && !flags.includes(c)) flags.push(c); };
    // #725.2 — il nome come lo vede chi legge (unicode), non come viaggia (punycode).
    const host = daPunycode(u.hostname.toLowerCase().replace(/\.$/, ''));
    const arrivo = sitoNominato ? sitoNominato(u.href) : null;
    aggiungi(codiceImitazione(u.href));
    for (const prima of [u.username, u.password]) aggiungi(nomePrimaDellaChiocciola(decodifica(prima), arrivo, arrivo ? arrivo.dove : host));
    if (!flags.some(imita) && alfabetoIngannevole(host)) flags.push('alfabeto_ingannevole');

    // Un rinvio porta dove dice l'indirizzo che si porta dentro: si giudica anche quello, come fa l'apertura
    // sull'indirizzo d'arrivo (#725.8).
    if (rinvii < 2) {
      for (const dentro of indirizziDentro(u)) {
        for (const c of analizza(dentro, rinvii + 1)) if (c !== 'url_invalido') aggiungi(c);
      }
    }
    return flags;
  }

  function imita(codice) {
    return /^(typosquatting|omografo|nome_altrui):/.test(codice);
  }

  // `dove` è il sito a cui il link porta: un altro da quello giudicato quando il nome sta prima della «@».
  function codiceImitazione(url, dove) {
    const imp = imitazione ? imitazione(url) : null;
    if (!imp) return '';
    const dominio = dominioImitato(imp);
    if (imp.somiglia) return (imp.straniero ? 'omografo:' : 'typosquatting:') + dominio;
    return 'nome_altrui:' + dominio + '|' + (dove || imp.dove);
  }

  // https://www.paypal.com@altro.net si legge come il sito vero, ma porta a quello dopo la chiocciola. Conta il nome con
  // cui il pezzo comincia: una seconda chiocciola in codice (www.poste.it%40x.net@altro.net) non deve spostarlo.
  function nomePrimaDellaChiocciola(prima, arrivo, dove) {
    if (!prima || !sitoNominato) return '';
    const nome = prima.replace(/^[a-z]+:\/\//i, '').match(/^[^@:/?#\\\s%]+/);
    if (!nome) return '';
    // Un nome senza punto (secure-paypal@altro.net) si giudica come il nome di un sito qualunque.
    const come = 'https://' + nome[0] + (nome[0].includes('.') ? '' : '.invalid');
    const nominato = sitoNominato(come);
    if (!nominato || (arrivo && arrivo.registrable === nominato.registrable)) return '';
    return nominato.brand ? 'nome_altrui:' + nominato.dove + '|' + dove : codiceImitazione(come, dove);
  }

  // Dove un rinvio scrive la destinazione: in un parametro (google.com/url?q=, Outlook), nel percorso (Proofpoint,
  // urldefense.com/v3/__https://…__) o codificata alla Proofpoint (u=https-3A__sito_percorso).
  function indirizziDentro(u) {
    const out = [];
    for (let pezzo of [decodifica(u.pathname), decodifica(u.hash), ...u.searchParams.values()]) {
      if (/^https?-3A__/i.test(pezzo)) {
        pezzo = pezzo.replace(/-([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/_/g, '/');
      }
      for (const m of pezzo.matchAll(/https?:\/\/[^\s"'<>]+/gi)) out.push(m[0]);
    }
    return out;
  }

  function decodifica(s) {
    try { return decodeURIComponent(s || ''); } catch (_) { return s || ''; }
  }

  // Il dominio vero da nominare: per un sosia il nome del marchio nello stesso Paese, se c'è (arnazon.it somiglia ad
  // amazon.it), altrimenti il sito principale (ariba.com somiglia ad aruba.it, paypal.com.verifica.co.uk usa paypal.com).
  function dominioImitato(imp) {
    const domini = imp.brand.domains;
    return domini.find((d) => imp.somiglia && imp.publicSuffix && d === imp.brand.token + '.' + imp.publicSuffix) || domini[0];
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
      if (dominio) return `L’indirizzo somiglia ${/^a/i.test(dominio) ? 'ad' : 'a'} ${dominio} ma non è quello: potrebbe essere un’imitazione.`;
    }
    if (codice.startsWith('omografo:')) {
      const dominio = codice.slice('omografo:'.length).trim();
      if (dominio) return `L’indirizzo sembra ${dominio}, ma alcune sue lettere sono solo simili a quelle vere: potrebbe essere un’imitazione.`;
    }
    if (codice.startsWith('nome_altrui:')) {
      const [dominio, dove] = codice.slice('nome_altrui:'.length).split('|').map((x) => (x || '').trim());
      if (dominio && dove) return `L’indirizzo usa il nome di ${conMarchio(dominio)}, ma il sito a cui porta è ${dove}: potrebbe essere un’imitazione.`;
    }
    return '';
  }

  // poste.it si legge meglio col nome di chi lo gestisce: «Poste Italiane (poste.it)».
  function conMarchio(dominio) {
    const brand = PRINCIPALI.get(dominio) || (LEGIT_DOMAINS && LEGIT_DOMAINS.get(dominio));
    return brand ? `${brand.display} (${dominio})` : dominio;
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

  global.SN_LINK_SOSPETTO = { analizza, frasi, avviso };
})(typeof globalThis !== 'undefined' ? globalThis : self);
