// Sentinella #726 — l'etichetta del bottone di raffinamento estetico.
//
// Una risposta che cambia cinque colori mette cinque bottoni: ognuno deve dire
// QUALE impostazione regola, o sono indistinguibili. Il nome sta nel registro
// dei token; qui si verifica che il bottone lo usi e che due token non
// finiscano mai con la stessa etichetta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = join(__dirname, '..', '..', 'src', 'shared');
require(join(shared, 'themeTokens.js'));
require(join(shared, 'aestheticRefiner.js'));

const TT = globalThis.SN_THEME_TOKENS;
const R = globalThis.SN_AESTHETIC_REFINER;

test("l'etichetta di ogni token è il suo nome leggibile", () => {
  for (const name of TT.names()) {
    assert.equal(R.triggerLabel(name, TT), TT.get(name).label);
  }
});

test('due token non hanno mai la stessa etichetta', () => {
  const viste = new Map();
  for (const name of TT.names()) {
    const l = R.triggerLabel(name, TT);
    assert.ok(!viste.has(l), `${name} e ${viste.get(l)} hanno la stessa etichetta «${l}»`);
    viste.set(l, name);
  }
});

test('il verbo resta come suggerimento, per tipo di controllo', () => {
  assert.equal(R.triggerHint('background', TT), 'Scegli il colore esatto');
  assert.equal(R.triggerHint('radius', TT), 'Regola la dimensione');
  assert.equal(R.triggerHint('font', TT), 'Cambia il font');
  assert.equal(R.triggerHint('selection.opacity', TT), 'Regola l’opacità');
});

test('un token sconosciuto ripiega sul verbo e non produce bottone', () => {
  assert.equal(R.triggerLabel('non.esiste', TT), 'Scegli il colore esatto');
  const doc = fakeDoc();
  assert.equal(R.buildButton({ token: 'non.esiste', valore: '#ff0000' }, { Tokens: TT, doc }), null);
});

// ── il bottone costruito davvero (DOM finto: il modulo accetta `doc`) ───────

function fakeDoc() {
  const make = (tag) => ({
    tag,
    children: [],
    style: {},
    attrs: {},
    textContent: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    get text() { return this.children.map((c) => c.text ?? c.textContent).join(''); },
  });
  return { createElement: make };
}

const textOf = (btn) => btn.children.map((c) => c.textContent).join('');

test('il bottone mostra il nome, il campione del colore e il verbo in hover', () => {
  const btn = R.buildButton({ token: 'background', valore: '#3a7d44' }, { Tokens: TT, doc: fakeDoc() });
  assert.ok(btn);
  assert.ok(textOf(btn).includes('Colore di sfondo'));
  assert.equal(btn.title, 'Scegli il colore esatto');
  const sw = btn.children.find((c) => c.className === 'sn-refine-trigger-swatch');
  assert.equal(sw.style.background, '#3a7d44');
});

test('cinque colori cambiati danno cinque bottoni diversi', () => {
  const tokens = ['background', 'text', 'accent', 'border', 'topbar'];
  const etichette = tokens.map((token) => {
    const btn = R.buildButton({ token, valore: '#112233' }, { Tokens: TT, doc: fakeDoc() });
    return textOf(btn);
  });
  assert.equal(new Set(etichette).size, tokens.length, etichette.join(' | '));
});

test('un valore non valido non finisce nello stile: niente campione', () => {
  const btn = R.buildButton({ token: 'accent', valore: 'red; content: url(x)' }, { Tokens: TT, doc: fakeDoc() });
  assert.ok(!btn.children.some((c) => c.className === 'sn-refine-trigger-swatch'));
  assert.ok(textOf(btn).includes("Colore d'accento"));
});
