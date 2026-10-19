// Corpo iniettato nel main world di ogni frame web (page-preload.js, via riquadri-vuoti.js), prima dei suoi script: lo
// schermo chiesto alla maniera vecchia (getUserMedia con chromeMediaSource) passa dalla domanda di getDisplayMedia della
// pagina, avvisando prima Filo che la risposta sarà no. Non concede niente: regole e guardia in services/permessiPagine.js.

const EVENTO_SCHERMO_VECCHIO = 'filo:schermo-vecchio';

// Un'espressione che vale la funzione da applicare a ogni finestra: la pagina e i riquadri vuoti che si crea (#1057).
// Anche la funzione presa da un riquadro chiede dalla pagina: per Chromium una combinazione come solo l'audio del computer
// è un messaggio guasto, e chiude la scheda prima di chiedere a Filo.
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
  function metti(o, nome, f) {
    try { Object.defineProperty(f, 'length', { value: o[nome].length }); } catch (e) {}
    try { Object.defineProperty(o, nome, { value: f, writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
  return function (w) {
    var WP = w.MediaDevices && w.MediaDevices.prototype;
    if (WP && typeof WP.getUserMedia === 'function') {
      var gum = WP.getUserMedia;
      metti(WP, 'getUserMedia', { getUserMedia: function (c) { return vecchia(c) ? rifiuta() : gum.apply(this, arguments); } }.getUserMedia);
    }
    var N = w.Navigator && w.Navigator.prototype;
    ['webkitGetUserMedia', 'getUserMedia'].forEach(function (nome) {
      var f = N && N[nome];
      if (typeof f !== 'function') return;
      var v = {};
      v[nome] = function (c, ok, err) {
        if (!vecchia(c)) return f.apply(this, arguments);
        rifiuta().catch(function (e) { if (typeof err === 'function') err(e); });
      };
      metti(N, nome, v[nome]);
    });
  };
})()`;
}

module.exports = { buildSchermoVecchioCorpo, EVENTO_SCHERMO_VECCHIO };
