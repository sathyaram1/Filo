// I domini dell'accesso Google (#1123): google.com, i suoi domini nazionali, youtube.com e gmail.com sono un accesso solo,
// quindi un contenitore di cookie solo, una protezione sola e una voce sola fra i siti fidati. Logica pura, per main e
// pagine. Sentinella: tests/unit/dominiGoogle.test.mjs.

(function (global) {
  'use strict';

  const Sito = global.SN_STESSO_SITO || require('./stessoSito.js');

  const SITO_GOOGLE = 'google.com';
  // Il suffisso di un dominio di Google: .com, il nazionale (.it, .co.uk, .com.br) e .cat. Un google.<piattaforma>
  // (google.blogspot.com, google.github.io) è il sito di qualcun altro.
  const SUFFISSO_GOOGLE = /^(com|cat|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
  // gmail.com e googlemail.com rimandano a mail.google.com: chi li scrive fra i fidati pensa a Gmail (#876).
  const ALTRI = new Set(['youtube.com', 'gmail.com', 'googlemail.com']);

  function hostDi(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/.test(s)) return s.replace(/^\.+/, '').split('/')[0].split(':')[0];
    try { return new URL(s).hostname; } catch (_) { return ''; }
  }

  // `v`: un indirizzo, un host, un sito o il dominio di un cookie (.google.com).
  function diGoogle(v) {
    const host = hostDi(v);
    if (!host) return false;
    let info = null;
    try { info = Sito.getDomainInfo(host, { soloPsl: true }); } catch (_) { return false; }
    if (!info || !info.registrable || info.ospitato || info.isIp || info.single) return false;
    if (ALTRI.has(info.registrable)) return true;
    return info.sld === 'google' && SUFFISSO_GOOGLE.test(info.publicSuffix || '');
  }

  // Il sito che dà il nome al contenitore: per tutti i domini di Google è google.com.
  function sitoDelContenitore(sito) {
    return diGoogle(sito) ? SITO_GOOGLE : sito;
  }

  // Un elenco di siti (fidati, con accesso) copre tutti i domini di Google quando ne contiene uno.
  function googleNellElenco(voci) {
    for (const d of voci instanceof Set ? voci.values() : Array.isArray(voci) ? voci : []) if (diGoogle(d)) return true;
    return false;
  }

  // Un elenco di siti che risponde a has() per tutti i domini di Google appena ne contiene uno.
  class ElencoConGoogle extends Sito.ElencoSiti {
    has(sito) { return super.has(sito) || (diGoogle(sito) && googleNellElenco(this)); }
  }

  // I siti dove resti connesso come li mostra e li salva l'elenco: ogni voce al sito del suo contenitore, così gmail.com
  // e google.com sono una voce sola e toglierne una non lascia l'altra a tenere connessi (#876).
  function sitiDeiFidati(voci) {
    const out = [];
    for (const v of Sito.sitiDelleVociIn(voci)) {
      const s = sitoDelContenitore(v);
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  // I cookie che dicono che c'è un account Google dentro, su qualunque dominio del gruppo.
  const NOMI_ACCESSO = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID']);
  function cookieDiAccesso(c) {
    return !!c && NOMI_ACCESSO.has(String(c.name || '')) && diGoogle(c.domain);
  }

  const api = {
    SITO_GOOGLE, diGoogle, sitoDelContenitore, googleNellElenco, ElencoConGoogle, sitiDeiFidati, cookieDiAccesso, NOMI_ACCESSO,
  };
  global.SN_DOMINI_GOOGLE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
