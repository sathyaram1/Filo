// Corpo iniettato nel main world di una pagina web e dei riquadri vuoti che si crea (page-preload.js, via
// riquadri-vuoti.js), prima dei suoi script: i permessi mai decisi si leggono «da chiedere», come in Chrome. Non concede
// niente: le regole stanno in src/main/services/permessiPagine.js, e una pagina che lo manomette inganna solo se stessa.

const SCRITTURA = 'filo:scrittura';
const SCRITTURA_FINE = 'filo:scrittura-fine';
const SCRITTURA_NIENTE = 'filo:scrittura-niente';
// Fotocamera, microfono, posizione e MIDI Chromium li dice concessi finché l'utente non ha detto no (il controllo è solo
// sì o no): se il sì c'è davvero lo sa il main, e il preload lo dice annullando questo evento (#1057).
const SI_DATO = 'filo:permesso-si:';
const PARTI_LETTE = { camera: 'video', microphone: 'audio', geolocation: 'posizione', midi: 'strumenti' };

// Un'espressione che vale la funzione da applicare a ogni finestra: la pagina e i riquadri vuoti che si crea, che
// leggono e chiedono come lei (#1057).
function buildStatoPermessiCorpo(stato) {
  const iniziale = ['granted', 'denied', 'default'].includes(stato && stato.notifiche) ? stato.notifiche : 'default';
  const gestoMs = Number(stato && stato.gestoMs) > 0 ? Number(stato.gestoMs) : 5000;
  return `(function(){
  'use strict';
  var N = window.Notification;
  var d = typeof N === 'function' ? Object.getOwnPropertyDescriptor(N, 'permission') : null;
  var vero = d && typeof d.get === 'function' ? d.get : null;
  var deciso = ${JSON.stringify(iniziale)};
  // Il sì vero lo dice Chromium; un no lo dice solo l'utente, mai il silenzio di una domanda non fatta.
  function leggi() {
    var v = 'denied';
    try { v = vero.call(N); } catch (e) {}
    if (v === 'granted') return v;
    return deciso === 'denied' ? 'denied' : 'default';
  }
  var manda = window.EventTarget.prototype.dispatchEvent, Ev = window.Event;
  var PARTI = ${JSON.stringify(PARTI_LETTE)};
  function siDato(parte) {
    try { return !manda.call(window, new Ev(${JSON.stringify(SI_DATO)} + parte, { cancelable: true })); } catch (e) { return false; }
  }
  function letto(nome, v) {
    if (nome === 'notifications') { var s = leggi(); return s === 'default' ? 'prompt' : s; }
    return v === 'granted' && !siDato(PARTI[nome]) ? 'prompt' : v;
  }
  // Senza un gesto Filo non fa la domanda: la risposta è «nessuno ha deciso», non un no. Il gesto si conta come lo
  // conta Filo, input vero di recente: l'attivazione della pagina può venire da uno script iniettato con gesto.
  var ultimoGesto = 0;
  function gesto(e) { if (e.isTrusted && e.key !== 'Escape') ultimoGesto = Date.now(); }
  var chiedi = typeof N === 'function' ? N.requestPermission : null;
  // La domanda parte sempre dalla pagina: da un riquadro vuoto Chromium non riconosce il sito che lo ha creato.
  var nativo = typeof comeNativo === 'function' ? comeNativo : function (f) { return f; };
  var r = { requestPermission(cb) {
    var g = Date.now() - ultimoGesto < ${gestoMs};
    return chiedi.call(N).then(function (x) {
      if (x === 'denied' && g) deciso = 'denied';
      var s = leggi();
      if (typeof cb === 'function') { try { cb(s); } catch (e) {} }
      return s;
    });
  } };
  ${SORGENTE_SCRITTURA}
  return function (w) {
    ['pointerdown', 'mousedown', 'mouseup', 'keydown', 'touchstart', 'touchend'].forEach(function (t) {
      try { w.addEventListener(t, gesto, true); } catch (e) {}
    });
    var WN = w.Notification;
    var wd = typeof WN === 'function' ? Object.getOwnPropertyDescriptor(WN, 'permission') : null;
    if (vero && wd && typeof wd.get === 'function') {
      var g = Object.getOwnPropertyDescriptor({ get permission() { return leggi(); } }, 'permission').get;
      try { Object.defineProperty(WN, 'permission', { get: nativo(g, wd.get, 'get permission'), enumerable: wd.enumerable, configurable: true }); } catch (e) {}
      if (typeof chiedi === 'function' && typeof WN.requestPermission === 'function') {
        try { Object.defineProperty(WN, 'requestPermission', { value: nativo(r.requestPermission, chiedi, 'requestPermission'), writable: true, configurable: true, enumerable: true }); } catch (e) {}
      }
    }
    var P = w.Permissions && w.Permissions.prototype;
    var S = w.PermissionStatus && Object.getOwnPropertyDescriptor(w.PermissionStatus.prototype, 'state');
    if (P && typeof P.query === 'function' && S && typeof S.get === 'function') {
      var q = P.query, stato = S.get;
      var o = { query(richiesta) {
        var p = q.apply(this, arguments);
        var nome;
        try { nome = richiesta && richiesta.name; } catch (e) {}
        if (nome !== 'notifications' && !(typeof nome === 'string' && Object.hasOwn(PARTI, nome))) return p;
        return p.then(function (st) {
          try {
            var leggiStato = Object.getOwnPropertyDescriptor({ get state() {
              var v = 'denied';
              try { v = stato.call(st); } catch (e) {}
              return letto(nome, v);
            } }, 'state').get;
            Object.defineProperty(st, 'state', { get: nativo(leggiStato, stato, 'get state'), configurable: true });
          } catch (e) {}
          return st;
        });
      } };
      try { Object.defineProperty(P, 'query', { value: nativo(o.query, q, 'query'), writable: true, configurable: true, enumerable: true }); } catch (e) {}
    }
  };
})()`;
}

// File e cartelle (#1069): da Electron 39 Chromium dice «concesso» o «negato» e non chiede mai. La domanda la fa Filo
// (permessiPagine.chiediScrittura) prima di ogni scrittura non ancora concessa; l'esito vero si rilegge da Chromium.
const SORGENTE_SCRITTURA = `(function(){
  'use strict';
  var H = window.FileSystemHandle && window.FileSystemHandle.prototype;
  if (!H || typeof H.queryPermission !== 'function' || typeof H.requestPermission !== 'function') return;
  var leggi = H.queryPermission, chiedi = H.requestPermission;
  var T = EventTarget.prototype, manda = T.dispatchEvent, ascolta = T.addEventListener, smetti = T.removeEventListener;
  var Ev = Event, DE = DOMException, FINE = ${JSON.stringify(SCRITTURA_FINE)}, NIENTE = ${JSON.stringify(SCRITTURA_NIENTE)};
  var ua = navigator.userActivation;
  var RW = { mode: 'readwrite' };
  // Chi ha avuto il no su questa maniglia lo legge come negato; una maniglia nuova torna «da chiedere».
  var negati = new WeakSet();
  function scrive(d) { return Boolean(d && d.mode && d.mode !== 'read'); }
  function attiva() { try { return Boolean(ua && ua.isActive); } catch (e) { return false; } }
  // Risolve true se Filo ha avuto una risposta (sì, no, o il no ricordato), false se non ha chiesto.
  function aFilo() {
    return new Promise(function (ok) {
      function fine(e) { smetti.call(window, FINE, fine, true); smetti.call(window, NIENTE, fine, true); ok(e.type === FINE); }
      ascolta.call(window, FINE, fine, true);
      ascolta.call(window, NIENTE, fine, true);
      manda.call(window, new Ev(${JSON.stringify(SCRITTURA)}));
    });
  }
  function richiedi(h, d, a) {
    return chiedi.apply(h, a).then(function (s) {
      if (s !== 'denied' || !scrive(d) || negati.has(h)) return s;
      if (!attiva()) throw new DE('User activation is required to request permissions.', 'SecurityError');
      return aFilo().then(function (risposto) {
        return chiedi.apply(h, a).then(function (x) {
          if (x === 'denied' && risposto) negati.add(h);
          return x;
        });
      });
    });
  }
  function metti(P, nome, f) {
    if (P && typeof P[nome] === 'function') try { Object.defineProperty(P, nome, { value: f, writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
  var o = {
    queryPermission: function queryPermission(d) {
      var h = this;
      return leggi.apply(h, arguments).then(function (s) { return s === 'denied' && scrive(d) && !negati.has(h) ? 'prompt' : s; });
    },
    requestPermission: function requestPermission(d) { return richiedi(this, d, arguments); },
  };
  metti(H, 'queryPermission', o.queryPermission);
  metti(H, 'requestPermission', o.requestPermission);
  // In Chrome scrivere, creare, cancellare e spostare chiedono da sé: qui la domanda va fatta prima.
  function primaChiedi(P, nome, serve) {
    var f = P && P[nome];
    if (typeof f !== 'function') return;
    var w = { f: function () {
      var h = this, a = arguments;
      if (!serve(a)) return f.apply(h, a);
      return richiedi(h, RW, [RW]).catch(function () {}).then(function () { return f.apply(h, a); });
    } };
    metti(P, nome, w.f);
  }
  var D = window.FileSystemDirectoryHandle && window.FileSystemDirectoryHandle.prototype;
  var F = window.FileSystemFileHandle && window.FileSystemFileHandle.prototype;
  var sempre = function () { return true; };
  var crea = function (a) { return Boolean(a[1] && a[1].create); };
  primaChiedi(F, 'createWritable', sempre);
  primaChiedi(D, 'getFileHandle', crea);
  primaChiedi(D, 'getDirectoryHandle', crea);
  primaChiedi(D, 'removeEntry', sempre);
  primaChiedi(F, 'move', sempre);
  primaChiedi(D, 'move', sempre);
  primaChiedi(H, 'remove', sempre);
})();`;

module.exports = { buildStatoPermessiCorpo, SCRITTURA, SCRITTURA_FINE, SCRITTURA_NIENTE, SI_DATO, PARTI_LETTE };
