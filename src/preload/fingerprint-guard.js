// Costruisce il sorgente JS (stringa) della "guardia anti-fingerprint" da
// iniettare nel MAIN WORLD di una pagina web esterna.
//
// Gira PRIMA degli script della pagina (lo inietta page-preload.js via
// webFrame.executeJavaScript, che valuta nel main world e ignora la CSP),
// quindi gli override dei prototipi sono in piedi prima di qualsiasi lettura di
// canvas/audio/webgl da parte di uno script di fingerprinting.
//
// `seed` (uint32) è derivato in main da HMAC(masterSecret, eTLD+1 + finestra
// temporale): stesso sito → stesso rumore (nessun flicker tra letture diverse),
// siti diversi → rumore scorrelato. Il rumore è legato alla posizione assoluta
// del pixel, così una lettura parziale (getImageData su un ritaglio) ottiene lo
// stesso rumore della lettura intera.
//
// `level` 1/2 serve solo a sapere se siamo accesi: la rotazione (settimanale vs
// per-sessione) è già codificata nel seed a monte.

function buildGuardSource(seed, level) {
  const s = (seed >>> 0);
  const lvl = level | 0;
  return `(function(){
  'use strict';
  if (window.__filoFpGuard) return;
  var SEED = ${s} >>> 0;
  var LEVEL = ${lvl};
  if (!LEVEL) return;
  try { Object.defineProperty(window, '__filoFpGuard', { value: true, enumerable: false, configurable: true }); } catch(e) {}

  // Hash deterministico per pixel (SEED, x, y) -> uint32.
  function ph(x, y) {
    var h = (SEED ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Perturba ~10% dei pixel flippando 1 LSB su R/G/B (mai alpha). Rumore legato
  // alla posizione assoluta (ox+col, oy+row): identico tra lettura intera e
  // ritaglio. Impercettibile a occhio (1 LSB su 255), cambia l'hash.
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

  // Maschera l'override così uno script che ispeziona fn.toString() vede ancora
  // "function name() { [native code] }".
  function mask(fn, orig, name) {
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      Object.defineProperty(fn, 'length', { value: orig.length, configurable: true });
      var ts = function toString() { return 'function ' + name + '() { [native code] }'; };
      Object.defineProperty(ts, 'name', { value: 'toString', configurable: true });
      Object.defineProperty(fn, 'toString', { value: ts, configurable: true, writable: true });
    } catch (e) {}
    return fn;
  }

  // ---- Canvas 2D ----
  try {
    var CtxProto = (window.CanvasRenderingContext2D || {}).prototype;
    var CanProto = (window.HTMLCanvasElement || {}).prototype;
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
      CtxProto.getImageData = mask(newGet, oGet, 'getImageData');

      // Per toDataURL/toBlob perturbiamo i pixel veri un istante, leggiamo, e
      // ripristiniamo subito: è sincrono, niente paint nel mezzo, niente
      // flicker. Usiamo SEMPRE gli originali oGet/oPut per non auto-rumoreggiare.
      function snapshotPerturb(canvas) {
        var ctx = null;
        try { ctx = canvas.getContext('2d'); } catch (e) {}
        if (!ctx) return null; // canvas WebGL: niente contesto 2d -> salta
        var w = canvas.width | 0, h = canvas.height | 0;
        if (w <= 0 || h <= 0 || (w * h) > 8000000) return null;
        var orig;
        try { orig = oGet.call(ctx, 0, 0, w, h); } catch (e) { return null; }
        var copy = new ImageData(new Uint8ClampedArray(orig.data), w, h);
        perturb(copy.data, w, h, 0, 0);
        try { oPut.call(ctx, copy, 0, 0); } catch (e) { return null; }
        return { ctx: ctx, orig: orig };
      }
      function restore(snap) { if (snap) { try { oPut.call(snap.ctx, snap.orig, 0, 0); } catch (e) {} } }

      var newToData = function toDataURL() {
        var snap = snapshotPerturb(this);
        try { return oToData.apply(this, arguments); }
        finally { restore(snap); }
      };
      CanProto.toDataURL = mask(newToData, oToData, 'toDataURL');

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
        CanProto.toBlob = mask(newToBlob, oToBlob, 'toBlob');
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
        try {
          if (pixels && pixels.length && (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
            perturb(pixels, width | 0, height | 0, x | 0, y | 0);
          }
        } catch (e) {}
      };
      proto.readPixels = mask(nf, oRead, 'readPixels');
    };
    patchGL((window.WebGLRenderingContext || {}).prototype);
    patchGL((window.WebGL2RenderingContext || {}).prototype);
  } catch (e) {}

  // ---- AudioContext (OfflineAudioContext.startRendering) ----
  try {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
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
      OAC.prototype.startRendering = mask(nf2, oStart, 'startRendering');
    }
  } catch (e) {}
})();`;
}

module.exports = { buildGuardSource };
