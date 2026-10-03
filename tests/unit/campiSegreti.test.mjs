// I campi segreti (#810.7): `crea` gira anche dentro i riquadri incorporati, mandata come testo dal main, quindi
// non deve usare niente fuori da sé; e un numero di carta si riconosce anche quando il sito non chiama il campo «carta».

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/campiSegreti.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const S = globalThis.SN_CAMPI_SEGRETI;

function campo(attr = {}, valore = '') {
  return {
    nodeType: 1, tagName: 'INPUT', value: valore, type: attr.type || 'text', labels: [],
    getAttribute: (a) => (a in attr ? attr[a] : null),
  };
}

// Lo stesso testo che il main manda nei riquadri, valutato in un contesto vuoto: niente SN_*, niente globali di Filo.
function creaIsolata() {
  const finestra = { document: { querySelectorAll: () => [], getElementById: () => null }, getComputedStyle: () => ({}) };
  const codice = `(function () { const luhn = ${G.luhn}; const cartaValida = ${G.cartaValida};
    return (${S.crea})(finestra, cartaValida); })()`;
  return vm.runInNewContext(codice, { finestra });
}

test('crea gira da sola, come nel riquadro di un altro sito', () => {
  const s = creaIsolata();
  assert.equal(s.campoSegreto(campo({ type: 'password' })), true);
  assert.equal(s.campiInVista().length, 0);
  const { codiceMisura } = require('../../src/main/services/campiNeiRiquadri.js');
  const carta = { ...campo({ name: 'number' }, '4111 1111 1111 1111'),
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 210, bottom: 50, width: 200, height: 30 }) };
  const window = { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({ backgroundColor: 'rgb(1, 2, 3)', color: 'red', fontSize: '16px' }),
    document: { querySelectorAll: () => [carta], getElementById: () => null } };
  const misurati = vm.runInNewContext(codiceMisura(), { window });
  assert.equal(misurati.length, 1, 'il riquadro deve riconoscere il numero di carta da solo');
  assert.equal(misurati[0].sfondo, 'rgb(1, 2, 3)');
});

test('il numero di carta si riconosce dal valore, qualunque nome abbia il campo', () => {
  const s = creaIsolata();
  assert.equal(s.campoSegreto(campo({ name: 'number' }, '4111 1111 1111 1111')), true);
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '5500-0000-0000-0004')), true);
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '4111 1111 1111 1112')), false, 'cifra di controllo sbagliata');
  assert.equal(s.campoSegreto(campo({ id: 'n' }, 'via Roma 4111 1111 1111 1111')), false, 'un indirizzo non è un campo della carta');
  assert.equal(s.campoSegreto(campo({ id: 'q' }, 'biciclette rosse')), false);
});

test('i nomi della carta che i moduli usano davvero', () => {
  const s = creaIsolata();
  for (const nome of ['cc-number', 'ccnumber', 'cc_number', 'ccNum', 'payment[cc_number]', 'cc-csc']) {
    assert.equal(s.campoSegreto(campo({ name: nome })), true, nome);
  }
  for (const nome of ['account_no', 'acc-number', 'success']) {
    assert.equal(s.campoSegreto(campo({ name: nome })), false, nome);
  }
});
