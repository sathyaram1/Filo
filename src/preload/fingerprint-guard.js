// Sorgente del preambolo che il page-preload inietta nel main world prima degli script della pagina: oggi la guardia
// anti-fingerprint, una parte fra quelle che il preambolo porta in ogni finestra della stessa origine (#798; #753 ci
// aggiunge GPC). Non legge mai il master secret: riceve solo il seed per sito (HMAC in main).

// La guardia: rumore legato alla posizione del pixel nell'immagine, stesso pixel stesso rumore da ogni porta.
// La parte che aggiunge a `parti` la monta nella finestra che riceve, sulle copie native di quella finestra.
function parteFingerprint(seed) {
  return `
  var SEED = ${seed >>> 0} >>> 0;

  // Dimensioni, pixel e canali si leggono coi getter nativi presi all'avvio: una proprietà riscritta dalla pagina
  // per un istante (larghezza 0, canali 0) farebbe saltare il rumore. I getter valgono anche sugli oggetti dei riquadri.
  function gget(P, n) { var d = P && gOPD(P, n); return d && d.get; }
  var idP = typeof ImageData === 'function' && ImageData.prototype;
  var idData = gget(idP, 'data'), idW = gget(idP, 'width'), idH = gget(idP, 'height'), idCS = gget(idP, 'colorSpace');
  var taLen = gget(getProto(Uint8Array.prototype), 'length'), pThen = Promise.prototype.then;
  var abP = typeof AudioBuffer === 'function' && AudioBuffer.prototype;
  var abCh = gget(abP, 'numberOfChannels'), abData = abP && abP.getChannelData;

  // Gli argomenti numerici si convertono una volta sola, prima del nativo: un valueOf che risponde diverso alla
  // seconda lettura darebbe alla guardia un'altra regione. Senza prototipo: nessun setter della pagina sugli indici.
  function numeri(args, quali) {
    var a = { __proto__: null, length: args.length };
    for (var i = 0; i < args.length; i++) a[i] = quali[i] ? +args[i] : args[i];
    return a;
  }

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
    if (R(taLen, data, []) < base + (h - 1) * stride + w * 4) return;
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
    var Q = [1, 1, 1, 1];
    proto.getImageData = mask(function getImageData(sx, sy, sw, sh) {
      var a = numeri(arguments, Q);
      var img = R(o, this, a);
      try {
        var x0 = (a[0] | 0) + ((a[2] | 0) < 0 ? (a[2] | 0) : 0);
        var y0 = (a[1] | 0) + ((a[3] | 0) < 0 ? (a[3] | 0) : 0);
        perturb(R(idData, img, []), R(idW, img, []), R(idH, img, []), x0, y0);
      } catch (e) {}
      return img;
    }, o, 'getImageData');
    return o;
  }

  function family(CanvasCtor, CtxCtor, make) {
    var cp = CanvasCtor && CanvasCtor.prototype, xp = CtxCtor && CtxCtor.prototype;
    if (!cp || !xp || !xp.getImageData) return null;
    var F = { __proto__: null, put: xp.putImageData, draw: xp.drawImage, make: make, getCtx: track(cp), get: patchGet(xp),
      w: gget(cp, 'width'), h: gget(cp, 'height') };
    return F.getCtx && F.w && F.h ? F : null;
  }

  // Si esporta una copia rumorosa, mai il canvas della pagina: i suoi pixel non cambiano nemmeno per
  // un istante, e toBlob/convertToBlob, che finiscono dopo, non ripristinano sopra un disegno nuovo.
  // Senza contesto il canvas è vuoto, uguale per tutti: null, e si esporta com'è.
  function noisyCopy(src, F) {
    var ctx = R(wmGet, ctxOf, [src]);
    if (!ctx || !F) return null;
    var W = R(F.w, src, []) | 0, H = R(F.h, src, []) | 0;
    if (W <= 0 || H <= 0 || (W * H) > MAXPX) return null;
    var img = null, cs;
    try { img = R(F.get, ctx, [0, 0, W, H]); cs = idCS ? R(idCS, img, []) : undefined; }
    catch (e) { img = null; try { cs = ctx.drawingBufferColorSpace; } catch (e2) {} }
    var tmp = F.make(W, H);
    var t = R(F.getCtx, tmp, ['2d', { __proto__: null, colorSpace: cs || 'srgb', willReadFrequently: true }]);
    if (!img) { R(F.draw, t, [src, 0, 0]); img = R(F.get, t, [0, 0, W, H]); }
    perturb(R(idData, img, []), W, H, 0, 0);
    R(F.put, t, [img, 0, 0]);
    return tmp;
  }
  function copyOrNull(src, F) { try { return noisyCopy(src, F); } catch (e) { return null; } }

  // La copia nasce nel documento della finestra a cui appartiene la funzione: il Blob che ne esce è suo. Col namespace
  // esplicito: in un documento XML o SVG createElement('canvas') non dà un canvas, e la copia fallirebbe in silenzio.
  function canvasHtml(w) {
    var oCreate = w.Document.prototype.createElementNS, CP = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype;
    var dw = CP && gOPD(CP, 'width'), dh = CP && gOPD(CP, 'height');
    var F = dw && dh && family(w.HTMLCanvasElement, w.CanvasRenderingContext2D, function (W, H) {
      var c = R(oCreate, w.document, ['http://www.w3.org/1999/xhtml', 'canvas']);
      R(dw.set, c, [W]); R(dh.set, c, [H]); return c;
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
    var Q = [1, 1, 1, 1, 1, 1, 0, gl2 ? 1 : 0];
    var nf = function readPixels(x, y, width, height, format, type, pixels, dstOffset) {
      var a = numeri(arguments, Q);
      R(oRead, this, a);
      try {
        x = a[0]; y = a[1]; format = a[4]; type = a[5]; pixels = a[6]; dstOffset = a[7];
        if (format !== 0x1908 || type !== 0x1401) return;
        var tipo = R(tagTA, pixels, []);
        if (tipo !== 'Uint8Array' && tipo !== 'Uint8ClampedArray') return;
        var w = a[2] | 0, h = a[3] | 0;
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
  // Lo stesso buffer arriva dall'evento complete, i cui gestori girano prima di ogni .then della
  // promessa: il rumore lo mette chi lo tocca per primo, una volta sola (sommato due volte, evento
  // e promessa darebbero impronte diverse). Solo da un evento vero: un buffer della pagina non si tocca.
  // Un insieme per tutte le finestre: lo stesso buffer può passare da quelle di due riquadri.
  var WSA = WeakSet.prototype, waHas = WSA.has, waAdd = WSA.add, rumoreAudio = new WeakSet();
  function noiseAudio(buf) {
    if (!buf || R(waHas, rumoreAudio, [buf])) return;
    R(waAdd, rumoreAudio, [buf]);
    try {
      for (var ch = 0, n = R(abCh, buf, []); ch < n; ch++) {
        var d = R(abData, buf, [ch]);
        for (var i = 0, L = R(taLen, d, []); i < L; i++) {
          d[i] += ((ph(i, ch) / 4294967295) - 0.5) * 1e-7;
        }
      }
    } catch (e) {}
  }
  function audio(w) {
    var OAC = w.OfflineAudioContext || w.webkitOfflineAudioContext;
    if (OAC && OAC.prototype && OAC.prototype.startRendering) {
      var oStart = OAC.prototype.startRendering;
      var nf = function startRendering() {
        // Il then preso all'avvio: uno riscritto dalla pagina per un istante restituirebbe il buffer pulito.
        var p = R(oStart, this, arguments);
        return p ? R(pThen, p, [function (buf) { noiseAudio(buf); return buf; }]) : p;
      };
      OAC.prototype.startRendering = mask(nf, oStart, 'startRendering');
    }
    var OACE = w.OfflineAudioCompletionEvent && w.OfflineAudioCompletionEvent.prototype;
    var dRB = OACE && gOPD(OACE, 'renderedBuffer');
    if (dRB && dRB.get && dRB.configurable) {
      var oRB = dRB.get;
      defP(OACE, 'renderedBuffer', {
        __proto__: null,
        get: mask(function () {
          var buf = R(oRB, this, []);
          if (this.isTrusted === true) noiseAudio(buf);
          return buf;
        }, oRB, 'get renderedBuffer'),
        set: dRB.set, enumerable: dRB.enumerable, configurable: true,
      });
    }
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
// funzioni le troverebbe intatte. Il preambolo si monta in ogni finestra vuota della pagina prima che la pagina la
// raggiunga: dall'elemento sempre, per indice o per nome appena il riquadro entra nel documento (anche da uno script)
// o vi carica una pagina vuota.
// Un riquadro che carica un documento della stessa origine non si tocca prima: il documento erediterebbe la finestra
// senza il preload. Nessun segno sulla finestra: un sito vedrebbe chi usa Filo (regole e porte rimaste:
// patterns/riquadri-incorporati-iframe-filo-gira-anche-li.md).
const PROPAGAZIONE = `
  var CORNICI = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'];
  var TAG = { __proto__: null, IFRAME: 1, FRAME: 1, OBJECT: 1, EMBED: 1 };
  var NP = Node.prototype, EP = Element.prototype, leggiAttr = EP.getAttribute, haAttr = EP.hasAttribute;
  var qsaE = EP.querySelectorAll, qsaF = DocumentFragment.prototype.querySelectorAll, qsaD = Document.prototype.querySelectorAll;
  var localName = gOPD(EP, 'localName').get, nodeType = gOPD(NP, 'nodeType').get, genitore = gOPD(NP, 'parentNode').get;
  var docDi = gOPD(NP, 'ownerDocument').get, baseDi = gOPD(NP, 'baseURI').get, quanti = gOPD(NodeList.prototype, 'length').get;
  var primoFiglio = gOPD(EP, 'firstElementChild').get;
  var SP = String.prototype, trim = SP.trim, lower = SP.toLowerCase, upper = SP.toUpperCase, taglia = SP.slice, cerca = SP.indexOf;
  var URLc = URL, origineUrl = gOPD(URL.prototype, 'origin').get, costruisci = Reflect.construct;
  var MO = MutationObserver, moObserve = MO.prototype.observe;
  var addEL = EventTarget.prototype.addEventListener, bersaglio = gOPD(Event.prototype, 'target').get;
  var annulla = Event.prototype.preventDefault, proprio = Object.prototype.hasOwnProperty;
  var WSP = WeakSet.prototype, wsHas = WSP.has, wsAdd = WSP.add, preparate = new WeakSet(), conPreload = new WeakSet();
  var dW = function (n) { return gOPD(window, n) || gOPD(Window.prototype, n) || {}; };
  var cornice = dW('frameElement').get, quanteF = dW('length').get;
  var vista = gOPD(Document.prototype, 'defaultView').get, misura = gOPD(HTMLElement.prototype, 'offsetWidth').get;
  // Dal nome locale: in un documento XML o SVG tagName resta minuscolo (o col prefisso) e il riquadro sfuggirebbe.
  function tagName(el) { return R(upper, '' + R(localName, el, []), []); }
  var GETTER = { __proto__: null };
  for (var k = 0; k < CORNICI.length; k++) {
    var CC = window[CORNICI[k]], dcw = CC && gOPD(CC.prototype, 'contentWindow');
    if (dcw && dcw.get) GETTER[k === 0 ? 'IFRAME' : k === 1 ? 'FRAME' : 'OBJECT'] = dcw.get;
  }

  // Si segna il mondo JS del documento, non la finestra: l'elemento dà la stessa finestra a ogni documento che vi
  // carica, e ognuno arriva con copie native nuove. Il prototipo di location non lo cambia la pagina.
  function regno(w) { try { return getProto(w.location); } catch (e) { return null; } }
  function preparata(w) { var r = regno(w); return !!r && R(wsHas, preparate, [r]); }

  // Una finestra con un documento suo ha già il preambolo dal suo preload: un secondo annullerebbe il rumore.
  // La forza la passa solo chi lo chiede per sé (questa finestra, un riquadro che si unisce).
  function prepara(w, forza) {
    try {
      var r = w && regno(w);
      if (!r || R(wsHas, preparate, [r])) return;
      if (!forza && R(taglia, '' + w.location.href, [0, 11]) !== 'about:blank') return;
      R(wsAdd, preparate, [r]);
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

  // Un embed non dà la sua finestra: nasce al primo calcolo della disposizione, e la si cerca fra quelle della pagina.
  function finestraDi(el, tag) {
    var g = GETTER[tag];
    if (g) return R(g, el, []);
    if (tag !== 'EMBED' || !cornice || !quanteF) return null;
    var cerca = function () {
      var v = R(vista, R(docDi, el, []), []);
      for (var i = 0, n = R(quanteF, v, []) | 0; i < n; i++) {
        var cw = v[i];
        try { if (R(cornice, cw, []) === el) return cw; } catch (e) {}
      }
      return null;
    };
    try { return cerca() || (R(misura, el, []), cerca()); } catch (e) { return null; }
  }

  // Si tocca in anticipo un riquadro che resterà la finestra vuota della pagina, o che andrà su un'altra origine e
  // avrà una finestra nuova; mai uno che carica un documento della stessa origine.
  function anticipabile(el, tag) {
    if (R(haAttr, el, ['srcdoc'])) return false;
    var s = R(leggiAttr, el, [tag === 'OBJECT' ? 'data' : 'src']);
    if (s === null) return true;
    s = R(lower, R(trim, '' + s, []), []);
    if (s === '' || R(taglia, s, [0, 11]) === 'about:blank' || R(taglia, s, [0, 11]) === 'javascript:') return true;
    try {
      return R(origineUrl, costruisci(URLc, [s, R(baseDi, el, [])]), []) !== R(docDi, el, []).location.origin;
    } catch (e) { return false; }
  }
  // In Automatico un riquadro della stessa origine lento o muto resta scoperto per indice: coprirlo spegne Filo lì
  // dentro se il documento arriva dopo. In Privacy massima, dopo qualche secondo ancora vuoto, si copre (decisione owner).
  var ATTESA_VUOTO = 3000, attesi = new WeakSet();
  function tocca(el) {
    var tag = tagName(el);
    if (!TAG[tag]) return;
    if (anticipabile(el, tag)) { prepara(finestraDi(el, tag)); return; }
    if (LIVELLO < 2 || R(wsHas, attesi, [el])) return;
    R(wsAdd, attesi, [el]);
    R(aspetta, window, [function () { try { prepara(finestraDi(el, tag)); } catch (e) {} }, ATTESA_VUOTO]);
  }
  var SEL = 'iframe,frame,object,embed';
  function cornici(n, fa) {
    var t = R(nodeType, n, []), l = null;
    if (t === 1) {
      if (TAG[tagName(n)]) fa(n);
      if (R(primoFiglio, n, [])) l = R(qsaE, n, [SEL]);
    } else if (t === 11) l = R(qsaF, n, [SEL]);
    else if (t === 9) l = R(qsaD, n, [SEL]);
    if (l) for (var i = 0, m = R(quanti, l, []); i < m; i++) fa(l[i]);
  }

  // Un riquadro che torna vuoto (src about:blank, location cambiata da dentro) ha un documento nuovo senza preload:
  // si prepara al suo load, che arriva al documento che lo contiene e mai alla sua finestra.
  function alCarico(w) {
    R(ascoltoDi(w), w.document, ['load', function (e) {
      try { var el = R(bersaglio, e, []), tag = tagName(el); if (TAG[tag]) prepara(finestraDi(el, tag)); } catch (x) {}
    }, true]);
  }

  // Il parser segna un riquadro scritto nell'HTML prima di eseguire lo script che lo segue.
  function osserva(w) {
    var mo = new MO(function (rec) {
      for (var i = 0; i < rec.length; i++) {
        var nodi = rec[i].addedNodes;
        for (var j = 0; j < nodi.length; j++) { try { cornici(nodi[j], tocca); } catch (e) {} }
      }
    });
    R(moObserve, mo, [w.document, { __proto__: null, childList: true, subtree: true }]);
  }

  // Uno script che inserisce un riquadro lo legge per indice nella riga dopo, prima dell'osservatore: le funzioni che
  // inseriscono lo segnano subito. I riquadri di un frammento si contano prima, dopo il frammento è vuoto.
  function raccogli(args) {
    var out = { __proto__: null, n: 0 };
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === null || typeof a !== 'object') continue;
      try { cornici(a, function (el) { out[out.n++] = el; }); } catch (e) {}
    }
    return out;
  }
  function conNodi(P, nome) {
    var d = P && gOPD(P, nome), orig = d && R(proprio, d, ['value']) ? d.value : null;
    if (typeof orig !== 'function') return;
    P[nome] = mask(function () {
      var c = raccogli(arguments);
      var r = R(orig, this, arguments);
      for (var i = 0; i < c.n; i++) { try { tocca(c[i]); } catch (e) {} }
      return r;
    }, orig, nome);
  }
  function conCornici(args) {
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') {
        var s = R(lower, a, []);
        if (R(cerca, s, ['frame']) >= 0 || R(cerca, s, ['object']) >= 0) return true;
      } else if (a !== null && typeof a === 'object') return true;
    }
    return false;
  }
  function conTesto(P, nome, dove) {
    var d = P && gOPD(P, nome);
    if (!d) return;
    var dopo = function (c, args) { if (c && conCornici(args)) { try { cornici(c, tocca); } catch (e) {} } };
    if (R(proprio, d, ['value'])) {
      var orig = d.value;
      if (typeof orig !== 'function') return;
      P[nome] = mask(function () {
        var c = dove(this), r = R(orig, this, arguments);
        dopo(c, arguments);
        return r;
      }, orig, nome);
    } else if (d.set && d.configurable) {
      var os = d.set;
      defP(P, nome, {
        __proto__: null, get: d.get, enumerable: d.enumerable, configurable: true,
        set: mask(function () { var c = dove(this); R(os, this, arguments); dopo(c, arguments); }, os, 'set ' + nome),
      });
    }
  }
  function se(t) { return t; }
  function suo(t) { try { return R(genitore, t, []); } catch (e) { return null; } }
  function suoOSe(t) { return suo(t) || t; }
  function inserimenti(w) {
    var p = function (n) { var C = w[n]; return C && C.prototype; };
    var N = p('Node'), E = p('Element'), F = p('DocumentFragment'), D = p('Document'), C = p('CharacterData');
    var T = p('DocumentType'), G = p('Range'), S = p('ShadowRoot');
    var nodi = [[N, 'appendChild'], [N, 'insertBefore'], [N, 'replaceChild'], [E, 'append'], [E, 'prepend'],
      [E, 'replaceChildren'], [E, 'before'], [E, 'after'], [E, 'replaceWith'], [E, 'insertAdjacentElement'],
      [F, 'append'], [F, 'prepend'], [F, 'replaceChildren'], [D, 'append'], [D, 'prepend'], [D, 'replaceChildren'],
      [C, 'before'], [C, 'after'], [C, 'replaceWith'], [T, 'before'], [T, 'after'], [T, 'replaceWith'],
      [G, 'insertNode'], [G, 'surroundContents']];
    for (var i = 0; i < nodi.length; i++) { try { conNodi(nodi[i][0], nodi[i][1]); } catch (e) {} }
    var testi = [[E, 'innerHTML', se], [S, 'innerHTML', se], [E, 'outerHTML', suo], [E, 'insertAdjacentHTML', suoOSe],
      [E, 'setHTMLUnsafe', se], [S, 'setHTMLUnsafe', se], [D, 'write', se], [D, 'writeln', se], [D, 'execCommand', se]];
    for (var j = 0; j < testi.length; j++) { try { conTesto(testi[j][0], testi[j][1], testi[j][2]); } catch (e) {} }
  }

  // L'aggiunta della finestra stessa: quella di questa può essere già avvolta da chi gira prima della pagina.
  function ascoltoDi(w) {
    var d = gOPD(w.EventTarget.prototype, 'addEventListener');
    return d && R(proprio, d, ['value']) ? d.value : addEL;
  }

  // Un riquadro della stessa origine col suo preload chiede, prima dei suoi script, questo stesso preambolo: un canvas
  // annotato da uno si legge con le funzioni dell'altro. Il tipo dell'evento è un segreto della sessione.
  function ascolta(w) {
    if (!CANALE) return;
    R(ascoltoDi(w), w, [CANALE, function (e) {
      try {
        var el = R(bersaglio, e, []), tag = tagName(el);
        if (!TAG[tag]) return;
        var cw = finestraDi(el, tag);
        prepara(cw, true);
        if (preparata(cw)) R(annulla, e, []);
      } catch (x) {}
    }, true]);
  }

  function riquadri(w) {
    for (var i = 0; i < CORNICI.length; i++) {
      var C = w[CORNICI[i]], CP = C && C.prototype, d = CP && gOPD(CP, 'contentWindow');
      if (!d || !d.get) continue;
      avvolgi(CP, 'contentDocument', d.get);
      avvolgi(CP, 'contentWindow', d.get);
    }
    try { inserimenti(w); } catch (e) {}
    try { osserva(w); } catch (e) {}
    try { alCarico(w); } catch (e) {}
    try { ascolta(w); } catch (e) {}
  }

  prepara(window, true);`;

// Solo nelle prove: un segno sul prototipo che le prove dei giri leggono, mai una proprietà della finestra; fuori dalle
// prove il preambolo non ne contiene nemmeno il nome.
const SONDA = `
  try { defP(getProto(window), '__filoFpGuard', { __proto__: null, get: function () { return true; }, configurable: true }); } catch (e) {}`;

function buildPreamboloSource({ fp, canale, sonda } = {}) {
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
  var parti = [], CANALE = ${JSON.stringify(String(canale || ''))}, LIVELLO = ${(fp && fp.level) | 0}, aspetta = setTimeout;

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
${PROPAGAZIONE}${sonda ? SONDA : ''}
})();`;
}

function buildGuardSource(seed, level, canale, sonda) {
  return buildPreamboloSource({ fp: { seed, level }, canale, sonda });
}

module.exports = { buildGuardSource, buildPreamboloSource };
