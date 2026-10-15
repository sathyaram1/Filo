// Sorgente del preambolo che il page-preload inietta nel main world prima degli script della pagina: oggi la guardia
// anti-fingerprint, una parte fra quelle che il preambolo porta in ogni finestra della stessa origine (#798; #753 ci
// aggiunge GPC). Non legge mai il master secret: riceve solo il seed per sito (HMAC in main).

// La guardia: rumore legato alla posizione del pixel nell'immagine, stesso pixel stesso rumore da ogni porta.
// `guarda(w)` la monta nella finestra `w`, con le copie native di quella finestra.
function parteFingerprint(seed) {
  return `
  var SEED = ${seed >>> 0} >>> 0;

  function ph(x, y) {
    var h = (SEED ^ imul(x | 0, 374761393) ^ imul(y | 0, 668265263)) >>> 0;
    h = imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ~10% dei pixel, 1 LSB su R/G/B, mai alpha. (ox, oy) è la posizione nell'immagine della prima
  // riga del buffer, dy il verso delle righe (-1 per readPixels, che parte dal basso). Un pixel con
  // alpha 0 non si tocca: un canvas vero lo restituisce sempre nero, il rumore tradirebbe la guardia.
  function perturb(data, w, h, ox, oy, base, stride, dy) {
    if (!data || w <= 0 || h <= 0) return;
    base = base | 0; stride = stride || w * 4; dy = dy || 1;
    if (data.length < base + (h - 1) * stride + w * 4) return;
    for (var row = 0; row < h; row++) {
      var py = oy + row * dy, i0 = base + row * stride;
      for (var col = 0; col < w; col++) {
        var i = i0 + col * 4;
        if (!data[i + 3]) continue;
        var r = ph(ox + col, py);
        if ((r % 100) < 10) {
          data[i]     ^= (r & 1);
          data[i + 1] ^= ((r >>> 1) & 1);
          data[i + 2] ^= ((r >>> 2) & 1);
        }
      }
    }
  }

  // ---- Canvas (elemento e OffscreenCanvas) ----
  // Il contesto di un canvas si annota quando la pagina lo crea: chiederlo alla guardia con
  // getContext('2d') ne creerebbe uno, e il canvas non potrebbe più diventare WebGL. L'annotazione è
  // di tutte le finestre: un canvas della pagina si legge anche con le funzioni di un suo riquadro.
  var ctxOf = new WeakMap();
  var MAXPX = 8000000;

  function track(proto) {
    var o = proto && proto.getContext;
    if (!o) return null;
    proto.getContext = mask(function getContext() {
      var ctx = R(o, this, arguments);
      if (ctx && !R(wmHas, ctxOf, [this])) R(wmSet, ctxOf, [this, ctx]);
      return ctx;
    }, o, 'getContext');
    return o;
  }

  function patchGet(proto) {
    var o = proto && proto.getImageData;
    if (!o) return null;
    proto.getImageData = mask(function getImageData(sx, sy, sw, sh) {
      var img = R(o, this, arguments);
      try {
        var x0 = (sx | 0) + ((sw | 0) < 0 ? (sw | 0) : 0);
        var y0 = (sy | 0) + ((sh | 0) < 0 ? (sh | 0) : 0);
        perturb(img.data, img.width, img.height, x0, y0);
      } catch (e) {}
      return img;
    }, o, 'getImageData');
    return o;
  }

  function family(CanvasCtor, CtxCtor, make) {
    var cp = CanvasCtor && CanvasCtor.prototype, xp = CtxCtor && CtxCtor.prototype;
    if (!cp || !xp || !xp.getImageData) return null;
    var F = { put: xp.putImageData, draw: xp.drawImage, make: make };
    F.getCtx = track(cp);
    F.get = patchGet(xp);
    return F.getCtx ? F : null;
  }

  // Si esporta una copia rumorosa, mai il canvas della pagina: i suoi pixel non cambiano nemmeno per
  // un istante, e toBlob/convertToBlob, che finiscono dopo, non ripristinano sopra un disegno nuovo.
  // Senza contesto il canvas è vuoto, uguale per tutti: null, e si esporta com'è.
  function noisyCopy(src, F) {
    var ctx = R(wmGet, ctxOf, [src]);
    if (!ctx || !F) return null;
    var W = src.width | 0, H = src.height | 0;
    if (W <= 0 || H <= 0 || (W * H) > MAXPX) return null;
    var img = null, cs;
    try { img = R(F.get, ctx, [0, 0, W, H]); cs = img.colorSpace; }
    catch (e) { img = null; try { cs = ctx.drawingBufferColorSpace; } catch (e2) {} }
    var tmp = F.make(W, H);
    var t = R(F.getCtx, tmp, ['2d', { __proto__: null, colorSpace: cs || 'srgb', willReadFrequently: true }]);
    if (!img) { R(F.draw, t, [src, 0, 0]); img = R(F.get, t, [0, 0, W, H]); }
    perturb(img.data, W, H, 0, 0);
    R(F.put, t, [img, 0, 0]);
    return tmp;
  }
  function copyOrNull(src, F) { try { return noisyCopy(src, F); } catch (e) { return null; } }

  // La copia nasce nel documento della finestra a cui appartiene la funzione: il Blob che ne esce è suo.
  function canvasHtml(w) {
    var oCreate = w.Document.prototype.createElement;
    var F = family(w.HTMLCanvasElement, w.CanvasRenderingContext2D, function (W, H) {
      var c = R(oCreate, w.document, ['canvas']); c.width = W; c.height = H; return c;
    });
    var P = F && w.HTMLCanvasElement.prototype;
    if (P && P.toDataURL) {
      var oToData = P.toDataURL;
      P.toDataURL = mask(function toDataURL() {
        return R(oToData, copyOrNull(this, F) || this, arguments);
      }, oToData, 'toDataURL');
    }
    if (P && P.toBlob) {
      var oToBlob = P.toBlob;
      P.toBlob = mask(function toBlob(cb) {
        var tmp = typeof cb === 'function' ? copyOrNull(this, F) : null;
        return R(oToBlob, tmp || this, arguments);
      }, oToBlob, 'toBlob');
    }
  }

  function canvasOffscreen(w) {
    var OC = w.OffscreenCanvas;
    var F = family(OC, w.OffscreenCanvasRenderingContext2D, function (W, H) { return new OC(W, H); });
    var P = F && OC.prototype;
    if (P && P.convertToBlob) {
      var oConvert = P.convertToBlob;
      P.convertToBlob = mask(function convertToBlob() {
        return R(oConvert, copyOrNull(this, F) || this, arguments);
      }, oConvert, 'convertToBlob');
    }
  }

  // ---- WebGL readPixels ----
  // Righe e posizioni come le vede toDataURL dello stesso canvas: le due letture devono coincidere.
  // Il buffer si riconosce dal tipo e non con instanceof: può venire da un'altra finestra.
  var tagTA = gOPD(getProto(Uint8Array.prototype), Symbol.toStringTag).get;
  function patchGL(proto, gl2) {
    if (!proto || !proto.readPixels) return;
    var oRead = proto.readPixels, oParam = proto.getParameter;
    var dbh = gOPD(proto, 'drawingBufferHeight');
    var dbhGet = dbh && dbh.get;
    var nf = function readPixels(x, y, width, height, format, type, pixels, dstOffset) {
      R(oRead, this, arguments);
      try {
        if (format !== 0x1908 || type !== 0x1401) return;
        var tipo = R(tagTA, pixels, []);
        if (tipo !== 'Uint8Array' && tipo !== 'Uint8ClampedArray') return;
        var w = width | 0, h = height | 0;
        var align = (R(oParam, this, [0x0D05]) | 0) || 4;
        var rowLen = 0, skipR = 0, skipP = 0;
        if (gl2) {
          rowLen = R(oParam, this, [0x0D02]) | 0;
          skipR = R(oParam, this, [0x0D03]) | 0;
          skipP = R(oParam, this, [0x0D04]) | 0;
        }
        var stride = ceil((rowLen > 0 ? rowLen : w) * 4 / align) * align;
        var base = (gl2 ? (dstOffset | 0) : 0) + skipR * stride + skipP * 4;
        var H = dbhGet ? (R(dbhGet, this, []) | 0) : 0;
        perturb(pixels, w, h, x | 0, H - 1 - (y | 0), base, stride, -1);
      } catch (e) {}
    };
    proto.readPixels = mask(nf, oRead, 'readPixels');
  }

  // ---- AudioContext (OfflineAudioContext.startRendering) ----
  function audio(w) {
    var OAC = w.OfflineAudioContext || w.webkitOfflineAudioContext;
    if (!OAC || !OAC.prototype || !OAC.prototype.startRendering) return;
    var oStart = OAC.prototype.startRendering;
    var nf = function startRendering() {
      var p = R(oStart, this, arguments);
      if (p && typeof p.then === 'function') {
        return p.then(function (buf) {
          try {
            for (var ch = 0; ch < buf.numberOfChannels; ch++) {
              var d = buf.getChannelData(ch);
              for (var i = 0; i < d.length; i++) {
                d[i] += ((ph(i, ch) / 4294967295) - 0.5) * 1e-7;
              }
            }
          } catch (e) {}
          return buf;
        });
      }
      return p;
    };
    OAC.prototype.startRendering = mask(nf, oStart, 'startRendering');
  }

  parti.push(function (w) {
    try { canvasHtml(w); } catch (e) {}
    try { canvasOffscreen(w); } catch (e) {}
    try { patchGL((w.WebGLRenderingContext || {}).prototype, false); } catch (e) {}
    try { patchGL((w.WebGL2RenderingContext || {}).prototype, true); } catch (e) {}
    try { audio(w); } catch (e) {}
  });`;
}

// Ogni finestra ha le sue copie native: una pagina che crea un riquadro vuoto (o della sua origine) e ne usa le
// funzioni le troverebbe intatte. Il preambolo va in ogni finestra della stessa origine prima che la pagina la tocchi:
// dall'elemento (contentWindow, contentDocument) sempre; per indice o per nome solo un riquadro vuoto, che il documento
// segna appena entra. Uno con un indirizzo non si tocca in anticipo: il suo documento erediterebbe la finestra senza
// il preload. Ci pensa il preload, e il preambolo che inietta si unisce a quello delle finestre della stessa origine.
const PROPAGAZIONE = `
  var CORNICI = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'];
  var EP = Element.prototype, leggiAttr = EP.getAttribute, haAttr = EP.hasAttribute, qsa = EP.querySelectorAll;
  var tagName = gOPD(EP, 'tagName').get, nodeType = gOPD(Node.prototype, 'nodeType').get;
  var SP = String.prototype, trim = SP.trim, lower = SP.toLowerCase, taglia = SP.slice;
  var MO = MutationObserver, moObserve = MO.prototype.observe, lunghezza = gOPD(window, 'length').get;
  var GETTER = {};
  for (var k = 0; k < CORNICI.length; k++) {
    var CC = window[CORNICI[k]], dcw = CC && gOPD(CC.prototype, 'contentWindow');
    if (dcw && dcw.get) GETTER[k === 0 ? 'IFRAME' : k === 1 ? 'FRAME' : 'OBJECT'] = dcw.get;
  }

  // Il segno non si toglie (due preamboli sulla stessa finestra annullerebbero il rumore). Letto da un'altra
  // finestra, il suo getter le dà questo preambolo: è così che un riquadro appena nato si unisce.
  function segna(w) {
    var g = mask(function () {
      if (this !== w) { try { prepara(this); } catch (e) {} }
      return true;
    }, w.Function.prototype.toString, 'get __filoFpGuard');
    defP(w, '__filoFpGuard', { __proto__: null, get: g, enumerable: false, configurable: false });
  }
  function prepara(w) {
    try {
      if (gOPD(w, '__filoFpGuard')) return;
      segna(w);
    } catch (e) { return; }
    try { mascheraToString(w); } catch (e) {}
    for (var i = 0; i < parti.length; i++) { try { parti[i](w); } catch (e) {} }
    try { riquadri(w); } catch (e) {}
  }

  function avvolgi(CP, prop, cw) {
    var d = gOPD(CP, prop);
    if (!d || !d.get || !d.configurable) return;
    var orig = d.get;
    defP(CP, prop, {
      __proto__: null,
      get: mask(function () {
        var r = R(orig, this, arguments);
        if (r) { try { prepara(R(cw, this, [])); } catch (e) {} }
        return r;
      }, orig, 'get ' + prop),
      set: d.set, enumerable: d.enumerable, configurable: true,
    });
  }

  function vuoto(el, tag) {
    if (R(haAttr, el, ['srcdoc'])) return false;
    var s = R(leggiAttr, el, [tag === 'OBJECT' ? 'data' : 'src']);
    if (s === null) return true;
    s = R(lower, R(trim, '' + s, []), []);
    return s === '' || s === 'about:blank' || R(taglia, s, [0, 12]) === 'about:blank#'
      || R(taglia, s, [0, 12]) === 'about:blank?' || R(taglia, s, [0, 11]) === 'javascript:';
  }
  function tocca(el) {
    var tag = R(tagName, el, []), g = GETTER[tag];
    if (g && vuoto(el, tag)) prepara(R(g, el, []));
  }
  // Il parser segna un riquadro scritto nell'HTML prima di eseguire lo script che lo segue.
  function osserva(w) {
    var mo = new MO(function (rec) {
      for (var i = 0; i < rec.length; i++) {
        var nodi = rec[i].addedNodes;
        for (var j = 0; j < nodi.length; j++) {
          try {
            var n = nodi[j];
            if (R(nodeType, n, []) !== 1) continue;
            tocca(n);
            var l = R(qsa, n, ['iframe,frame,object']);
            for (var h = 0; h < l.length; h++) tocca(l[h]);
          } catch (e) {}
        }
      }
    });
    R(moObserve, mo, [w.document, { __proto__: null, childList: true, subtree: true }]);
  }

  function riquadri(w) {
    for (var i = 0; i < CORNICI.length; i++) {
      var C = w[CORNICI[i]], CP = C && C.prototype, d = CP && gOPD(CP, 'contentWindow');
      if (!d || !d.get) continue;
      avvolgi(CP, 'contentDocument', d.get);
      avvolgi(CP, 'contentWindow', d.get);
    }
    try { osserva(w); } catch (e) {}
  }

  // Il primo preambolo della stessa origine nella scheda, cercato dalla cima: un canvas annotato da uno si legge con
  // le funzioni dell'altro, e ognuno riconosce come native le funzioni dell'altro. Si legge solo il segno, che la
  // pagina non può aver messo prima del preambolo della sua finestra.
  function unisci() {
    var coda = [window.top], visti = 0;
    while (coda.length && visti++ < 500) {
      var w = coda.shift();
      if (w !== window) {
        try {
          var d = gOPD(w, '__filoFpGuard');
          if (d && !d.configurable && typeof d.get === 'function') { R(d.get, window, []); return; }
        } catch (e) {}
      }
      var n = 0;
      try { n = R(lunghezza, w, []) | 0; } catch (e) {}
      for (var i = 0; i < n; i++) { try { coda.push(w[i]); } catch (e) {} }
    }
  }
  if (window.top !== window) { try { unisci(); } catch (e) {} }
  prepara(window);`;

function buildPreamboloSource({ fp } = {}) {
  const parti = [];
  if (fp && (fp.level | 0) > 0) parti.push(parteFingerprint(fp.seed));
  if (!parti.length) return '';
  return `(function(){
  'use strict';
  // Presi prima degli script della pagina: un riquadro si prepara quando la pagina ha già riscritto ciò che voleva,
  // e da un call o un apply riscritti uscirebbero le copie native. I descrittori senza prototipo non leggono
  // proprietà messe dalla pagina su Object.prototype.
  var R = Reflect.apply, defP = Object.defineProperty, gOPD = Object.getOwnPropertyDescriptor;
  var getProto = Object.getPrototypeOf, setProto = Object.setPrototypeOf, imul = Math.imul, ceil = Math.ceil;
  var WMP = WeakMap.prototype, wmGet = WMP.get, wmSet = WMP.set, wmHas = WMP.has;
  var parti = [];

  // Un sostituto deve somigliare a un nativo anche a chi lo ispeziona: metodo senza prototype né new,
  // nessuna proprietà propria in più, testo nativo anche da Function.prototype.toString.call (#799), e
  // prototipo del nativo che sostituisce, anche quando è di un'altra finestra.
  var masked = new WeakMap();
  function mask(fn, orig, name) {
    var m = fn;
    try {
      m = ({ [name]() { return R(fn, this, arguments); } })[name];
      defP(m, 'length', { __proto__: null, value: orig.length, configurable: true });
      setProto(m, getProto(orig));
      R(wmSet, masked, [m, 'function ' + name + '() { [native code] }']);
    } catch (e) {}
    return m;
  }
  function mascheraToString(w) {
    var FP = w.Function.prototype, o = FP.toString;
    FP.toString = mask(function toString() {
      return (typeof this === 'function' && R(wmGet, masked, [this])) || R(o, this, arguments);
    }, o, 'toString');
  }
${parti.join('\n')}
${PROPAGAZIONE}
})();`;
}

function buildGuardSource(seed, level) {
  return buildPreamboloSource({ fp: { seed, level } });
}

module.exports = { buildGuardSource, buildPreamboloSource };
