// Sorgente per il MAIN WORLD di ogni frame web (#586): «da chiedere» dove Chromium direbbe «negato» senza che nessuno
// abbia negato, e la strada vecchia per lo schermo (`chromeMediaSource`) rifiutata prima del browser. Non concede
// niente: il cancello vero resta nel main. Regole: tests/unit/permessiSiti.test.mjs e il pattern dei permessi.

const P = require('../shared/permessiSiti.js');

const CANALE = '__filo_permessi_pagina';
// getDisplayMedia lo annuncia al main prima di partire: un «schermo» che arriva senza annuncio è la strada vecchia.
const ANNUNCIO_SCHERMO = '__filo_schermo_annunciato';

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

  // Quello che la pagina scrive si legge due volte, con le funzioni prese prima di lei, e a Chromium arriva la copia
  // controllata: una richiesta che cambia mentre la si legge (un getter, un Proxy) non è una richiesta.
  var RA = Reflect.apply;
  var GOPD = Object.getOwnPropertyDescriptor;
  var KEYS = Object.keys;
  var DEF = Object.defineProperty;
  var CREA = Object.create;
  var ARR = Array.isArray;
  var PROPRIA = Object.prototype.hasOwnProperty;
  var FONTE_VECCHIA = { chromeMediaSource: 1, chromeMediaSourceId: 1 };
  var MANDA = EventTarget.prototype.dispatchEvent;
  var EVENTO = Event;
  var DOC = document;

  // Oggetti senza prototipo: quello che Chromium non trova nella copia non lo va a cercare in un prototipo della pagina.
  function copia(v, prof) {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function' || typeof v === 'symbol') throw 0;
      return v;
    }
    if (prof > 6) throw 0;
    var out = ARR(v) ? [] : CREA(null);
    var chiavi = KEYS(v);
    for (var i = 0; i < chiavi.length; i++) {
      var k = chiavi[i];
      if (RA(PROPRIA, FONTE_VECCHIA, [k])) throw 0;
      var d = GOPD(v, k);
      if (!d) continue;
      var valore = RA(PROPRIA, d, ['value']) ? d.value : (typeof d.get === 'function' ? RA(d.get, v, []) : undefined);
      var campo = CREA(null);
      campo.value = copia(valore, prof + 1);
      campo.enumerable = true;
      campo.writable = true;
      campo.configurable = true;
      DEF(out, k, campo);
    }
    return out;
  }

  function uguali(a, b) {
    if (a === b) return true;
    if (a !== a && b !== b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || ARR(a) !== ARR(b)) return false;
    var ka = KEYS(a);
    var kb = KEYS(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !uguali(a[ka[i]], b[kb[i]])) return false;
    return true;
  }

  // null: la richiesta non si fa (fonte vecchia, funzioni, troppo profonda, diversa alla seconda lettura).
  function vincoli(c) {
    if (c === undefined) return c;
    try {
      var a = copia(c, 0);
      return uguali(a, copia(c, 0)) ? a : null;
    } catch (_) { return null; }
  }

  function maschera(fn, orig, nome) {
    try { Object.defineProperty(fn, 'name', { value: nome, configurable: true }); } catch (_) {}
    try { Object.defineProperty(fn, 'length', { value: orig.length, configurable: true }); } catch (_) {}
    try {
      var ts = Function.prototype.toString;
      Object.defineProperty(fn, 'toString', { value: function toString() { return RA(ts, orig, []); }, configurable: true, writable: true });
    } catch (_) {}
    return fn;
  }

  function installa(w) {
    try {
      if (!w || w.__filoPermessiPagina) return;
      Object.defineProperty(w, '__filoPermessiPagina', { value: true, configurable: false, enumerable: false });
    } catch (_) { return; }
    var DE = w.DOMException;
    var PR = w.Promise;
    var rifiuta = PR && PR.reject;
    var dopo = w.setTimeout;
    var no = function () { return new DE('Permission denied', 'NotAllowedError'); };

    var MD = w.MediaDevices && w.MediaDevices.prototype;
    if (MD && typeof MD.getUserMedia === 'function') {
      var gum = MD.getUserMedia;
      MD.getUserMedia = maschera(function getUserMedia(c) {
        var pulita = vincoli(c);
        if (pulita === null) return RA(rifiuta, PR, [no()]);
        return RA(gum, this, [pulita]);
      }, gum, 'getUserMedia');
    }
    if (MD && typeof MD.getDisplayMedia === 'function') {
      var gdm = MD.getDisplayMedia;
      MD.getDisplayMedia = maschera(function getDisplayMedia() {
        try { RA(MANDA, DOC, [new EVENTO(${JSON.stringify(ANNUNCIO_SCHERMO)})]); } catch (_) {}
        return RA(gdm, this, arguments);
      }, gdm, 'getDisplayMedia');
    }
    var N = w.Navigator && w.Navigator.prototype;
    ['getUserMedia', 'webkitGetUserMedia'].forEach(function (k) {
      if (!N || typeof N[k] !== 'function') return;
      var orig = N[k];
      N[k] = maschera(function (c, ok, ko) {
        var pulita = vincoli(c);
        if (pulita === null) { RA(dopo, w, [function () { try { if (typeof ko === 'function') ko(no()); } catch (_) {} }, 0]); return undefined; }
        return RA(orig, this, [pulita, ok, ko]);
      }, orig, k);
    });

    var PS = w.PermissionStatus && w.PermissionStatus.prototype;
    var dStato = PS && Object.getOwnPropertyDescriptor(PS, 'state');
    if (dStato && dStato.get) {
      var leggiStato = dStato.get;
      Object.defineProperty(PS, 'state', {
        configurable: true, enumerable: dStato.enumerable,
        get: maschera(function () {
          var s = RA(leggiStato, this, []);
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
          var s = RA(leggiNot, this, []);
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
            var v = RA(leggi, this, []);
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

module.exports = { buildPermessiPaginaSource, CANALE, ANNUNCIO_SCHERMO };
