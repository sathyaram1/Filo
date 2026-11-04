// Il testo che la pagina manda su un collegamento sempre aperto (WebSocket) e a cui il server risponde è arrivato al sito,
// come quello di una richiesta riuscita (#824.4). Una sonda nel mondo della pagina lo passa al mondo di Filo con un evento
// dal nome segreto; senza una risposta del server non passa niente. Lo riceve content.js; regole in tests/tab-auto-archive.spec.mjs.
'use strict';

// Come il corpo di una richiesta letto dal main.
const { LIMITE_CORPO: LIMITE } = require('../main/services/testoInviato.js');
// Messaggi mandati e non ancora seguiti da una risposta, per collegamento: oltre si tengono gli ultimi.
const IN_ATTESA = 20;

function sorgenteSonda(nome) {
  const n = JSON.stringify(String(nome));
  return `(function(){
  'use strict';
  var WP = typeof WebSocket === 'function' && WebSocket.prototype;
  if (!WP || typeof WP.send !== 'function') return;
  var NOME = ${n}, LIMITE = ${LIMITE}, IN_ATTESA = ${IN_ATTESA};
  var oSend = WP.send, oAdd = EventTarget.prototype.addEventListener, oDispatch = EventTarget.prototype.dispatchEvent;
  var CE = CustomEvent, decoder = null;
  var attesa = new WeakMap();
  var mascherate = new WeakMap();
  function maschera(fn, orig, name) {
    var m = fn;
    try {
      m = ({ [name]() { return fn.apply(this, arguments); } })[name];
      Object.defineProperty(m, 'length', { value: orig.length, configurable: true });
      mascherate.set(m, 'function ' + name + '() { [native code] }');
    } catch (e) {}
    return m;
  }
  function testo(d) {
    if (typeof d === 'string') return d;
    try {
      if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) {
        if (!decoder) decoder = new TextDecoder('utf-8');
        return decoder.decode(d);
      }
    } catch (e) {}
    return '';
  }
  function segui(ws) {
    var lista = attesa.get(ws);
    if (lista) return lista;
    lista = [];
    attesa.set(ws, lista);
    // La risposta del server dice che quello che è partito prima è arrivato; un collegamento chiuso non dice niente.
    oAdd.call(ws, 'message', function () {
      var arrivati = lista.splice(0);
      for (var i = 0; i < arrivati.length; i++) {
        try { oDispatch.call(window, new CE(NOME, { detail: arrivati[i] })); } catch (e) {}
      }
    });
    oAdd.call(ws, 'close', function () { lista.length = 0; });
    return lista;
  }
  try {
    WP.send = maschera(function send(d) {
      try {
        if (this.readyState === 1) {
          var t = testo(d);
          if (t && t.length <= LIMITE) { var l = segui(this); l.push(t); if (l.length > IN_ATTESA) l.shift(); }
        }
      } catch (e) {}
      return oSend.apply(this, arguments);
    }, oSend, 'send');
    var FP = Function.prototype, oStr = FP.toString;
    FP.toString = maschera(function toString() {
      return (typeof this === 'function' && mascherate.get(this)) || oStr.apply(this, arguments);
    }, oStr, 'toString');
  } catch (e) {}
})();`;
}

// Nel frame che la carica, prima degli script del sito. Il nome segreto resta nel mondo di Filo, dove content.js lo legge.
function installa({ webFrame } = {}) {
  const nome = `x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try { webFrame.executeJavaScript(sorgenteSonda(nome), false).catch(() => {}); } catch (_) { return null; }
  globalThis.SN_COLLEGAMENTO_APERTO = nome;
  return nome;
}

module.exports = { installa, sorgenteSonda, LIMITE };
