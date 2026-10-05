// Il pezzo «guardia anti-impronta» del preambolo di frame (preload/preambolo-frame.js): rumore deterministico
// su canvas, WebGL e audio della finestra che riceve. Non decide dove montarsi: lo decide il main (seme e
// livello, services/fingerprint.js) e il preambolo (in quali finestre). Prove: tests/fingerprint*.spec.mjs.
//
// `seed` (uint32) viene da HMAC(masterSecret, eTLD+1 + finestra temporale): stesso sito → stesso rumore in
// ogni finestra e a ogni lettura, siti diversi → rumore scorrelato. Il rumore è legato alla posizione assoluta
// del pixel, così un ritaglio letto con getImageData ha lo stesso rumore della lettura intera.

function buildGuardPiece(seed, level) {
  const s = (seed >>> 0);
  const lvl = level | 0;
  return `(function(){
  var SEED = ${s} >>> 0;
  var LEVEL = ${lvl};

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

  // Il nome del tipo letto dallo slot interno vale per gli array di qualunque finestra: instanceof no.
  var tagArray = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get;
  function isBytes(a) {
    var t; try { t = tagArray.call(a); } catch (e) { return false; }
    return t === 'Uint8Array' || t === 'Uint8ClampedArray';
  }

  return function guardiaImpronta(win, maschera) {
    if (!LEVEL || win.__filoFpGuard) return;
    // Non cancellabile: una seconda guardia sopra la prima annullerebbe il rumore (XOR due volte).
    try { Object.defineProperty(win, '__filoFpGuard', { value: true, enumerable: false, configurable: false, writable: false }); } catch (e) {}

    // ---- Canvas 2D ----
    try {
      var CtxProto = (win.CanvasRenderingContext2D || {}).prototype;
      var CanProto = (win.HTMLCanvasElement || {}).prototype;
      var ImgData = win.ImageData;
      var Bytes = win.Uint8ClampedArray;
      if (CtxProto && CanProto && CtxProto.getImageData) {
        var oGet = CtxProto.getImageData;
        var oPut = CtxProto.putImageData;
        var oToData = CanProto.toDataURL;
        var oToBlob = CanProto.toBlob;

        var newGet = function getImageData(sx, sy) {
          var img = oGet.apply(this, arguments);
          try { perturb(img.data, img.width, img.height, sx | 0, sy | 0); } catch (e) {}
          return img;
        };
        CtxProto.getImageData = maschera(newGet, oGet, 'getImageData');

        // toDataURL/toBlob: si perturbano i pixel veri un istante e si rimettono subito (sincrono, niente
        // paint nel mezzo). Sempre gli originali oGet/oPut, per non sommare il rumore a se stesso.
        var snapshotPerturb = function (canvas) {
          var ctx = null;
          try { ctx = canvas.getContext('2d'); } catch (e) {}
          if (!ctx) return null; // canvas WebGL: niente contesto 2d -> salta
          var w = canvas.width | 0, h = canvas.height | 0;
          if (w <= 0 || h <= 0 || (w * h) > 8000000) return null;
          var orig;
          try { orig = oGet.call(ctx, 0, 0, w, h); } catch (e) { return null; }
          var copy = new ImgData(new Bytes(orig.data), w, h);
          perturb(copy.data, w, h, 0, 0);
          try { oPut.call(ctx, copy, 0, 0); } catch (e) { return null; }
          return { ctx: ctx, orig: orig };
        };
        var restore = function (snap) { if (snap) { try { oPut.call(snap.ctx, snap.orig, 0, 0); } catch (e) {} } };

        var newToData = function toDataURL() {
          var snap = snapshotPerturb(this);
          try { return oToData.apply(this, arguments); }
          finally { restore(snap); }
        };
        CanProto.toDataURL = maschera(newToData, oToData, 'toDataURL');

        if (oToBlob) {
          var newToBlob = function toBlob(cb) {
            var snap = snapshotPerturb(this);
            var args = Array.prototype.slice.call(arguments);
            if (typeof cb === 'function') {
              args[0] = function (blob) { restore(snap); try { cb(blob); } catch (e) {} };
              try { return oToBlob.apply(this, args); }
              catch (e) { restore(snap); throw e; }
            }
            try { return oToBlob.apply(this, args); }
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
          oRead.apply(this, arguments);
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
      if (OAC && OAC.prototype && OAC.prototype.startRendering) {
        var oStart = OAC.prototype.startRendering;
        var nf2 = function startRendering() {
          var p = oStart.apply(this, arguments);
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
        OAC.prototype.startRendering = maschera(nf2, oStart, 'startRendering');
      }
    } catch (e) {}
  };
})()`;
}

module.exports = { buildGuardPiece };
