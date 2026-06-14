// Unit test per src/shared/themeTokens.js — il registro dei token estetici
// (#146.1): risoluzione della gerarchia categoria→token specifico, validazione
// dei valori (whitelist anti CSS-injection) ed emissione del CSS degli
// override.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'themeTokens.js'));

const TT = globalThis.SN_THEME_TOKENS;

test('il registro si registra su globalThis con la sua API', () => {
  assert.ok(TT);
  assert.equal(typeof TT.effectiveValue, 'function');
  assert.equal(typeof TT.pageCss, 'function');
  assert.equal(typeof TT.shellCss, 'function');
  assert.equal(typeof TT.sanitize, 'function');
});

test('ogni token specifico punta a una categoria esistente', () => {
  for (const name of TT.names()) {
    const t = TT.get(name);
    if (t.category) {
      assert.ok(TT.get(t.category), `${name} → categoria inesistente ${t.category}`);
      assert.ok(!TT.get(t.category).category, `la categoria di ${name} non è di primo livello`);
    }
    // Ogni token deve risolvere un default per entrambi i temi.
    assert.ok(TT.defaultValue(name, 'light'), `${name} senza default light`);
    assert.ok(TT.defaultValue(name, 'dark'), `${name} senza default dark`);
  }
});

// ── gerarchia ───────────────────────────────────────────────────────────────

test('senza override vale il predefinito (per tema)', () => {
  assert.equal(TT.effectiveValue('accent', {}, 'light'), '#c45a3b');
  assert.equal(TT.effectiveValue('background', {}, 'light'), '#f8f6f0');
  assert.equal(TT.effectiveValue('background', {}, 'dark'), '#1e1d1b');
  assert.equal(TT.effectiveValue('selection.opacity', {}, 'dark'), '0.35');
});

test('il token specifico eredita di default dalla categoria', () => {
  // link.color e selection.color derivano da accent
  assert.equal(TT.effectiveValue('link.color', {}, 'light'), '#c45a3b');
  assert.equal(TT.effectiveValue('selection.color', {}, 'light'), '#c45a3b');
  // button.bg deriva dal colore del testo, button.fg dallo sfondo
  assert.equal(TT.effectiveValue('button.bg', {}, 'light'), '#1a1918');
  assert.equal(TT.effectiveValue('button.fg', {}, 'dark'), '#1e1d1b');
});

test("l'override della categoria si propaga ai token che ne ereditano", () => {
  const o = { accent: '#1e90ff' };
  assert.equal(TT.effectiveValue('accent', o, 'light'), '#1e90ff');
  assert.equal(TT.effectiveValue('link.color', o, 'light'), '#1e90ff');
  assert.equal(TT.effectiveValue('selection.color', o, 'light'), '#1e90ff');
  // ...ma non a token estranei alla categoria
  assert.equal(TT.effectiveValue('background', o, 'light'), '#f8f6f0');
});

test("l'override del token specifico vince sulla categoria", () => {
  const o = { accent: '#1e90ff', 'link.color': '#00aa00' };
  assert.equal(TT.effectiveValue('link.color', o, 'light'), '#00aa00');
  assert.equal(TT.effectiveValue('selection.color', o, 'light'), '#1e90ff');
});

test('rimuovere un override riporta al predefinito', () => {
  assert.equal(TT.effectiveValue('accent', { accent: '#1e90ff' }, 'light'), '#1e90ff');
  assert.equal(TT.effectiveValue('accent', {}, 'light'), '#c45a3b');
});

// ── validazione ─────────────────────────────────────────────────────────────

test('validate accetta i valori sani per tipo', () => {
  assert.ok(TT.validate('accent', '#1e90ff'));
  assert.ok(TT.validate('accent', '#abc'));
  assert.ok(TT.validate('accent', 'rgb(10, 20, 30)'));
  assert.ok(TT.validate('accent', 'rgba(10, 20, 30, 0.5)'));
  assert.ok(TT.validate('selection.opacity', '0.4'));
  assert.ok(TT.validate('selection.opacity', '1'));
  assert.ok(TT.validate('radius', '12px'));
  assert.ok(TT.validate('radius', '0.5rem'));
  assert.ok(TT.validate('font', "'Comic Sans MS', cursive"));
});

test('validate rifiuta valori malformati o ostili (CSS injection)', () => {
  assert.ok(!TT.validate('accent', 'red'));               // keyword non in whitelist
  assert.ok(!TT.validate('accent', '#zzz'));
  assert.ok(!TT.validate('accent', '#fff; background: url(http://evil)'));
  assert.ok(!TT.validate('accent', '}body{display:none}'));
  assert.ok(!TT.validate('selection.opacity', '2'));
  assert.ok(!TT.validate('selection.opacity', '-1'));
  assert.ok(!TT.validate('radius', '10vw'));
  assert.ok(!TT.validate('font', 'x;}{'));
  assert.ok(!TT.validate('font', 'url(http://evil)'));
  assert.ok(!TT.validate('inesistente', '#fff'));         // token non registrato
  assert.ok(!TT.validate('accent', 42));
});

test('sanitize separa override validi e rifiutati', () => {
  const { clean, rejected } = TT.sanitize({
    accent: '#1e90ff',
    radius: 'evil;}',
    boh: '#fff',
  });
  assert.deepEqual(clean, { accent: '#1e90ff' });
  assert.deepEqual(rejected.sort(), ['boh', 'radius']);
});

test('effectiveValue ignora gli override non validi', () => {
  assert.equal(TT.effectiveValue('accent', { accent: 'evil;}' }, 'light'), '#c45a3b');
});

// ── emissione CSS ───────────────────────────────────────────────────────────

test('pageCss emette solo le variabili sovrascritte', () => {
  assert.equal(TT.pageCss({}), '');
  assert.equal(TT.pageCss(null), '');
  const css = TT.pageCss({ accent: '#1e90ff', radius: '12px' });
  assert.match(css, /^html\[data-sn-theme\] \{/);
  assert.match(css, /--sn-accent: #1e90ff;/);
  assert.match(css, /--sn-radius: 12px;/);
  // accent emette anche la tripletta rgb per le tinte rgba(...)
  assert.match(css, /--sn-accent-rgb: 30, 144, 255;/);
  assert.ok(!css.includes('--sn-bg'));
});

test('pageCss scarta gli override non validi senza perdere gli altri', () => {
  const css = TT.pageCss({ accent: '#1e90ff', radius: 'evil;}' });
  assert.match(css, /--sn-accent: #1e90ff;/);
  assert.ok(!css.includes('evil'));
});

test('shellCss mappa i token sulle variabili della shell', () => {
  const css = TT.shellCss({ accent: '#1e90ff', text: '#112233', error: '#ff0000' });
  assert.match(css, /^html:root \{/);
  assert.match(css, /--accent: #1e90ff;/);
  assert.match(css, /--accent-rgb: 30, 144, 255;/);
  assert.match(css, /--fg: #112233;/);
  // error non ha una variabile gemella nella shell: non deve emettere nulla
  assert.ok(!css.includes('#ff0000'));
});

test('toRgbTriplet converte hex corti, lunghi e rgb()', () => {
  assert.equal(TT.toRgbTriplet('#fff'), '255, 255, 255');
  assert.equal(TT.toRgbTriplet('#1e90ff'), '30, 144, 255');
  assert.equal(TT.toRgbTriplet('rgb(1, 2, 3)'), '1, 2, 3');
  assert.equal(TT.toRgbTriplet('rgba(1, 2, 3, 0.5)'), '1, 2, 3');
  assert.equal(TT.toRgbTriplet('boh'), null);
});

// ── leggibilità (#146.4): testo vs sfondo ────────────────────────────────────

test('contrastRatio: colori identici → 1, nero su bianco → ~21', () => {
  assert.equal(TT.contrastRatio('#000000', '#000000'), 1);
  assert.ok(Math.abs(TT.contrastRatio('#000000', '#ffffff') - 21) < 0.1);
  assert.equal(TT.contrastRatio('#000000', 'non-un-colore'), null);
});

test('illegibleAfter intercetta "testo ≈ sfondo" (entrambe le direzioni)', () => {
  // Default chiaro: testo #1a1918 su sfondo #f8f6f0 (alto contrasto).
  // Rendere il testo uguale allo sfondo → illeggibile.
  assert.equal(TT.illegibleAfter('text', '#f8f6f0', {}, 'light'), true);
  // Rendere lo sfondo uguale al testo → illeggibile.
  assert.equal(TT.illegibleAfter('background', '#1a1918', {}, 'light'), true);
  // Bottone: sfondo del bottone uguale al testo del bottone (default chiaro) →
  // illeggibile (è la coppia button.fg/button.bg).
  assert.equal(TT.illegibleAfter('button.bg', '#f8f6f0', {}, 'light'), true);
});

test('illegibleAfter NON segnala i cambi estetici sensati', () => {
  // Un accento verde non tocca la coppia testo/sfondo né i bottoni.
  assert.equal(TT.illegibleAfter('accent', '#3a7d44', {}, 'light'), false);
  // Un bottone verde resta leggibile sul testo chiaro dei bottoni.
  assert.equal(TT.illegibleAfter('button.bg', '#3a7d44', {}, 'light'), false);
  // Cambiare il raggio degli angoli non c'entra con la leggibilità.
  assert.equal(TT.illegibleAfter('radius', '12px', {}, 'light'), false);
});
