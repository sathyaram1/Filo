// Il preambolo di un frame: i pezzi che il main ha deciso per QUESTO frame (canale filo:preambolo-frame) messi
// nel mondo della pagina prima dei suoi script, e da lì nei riquadri about:blank in cui il preload non gira
// (#798). Un pezzo nuovo (il GPC per frame, #753) è una voce in più di `pezzi`. Prove: tests/fingerprint-riquadri.spec.mjs.

const { buildGuardPiece } = require('./fingerprint-guard.js');

function buildPreamboloSource(cfg) {
  const pezzi = [];
  const fp = cfg && cfg.fp;
  if (fp && fp.level > 0) pezzi.push(buildGuardPiece(fp.seed, fp.level));
  if (!pezzi.length) return '';
  return `(function(){
  'use strict';
  var PEZZI = [${pezzi.join(',\n')}];
  // Quello che gira dopo gli script del sito usa solo originali presi qui, chiamati con Reflect.apply.
  var rApply = Reflect.apply;
  var gopd = Object.getOwnPropertyDescriptor, defp = Object.defineProperty;
  var gpo = Object.getPrototypeOf, spo = Object.setPrototypeOf;
  var ascolta = EventTarget.prototype.addEventListener;
  var bersaglio = gopd(Event.prototype, 'target').get;
  var nomeTag = gopd(Element.prototype, 'localName').get;
  var vista = gopd(Document.prototype, 'defaultView').get;
  var wsHas = WeakSet.prototype.has, wsAdd = WeakSet.prototype.add;
  // Una Location per finestra, e la pagina non può sostituirla: un segno su window sì.
  var fatte = new WeakSet();
  var docDi = Object.create(null);
  var CORNICI = [['HTMLIFrameElement', 'iframe'], ['HTMLFrameElement', 'frame'], ['HTMLObjectElement', 'object']];
  var PORTE = ['contentWindow', 'contentDocument'];

  function maschera(fn, orig, name) {
    try {
      defp(fn, 'name', { value: name, configurable: true });
      defp(fn, 'length', { value: orig.length, configurable: true });
      var ts = function toString() { return 'function ' + name + '() { [native code] }'; };
      defp(ts, 'name', { value: 'toString', configurable: true });
      defp(fn, 'toString', { value: ts, configurable: true, writable: true });
      spo(fn, gpo(orig));
    } catch (e) {}
    return fn;
  }

  function monta(w) {
    for (var i = 0; i < PEZZI.length; i++) { try { PEZZI[i](w, maschera); } catch (e) {} }
    try { aggancia(w); } catch (e) {}
  }

  // Solo i documenti about: (vuoti, o srcdoc prima di caricarsi): gli altri li prepara il loro preload.
  function proteggi(w) {
    var loc;
    try { loc = w.location; if (loc.protocol !== 'about:') return; } catch (e) { return; }
    if (rApply(wsHas, fatte, [loc])) return;
    rApply(wsAdd, fatte, [loc]);
    monta(w);
  }

  function daElemento(el) {
    try {
      var g = docDi[rApply(nomeTag, el, [])];
      var d = g && rApply(g, el, []);
      var w = d && rApply(vista, d, []);
      if (w) proteggi(w);
    } catch (e) {}
  }

  function figli(w, quanti) {
    var n = 0;
    try { n = rApply(quanti, w, []) | 0; } catch (e) {}
    for (var i = 0; i < n; i++) { try { proteggi(w[i]); } catch (e) {} }
  }

  // Un riquadro senza indirizzo inserito nel documento manda il suo load in modo sincrono: è l'unico aggancio
  // prima di window[i], che nessun getter intercetta.
  function alCarico(e) { try { daElemento(rApply(bersaglio, e, [])); } catch (err) {} }

  function aggancia(w) {
    for (var c = 0; c < CORNICI.length; c++) {
      var C = w[CORNICI[c][0]], P = C && C.prototype;
      if (!P) continue;
      var dd = gopd(P, 'contentDocument');
      if (dd && dd.get && !docDi[CORNICI[c][1]]) docDi[CORNICI[c][1]] = dd.get;
      for (var k = 0; k < PORTE.length; k++) agganciaGetter(P, PORTE[k], function (self) { daElemento(self); });
    }
    var dl = gopd(w, 'length'), quanti = dl && dl.get;
    if (quanti) {
      agganciaGetter(w, 'frames', function () { figli(w, quanti); });
      agganciaGetter(w, 'length', function () { figli(w, quanti); });
    }
    try { rApply(ascolta, w.document, ['load', alCarico, true]); } catch (e) {}
  }

  function agganciaGetter(obj, prop, prima) {
    var d = gopd(obj, prop);
    if (!d || !d.get) return;
    var og = d.get;
    var ng = function () { prima(this); return rApply(og, this, []); };
    defp(obj, prop, { get: maschera(ng, og, 'get ' + prop), set: d.set, enumerable: d.enumerable, configurable: true });
  }

  try { rApply(wsAdd, fatte, [window.location]); } catch (e) {}
  monta(window);
})();`;
}

module.exports = { buildPreamboloSource };
