// Corpo iniettato nel main world di ogni frame web (page-preload.js, via riquadri-vuoti.js), prima dei suoi script: lo
// schermo chiesto alla maniera vecchia (getUserMedia con chromeMediaSource) passa dalla domanda di getDisplayMedia della
// pagina, avvisando prima Filo che la risposta sarà no. Non concede niente: regole e guardia in services/permessiPagine.js.

const EVENTO_SCHERMO_VECCHIO = 'filo:schermo-vecchio';

// La funzione da applicare alla pagina e ai riquadri vuoti che si crea (#1057): anche da lì si chiede dalla pagina, perché
// per Chromium «solo l'audio del computer» è un messaggio guasto e chiude la scheda prima di chiedere a Filo.
function buildSchermoVecchioCorpo() {
  return `(function(){
  'use strict';
  function haLaChiave(o) { return Boolean(o) && typeof o === 'object' && 'chromeMediaSource' in o; }
  function vecchia(c) {
    try {
      if (!c || typeof c !== 'object') return false;
      return ['audio', 'video'].some(function (k) {
        var t = c[k];
        if (!t || typeof t !== 'object') return false;
        return haLaChiave(t) || haLaChiave(t.mandatory) || (Array.isArray(t.optional) && t.optional.some(haLaChiave));
      });
    } catch (e) { return false; }
  }
  // Chromium rilegge i vincoli: un getter o un Proxy che alla seconda lettura dice desktop chiude la scheda (#1057). Si
  // guarda e si passa una copia di soli dati, letta una volta, con attrezzi presi prima che la pagina li possa cambiare.
  var nomiDi = Object.getOwnPropertyNames, protoDi = Object.getPrototypeOf, defP = Object.defineProperty;
  var crea = Object.create, isArr = Array.isArray, minimo = Math.min, numero = Number;
  var FINE = [Object.prototype, Function.prototype, Array.prototype];
  function finale(o) { return o === FINE[0] || o === FINE[1] || o === FINE[2]; }
  function metto(o, k, v) { defP(o, k, { value: v, enumerable: true, writable: true, configurable: true }); }
  function copia(v, prof) {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
    if (prof > 8) return crea(null);
    var out, i, n;
    if (isArr(v)) {
      out = [];
      for (i = 0, n = minimo(numero(v.length) || 0, 1024); i < n; i++) metto(out, i, copia(v[i], prof + 1));
      return out;
    }
    out = crea(null);
    var visti = crea(null);
    for (var o = v, giri = 0; o && !finale(o) && giri < 16 && (o === v || protoDi(o) !== null); o = protoDi(o), giri++) {
      var nomi = nomiDi(o);
      for (i = 0; i < nomi.length; i++) {
        var k = nomi[i];
        if (k === 'constructor' || k === '__proto__' || visti[k]) continue;
        visti[k] = true;
        metto(out, k, copia(v[k], prof + 1));
      }
    }
    return out;
  }
  var DE = window.DOMException, Ev = window.Event, manda = window.EventTarget.prototype.dispatchEvent;
  function no() { return new DE('Permission denied', 'NotAllowedError'); }
  var P = window.MediaDevices && window.MediaDevices.prototype;
  var gdm = P && P.getDisplayMedia;
  var md = navigator.mediaDevices;
  // La domanda resta quella di sempre; quello che arrivasse comunque si spegne subito.
  function rifiuta() {
    try { manda.call(window, new Ev(${JSON.stringify(EVENTO_SCHERMO_VECCHIO)})); } catch (e) {}
    if (typeof gdm !== 'function' || !md) return Promise.reject(no());
    return gdm.call(md, { video: true }).then(function (s) {
      try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      throw no();
    }, function () { throw no(); });
  }
  var nativo = typeof comeNativo === 'function' ? comeNativo : function (f) { return f; };
  function metti(o, nome, f) {
    try { Object.defineProperty(o, nome, { value: nativo(f, o[nome], nome), writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
  return function (w) {
    var WP = w.MediaDevices && w.MediaDevices.prototype;
    if (WP && typeof WP.getUserMedia === 'function') {
      var gum = WP.getUserMedia;
      metti(WP, 'getUserMedia', { getUserMedia(c) {
        if (!arguments.length) return gum.apply(this, arguments);
        var d;
        try { d = copia(c, 0); } catch (e) { return Promise.reject(e); }
        return vecchia(d) ? rifiuta() : gum.call(this, d);
      } }.getUserMedia);
    }
    var N = w.Navigator && w.Navigator.prototype;
    ['webkitGetUserMedia', 'getUserMedia'].forEach(function (nome) {
      var f = N && N[nome];
      if (typeof f !== 'function') return;
      metti(N, nome, { [nome](c, ok, err) {
        if (!arguments.length) return f.apply(this, arguments);
        var a = [copia(c, 0), ok, err];
        if (!vecchia(a[0])) return f.apply(this, a);
        rifiuta().catch(function (e) { if (typeof err === 'function') err(e); });
      } }[nome]);
    });
  };
})()`;
}

module.exports = { buildSchermoVecchioCorpo, EVENTO_SCHERMO_VECCHIO };
