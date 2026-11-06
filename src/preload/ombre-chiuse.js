// Sonda nel mondo della pagina che tiene gli alberi chiusi dei componenti del sito (#472): risponde al mondo di Filo
// se uno di loro non ha niente da leggere, così una decorazione non fa dire «tradotta solo in parte». Non legge altro
// e non dice cosa c'è dentro. La chiede extractContext.js; regole in tests/translate-page.spec.mjs (#472).
'use strict';

const { SORGENTE: SEMBRA_NATIVA } = require('./sembraNativa.js');

function sorgenteSonda(nome) {
  const n = JSON.stringify(String(nome));
  return `(function(){
  'use strict';
  var EP = typeof Element === 'function' && Element.prototype;
  if (!EP || typeof EP.attachShadow !== 'function') return;
  var NOME = ${n};
  var oAttach = EP.attachShadow, radici = new WeakMap();
  var oAdd = EventTarget.prototype.addEventListener;
  var oStop = Event.prototype.stopImmediatePropagation, oPrevent = Event.prototype.preventDefault;
  var LETTERA = /\\p{L}/u, MUTI = { STYLE: 1, SCRIPT: 1, TEMPLATE: 1, NOSCRIPT: 1 };
  var ETICHETTE = ['alt', 'title', 'aria-label', 'placeholder', 'value'];
  ${SEMBRA_NATIVA}
  // Testo che si legge, anche negli alberi annidati; lo stile e gli script dentro l'albero non sono testo.
  function haTesto(radice, prof) {
    if (!radice || prof > 8) return true;
    var tutti;
    try { tutti = radice.querySelectorAll('*'); } catch (e) { return true; }
    var figli = radice.childNodes || [];
    for (var i = 0; i < figli.length; i++) {
      if (figli[i].nodeType === 3 && LETTERA.test(figli[i].nodeValue || '')) return true;
    }
    for (var j = 0; j < tutti.length; j++) {
      var el = tutti[j];
      if (MUTI[el.tagName]) continue;
      var c = el.childNodes;
      for (var k = 0; k < c.length; k++) {
        if (c[k].nodeType === 3 && LETTERA.test(c[k].nodeValue || '')) return true;
      }
      for (var a = 0; a < ETICHETTE.length; a++) {
        var v = el.getAttribute(ETICHETTE[a]);
        if (v && LETTERA.test(v)) return true;
      }
      var dentro = el.shadowRoot || radici.get(el);
      if (dentro && haTesto(dentro, prof + 1)) return true;
    }
    return false;
  }
  try {
    EP.attachShadow = maschera(function attachShadow(init) {
      var r = oAttach.apply(this, arguments);
      try { if (init && init.mode === 'closed') radici.set(this, r); } catch (e) {}
      return r;
    }, oAttach, 'attachShadow');
    mascheraToString();
    oAdd.call(window, NOME, function (e) {
      var r = radici.get(e.target);
      oStop.call(e);
      if (r && !haTesto(r, 0)) oPrevent.call(e);
    }, true);
  } catch (e) {}
})();`;
}

// Nel frame principale, prima degli script del sito. Il nome segreto resta nel mondo di Filo.
function installa({ webFrame } = {}) {
  const nome = `x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try { webFrame.executeJavaScript(sorgenteSonda(nome), false).catch(() => {}); } catch (_) { return null; }
  globalThis.SN_OMBRE_CHIUSE = nome;
  return nome;
}

module.exports = { installa, sorgenteSonda };
