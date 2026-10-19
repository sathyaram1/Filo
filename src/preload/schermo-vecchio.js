// Sorgente iniettato nel main world di ogni frame web (page-preload.js), prima dei suoi script: lo schermo chiesto alla
// maniera vecchia (getUserMedia con chromeMediaSource) passa dalla stessa domanda di getDisplayMedia, avvisando prima Filo
// che la risposta sarà no. Non concede niente: le regole e la guardia per chi lo aggira stanno in services/permessiPagine.js.

const EVENTO_SCHERMO_VECCHIO = 'filo:schermo-vecchio';

function buildSchermoVecchioSource() {
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
  function no() { return new DOMException('Permission denied', 'NotAllowedError'); }
  var P = window.MediaDevices && window.MediaDevices.prototype;
  var gdm = P && P.getDisplayMedia;
  var md = navigator.mediaDevices;
  // La domanda resta quella di sempre; quello che arrivasse comunque si spegne subito.
  function rifiuta() {
    try { window.dispatchEvent(new Event(${JSON.stringify(EVENTO_SCHERMO_VECCHIO)})); } catch (e) {}
    if (typeof gdm !== 'function' || !md) return Promise.reject(no());
    return gdm.call(md, { video: true }).then(function (s) {
      try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      throw no();
    }, function () { throw no(); });
  }
  if (P && typeof P.getUserMedia === 'function') {
    var gum = P.getUserMedia;
    var m = { getUserMedia: function (c) { return vecchia(c) ? rifiuta() : gum.apply(this, arguments); } };
    try { Object.defineProperty(P, 'getUserMedia', { value: m.getUserMedia, writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
  var N = window.Navigator && window.Navigator.prototype;
  ['webkitGetUserMedia', 'getUserMedia'].forEach(function (nome) {
    var f = N && N[nome];
    if (typeof f !== 'function') return;
    var v = {};
    v[nome] = function (c, ok, err) {
      if (!vecchia(c)) return f.apply(this, arguments);
      rifiuta().catch(function (e) { if (typeof err === 'function') err(e); });
    };
    try { Object.defineProperty(N, nome, { value: v[nome], writable: true, configurable: true, enumerable: true }); } catch (e) {}
  });
})();`;
}

module.exports = { buildSchermoVecchioSource, EVENTO_SCHERMO_VECCHIO };
