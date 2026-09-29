// Sorgente iniettato nel main world di una pagina web (page-preload.js), prima dei suoi script: le notifiche si leggono
// «da chiedere» finché l'utente non ha deciso, come in Chrome. Non concede niente: le regole stanno in
// src/main/services/permessiPagine.js, e una pagina che manomette questo override inganna solo se stessa.

function buildStatoPermessiSource(stato) {
  const iniziale = ['granted', 'denied', 'default'].includes(stato && stato.notifiche) ? stato.notifiche : 'default';
  return `(function(){
  'use strict';
  var N = window.Notification;
  if (typeof N !== 'function') return;
  var d = Object.getOwnPropertyDescriptor(N, 'permission');
  if (!d || typeof d.get !== 'function') return;
  var vero = d.get;
  var deciso = ${JSON.stringify(iniziale)};
  // Il sì vero lo dice Chromium; un no lo dice solo l'utente, mai il silenzio di una domanda non fatta.
  function leggi() {
    var v = 'denied';
    try { v = vero.call(N); } catch (e) {}
    if (v === 'granted') return v;
    return deciso === 'denied' ? 'denied' : 'default';
  }
  var g = { get permission() { return leggi(); } };
  try { Object.defineProperty(N, 'permission', { get: Object.getOwnPropertyDescriptor(g, 'permission').get, enumerable: d.enumerable, configurable: true }); } catch (e) { return; }
  var chiedi = N.requestPermission;
  if (typeof chiedi === 'function') {
    // Senza un gesto Filo non fa la domanda: la risposta è «nessuno ha deciso», non un no. Il gesto si conta come lo
    // conta Filo (input vero negli ultimi 5 s): l'attivazione della pagina può venire da uno script iniettato con gesto.
    var ultimoGesto = 0;
    ['pointerdown', 'mousedown', 'mouseup', 'keydown', 'touchstart', 'touchend'].forEach(function (t) {
      window.addEventListener(t, function (e) { if (e.isTrusted && e.key !== 'Escape') ultimoGesto = Date.now(); }, true);
    });
    var r = { requestPermission: function (cb) {
      var gesto = Date.now() - ultimoGesto < 5000;
      return chiedi.call(N).then(function (x) {
        if (x === 'denied' && gesto) deciso = 'denied';
        var s = leggi();
        if (typeof cb === 'function') { try { cb(s); } catch (e) {} }
        return s;
      });
    } };
    try { Object.defineProperty(N, 'requestPermission', { value: r.requestPermission, writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
  var P = window.Permissions && window.Permissions.prototype;
  if (P && typeof P.query === 'function') {
    var q = P.query;
    var o = { query: function (desc) {
      var p = q.apply(this, arguments);
      if (!desc || desc.name !== 'notifications') return p;
      return p.then(function (st) {
        try { Object.defineProperty(st, 'state', { get: function () { var s = leggi(); return s === 'default' ? 'prompt' : s; }, configurable: true }); } catch (e) {}
        return st;
      });
    } };
    try { Object.defineProperty(P, 'query', { value: o.query, writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
})();`;
}

module.exports = { buildStatoPermessiSource };
