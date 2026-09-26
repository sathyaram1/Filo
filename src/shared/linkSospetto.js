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

  // Codici: 'url_invalido' | 'side_effect' | 'token_in_url' | 'typosquatting:<dominio>'.
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

    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const nome = nomeSito(host);
    const sosia = normalizzaSosia(nome);
    for (const p of POPULAR) {
      if (host === p) break;
      if (host.endsWith('.' + p)) break;
      const suo = nomeSito(p);
      // Stesso nome, altro dominio di primo livello (amazon.de, google.co):
      // è il sito, non chi lo imita.
      if (nome === suo) break;
      if (sosia === suo || levenshteinSmall(nome, suo, tolleranza(suo))) {
        flags.push('typosquatting:' + p);
        break;
      }
    }
    return flags;
  }

  // Suffissi di secondo livello: in 'amazon.co.uk' il nome del sito è 'amazon'.
  const SUFFISSI_2L = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

  // #725 — si confronta il nome, non l'indirizzo intero: col primo livello
  // dentro, ogni cambio di Paese era un'imitazione (amazon.de contro amazon.it).
  function nomeSito(host) {
    const parti = host.split('.').filter(Boolean);
    if (parti.length < 2) return host;
    parti.pop();
    if (parti.length >= 2 && SUFFISSI_2L.has(parti[parti.length - 1])) parti.pop();
    return parti[parti.length - 1] || host;
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

  function frasePerCodice(codice) {
    if (FRASI[codice]) return FRASI[codice];
    if (codice.startsWith('typosquatting:')) {
      const dominio = codice.slice('typosquatting:'.length).trim();
      if (dominio) return `L’indirizzo somiglia a ${dominio} ma non è quello: potrebbe essere un’imitazione.`;
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
