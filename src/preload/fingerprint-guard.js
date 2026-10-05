// Sorgente della guardia anti-fingerprint, iniettata dal page-preload nel main world prima degli
// script della pagina. Non legge mai il master secret: riceve solo il seed per sito (HMAC in main).
// Il rumore è legato alla posizione del pixel nell'immagine: stesso pixel, stesso rumore, da ogni porta.

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

  function ph(x, y) {
    var h = (SEED ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
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

  // ---- Canvas (elemento e OffscreenCanvas) ----
  // Il contesto di un canvas si annota quando la pagina lo crea: chiederlo alla guardia con
  // getContext('2d') ne creerebbe uno, e il canvas non potrebbe più diventare WebGL.
  var ctxOf = new WeakMap();
  var MAXPX = 8000000;

  function track(proto) {
    var o = proto && proto.getContext;
    if (!o) return null;
    proto.getContext = mask(function getContext() {
      var ctx = o.apply(this, arguments);
      if (ctx && !ctxOf.has(this)) ctxOf.set(this, ctx);
      return ctx;
    }, o, 'getContext');
    return o;
  }

  function patchGet(proto) {
    var o = proto && proto.getImageData;
    if (!o) return null;
    proto.getImageData = mask(function getImageData(sx, sy, sw, sh) {
      var img = o.apply(this, arguments);
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
    var ctx = ctxOf.get(src);
    if (!ctx || !F) return null;
    var w = src.width | 0, h = src.height | 0;
    if (w <= 0 || h <= 0 || (w * h) > MAXPX) return null;
    var img = null, cs;
    try { img = F.get.call(ctx, 0, 0, w, h); cs = img.colorSpace; }
    catch (e) { img = null; try { cs = ctx.drawingBufferColorSpace; } catch (e2) {} }
    var tmp = F.make(w, h);
    var t = F.getCtx.call(tmp, '2d', { colorSpace: cs || 'srgb', willReadFrequently: true });
    if (!img) { F.draw.call(t, src, 0, 0); img = F.get.call(t, 0, 0, w, h); }
    perturb(img.data, w, h, 0, 0);
    F.put.call(t, img, 0, 0);
    return tmp;
  }
  function copyOrNull(src, F) { try { return noisyCopy(src, F); } catch (e) { return null; } }

  try {
    var oCreate = Document.prototype.createElement;
    var HTML = family(window.HTMLCanvasElement, window.CanvasRenderingContext2D, function (w, h) {
      var c = oCreate.call(document, 'canvas'); c.width = w; c.height = h; return c;
    });
    var CanProto = HTML && window.HTMLCanvasElement.prototype;
    if (CanProto && CanProto.toDataURL) {
      var oToData = CanProto.toDataURL;
      CanProto.toDataURL = mask(function toDataURL() {
        return oToData.apply(copyOrNull(this, HTML) || this, arguments);
      }, oToData, 'toDataURL');
    }
    if (CanProto && CanProto.toBlob) {
      var oToBlob = CanProto.toBlob;
      CanProto.toBlob = mask(function toBlob(cb) {
        var tmp = typeof cb === 'function' ? copyOrNull(this, HTML) : null;
        return oToBlob.apply(tmp || this, arguments);
      }, oToBlob, 'toBlob');
    }
  } catch (e) {}

  try {
    var OC = window.OffscreenCanvas;
    var OFF = family(OC, window.OffscreenCanvasRenderingContext2D, function (w, h) { return new OC(w, h); });
    var OffProto = OFF && OC.prototype;
    if (OffProto && OffProto.convertToBlob) {
      var oConvert = OffProto.convertToBlob;
      OffProto.convertToBlob = mask(function convertToBlob() {
        return oConvert.apply(copyOrNull(this, OFF) || this, arguments);
      }, oConvert, 'convertToBlob');
    }
  } catch (e) {}

  // ---- WebGL readPixels ----
  // Righe e posizioni come le vede toDataURL dello stesso canvas: le due letture devono coincidere.
  try {
    var patchGL = function (proto, gl2) {
      if (!proto || !proto.readPixels) return;
      var oRead = proto.readPixels, oParam = proto.getParameter;
      var dbh = Object.getOwnPropertyDescriptor(proto, 'drawingBufferHeight');
      var dbhGet = dbh && dbh.get;
      var nf = function readPixels(x, y, width, height, format, type, pixels, dstOffset) {
        oRead.apply(this, arguments);
        try {
          if (format !== 0x1908 || type !== 0x1401) return;
          if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) return;
          var w = width | 0, h = height | 0;
          var align = (oParam.call(this, 0x0D05) | 0) || 4;
          var rowLen = 0, skipR = 0, skipP = 0;
          if (gl2) {
            rowLen = oParam.call(this, 0x0D02) | 0;
            skipR = oParam.call(this, 0x0D03) | 0;
            skipP = oParam.call(this, 0x0D04) | 0;
          }
          var stride = Math.ceil((rowLen > 0 ? rowLen : w) * 4 / align) * align;
          var base = (gl2 ? (dstOffset | 0) : 0) + skipR * stride + skipP * 4;
          var H = dbhGet ? (dbhGet.call(this) | 0) : 0;
          perturb(pixels, w, h, x | 0, H - 1 - (y | 0), base, stride, -1);
        } catch (e) {}
      };
      proto.readPixels = mask(nf, oRead, 'readPixels');
    };
    patchGL((window.WebGLRenderingContext || {}).prototype, false);
    patchGL((window.WebGL2RenderingContext || {}).prototype, true);
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
