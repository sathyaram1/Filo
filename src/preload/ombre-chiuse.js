// Sonda nel mondo della pagina che tiene gli alberi chiusi dei componenti del sito (#472): risponde al mondo di Filo
// se uno di loro non ha niente da leggere, così una decorazione non fa dire «tradotta solo in parte». Non legge altro
// e non dice cosa c'è dentro. La chiede extractContext.js; regole in tests/translate-page.spec.mjs (#472).
'use strict';

const path = require('node:path');
const { SORGENTE: SEMBRA_NATIVA } = require('./sembraNativa.js');

// Cosa è testo da tradurre lo dice constants.js, con le regole che usa la traduzione (sottoalberi che non apre,
// etichette, testo segnato da non tradurre): qui dentro arriva il loro sorgente, non una copia (#1290.2).
function regole() {
  if (!globalThis.SN_CONST) require(path.join(__dirname, '..', 'shared', 'constants.js'));
  return globalThis.SN_CONST;
}

function sorgenteSonda(nome) {
  const n = JSON.stringify(String(nome));
  const C = regole();
  const senzaProsa = C.TAG_SENZA_PROSA;
  return `(function(){
  'use strict';
  var EP = typeof Element === 'function' && Element.prototype;
  if (!EP || typeof EP.attachShadow !== 'function') return;
  var NOME = ${n};
  var oAttach = EP.attachShadow, radici = new WeakMap();
  var oAdd = EventTarget.prototype.addEventListener;
  var oStop = Event.prototype.stopImmediatePropagation, oPrevent = Event.prototype.preventDefault;
  var oPath = Event.prototype.composedPath, oClosest = EP.closest;
  var HTML = 'http://www.w3.org/1999/xhtml';
  var MUTI = ${JSON.stringify(Object.fromEntries(senzaProsa.map((t) => [t, 1])))};
  var ETICHETTE = ${JSON.stringify(C.ETICHETTE_TRADOTTE)};
  // Di un riquadro o di un oggetto incorporato da qui non si legge il contenuto: non è testo, ma nemmeno vuoto.
  var INCORPORATI = { IFRAME: 1, FRAME: 1, OBJECT: 1, EMBED: 1, PORTAL: 1 };
  ${SEMBRA_NATIVA}
  ${String(C.testoDaTradurre)}
  ${String(C.valoreEtichetta)}
  ${String(C.nonDaTradurre)}
  function testoProprio(nodo) {
    var c = nodo.childNodes || [], s = '';
    for (var k = 0; k < c.length; k++) if (c[k].nodeType === 3) s += c[k].nodeValue || '';
    return testoDaTradurre(s);
  }
  // Un antenato in cui la traduzione non scende: 'tag' (niente prosa, o non HTML), 'no' (da non tradurre), o ''.
  function sottoMuto(el) {
    var esito = '';
    for (var su = el.parentElement; su; su = su.parentElement) {
      if (MUTI[String(su.tagName || '').toUpperCase()] || su.namespaceURI !== HTML) return 'tag';
      if (!esito && nonDaTradurre(su)) esito = 'no';
    }
    return esito;
  }
  function etichetta(el, tag) {
    var nomi = ETICHETTE.ovunque.concat(ETICHETTE.perTag[tag] || []);
    if (tag === 'INPUT' && valoreEtichetta(el)) nomi.push('value');
    for (var a = 0; a < nomi.length; a++) {
      var v = el.getAttribute(nomi[a]);
      if (v === null && nomi[a] === 'label' && tag === 'OPTION') v = el.textContent;
      if (testoDaTradurre(v)) return true;
    }
    return false;
  }
  // 2 testo che si legge, anche negli alberi annidati; 1 solo incorporati (o troppo fondo per saperlo); 0 niente.
  // Lì dove la traduzione non entra (stile, script, grafici, codice, testo da non tradurre) non c'è testo; le etichette
  // che lei traduce sì.
  function leggibile(radice, prof) {
    if (!radice || prof > 8) return 1;
    var tutti;
    try { tutti = radice.querySelectorAll('*'); } catch (e) { return 1; }
    if (testoProprio(radice)) return 2;
    var esito = 0;
    for (var j = 0; j < tutti.length; j++) {
      var el = tutti[j];
      var muto = sottoMuto(el);
      if (muto === 'tag') continue;
      var tag = String(el.tagName || '').toUpperCase();
      if (INCORPORATI[tag]) esito = 1;
      if (muto || nonDaTradurre(el)) continue;
      if (etichetta(el, tag)) return 2;
      if (MUTI[tag] || el.namespaceURI !== HTML) continue;
      if (testoProprio(el)) return 2;
      var dentro = el.shadowRoot || radici.get(el);
      if (dentro) {
        var d = leggibile(dentro, prof + 1);
        if (d === 2) return 2;
        if (d) esito = 1;
      }
    }
    return esito;
  }
  // La domanda può partire da dentro un componente aperto: a questa altezza il bersaglio è già il suo ospite.
  function chiesto(e) {
    try { var p = oPath.call(e); if (p && p[0]) return p[0]; } catch (x) {}
    return e.target;
  }
  try {
    EP.attachShadow = maschera(function attachShadow(init) {
      var r = oAttach.apply(this, arguments);
      try { if (init && init.mode === 'closed') radici.set(this, r); } catch (e) {}
      return r;
    }, oAttach, 'attachShadow');
    mascheraToString();
    // Una domanda per risposta: annullato vuol dire sì. NOME «è vuoto?», NOME+'r' «solo incorporati?», NOME+'t' «testo?».
    var RISPOSTE = [['', 0], ['r', 1], ['t', 2]];
    RISPOSTE.forEach(function (q) {
      oAdd.call(window, NOME + q[0], function (e) {
        var r = radici.get(chiesto(e));
        oStop.call(e);
        if (r && leggibile(r, 0) === q[1]) oPrevent.call(e);
      }, true);
    });
  } catch (e) {}
})();`;
}

// In ogni frame, prima degli script del sito: anche un riquadro incorporato ha i suoi componenti. Il nome segreto resta
// nel mondo di Filo.
function installa({ webFrame } = {}) {
  const nome = `x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try { webFrame.executeJavaScript(sorgenteSonda(nome), false).catch(() => {}); } catch (_) { return null; }
  globalThis.SN_OMBRE_CHIUSE = nome;
  return nome;
}

module.exports = { installa, sorgenteSonda };
