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
  // Chromium rilegge i vincoli dopo di noi: un getter o un Proxy che alla seconda lettura dice desktop chiuderebbe la
  // scheda (#1057). Si guarda e si passa una copia di soli dati, letta una volta; quello che la copia non ha, Chromium non lo vede.
  var nomiDi = Object.getOwnPropertyNames, protoDi = Object.getPrototypeOf, defP = Object.defineProperty, isArr = Array.isArray;
  var FINE = [Object.prototype, Function.prototype, Array.prototype];
  function copia(v, prof) {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
    if (prof > 8) return {};
    var out;
    if (isArr(v)) {
      out = [];
      for (var i = 0, n = Math.min(Number(v.length) || 0, 1024); i < n; i++) out.push(copia(v[i], prof + 1));
      return out;
    }
    out = Object.create(null);
    var visti = Object.create(null);
    for (var o = v, giri = 0; o && FINE.indexOf(o) < 0 && giri < 16; o = protoDi(o), giri++) {
      var nomi = nomiDi(o);
      for (var j = 0; j < nomi.length; j++) {
        var k = nomi[j];
        if (k === 'constructor' || k === '__proto__' || visti[k]) continue;
        visti[k] = true;
        defP(out, k, { value: copia(v[k], prof + 1), enumerable: true, writable: true, configurable: true });
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
      metti(WP, 'getUserMedia', { getUserMedia(c) { return vecchia(c) ? rifiuta() : gum.apply(this, arguments); } }.getUserMedia);
    }
    var N = w.Navigator && w.Navigator.prototype;
    ['webkitGetUserMedia', 'getUserMedia'].forEach(function (nome) {
      var f = N && N[nome];
      if (typeof f !== 'function') return;
      metti(N, nome, { [nome](c, ok, err) {
        if (!vecchia(c)) return f.apply(this, arguments);
        rifiuta().catch(function (e) { if (typeof err === 'function') err(e); });
      } }[nome]);
    });
  };
})()`;
}

module.exports = { buildSchermoVecchioCorpo, EVENTO_SCHERMO_VECCHIO };
