// Sorgente iniettato nel main world di ogni frame web (page-preload.js), prima dei suoi script: i corpi che Filo mette
// nella pagina valgono anche nei riquadri vuoti che lei si crea, che un preload loro non l'hanno (#1057). Non concede
// niente; cosa copre e cosa resta fuori: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md.

// `corpi`: espressioni che valgono ciascuna una funzione (finestra). Per indice (window[i]) un riquadro si prende senza
// passare da niente di intercettabile: va sistemato appena nasce, dopo ogni via che lo crea e al suo load.
function buildRiquadriVuotiSource(corpi) {
  return `(function(){
  'use strict';
  var corpi = [${corpi.join(',\n')}];
  var D = Object.getOwnPropertyDescriptor, def = Object.defineProperty;
  var lungo = (D(window, 'length') || D(Window.prototype, 'length') || {}).get;
  var urlDi = (D(Document.prototype, 'URL') || {}).get;
  var vistaDi = (D(Document.prototype, 'defaultView') || {}).get;
  var chiusa = (D(window, 'closed') || D(Window.prototype, 'closed') || {}).get;
  // Un riquadro dentro una radice ombra non sta fra quelli per indice: si raggiunge dal suo elemento.
  var finestreDi = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'].map(function (c) {
    return ((window[c] && D(window[c].prototype, 'contentWindow')) || {}).get;
  }).filter(Boolean);
  // Un documento a about:blank non ha un preload suo: il riquadro appena nato, o rimandato lì dalla pagina.
  var VUOTO = /^about:blank([?#]|$)/i;
  var visti = new WeakSet();
  var fuori = new WeakSet();
  var sistemate = [];
  function documento(w) {
    if (fuori.has(w)) return null;
    try { return w.document || null; } catch (e) { fuori.add(w); return null; }
  }
  function applica(w) {
    var d = documento(w);
    if (!d || visti.has(d)) return d;
    visti.add(d);
    var u = '';
    try { u = String(urlDi.call(d)); } catch (e) {}
    if (!VUOTO.test(u)) return d;
    for (var i = 0; i < corpi.length; i++) { try { corpi[i](w); } catch (e) {} }
    aggancia(w, d);
    try { sistemate.push(new WeakRef(w)); } catch (e) {}
    return d;
  }
  function applicaA(r) {
    if (!r || typeof r !== 'object') return;
    if (finestra(r)) { applica(r); return; }
    var v = null;
    try { v = vistaDi.call(r); } catch (e) {}
    if (v) applica(v);
  }
  function delRiquadro(t) {
    for (var i = 0; i < finestreDi.length; i++) { try { var w = finestreDi[i].call(t); if (w) return w; } catch (e) {} }
    return null;
  }
  function aperta(w) { try { return !chiusa.call(w); } catch (e) { return false; } }
  var inGiro = false;
  function spazza() {
    if (inGiro) return;
    inGiro = true;
    try {
      var coda = [window];
      sistemate = sistemate.filter(function (r) { var w = r.deref(); if (w && aperta(w)) { coda.push(w); return true; } return false; });
      for (var n = 0; n < coda.length && n < 4096; n++) {
        var w = coda[n], k = 0;
        try { k = lungo ? lungo.call(w) : w.length; } catch (e) {}
        for (var i = 0; i < k && i < 4096; i++) {
          var f = null;
          try { f = w[i]; } catch (e) {}
          if (f && applica(f)) coda.push(f);
        }
      }
    } catch (e) {} finally { inGiro = false; }
  }
  var OSPITI = 'iframe,frame,object,embed', OSPITE = /^(iframe|frame|object|embed)$/;
  var nomeDi = (D(Element.prototype, 'localName') || {}).get;
  var connesso = (D(Node.prototype, 'isConnected') || {}).get;
  var cercaIn = [Element.prototype.querySelector, DocumentFragment.prototype.querySelector];
  // Il giro costa: si fa solo se l'inserimento può aver fatto nascere un riquadro.
  function ospite(n) {
    try { return OSPITE.test(nomeDi.call(n)); } catch (e) { return false; }
  }
  function conOspiti(n) {
    if (!n || typeof n !== 'object') return false;
    if (ospite(n)) return true;
    for (var i = 0; i < cercaIn.length; i++) { try { return cercaIn[i].call(n, OSPITI) !== null; } catch (e) {} }
    return false;
  }
  function inPagina(t) { try { return connesso.call(t); } catch (e) { return true; } }
  // Una stringa che nomina un ospite; ciò che non è una stringa si converte da sé, e si guarda dopo.
  function testoConOspiti(v) { return typeof v !== 'string' || /<\s*(i?frame|object|embed)/i.test(v); }
  var SE = {
    nodi: function (t, a) {
      if (!inPagina(t)) return false;
      for (var i = 0; i < a.length; i++) if (conOspiti(a[i])) return true;
      return false;
    },
    gamma: function (t, a) { return conOspiti(a[0]); },
    testo: function (i) { return function (t, a) { return inPagina(t) && testoConOspiti(a[i]); }; },
    sempre: function () { return true; },
  };
  // Un frame che cambia documento può passare da un altro sito a un riquadro vuoto: al suo load si riguarda tutto.
  function alLoad(e) {
    var t = e && e.target;
    if (!ospite(t)) return;
    fuori = new WeakSet();
    var w = delRiquadro(t);
    if (w) applica(w);
    spazza();
  }
  function ascolta(t) { try { t.addEventListener('load', alLoad, true); } catch (e) {} }
  function stessaForma(f, v) { try { def(f, 'length', { value: v.length }); } catch (e) {} return f; }
  function dopo(o, nome, se, poi) {
    var x = o && D(o, nome);
    if (!x || typeof x.value !== 'function') return;
    var v = x.value;
    var m = {}; m[nome] = function () {
      var giro = se(this, arguments), r;
      try { r = v.apply(this, arguments); } finally { if (giro) spazza(); }
      if (poi) { try { poi(this, r); } catch (e) {} }
      return r;
    };
    try { def(o, nome, { value: stessaForma(m[nome], v), writable: x.writable, enumerable: x.enumerable, configurable: true }); } catch (e) {}
  }
  function prima(o, nome) {
    var x = o && D(o, nome);
    if (!x) return;
    if (typeof x.value === 'function') {
      var v = x.value;
      var m = {}; m[nome] = function () { spazza(); var r = v.apply(this, arguments); applicaA(r); return r; };
      try { def(o, nome, { value: stessaForma(m[nome], v), writable: x.writable, enumerable: x.enumerable, configurable: true }); } catch (e) {}
      return;
    }
    if (typeof x.get !== 'function') return;
    var g = x.get;
    try { def(o, nome, { get: function () { spazza(); var r = g.call(this); applicaA(r); return r; }, set: x.set, enumerable: x.enumerable, configurable: true }); } catch (e) {}
  }
  function dopoLaScrittura(o, nome) {
    var x = o && D(o, nome);
    if (!x || typeof x.set !== 'function') return;
    var s = x.set, se = SE.testo(0);
    try { def(o, nome, { get: x.get, set: function (v) { var giro = se(this, [v]); try { s.call(this, v); } finally { if (giro) spazza(); } }, enumerable: x.enumerable, configurable: true }); } catch (e) {}
  }
  function proto(w, nome) { var c = w[nome]; return c && c.prototype; }
  function finestra(r) { return r && typeof r === 'object' && r === r.window; }
  function aggancia(w, d) {
    ascolta(d);
    try { new w.MutationObserver(spazza).observe(d, { childList: true, subtree: true }); } catch (e) {}
    var N = proto(w, 'Node');
    ['appendChild', 'insertBefore', 'replaceChild'].forEach(function (m) { dopo(N, m, SE.nodi); });
    var conTesto = { insertAdjacentHTML: SE.testo(1), setHTMLUnsafe: SE.testo(0), setHTML: SE.testo(0) };
    ['Element', 'Document', 'DocumentFragment', 'CharacterData', 'DocumentType', 'ShadowRoot'].forEach(function (c) {
      var P = proto(w, c);
      if (!P) return;
      ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith', 'moveBefore', 'insertAdjacentElement',
        'insertAdjacentHTML', 'setHTMLUnsafe', 'setHTML'].forEach(function (m) { if (Object.hasOwn(P, m)) dopo(P, m, conTesto[m] || SE.nodi); });
      if (c !== 'Document') ['innerHTML', 'outerHTML'].forEach(function (p) { if (Object.hasOwn(P, p)) dopoLaScrittura(P, p); });
    });
    var Doc = proto(w, 'Document');
    dopo(Doc, 'write', SE.sempre);
    dopo(Doc, 'writeln', SE.sempre);
    dopo(Doc, 'execCommand', SE.testo(2));
    // La riscrittura da capo toglie gli ascolti del documento; con tre argomenti apre una finestra.
    dopo(Doc, 'open', SE.sempre, function (doc, r) { ascolta(doc); if (finestra(r)) applica(r); });
    var R = proto(w, 'Range');
    ['insertNode', 'surroundContents'].forEach(function (m) { dopo(R, m, SE.gamma); });
    dopo(proto(w, 'Element'), 'attachShadow', function () { return false; }, function (el, radice) { ascolta(radice); });
    ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'].forEach(function (c) {
      ['contentWindow', 'contentDocument'].forEach(function (p) { prima(proto(w, c), p); });
    });
    ['HTMLIFrameElement', 'HTMLObjectElement', 'HTMLEmbedElement'].forEach(function (c) { prima(proto(w, c), 'getSVGDocument'); });
    dopo(D(w, 'open') ? w : proto(w, 'Window'), 'open', SE.sempre, function (_, r) { if (finestra(r)) applica(r); });
  }
  visti.add(document);
  for (var i = 0; i < corpi.length; i++) { try { corpi[i](window); } catch (e) {} }
  aggancia(window, document);
  spazza();
})();`;
}

module.exports = { buildRiquadriVuotiSource };
