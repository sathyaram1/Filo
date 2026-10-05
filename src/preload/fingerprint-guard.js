// Il pezzo «guardia anti-impronta» del preambolo di frame (preload/preambolo-frame.js): rumore deterministico
// su canvas, WebGL e audio della finestra che riceve. Non decide dove montarsi: lo decide il main (seme e
// livello, services/fingerprint.js) e il preambolo (in quali finestre). Prove: tests/fingerprint*.spec.mjs.
//
// `seed` (uint32) viene da HMAC(masterSecret, eTLD+1 + finestra temporale): stesso sito → stesso rumore in
// ogni finestra e a ogni lettura, siti diversi → rumore scorrelato. Il rumore è legato alla posizione assoluta
// del pixel, così un ritaglio letto con getImageData ha lo stesso rumore della lettura intera.
//
// Gli involucri girano DOPO gli script del sito: ogni funzione o getter che usano è preso alla posa e chiamato
// con Reflect.apply, altrimenti la pagina, ridefinendo apply/call o un getter, riavrebbe in mano l'originale.

function buildGuardPiece(seed, level) {
  const s = (seed >>> 0);
  const lvl = level | 0;
  return `(function(){
  var SEED = ${s} >>> 0;
  var LEVEL = ${lvl};
  var rApply = Reflect.apply;
  var gopd = Object.getOwnPropertyDescriptor;
  var defp = Object.defineProperty;
  var TA = Object.getPrototypeOf(Uint8Array.prototype);
  var taTag = gopd(TA, Symbol.toStringTag).get;
  var taLen = gopd(TA, 'length').get;
  var pThen = Promise.prototype.then;

  function ph(x, y) {
    var h = (SEED ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ~10% dei pixel, 1 LSB su R/G/B, mai alpha: invisibile a occhio, cambia l'hash.
  function perturb(data, w, h, ox, oy) {
    if (!data || w <= 0 || h <= 0) return;
    for (var row = 0; row < h; row++) {
      for (var col = 0; col < w; col++) {
        var r = ph(ox + col, oy + row);
        if ((r % 100) < 10) {
          var i = (row * w + col) * 4;
          data[i]     ^= (r & 1);
          data[i + 1] ^= ((r >>> 1) & 1);
          data[i + 2] ^= ((r >>> 2) & 1);
        }
      }
    }
  }

  // Lo slot interno vale per gli array di qualunque finestra, e la pagina non lo ridefinisce: instanceof no.
  function isBytes(a) {
    var t; try { t = rApply(taTag, a, []); } catch (e) { return false; }
    return t === 'Uint8Array' || t === 'Uint8ClampedArray';
  }

  function getter(proto, name) { var d = proto && gopd(proto, name); return d && d.get; }

  return function guardiaImpronta(win, maschera) {
    if (!LEVEL || win.__filoFpGuard) return;
    // Non cancellabile: una seconda guardia sopra la prima annullerebbe il rumore (XOR due volte).
    try { defp(win, '__filoFpGuard', { value: true, enumerable: false, configurable: false, writable: false }); } catch (e) {}

    // ---- Canvas 2D ----
    try {
      var CtxProto = (win.CanvasRenderingContext2D || {}).prototype;
      var CanProto = (win.HTMLCanvasElement || {}).prototype;
      var IDProto = (win.ImageData || {}).prototype;
      var ImgData = win.ImageData || ImageData;
      var Bytes = win.Uint8ClampedArray || Uint8ClampedArray;
      if (CtxProto && CanProto && IDProto && CtxProto.getImageData) {
        var oGet = CtxProto.getImageData;
        var oPut = CtxProto.putImageData;
        var oToData = CanProto.toDataURL;
        var oToBlob = CanProto.toBlob;
        var oCtx = CanProto.getContext;
        var gW = getter(CanProto, 'width'), gH = getter(CanProto, 'height');
        var gData = getter(IDProto, 'data'), gIW = getter(IDProto, 'width'), gIH = getter(IDProto, 'height');

        var newGet = function getImageData(sx, sy) {
          var img = rApply(oGet, this, arguments);
          try { perturb(rApply(gData, img, []), rApply(gIW, img, []), rApply(gIH, img, []), sx | 0, sy | 0); } catch (e) {}
          return img;
        };
        CtxProto.getImageData = maschera(newGet, oGet, 'getImageData');

        // toDataURL/toBlob: si perturbano i pixel veri un istante e si rimettono subito (sincrono, niente
        // paint nel mezzo). Sempre gli originali oGet/oPut, per non sommare il rumore a se stesso.
        var snapshotPerturb = function (canvas) {
          var ctx = null;
          try { ctx = rApply(oCtx, canvas, ['2d']); } catch (e) {}
          if (!ctx) return null; // canvas WebGL: niente contesto 2d -> salta
          var w = rApply(gW, canvas, []) | 0, h = rApply(gH, canvas, []) | 0;
          if (w <= 0 || h <= 0 || (w * h) > 8000000) return null;
          var orig;
          try { orig = rApply(oGet, ctx, [0, 0, w, h]); } catch (e) { return null; }
          var copy = new ImgData(new Bytes(rApply(gData, orig, [])), w, h);
          perturb(rApply(gData, copy, []), w, h, 0, 0);
          try { rApply(oPut, ctx, [copy, 0, 0]); } catch (e) { return null; }
          return { ctx: ctx, orig: orig };
        };
        var restore = function (snap) { if (snap) { try { rApply(oPut, snap.ctx, [snap.orig, 0, 0]); } catch (e) {} } };

        var newToData = function toDataURL() {
          var snap = snapshotPerturb(this);
          try { return rApply(oToData, this, arguments); }
          finally { restore(snap); }
        };
        CanProto.toDataURL = maschera(newToData, oToData, 'toDataURL');

        if (oToBlob) {
          var newToBlob = function toBlob(cb) {
            var snap = snapshotPerturb(this);
            var args = [];
            for (var i = 0; i < arguments.length; i++) args[i] = arguments[i];
            if (typeof cb === 'function') {
              args[0] = function (blob) { restore(snap); try { cb(blob); } catch (e) {} };
              try { return rApply(oToBlob, this, args); }
              catch (e) { restore(snap); throw e; }
            }
            try { return rApply(oToBlob, this, args); }
            finally { restore(snap); }
          };
          CanProto.toBlob = maschera(newToBlob, oToBlob, 'toBlob');
        }
      }
    } catch (e) {}

    // ---- WebGL readPixels ----
    try {
      var patchGL = function (proto) {
        if (!proto || !proto.readPixels) return;
        var oRead = proto.readPixels;
        var nf = function readPixels(x, y, width, height, format, type, pixels) {
          rApply(oRead, this, arguments);
          try { if (isBytes(pixels)) perturb(pixels, width | 0, height | 0, x | 0, y | 0); } catch (e) {}
        };
        proto.readPixels = maschera(nf, oRead, 'readPixels');
      };
      patchGL((win.WebGLRenderingContext || {}).prototype);
      patchGL((win.WebGL2RenderingContext || {}).prototype);
    } catch (e) {}

    // ---- AudioContext (OfflineAudioContext.startRendering) ----
    try {
      var OAC = win.OfflineAudioContext || win.webkitOfflineAudioContext;
      var ABProto = (win.AudioBuffer || {}).prototype;
      if (OAC && OAC.prototype && OAC.prototype.startRendering && ABProto) {
        var oStart = OAC.prototype.startRendering;
        var oChannel = ABProto.getChannelData;
        var gChannels = getter(ABProto, 'numberOfChannels');
        var rumore = function (buf) {
          try {
            var n = rApply(gChannels, buf, []);
            for (var ch = 0; ch < n; ch++) {
              var d = rApply(oChannel, buf, [ch]);
              var len = rApply(taLen, d, []);
              for (var i = 0; i < len; i++) {
                d[i] += ((ph(i, ch) / 4294967295) - 0.5) * 1e-7;
              }
            }
          } catch (e) {}
          return buf;
        };
        var nf2 = function startRendering() {
          var p = rApply(oStart, this, arguments);
          try { return rApply(pThen, p, [rumore]); } catch (e) { return p; }
        };
        OAC.prototype.startRendering = maschera(nf2, oStart, 'startRendering');
      }
    } catch (e) {}
  };
})()`;
}

module.exports = { buildGuardPiece };
