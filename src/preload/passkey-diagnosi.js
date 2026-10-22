// Diagnosi delle passkey (#1608): nel mondo della pagina avvolge navigator.credentials.get/create per registrare la
// forma della richiesta (mai gli id né le risposte) e, a interruttore, completare con «hybrid» i trasporti delle
// credenziali ammesse. Si accende solo con FILO_PASSKEY_DIAGNOSI nell'ambiente del main (ipc.js, filo:passkey-diagnosi).

function buildSource({ hybrid = false } = {}) {
  return `(function(){
  'use strict';
  try {
    if (!navigator.credentials || window.__filoPasskeyDiag) return;
    Object.defineProperty(window, '__filoPasskeyDiag', { value: true, enumerable: false, configurable: true });
    var HYBRID = ${hybrid ? 'true' : 'false'};
    function lung(x) {
      try {
        if (!x) return 0;
        if (typeof x.byteLength === 'number') return x.byteLength;
        if (typeof x === 'string') return x.length;
      } catch (e) {}
      return -1;
    }
    function riassunto(tipo, opts) {
      var pk = opts && opts.publicKey;
      if (!pk) return null;
      var lista = tipo === 'get' ? pk.allowCredentials : pk.excludeCredentials;
      var sel = pk.authenticatorSelection || null;
      return {
        tipo: tipo,
        origin: location.origin,
        rpId: pk.rpId || (pk.rp && pk.rp.id) || null,
        mediation: (opts && opts.mediation) || null,
        userVerification: pk.userVerification || (sel && sel.userVerification) || null,
        hints: pk.hints || null,
        attachment: (sel && sel.authenticatorAttachment) || null,
        residentKey: (sel && sel.residentKey) || null,
        timeout: pk.timeout || null,
        extensions: pk.extensions ? Object.keys(pk.extensions) : null,
        credenziali: Array.isArray(lista)
          ? lista.map(function (c) {
              return { type: c.type, idLen: lung(c.id), transports: Array.isArray(c.transports) ? c.transports.slice() : (c.transports || null) };
            })
          : (lista == null ? null : 'non-array')
      };
    }
    // Copia: l'oggetto della pagina non si tocca.
    function conHybrid(opts) {
      var pk = opts.publicKey, lista = pk.allowCredentials, n = 0;
      if (!Array.isArray(lista)) return { opts: opts, n: 0 };
      var nuova = lista.map(function (c) {
        if (Array.isArray(c.transports) && c.transports.length && c.transports.indexOf('hybrid') < 0) {
          n++;
          return Object.assign({}, c, { transports: c.transports.concat(['hybrid']) });
        }
        return c;
      });
      if (!n) return { opts: opts, n: 0 };
      return { opts: Object.assign({}, opts, { publicKey: Object.assign({}, pk, { allowCredentials: nuova }) }), n: n };
    }
    function log(s) { try { console.log('[Filo passkey] ' + s); } catch (e) {} }
    // Google respinge un browser con le API ritoccate: la funzione avvolta si presenta come l'originale
    // (stesso nome, stessa arità, stesso testo) e sta sul prototipo, non sull'oggetto.
    var FP = Function.prototype, prevToString = FP.toString, originali = new WeakMap();
    function toString() { var o = originali.get(this); return prevToString.apply(o || this, arguments); }
    originali.set(toString, prevToString);
    FP.toString = toString;
    var sede = (window.CredentialsContainer && CredentialsContainer.prototype && typeof CredentialsContainer.prototype.get === 'function')
      ? CredentialsContainer.prototype : navigator.credentials;
    function avvolgi(nome) {
      var orig = sede[nome];
      if (typeof orig !== 'function') return;
      var avvolta = function (opts) {
        var r = null;
        try { r = riassunto(nome, opts); } catch (e) { log('riassunto fallito ' + e); }
        var usa = opts;
        if (r && nome === 'get' && HYBRID) {
          try { var c = conHybrid(opts); usa = c.opts; r.hybridAggiunto = c.n; } catch (e) { log('hybrid fallito ' + e); }
        }
        if (r) log('richiesta ' + JSON.stringify(r));
        var p;
        try { p = orig.apply(this, [usa]); }
        catch (e) { if (r) log('esito ' + nome + ' eccezione ' + (e && e.name) + ': ' + (e && e.message)); throw e; }
        if (r && p && typeof p.then === 'function') {
          p.then(function (cred) { log('esito ' + nome + ' ok tipo=' + (cred && cred.type) + ' attacco=' + (cred && cred.authenticatorAttachment)); },
                 function (e) { log('esito ' + nome + ' errore ' + (e && e.name) + ': ' + (e && e.message)); });
        }
        return p;
      };
      try {
        Object.defineProperty(avvolta, 'name', { value: orig.name, configurable: true });
        Object.defineProperty(avvolta, 'length', { value: orig.length, configurable: true });
      } catch (e) {}
      originali.set(avvolta, orig);
      sede[nome] = avvolta;
    }
    avvolgi('get');
    avvolgi('create');
    log('attiva hybrid=' + HYBRID + ' su ' + location.origin);
  } catch (e) { try { console.log('[Filo passkey] non installata ' + e); } catch (_) {} }
})();`;
}

module.exports = { buildSource };
