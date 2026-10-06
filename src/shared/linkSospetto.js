// Link sospetti: euristica sull'indirizzo e le frasi con cui si dicono a chi legge.
// Non apre il link e non interroga nessun servizio: guarda solo l'indirizzo.
// Regole e frasi: tests/unit/linkSospetto.test.mjs.

(function (global) {
  'use strict';

  const POPULAR = [
    'google.com', 'amazon.com', 'amazon.it', 'apple.com', 'microsoft.com',
    'facebook.com', 'youtube.com', 'paypal.com', 'netflix.com', 'instagram.com',
    'twitter.com', 'x.com', 'linkedin.com', 'github.com',
  ];

  // Codici: 'url_invalido' | 'side_effect' | 'token_in_url' | 'alfabeto_ingannevole'
  // | 'typosquatting:<dominio>' | 'omografo:<dominio>' | 'nome_altrui:<dominio>|<dove porta>'.
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
    const norm = SAFEBROWSE ? SAFEBROWSE.normalize(u.href) : null;
    const esca = etichetteUtente(u);
    // Chi comanda si legge in due modi, e basta uno: il sito secondo l'elenco dei
    // suffissi (paypal-login.vercel.app) o la piattaforma che lo ospita (paypal.wordpress.com).
    const imitato = sitoFidato(norm, u) ? '' : (imitazione(host, esca, sitoVero(norm, host)) || imitazione(host, esca, sitoDi(host)));
    if (imitato) flags.push(imitato);
    else if (alfabetoIngannevole(host)) flags.push('alfabeto_ingannevole');
    return flags;
  }

  // #725.2 — chi è davvero il sito lo dice l'elenco del controllo di
  // navigazione (domini dei marchi, CDN, piattaforme che ospitano altri): uno
  // solo per i due controlli, così media-amazon.com o fbcdn.net non gridano al lupo.
  const SAFEBROWSE = (() => {
    try {
      // eslint-disable-next-line no-undef
      if (typeof require === 'function') {
        return { ...require('../main/services/safebrowse/whitelist.js'), ...require('../main/services/safebrowse/normalize.js') };
      }
    } catch (_) {}
    return null;
  })();
  function sitoFidato(norm, u) {
    if (!norm || !norm.ok) return false;
    return !SAFEBROWSE.hostedPlatform(norm.host, u.pathname) && SAFEBROWSE.isWhitelisted(norm.registrable);
  }

  // Il nome famoso che l'indirizzo porta addosso senza essere lui a comandare.
  function imitazione(host, esca, sito) {
    for (const p of POPULAR) {
      if (host === p || host.endsWith('.' + p)) return '';
    }
    // Stesso nome, altro dominio di primo livello (amazon.de, google.co): è il sito. Su una piattaforma che
    // ospita altri il nome è di chi l'ha preso: lì è del marchio solo se lo dice l'elenco dei siti ufficiali (#732).
    if (!sito.ospitato && POPULAR.some((p) => sitoDi(p).nome === sito.nome)) return '';

    // #732 — il nome di un dominio che il controllo all'apertura conosce come fidato è suo (githubusercontent.com,
    // googleapis.com): contano solo i pezzi davanti (paypal-login.s3.amazonaws.com).
    const nomeSuo = !!SAFEBROWSE && SAFEBROWSE.isWhitelisted(sito.dominio);
    const scritto = scheletro(sito.nome);
    const straniero = /[^\x00-\x7f]/.test(sito.nome);
    for (const p of nomeSuo ? [] : POPULAR) {
      const suo = sitoDi(p).nome;
      // Il nome di un sito ospitato è una parola scelta da chi l'ha aperto
      // (apply.vercel.app non imita apple): lì conta solo la stessa grafia.
      if ((scritto === suo && sito.nome !== suo) || (!sito.ospitato && levenshteinSmall(scritto, suo, tolleranza(suo)))) {
        return (straniero ? 'omografo:' : 'typosquatting:') + p;
      }
    }

    // #725.2 — il nome vero c'è tutto ma non comanda: una regola sola per ogni
    // pezzo, davanti al sito o nel suo nome, spezzato ai punti e ai trattini
    // (paypal.com.altro.net, login-paypal.com.altro.net, paypal-login.wixsite.com).
    const pezziSito = esca.concat(sito.sotto, nomeSuo ? [] : [sito.nome]);
    const catena = '.' + pezziSito.map(scheletro).join('.') + '.';
    // Alla regola comune va la grafia vera: le lettere finte attaccate a un marchio-parola (аpplelogin) le vede lei.
    const grezza = '.' + pezziSito.join('.') + '.';
    for (const p of POPULAR) {
      const suo = sitoDi(p).nome;
      const intero = new RegExp('[.-]' + p.replace(/\./g, '[.-]') + '[.-]').test(catena);
      // #732 — il nome da solo conta con la stessa regola del controllo all'apertura (paypallogin sì, pineapple no).
      const nudo = MARCHI ? MARCHI.nominaMarchio(grezza, suo, scheletro) : (suo.length >= 6 && catena.split(/[.-]/).includes(suo));
      if (intero || nudo) return 'nome_altrui:' + p + '|' + sito.dominio;
    }
    // #732 — gli altri marchi del controllo all'apertura (chase-login.com): il tasto destro avvisa sugli stessi.
    for (const b of ALTRI_MARCHI) {
      if (b.domains.includes(sito.dominio)) continue;
      if (MARCHI.nominaMarchio(grezza, b.token, scheletro)) return 'nome_altrui:' + b.domains[0] + '|' + sito.dominio;
    }
    return '';
  }
  const MARCHI = (() => {
    try {
      // eslint-disable-next-line no-undef
      if (typeof require === 'function') return require('../main/services/safebrowse/brands.js');
    } catch (_) {}
    return null;
  })();
  const ALTRI_MARCHI = MARCHI ? MARCHI.BRANDS.filter((b) => !POPULAR.some((p) => sitoDi(p).nome === b.token)) : [];

  // Suffissi di secondo livello: in 'amazon.co.uk' il nome del sito è 'amazon'.
  const SUFFISSI_2L = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

  // #725 — si confronta il nome, non l'indirizzo intero: col primo livello
  // dentro, ogni cambio di Paese era un'imitazione (amazon.de contro amazon.it).
  // `sotto` sono le etichette davanti al dominio, `dominio` è dove porta.
  function sitoDi(host) {
    const parti = host.split('.').filter(Boolean);
    if (parti.length < 2) return { nome: host, dominio: host, sotto: [] };
    let i = parti.length - 2;
    if (i >= 1 && SUFFISSI_2L.has(parti[i])) i--;
    return { nome: parti[i], dominio: parti.slice(i).join('.'), sotto: parti.slice(0, i) };
  }

  // #725.2 — dove finisce il sito lo dice l'elenco dei suffissi del controllo di
  // navigazione: paypal-login.vercel.app è di chi l'ha aperto, non di Vercel.
  // Dove l'elenco ricade sulla regola generica (amazon.com.co) vale la regola corta.
  function sitoVero(norm, host) {
    if (!norm || !norm.ok || !norm.registrable) return sitoDi(host);
    if (norm.isIp) return { nome: host, dominio: host, sotto: [] };
    const parti = host.split('.').filter(Boolean);
    const n = norm.registrable.split('.').length;
    if (parti.length < n) return sitoDi(host);
    let i = parti.length - n;
    if (n === 2 && i >= 1 && SUFFISSI_2L.has(parti[i])) i--;
    return { nome: parti[i], dominio: parti.slice(i).join('.'), sotto: parti.slice(0, i), ospitato: !!norm.ospitato };
  }

  // Le parole prima della «@» (https://paypal.com@altro.net): a schermo
  // aprono l'indirizzo, ma il browser le scarta e va dopo la chiocciola.
  function etichetteUtente(u) {
    let s = u.username + (u.password ? '.' + u.password : '');
    try { s = decodeURIComponent(s); } catch (_) {}
    return s.toLowerCase().split(/[.:]/).filter(Boolean);
  }

  // #725 — una soglia fissa grida al lupo: due lettere su un nome corto sono
  // un altro sito (gitlab non imita github), e su un nome di una non si indovina.
  function tolleranza(nome) {
    if (nome.length <= 4) return 0;
    return nome.length <= 7 ? 1 : 2;
  }

  // Le lettere che a occhio ne valgono un'altra: recuperano i sosia (paypa1,
  // micros0ft, arnazon) che la tolleranza più stretta lascerebbe passare.
  function normalizzaSosia(nome) {
    return nome
      .replace(/rn/g, 'm').replace(/vv/g, 'w')
      .replace(/0/g, 'o').replace(/1/g, 'l')
      .replace(/3/g, 'e').replace(/5/g, 's');
  }

  // Come il nome si legge a schermo: accenti via, lettere cirilliche, greche
  // e armene che sembrano latine al loro posto, poi i sosia ASCII di sopra.
  function scheletro(nome) {
    if (LEGGI_SOSIA) return LEGGI_SOSIA(nome); // la stessa lettura dell'apertura (#732)
    let out = '';
    for (const ch of nome.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')) {
      out += ch.charCodeAt(0) < 0x80 ? ch : (CONFONDIBILI.get(ch) || ch);
    }
    return normalizzaSosia(out);
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

  // Levenshtein limitata a `max` (early-exit). True se distance ≤ max e ≥ 1.
  function levenshteinSmall(a, b, max) {
    if (a === b) return false;
    if (Math.abs(a.length - b.length) > max) return false;
    const m = a.length, n = b.length;
    if (m === 0 || n === 0) return false;
    const prev = new Array(n + 1);
    const cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= n; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return false;
      for (let j = 0; j <= n; j++) prev[j] = cur[j];
    }
    const d = prev[n];
    return d >= 1 && d <= max;
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

  global.SN_LINK_SOSPETTO = { analizza, frasi, avviso, POPULAR };
})(typeof globalThis !== 'undefined' ? globalThis : self);
