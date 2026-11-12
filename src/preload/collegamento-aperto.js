// Il testo che la pagina manda su un collegamento sempre aperto (WebSocket) e che il server conferma è arrivato al sito,
// come quello di una richiesta riuscita (#824.4, #1808). Una sonda nel mondo della pagina lo passa al mondo di Filo con un evento
// dal nome segreto; senza una conferma del server non passa niente. Lo riceve content.js; regole in tests/tab-auto-archive.spec.mjs.
'use strict';

// Come il corpo di una richiesta letto dal main.
const { LIMITE_CORPO: LIMITE } = require('../main/services/testoInviato.js');
const { SORGENTE: SEMBRA_NATIVA } = require('./sembraNativa.js');
// Messaggi mandati e non ancora seguiti da una risposta, per collegamento: oltre si tengono gli ultimi.
const IN_ATTESA = 20;

// Un messaggio del server che dice di no: la risposta che lo porta non è una prova d'arrivo, e quello che aspettava
// resta da proteggere (#1808).
const ERRORE = /"(?:error|errors|errore|errori|err)"\s*:\s*(?!null\b|false\b|""|\[\]|\{\}|0\b)|"(?:ok|success|successo)"\s*:\s*false\b|"(?:status|type|tipo|result|esito|event)"\s*:\s*"(?:error|errore|fail|failed|failure|denied|rejected|forbidden|unauthori[sz]ed|invalid)"|^\s*(?:error|errore)\b/i;
// Dopo la risposta il collegamento deve tacere così a lungo: uno che parla di continuo (presenze, notifiche) non dice
// con una risposta qualunque che il testo è arrivato, solo con l'eco del testo o del suo identificativo.
const QUIETE_MS = 1500;
// Messaggi arrivati dopo l'invio oltre i quali la risposta non è più «quella» all'invio.
const RISPOSTE_MAX = 2;

function sorgenteSonda(nome) {
  const n = JSON.stringify(String(nome));
  return `(function(){
  'use strict';
  var WP = typeof WebSocket === 'function' && WebSocket.prototype;
  if (!WP || typeof WP.send !== 'function') return;
  var NOME = ${n}, LIMITE = ${LIMITE}, IN_ATTESA = ${IN_ATTESA}, QUIETE = ${QUIETE_MS}, RISPOSTE = ${RISPOSTE_MAX};
  var ERRORE = ${ERRORE.toString()};
  var oSend = WP.send, oAdd = EventTarget.prototype.addEventListener, oDispatch = EventTarget.prototype.dispatchEvent;
  var oST = setTimeout, oCT = clearTimeout, CE = CustomEvent, oParse = JSON.parse, oStringify = JSON.stringify, decoder = null;
  var attesa = new WeakMap();
  ${SEMBRA_NATIVA}
  function testo(d) {
    if (typeof d === 'string') return d.length > LIMITE ? d.slice(0, LIMITE) : d;
    try {
      var v = null;
      if (d instanceof ArrayBuffer) v = new Uint8Array(d, 0, Math.min(d.byteLength, LIMITE));
      else if (ArrayBuffer.isView(d)) v = new Uint8Array(d.buffer, d.byteOffset, Math.min(d.byteLength, LIMITE));
      if (v) { if (!decoder) decoder = new TextDecoder('utf-8'); return decoder.decode(v); }
    } catch (e) {}
    return '';
  }
  // I valori che un'eco del server riporterebbe: i testi lunghi del messaggio e i suoi identificativi.
  var CHIAVI_ID = /^(?:id|nonce|ref|uuid|cid|request_?id|req_?id|client_?id|temp_?id|local_?id|msg_?id|message_?id)$/i;
  function valori(t) {
    var out = [];
    var o = null;
    try { o = oParse(t); } catch (e) { return out; }
    (function giu(x, chiave, prof) {
      if (prof > 6 || out.length > 40) return;
      if (typeof x === 'string') {
        if (x.length >= 12 || (CHIAVI_ID.test(chiave) && x.length >= 4)) { out.push(x); var j = oStringify(x).slice(1, -1); if (j !== x) out.push(j); }
      } else if (typeof x === 'number' && CHIAVI_ID.test(chiave) && String(x).length >= 4) out.push(String(x));
      else if (x && typeof x === 'object') for (var k in x) { if (Object.prototype.hasOwnProperty.call(x, k)) giu(x[k], k, prof + 1); }
    })(o, '', 0);
    return out;
  }
  function eco(voce, r) {
    for (var i = 0; i < voce.v.length; i++) if (r.indexOf(voce.v[i]) !== -1) return true;
    return false;
  }
  function arriva(voce) { try { oDispatch.call(window, new CE(NOME, { detail: voce.t })); } catch (e) {} }
  function segui(ws) {
    var st = attesa.get(ws);
    if (st) return st;
    st = { lista: [], timer: 0 };
    attesa.set(ws, st);
    function svuota() { st.lista.length = 0; if (st.timer) { oCT(st.timer); st.timer = 0; } }
    function respinti() {
      var via = st.lista.splice(0);
      for (var i = 0; i < via.length; i++) { try { oDispatch.call(window, new CE(NOME + ':r', { detail: via[i].t })); } catch (e) {} }
      svuota();
    }
    // Arrivato: l'eco del testo o del suo identificativo, oppure una risposta dopo cui il collegamento tace. Un errore
    // del server, o un collegamento chiuso, non dicono che sia arrivato.
    oAdd.call(ws, 'message', function (e) {
      if (!st.lista.length) return;
      var r = '';
      try { r = testo(e.data); } catch (x) {}
      if (ERRORE.test(r)) { respinti(); return; }
      for (var i = st.lista.length - 1; i >= 0; i--) {
        var voce = st.lista[i];
        voce.n++;
        if (r && eco(voce, r)) { st.lista.splice(i, 1); arriva(voce); }
      }
      if (st.timer) oCT(st.timer);
      st.timer = st.lista.length ? oST(function () {
        st.timer = 0;
        for (var i = st.lista.length - 1; i >= 0; i--) {
          var voce = st.lista[i];
          if (voce.n >= 1 && voce.n <= RISPOSTE) { st.lista.splice(i, 1); arriva(voce); }
          else if (voce.n > RISPOSTE) st.lista.splice(i, 1);
        }
      }, QUIETE) : 0;
    });
    oAdd.call(ws, 'close', svuota);
    return st;
  }
  try {
    WP.send = maschera(function send(d) {
      try {
        if (this.readyState === 1) {
          var t = testo(d);
          if (t && t.length < LIMITE) {
            var st = segui(this);
            st.lista.push({ t: t, v: valori(t), n: 0 });
            if (st.lista.length > IN_ATTESA) st.lista.shift();
          }
        }
      } catch (e) {}
      return oSend.apply(this, arguments);
    }, oSend, 'send');
    mascheraToString();
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
