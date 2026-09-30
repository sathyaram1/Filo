// Link sospetti: euristica sull'indirizzo e le frasi con cui si dicono a chi legge.
// Non apre il link e non interroga nessun servizio: guarda solo l'indirizzo.
// Regole e frasi: tests/unit/linkSospetto.test.mjs.

(function (global) {
  'use strict';

  // #725.8 — chi imita un marchio lo decide il controllo che gira all'apertura della pagina: un elenco solo
  // di marchi e domini ufficiali, e un link non è pulito qui e sospetto quando lo apri.
  let imitazione = null;
  let sitoNominato = null;
  try {
    if (typeof require === 'function') ({ imitazione, sitoNominato } = require('../main/services/safebrowse/engine.js'));
  } catch (e) { console.error('[linkSospetto] controllo dei marchi non caricato', e); }

  // Codici: 'url_invalido' | 'side_effect' | 'token_in_url' | 'typosquatting:<dominio>' | 'marchio_imitato:<marchio>'
  // | 'nome_prima_chiocciola'.
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
    aggiungi(codiceImitazione(u.href));
    for (const prima of [u.username, u.password]) aggiungi(nomePrimaDellaChiocciola(decodifica(prima), u.href));

    // Un rinvio porta dove dice l'indirizzo che si porta dentro: si giudica anche quello, come fa l'apertura
    // sull'indirizzo d'arrivo (#725.8).
    if (rinvii < 2) {
      for (const dentro of indirizziDentro(u)) {
        for (const c of analizza(dentro, rinvii + 1)) if (c !== 'url_invalido') aggiungi(c);
      }
    }
    return flags;
  }

  function codiceImitazione(url) {
    const imp = imitazione ? imitazione(url) : null;
    if (!imp) return '';
    return imp.stretta ? 'typosquatting:' + dominioImitato(imp) : 'marchio_imitato:' + imp.brand.display;
  }

  // https://www.paypal.com@altro.net si legge come il sito vero, ma porta a quello dopo la chiocciola.
  function nomePrimaDellaChiocciola(prima, href) {
    if (!prima || !sitoNominato) return '';
    const nominato = sitoNominato('https://' + prima.replace(/^[a-z]+:\/\//i, ''));
    const arrivo = sitoNominato(href);
    if (!nominato || (arrivo && arrivo.registrable === nominato.registrable)) return '';
    if (nominato.brand) return 'marchio_imitato:' + nominato.brand.display;
    return codiceImitazione('https://' + nominato.registrable + '/') || 'nome_prima_chiocciola';
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

  // Il dominio vero da nominare: quello dello stesso Paese, se il marchio ce l'ha (arnazon.it somiglia ad amazon.it).
  function dominioImitato(imp) {
    const domini = imp.brand.domains;
    return domini.find((d) => imp.publicSuffix && d.endsWith('.' + imp.publicSuffix) && !d.slice(0, -imp.publicSuffix.length - 1).includes('.'))
      || domini[0];
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
    nome_prima_chiocciola: 'L’indirizzo comincia col nome di un sito ma porta a quello scritto dopo la chiocciola: potrebbe essere un’imitazione.',
  };

  function frasePerCodice(codice) {
    if (FRASI[codice]) return FRASI[codice];
    if (codice.startsWith('typosquatting:')) {
      const dominio = codice.slice('typosquatting:'.length).trim();
      if (dominio) return `L’indirizzo somiglia ${/^a/i.test(dominio) ? 'ad' : 'a'} ${dominio} ma non è quello: potrebbe essere un’imitazione.`;
    }
    // Il nome del sito vero non ci va: lo sceglie chi ha scritto il link, e il modello legge questi codici come parole di Filo.
    if (codice.startsWith('marchio_imitato:')) {
      const marchio = codice.slice('marchio_imitato:'.length).trim();
      if (marchio) return `L’indirizzo usa il nome di ${marchio} ma non porta a un suo sito: potrebbe essere un’imitazione.`;
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

  global.SN_LINK_SOSPETTO = { analizza, frasi, avviso };
})(typeof globalThis !== 'undefined' ? globalThis : self);
