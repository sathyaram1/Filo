// Il media che la pagina suona fuori dal documento (`new Audio(blob)`, il vocale di WhatsApp Web): una sonda nel mondo
// della pagina ne passa l'indirizzo al mondo di Filo con un evento dal nome segreto, perché «Trascrivi» lo trovi (#1660).
// Non tocca la riproduzione. Lo riceve src/content/actions.js (mediaDelLettore); prova in tests/trascrivi-audio.spec.mjs.
'use strict';

const { SORGENTE: SEMBRA_NATIVA } = require('./sembraNativa.js');

function sorgenteSonda(nome) {
  const n = JSON.stringify(String(nome));
  return `(function(){
  'use strict';
  var MP = typeof HTMLMediaElement === 'function' && HTMLMediaElement.prototype;
  if (!MP || typeof MP.play !== 'function') return;
  var NOME = ${n}, oPlay = MP.play, oDispatch = EventTarget.prototype.dispatchEvent, CE = CustomEvent;
  ${SEMBRA_NATIVA}
  try {
    MP.play = maschera(function play() {
      try {
        if (!this.isConnected) {
          var src = this.currentSrc || this.src || '';
          if (src) oDispatch.call(window, new CE(NOME, { detail: String(src) }));
        }
      } catch (e) {}
      return oPlay.apply(this, arguments);
    }, oPlay, 'play');
    mascheraToString();
  } catch (e) {}
})();`;
}

// Nel frame che la carica, prima degli script del sito. Il nome segreto resta nel mondo di Filo.
function installa({ webFrame } = {}) {
  const nome = `x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try { webFrame.executeJavaScript(sorgenteSonda(nome), false).catch(() => {}); } catch (_) { return null; }
  globalThis.SN_MEDIA_STACCATI = nome;
  return nome;
}

module.exports = { installa, sorgenteSonda };
