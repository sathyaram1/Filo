// Sorgente per il MAIN WORLD di ogni frame web (#586): «da chiedere» dove Chromium direbbe «negato» senza che nessuno
// abbia negato, e la strada vecchia per lo schermo (`chromeMediaSource`) rifiutata prima del browser. Non concede
// niente: il cancello vero resta nel main. Regole: tests/unit/permessiSiti.test.mjs e il pattern dei permessi.

const P = require('../shared/permessiSiti.js');

const CANALE = '__filo_permessi_pagina';

function buildPermessiPaginaSource(negati) {
  const lista = JSON.stringify(Array.isArray(negati) ? negati.filter((t) => typeof t === 'string') : []);
  const nomi = JSON.stringify(P.NOMI_DI_PAGINA);
  return `(function(){
  'use strict';
  var NEGATI = new Set(${lista});
  var NOMI = ${nomi};
  try {
    document.addEventListener(${JSON.stringify(CANALE)}, function (e) {
      try { NEGATI = new Set(JSON.parse(e.detail)); } catch (_) {}
    }, true);
  } catch (_) {}

  function vecchia(c, prof) {
    if (!c || typeof c !== 'object' || prof > 5) return false;
    try {
      if ('chromeMediaSource' in c || 'chromeMediaSourceId' in c) return true;
      var chiavi = Object.keys(c);
      for (var i = 0; i < chiavi.length; i++) if (vecchia(c[chiavi[i]], prof + 1)) return true;
    } catch (_) { return true; }
    return false;
  }

  function maschera(fn, orig, nome) {
    try { Object.defineProperty(fn, 'name', { value: nome, configurable: true }); } catch (_) {}
    try { Object.defineProperty(fn, 'length', { value: orig.length, configurable: true }); } catch (_) {}
    try {
      var ts = Function.prototype.toString;
      Object.defineProperty(fn, 'toString', { value: function toString() { return ts.call(orig); }, configurable: true, writable: true });
    } catch (_) {}
    return fn;
  }

  function installa(w) {
    try {
      if (!w || w.__filoPermessiPagina) return;
      Object.defineProperty(w, '__filoPermessiPagina', { value: true, configurable: false, enumerable: false });
    } catch (_) { return; }
    var no = function () { return new w.DOMException('Permission denied', 'NotAllowedError'); };

    var MD = w.MediaDevices && w.MediaDevices.prototype;
    if (MD && typeof MD.getUserMedia === 'function') {
      var gum = MD.getUserMedia;
      MD.getUserMedia = maschera(function getUserMedia(c) {
        if (vecchia(c, 0)) return w.Promise.reject(no());
        return gum.apply(this, arguments);
      }, gum, 'getUserMedia');
    }
    var N = w.Navigator && w.Navigator.prototype;
    ['getUserMedia', 'webkitGetUserMedia'].forEach(function (k) {
      if (!N || typeof N[k] !== 'function') return;
      var orig = N[k];
      N[k] = maschera(function (c, ok, ko) {
        if (vecchia(c, 0)) { w.setTimeout(function () { try { if (typeof ko === 'function') ko(no()); } catch (_) {} }, 0); return undefined; }
        return orig.apply(this, arguments);
      }, orig, k);
    });

    var PS = w.PermissionStatus && w.PermissionStatus.prototype;
    var dStato = PS && Object.getOwnPropertyDescriptor(PS, 'state');
    if (dStato && dStato.get) {
      var leggiStato = dStato.get;
      Object.defineProperty(PS, 'state', {
        configurable: true, enumerable: dStato.enumerable,
        get: maschera(function () {
          var s = leggiStato.call(this);
          if (s !== 'denied') return s;
          var t = NOMI[this && this.name];
          return t && !NEGATI.has(t) ? 'prompt' : s;
        }, leggiStato, 'get state'),
      });
    }
    var Nt = w.Notification;
    var dNot = Nt && Object.getOwnPropertyDescriptor(Nt, 'permission');
    if (dNot && dNot.get) {
      var leggiNot = dNot.get;
      Object.defineProperty(Nt, 'permission', {
        configurable: true, enumerable: dNot.enumerable,
        get: maschera(function () {
          var s = leggiNot.call(this);
          return s === 'denied' && !NEGATI.has('notifiche') ? 'default' : s;
        }, leggiNot, 'get permission'),
      });
    }

    // Un riquadro creato senza indirizzo non ha il preload: lo si copre appena la pagina ci mette le mani.
    [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement].forEach(function (C) {
      var proto = C && C.prototype;
      if (!proto) return;
      ['contentWindow', 'contentDocument'].forEach(function (k) {
        var d = Object.getOwnPropertyDescriptor(proto, k);
        if (!d || !d.get) return;
        var leggi = d.get;
        Object.defineProperty(proto, k, {
          configurable: true, enumerable: d.enumerable,
          get: maschera(function () {
            var v = leggi.call(this);
            try { installa(k === 'contentWindow' ? v : (v && v.defaultView)); } catch (_) {}
            return v;
          }, leggi, 'get ' + k),
        });
      });
    });
  }
  installa(window);
})();`;
}

module.exports = { buildPermessiPaginaSource, CANALE };
