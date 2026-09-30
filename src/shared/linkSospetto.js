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

  const FORME = ['typosquatting', 'homograph', 'brand_in_subdomain', 'combosquatting'];

  // Codici: 'url_invalido' | 'side_effect' | 'token_in_url' | '<forma>:<dominio imitato>'.
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

    const imit = imitazione(sitoCheComanda(rawUrl));
    if (imit) flags.push(imit.forma + ':' + imit.dominio);
    return flags;
  }

  // Chi comanda un indirizzo lo decide lo stesso motore dei siti aperti
  // (safebrowse): dominio registrabile, piattaforme ospitanti, whitelist, omoglifi.
  const MOTORE = (function () {
    if (typeof require !== 'function') return null;
    try {
      return {
        normalize: require('../main/services/safebrowse/normalize.js').normalize,
        isWhitelisted: require('../main/services/safebrowse/whitelist.js').isWhitelisted,
        skeleton: require('../main/services/safebrowse/confusables.js').skeleton,
      };
    } catch (e) {
      console.error('[Filo] linkSospetto: senza il motore dei siti non riconosce le imitazioni', e);
      return null;
    }
  })();

  // Suffissi di secondo livello sotto un dominio di Paese: in 'google.com.eg' il
  // nome del sito è 'google' anche dove la lista dei suffissi non arriva.
  const SUFFISSI_2L = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

  function sitoCheComanda(rawUrl) {
    if (!MOTORE) return null;
    let n = null;
    try { n = MOTORE.normalize(rawUrl); } catch (_) { return null; }
    if (!n || !n.ok) return null;
    // https://paypal.com@altro.net si legge paypal.com, ma il sito è altro.net:
    // quello che sta prima della chiocciola vale come un sottodominio.
    const chi = utente(rawUrl);
    // Un indirizzo numerico o di un nome solo non ha nome né sottodomini: conta
    // solo quello che sta prima della chiocciola (http://paypal.com@203.0.113.7).
    if (n.isIp || n.single) {
      if (!chi.length) return null;
      return { registrabile: n.host, registrabileU: n.host, nome: '', nomeU: '', sotto: chi, primo: '', piattaforma: '', certificato: false };
    }
    if (n.suffixOnly || !n.sld) return null;
    // «paypal.com.» è paypal.com: il punto finale non è un'etichetta.
    const ascii = n.host.replace(/\.$/, '').split('.');
    const uni = (n.hostUnicode || n.host).replace(/\.$/, '').split('.');
    if (uni.length !== ascii.length) return null;
    let quante = n.registrable.split('.').length;
    let piattaforma = n.ospitato ? n.publicSuffix : '';
    if (!n.ospitato && !n.publicSuffix.includes('.') && n.publicSuffix.length === 2
      && SUFFISSI_2L.has(n.sld) && ascii.length > quante) quante += 1;
    const i = ascii.length - quante;
    const sottoHost = uni.slice(0, i);
    if (sottoHost[0] === 'www') sottoHost.shift();
    const registrabile = ascii.slice(i).join('.');
    return {
      registrabile,
      // Il sito si nomina come lo vede chi legge, non col punycode «xn--».
      registrabileU: uni.slice(i).join('.'),
      nome: ascii[i],
      nomeU: uni[i],
      sotto: [...chi, ...sottoHost],
      primo: sottoHost[0] || '',
      piattaforma,
      certificato: MOTORE.isWhitelisted(registrabile),
    };
  }

  function utente(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch (_) { return []; }
    const chi = [u.username, u.password].filter(Boolean).join('.');
    if (!chi) return [];
    let testo = chi;
    try { testo = decodeURIComponent(chi); } catch (_) {}
    return testo.toLowerCase().split(/[.:@/]+/).filter(Boolean);
  }

  // Piattaforme dove il sottodominio è l'account di chi pubblica, e le aziende
  // si tengono il proprio nome: microsoft.github.io è Microsoft. Su googleapis.com
  // i nomi li sceglie Google (youtube.googleapis.com).
  const PIATTAFORME_ACCOUNT = new Set(['github.io', 'gitlab.io', 'googleapis.com']);
  // Servizi riservati alle aziende, che danno a ogni cliente un indirizzo col suo
  // nome in testa: paypal.wd1.myworkdayjobs.com sono le offerte di lavoro di PayPal.
  const SERVIZI_PER_AZIENDA = new Set([
    'myworkdayjobs.com', 'qualtrics.com', 'service-now.com', 'webex.com', 'salesforce.com',
  ]);

  // Parole che accompagnano un nome famoso nei domini di phishing
  // (secure-paypal, paypal-com, amazon-rimborsi). Senza una di queste accanto,
  // «github-readme-stats» è uno strumento, non un'imitazione (#725.2).
  const ESCA = new Set([
    'com', 'it', 'net', 'org', 'co', 'eu', 'info', 'uk', 'de', 'fr', 'es', 'us',
    'login', 'signin', 'logon', 'accesso', 'accedi', 'entra', 'auth', 'id', 'account', 'accounts', 'conto', 'profilo', 'profile',
    'secure', 'security', 'sicuro', 'sicura', 'sicurezza', 'protezione', 'protect', 'verify', 'verifica', 'verification', 'verified',
    'conferma', 'confirm', 'convalida', 'validate', 'unlock', 'sblocco', 'sblocca', 'recovery', 'recupero', 'reset', 'password',
    'support', 'supporto', 'assistenza', 'help', 'aiuto', 'service', 'services', 'servizio', 'servizi', 'customer', 'clienti', 'cliente', 'care', 'center', 'centro',
    'billing', 'pagamento', 'pagamenti', 'payment', 'payments', 'pay', 'fattura', 'invoice', 'refund', 'rimborso', 'rimborsi', 'rinnovo', 'renew',
    'abbonamento', 'subscription', 'carta', 'card', 'wallet', 'bonus', 'premio', 'premi', 'gift', 'regalo', 'promo', 'offerta', 'offer', 'rewards', 'prize',
    'alert', 'alerts', 'avviso', 'notifica', 'notification', 'update', 'aggiorna', 'aggiornamento', 'attivazione', 'activate',
    'blocco', 'blocked', 'sospeso', 'suspended', 'limited', 'limitato', 'official', 'ufficiale', 'italia', 'italy', 'team', 'mail', 'email', 'web', 'online',
    'copyright', 'www',
  ]);
  // Incollate al nome (securepaypal, paypalcom) solo le più nette: googlemail e
  // amazonpay sono domini veri dei due marchi.
  const ESCA_INCOLLATA = new Set([
    'com', 'it', 'net', 'login', 'signin', 'logon', 'secure', 'security', 'sicuro', 'sicurezza', 'verify', 'verifica',
    'account', 'accesso', 'id', 'support', 'assistenza', 'help', 'update', 'conferma', 'confirm', 'rimborso', 'refund',
  ]);
  // Sotto questa lunghezza un nome famoso dentro un altro è un caso, non un indizio.
  const MIN_NOME_DENTRO = 5;

  const NON_ASCII = /[^\u0000-\u007f]/;

  // Quello che si legge a schermo: le lettere sosia diventano latine, quelle che
  // la tabella non conosce restano come sono, così la distanza le conta invece
  // di perderle (ԍithub dista una lettera da github, non tre).
  function scheletro(s) {
    let out = '';
    for (const ch of s.normalize('NFC').toLowerCase()) {
      const m = MOTORE.skeleton(ch);
      if (m) out += m;
      else if (NON_ASCII.test(ch)) out += ch;
    }
    return normalizzaSosia(out);
  }

  // Una parola scritta con lettere d'altri alfabeti vale il nome famoso anche a
  // qualche lettera di distanza: un nome di sito vero non è così vicino a un marchio.
  function valeNome(p, suo) {
    return p.w === suo || (p.estera && levenshteinSmall(p.w, suo, tolleranza(suo)));
  }

  // Il nome famoso `suo` sta in `parte` (un'etichetta dell'indirizzo), da solo o
  // incollato a un'altra parola, con un'esca accanto o incollata. `bastaLui`: da
  // solo vale già.
  function usaNome(parte, suo, bastaLui) {
    if (suo.length < MIN_NOME_DENTRO) return false;
    const parole = parte.split('-').filter(Boolean).map((p) => ({ w: scheletro(p), estera: NON_ASCII.test(p) }));
    const escaAccanto = (k) => parole.some((a, j) => j !== k && ESCA.has(a.w));
    if (bastaLui && parole.length === 1 && valeNome(parole[0], suo)) return true;
    for (let k = 0; k < parole.length; k++) {
      const w = parole[k].w;
      if (valeNome(parole[k], suo)) {
        if (bastaLui || escaAccanto(k)) return true;
      } else if (w.length > suo.length) {
        if (w.startsWith(suo) && (ESCA_INCOLLATA.has(w.slice(suo.length)) || escaAccanto(k))) return true;
        if (w.endsWith(suo) && (ESCA_INCOLLATA.has(w.slice(0, -suo.length)) || escaAccanto(k))) return true;
      }
    }
    return false;
  }

  function imitazione(sito) {
    if (!sito || sito.certificato) return null;
    const famosi = POPULAR.map((dominio) => ({ dominio, suo: nomeSito(dominio) }));
    for (const f of famosi) {
      if (sito.registrabile === f.dominio) return null;
      // Stesso nome, altro dominio di primo livello (amazon.de, google.co): è
      // il sito. Su una piattaforma ospitante il nome lo sceglie chi pubblica.
      if (sito.nome === f.suo && (!sito.piattaforma || PIATTAFORME_ACCOUNT.has(sito.piattaforma))) return null;
    }
    // Lettere di un altro alfabeto (раураl.com): si confronta quello che si
    // legge a schermo, non il punycode che il browser ha nell'indirizzo. Solo se
    // ogni lettera si legge come una latina: una parola russa non imita nessuno.
    const straniero = /[^\u0000-\u007f]/.test(sito.nomeU)
      && MOTORE.skeleton(sito.nomeU).length === sito.nomeU.replace(/-/g, '').length
      ? scheletro(sito.nomeU) : '';
    for (const f of famosi) {
      if (straniero) {
        if (straniero === f.suo || (!sito.piattaforma && levenshteinSmall(straniero, f.suo, tolleranza(f.suo)))) {
          return { forma: 'homograph', dominio: f.dominio };
        }
      } else if (sito.nome !== f.suo) {
        if (normalizzaSosia(sito.nome) === f.suo) return { forma: 'typosquatting', dominio: f.dominio };
        // Sul nome di una pagina ospitata la distanza non dice niente: è una
        // parola scelta da chi pubblica (team.netlify.app).
        if (!sito.piattaforma && levenshteinSmall(sito.nome, f.suo, tolleranza(f.suo))) return { forma: 'typosquatting', dominio: f.dominio };
      }
    }
    for (const f of famosi) {
      // Arriva qui solo su una piattaforma ospitante: paypal.netlify.app.
      if (sito.nome === f.suo) return { forma: 'brand_in_subdomain', dominio: f.dominio };
      if (sito.sotto.some((l) => usaNome(l, f.suo, true))) return { forma: 'brand_in_subdomain', dominio: f.dominio };
      if (usaNome(sito.nomeU, f.suo, false)) return { forma: 'combosquatting', dominio: f.dominio };
    }
    return null;
  }

  // Il nome di un dominio famoso scritto per intero: 'amazon' da 'amazon.it'.
  function nomeSito(dominio) {
    return dominio.split('.')[0];
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
  };

  // `url`, se c'è, fa dire quale sito comanda davvero: chi legge
  // paypal.com.accesso-sicuro.net deve sapere che il sito è accesso-sicuro.net.
  function frasePerCodice(codice, url) {
    if (FRASI[codice]) return FRASI[codice];
    const due = codice.indexOf(':');
    if (due < 0) return '';
    const forma = codice.slice(0, due);
    const dominio = codice.slice(due + 1).trim();
    if (!dominio) return '';
    if (forma === 'typosquatting') return `L’indirizzo somiglia a ${dominio} ma non è quello: potrebbe essere un’imitazione.`;
    if (forma === 'homograph') return `L’indirizzo sembra ${dominio}, ma alcune lettere sono solo simili a quelle vere: potrebbe essere un’imitazione.`;
    if (forma === 'brand_in_subdomain' || forma === 'combosquatting') {
      const sito = url ? sitoCheComanda(url) : null;
      const dove = !sito ? 'porta a un altro sito'
        : sito.piattaforma ? `la pagina sta su ${sito.piattaforma}` : `il sito è ${sito.registrabile}`;
      return `L’indirizzo usa il nome di ${dominio}, ma ${dove}: potrebbe essere un’imitazione.`;
    }
    return '';
  }

  // Codici → frasi, senza doppioni e senza vuoti. Un codice che non conosciamo
  // si tace: meglio nessun avviso che un avviso incomprensibile.
  function frasi(codici, url) {
    const out = [];
    for (const c of (Array.isArray(codici) ? codici : [])) {
      if (typeof c !== 'string') continue;
      const f = frasePerCodice(c, typeof url === 'string' ? url : '');
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  }

  // L'avviso intero, pronto da mostrare (stringa vuota se non c'è niente da dire).
  function avviso(codici, url) {
    const f = frasi(codici, url);
    return f.length ? '⚠️ ' + f.join(' ') : '';
  }

  // Un link da non contattare nemmeno per leggerne il titolo: esegue
  // un'azione, o imita un altro sito.
  function grave(codici) {
    return (Array.isArray(codici) ? codici : []).some((c) => typeof c === 'string'
      && (c === 'side_effect' || FORME.includes(c.split(':')[0])));
  }

  global.SN_LINK_SOSPETTO = { analizza, frasi, avviso, grave, POPULAR };
})(typeof globalThis !== 'undefined' ? globalThis : self);
