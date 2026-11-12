// Il travestimento «sembra nativa» delle sonde che Filo mette nel mondo della pagina (#799): una copia sola, inclusa nel
// loro sorgente. Un sostituto non ha prototype né new, ha la lunghezza dell'originale e il testo nativo anche da
// Function.prototype.toString.call. Prova: tests/pagina-come-chrome.spec.mjs.
'use strict';

// Dà alla sonda `maschera(fn, orig, nome)` e `mascheraToString()`, da chiamare dopo aver mascherato le sue funzioni.
const SORGENTE = `var mascherate = new WeakMap();
  function maschera(fn, orig, name) {
    var m = fn;
    try {
      m = ({ [name]() { return fn.apply(this, arguments); } })[name];
      Object.defineProperty(m, 'length', { value: orig.length, configurable: true });
      mascherate.set(m, 'function ' + name + '() { [native code] }');
    } catch (e) {}
    return m;
  }
  function mascheraToString() {
    var FP = Function.prototype, oStr = FP.toString;
    FP.toString = maschera(function toString() {
      return (typeof this === 'function' && mascherate.get(this)) || oStr.apply(this, arguments);
    }, oStr, 'toString');
  }`;

module.exports = { SORGENTE };
