// #798 — Un riquadro ha la protezione anti-fingerprint della pagina principale, col suo seme, se è dello stesso sito o
// è contenuto suo (srcdoc, data:, blob:); un riquadro di un altro sito resta com'è. La catena va dal riquadro alla cima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FP = require('../../src/main/services/fingerprint.js');

const OFF = { level: 0, seed: 0 };
const PAGINA = 'https://www.esempio.it/articolo';
const INCOGNITO = 'filo-incognito-1b4e28ba-2fa1-11d2-883f-0016d3cca427';
FP.setMode({ security: { fingerprint: { mode: 'default' } } }, false);

test('un riquadro dello stesso sito, anche su un altro sottodominio, ha il seme della pagina', () => {
  const pagina = FP.configForHref(PAGINA);
  assert.ok(pagina.level > 0 && pagina.seed > 0);
  assert.deepEqual(FP.configForFrames(['https://www.esempio.it/widget', PAGINA]), pagina);
  assert.deepEqual(FP.configForFrames(['https://cdn.esempio.it/w.html', PAGINA]), pagina);
});

test('un riquadro di un altro sito resta com\'è, anche annidato in uno dello stesso sito', () => {
  assert.deepEqual(FP.configForFrames(['https://mappe.example.com/embed', PAGINA]), OFF);
  assert.deepEqual(FP.configForFrames(['https://mappe.example.com/x', 'https://www.esempio.it/w', PAGINA]), OFF);
});

test('srcdoc, data: e blob: sono contenuto del frame che li contiene', () => {
  const pagina = FP.configForHref(PAGINA);
  for (const u of ['about:srcdoc', 'data:text/html,<p>x</p>', 'blob:https://www.esempio.it/1b4e28ba']) {
    assert.deepEqual(FP.configForFrames([u, PAGINA]), pagina, u);
    assert.deepEqual(FP.configForFrames([u, 'https://www.esempio.it/w', PAGINA]), pagina, u);
    assert.deepEqual(FP.configForFrames([u, 'https://mappe.example.com/x', PAGINA]), OFF, `${u} dentro un altro sito`);
  }
  assert.deepEqual(FP.configForFrames(['about:srcdoc', 'data:text/html,x', PAGINA]), pagina);
});

test('lo stesso sito dentro un riquadro di un altro sito ha il seme della pagina', () => {
  assert.deepEqual(FP.configForFrames(['https://www.esempio.it/b', 'https://mappe.example.com/x', PAGINA]), FP.configForHref(PAGINA));
});

test('una pagina esente o senza protezione non la dà ai suoi riquadri; un riquadro esente resta esente', () => {
  assert.deepEqual(FP.configForFrames(['about:srcdoc', 'https://accounts.google.com/signin']), OFF);
  assert.deepEqual(FP.configForFrames(['https://accounts.google.com/x', 'https://www.google.com/search?q=a']), OFF);
  assert.deepEqual(FP.configForFrames(['about:srcdoc', 'filo://newtab/']), OFF);
  assert.deepEqual(FP.configForFrames(['https://github.com/login', 'https://github.com/filo/filo']), OFF);
  assert.deepEqual(FP.configForFrames([]), OFF);
  assert.deepEqual(FP.configForFrames(null), OFF);
});

test('in incognito il riquadro ha il seme della pagina in quella finestra', () => {
  const pagina = FP.configForHref(PAGINA, INCOGNITO);
  assert.deepEqual(FP.configForFrames(['about:srcdoc', PAGINA], INCOGNITO), pagina);
  assert.notEqual(pagina.seed, FP.configForHref(PAGINA).seed);
});

test('in Off nessun riquadro ha la protezione', () => {
  FP.setMode({ security: { fingerprint: { mode: 'off' } } }, false);
  try {
    assert.deepEqual(FP.configForFrames(['https://www.esempio.it/w', PAGINA]), OFF);
    assert.deepEqual(FP.configForFrames(['about:srcdoc', PAGINA]), OFF);
  } finally {
    FP.setMode({ security: { fingerprint: { mode: 'default' } } }, false);
  }
});

test('fuori dalle prove la guardia non lascia nessun segno che un sito possa leggere', () => {
  const G = require('../../src/preload/fingerprint-guard.js');
  assert.doesNotMatch(G.buildGuardSource(123, 1, 'xabc'), /__filoFp/);
  assert.doesNotMatch(G.buildGuardSource(123, 1, 'xabc', false), /__filoFp/);
  assert.match(G.buildGuardSource(123, 1, 'xabc', true), /__filoFpGuard/);
});

// La guardia e i corpi che Filo mette nei riquadri vuoti prendono le vie dei riquadri e la regola del riquadro in arrivo
// da un elenco solo: una via nuova, o una correzione alla regola, vale per tutti e due.
test('le vie dei riquadri e la regola del riquadro in arrivo vivono in un posto solo', () => {
  const { readFileSync } = require('node:fs');
  const V = require('../../src/preload/vie-dei-riquadri.js');
  const G = require('../../src/preload/fingerprint-guard.js');
  const { buildRiquadriVuotiSource } = require('../../src/preload/riquadri-vuoti.js');
  const sorgenti = { guardia: G.buildGuardSource(123, 1, 'xabc'), vuoti: buildRiquadriVuotiSource(['function (w) {}']) };
  for (const [chi, s] of Object.entries(sorgenti)) {
    for (const parte of [JSON.stringify(V.VIE_NODI), JSON.stringify(V.VIE_TESTO), JSON.stringify(V.CORNICI), V.sorgenteInArrivo()]) {
      assert.ok(s.includes(parte), `${chi}: senza l'elenco condiviso`);
    }
    new Function(s);
  }
  const VIE = /'(appendChild|insertBefore|replaceChild|append|prepend|replaceChildren|before|after|replaceWith|moveBefore|insertAdjacentElement|insertAdjacentHTML|innerHTML|outerHTML|setHTMLUnsafe|setHTML|insertNode|surroundContents|write|writeln|open|execCommand|srcdoc)'/;
  for (const f of ['src/preload/fingerprint-guard.js', 'src/preload/riquadri-vuoti.js']) {
    const testo = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(testo, VIE, `${f}: una via dei riquadri scritta a mano, fuori dall'elenco condiviso`);
  }
  assert.ok(V.RISCRIVONO.every((n) => V.VIE_TESTO.some((v) => v[0] === 'Document' && v[1] === n)), 'la riscrittura da capo passa dalle vie del testo');
});

test('un sito con pagine di accesso esenti lo dice alla guardia, uno qualunque no', () => {
  assert.equal(FP.esentiNelSito('https://github.com/filo/filo'), true);
  assert.equal(FP.esentiNelSito('http://www.linkedin.com:8080/feed'), true);
  assert.equal(FP.esentiNelSito(PAGINA), false);
  assert.equal(FP.esentiNelSito('https://accounts.google.com/x'), false);
  assert.equal(FP.esentiNelSito('about:srcdoc'), false);
  assert.equal(FP.esentiNelSito(''), false);
});
