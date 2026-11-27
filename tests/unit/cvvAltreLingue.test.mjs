// #2681.1: il CVV chiamato nella lingua del sito è segreto come «CVV» in ogni strada: il testo per il modello, i campi
// dei moduli (anche nei riquadri, dal sorgente) e gli indizi di pagamento dei siti pericolosi. Una lista sola.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/campiSegreti.js');
const P = require('../../src/shared/pavimento.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const S = globalThis.SN_CAMPI_SEGRETI;
const { pageHints, PAGE_HINTS_JS } = require('../../src/content/safebrowseHints.js');

const NOMI = ['Cryptogramme', 'Cryptogramme visuel', 'Code de sécurité', 'Code de securite', 'Código de seguridad',
  'Codigo de seguridad', 'Código de segurança', 'Kartenprüfnummer', 'Kartenpruefnummer', 'Prüfnummer', 'Prüfziffer',
  'Sicherheitscode', 'Beveiligingscode', 'Kod bezpieczeństwa', 'Kod bezpieczenstwa', 'CODE DE SÉCURITÉ'];
// Come i siti li scrivono negli attributi.
const NOMI_DI_CAMPO = ['cryptogramme', 'codigoSeguridad', 'codigo_de_seguridad', 'kartenPruefnummer', 'sicherheitsCode',
  'beveiligings-code', 'kodBezpieczenstwa', 'codeSecurite', 'codigoSeguranca'];
const QUALUNQUE = ['Code postal', 'Código postal', 'Kod pocztowy', 'Postcode', 'Kundennummer', 'Prüfung', 'Seguridad social',
  'Code promo', 'Nom'];

function campo(attr = {}, valore = '') {
  return {
    nodeType: 1, tagName: 'INPUT', value: valore, type: 'text', labels: [],
    getAttribute: (a) => (a in attr ? attr[a] : null),
  };
}

// Come nel riquadro di un altro sito: il testo che manda il main, in un contesto senza niente di Filo.
function creaIsolata() {
  const finestra = { document: { querySelectorAll: () => [], getElementById: () => null }, getComputedStyle: () => ({}) };
  const codice = `(function () { const luhn = ${G.luhn}; const cartaValida = ${G.cartaValida};
    return (${S.crea})(finestra, cartaValida, { etichette: ${JSON.stringify(S.etichette())} }); })()`;
  return vm.runInNewContext(codice, { finestra });
}

function documento(etichette) {
  return {
    querySelector: () => null,
    querySelectorAll: () => etichette.map((t) => ({ getAttribute: (k) => (k === 'aria-label' ? t : null), labels: [] })),
    getElementById: () => null,
  };
}

test('la lista autonoma degli indizi di pagamento è la stessa del pavimento', () => {
  const riga = (p) => (readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8').match(/const CVV_ALTRE_LINGUE = ('[^\n]*');/) || [])[1];
  assert.ok(riga('shared/pavimento.js'), 'la lista nel pavimento');
  assert.equal(riga('content/safebrowseHints.js'), riga('shared/pavimento.js'));
  assert.ok(S.etichette().includes(P.CVV_ALTRE_LINGUE), 'i campi dei moduli la ricevono con le etichette');
});

test('un campo col nome del CVV in un’altra lingua è segreto, da qualunque parte arrivi il nome', () => {
  const s = creaIsolata();
  for (const nome of NOMI) {
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      assert.equal(s.campoSegreto(campo({ [attr]: nome }, '123')), true, `${attr}="${nome}"`);
    }
    const legato = { ...campo({}, '123'), labels: [{ childNodes: [{ nodeType: 3, nodeValue: `${nome}:` }] }] };
    assert.equal(s.campoSegreto(legato), true, `<label>${nome}</label>`);
  }
  for (const nome of NOMI_DI_CAMPO) assert.equal(s.campoSegreto(campo({ name: nome }, '123')), true, `name="${nome}"`);
  for (const nome of QUALUNQUE) assert.equal(s.campoSegreto(campo({ 'aria-label': nome }, '123')), false, nome);
});

test('nell’immagine che va al modello il CVV col nome straniero è coperto', () => {
  const { codiceMisura } = require('../../src/main/services/campiNeiRiquadri.js');
  const cvv = { ...campo({ 'aria-label': 'Kartenprüfnummer' }, '482'),
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 210, bottom: 50, width: 200, height: 30 }) };
  const window = { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({ backgroundColor: 'rgb(1, 2, 3)', color: 'red', fontSize: '16px' }),
    document: { querySelectorAll: () => [cvv], getElementById: () => null } };
  assert.equal(vm.runInNewContext(codiceMisura(), { window }).length, 1);
});

test('nel testo per il modello il CVV annunciato col nome straniero diventa il segnaposto', () => {
  const casi = ['Cryptogramme : 123', 'Cryptogramme visuel : 123', 'Le code de sécurité est 123', 'Código de seguridad: 123',
    'El código de seguridad es 123', 'Código de segurança: 1234', 'Kartenprüfnummer: 123', 'Die Kartenprüfnummer lautet 123',
    'Sicherheitscode: 123', 'Beveiligingscode: 123', 'Kod bezpieczeństwa: 123', 'Kod bezpieczeństwa to 123'];
  for (const riga of casi) {
    const fuori = P.oscura(riga);
    assert.ok(!/\d{3}/.test(fuori), `${riga} → ${fuori}`);
    assert.ok(fuori.includes(P.SEGNAPOSTO), riga);
  }
  for (const riga of ['Le code de sécurité est le code à 3 chiffres', 'El código de seguridad tiene 3 dígitos', 'Code postal: 75011']) {
    assert.equal(P.oscura(riga), riga);
  }
});

test('il CVV chiamato in un’altra lingua conta come dato di pagamento, anche dal sorgente', () => {
  const daSorgente = new Function(`return (${pageHints.toString()})`)();
  for (const nome of NOMI) {
    assert.equal(pageHints(documento(['Nome', nome])).hasPayment, true, nome);
    assert.equal(daSorgente(documento([nome])).hasPayment, true, `dal sorgente: ${nome}`);
  }
  assert.equal(pageHints(documento(QUALUNQUE)).hasPayment, false);
});
