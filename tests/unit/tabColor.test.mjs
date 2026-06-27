// Unit test per src/shared/tabColor.js — la regola che decide se un colore
// "ha identità" (brand del sito) o è chrome neutra da scartare.
//
// È il cuore del fix "tinta della tab dal favicon": un theme-color bianco (es.
// YouTube) NON ha identità → si deve ripiegare sul favicon. Questi test
// asseriscono proprio quella decisione, senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'tabColor.js'));

const TC = globalThis.SN_TAB_COLOR;

test('tabColor si registra su globalThis con la sua API', () => {
  assert.ok(TC);
  assert.equal(typeof TC.hasIdentity, 'function');
  assert.equal(typeof TC.chroma, 'function');
  assert.equal(TC.IDENTITY_CHROMA_MIN, 24);
});

test('chrome neutra (bianco/nero/grigio) NON ha identità', () => {
  assert.equal(TC.hasIdentity('rgb(255, 255, 255)'), false, 'bianco (theme-color YouTube light)');
  assert.equal(TC.hasIdentity('rgb(0, 0, 0)'), false, 'nero');
  assert.equal(TC.hasIdentity('rgb(15, 15, 15)'), false, 'quasi-nero (YouTube dark)');
  assert.equal(TC.hasIdentity('rgb(128, 128, 128)'), false, 'grigio medio');
  assert.equal(TC.hasIdentity('rgb(250, 250, 252)'), false, 'quasi-bianco (croma 2)');
});

test('un vero colore brand HA identità', () => {
  assert.equal(TC.hasIdentity('rgb(255, 0, 0)'), true, 'rosso YouTube');
  assert.equal(TC.hasIdentity('rgb(29, 161, 242)'), true, 'azzurro');
  assert.equal(TC.hasIdentity('rgb(40, 60, 90)'), true, 'blu scuro brand (croma 50)');
  assert.equal(TC.hasIdentity('rgb(200, 180, 40)'), true, 'giallo/oro');
});

test('soglia: appena sotto/sopra IDENTITY_CHROMA_MIN', () => {
  // croma 23 → no, croma 24 → sì (la soglia è inclusiva).
  assert.equal(TC.hasIdentity('rgb(123, 100, 100)'), false, 'croma 23');
  assert.equal(TC.hasIdentity('rgb(124, 100, 100)'), true, 'croma 24');
});

test('input invalido o nullo → nessuna identità (no crash)', () => {
  assert.equal(TC.hasIdentity(null), false);
  assert.equal(TC.hasIdentity(''), false);
  assert.equal(TC.hasIdentity('non-un-colore'), false);
  assert.equal(TC.chroma(null), 0);
});

test('chroma calcola max-min sui canali', () => {
  assert.equal(TC.chroma('rgb(255, 0, 0)'), 255);
  assert.equal(TC.chroma('rgb(100, 100, 100)'), 0);
  assert.equal(TC.chroma('rgb(200, 150, 100)'), 100);
});

// ------------------------------------------------------------
// Estrazione colore identità dal favicon (nuova pipeline a due path)
// ------------------------------------------------------------

// Costruisce un buffer RGBA width×height: cb(x,y) → [r,g,b,a].
function makeFavicon(w, h, cb) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = cb(x, y);
      const i = (y * w + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a == null ? 255 : a;
    }
  }
  return px;
}

function rgbParts(str) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(str);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function hueDeg(str) {
  const [r, g, b] = rgbParts(str);
  return TC.rgbToHsl(r, g, b)[0] * 360;
}

test('API estrazione registrata', () => {
  assert.equal(typeof TC.extractIdentityFromPixels, 'function');
  assert.equal(typeof TC.rgbToHsl, 'function');
  assert.equal(TC.IDENTITY_PARAMS.soglia_saturazione, 0.30);
});

test('favicon vuoto/trasparente → null (tab resta neutra)', () => {
  const px = makeFavicon(16, 16, () => [0, 0, 0, 0]);
  assert.equal(TC.extractIdentityFromPixels(px, 16, 16), null);
});

test('logo rosso centrale su sfondo bianco → tinta rossa, non rosa slavato', () => {
  // Sfondo bianco (acromatico, scartato dal path cromatico) + quadrato rosso
  // al centro. La vecchia media su TUTTI i pixel cromatici qui non esisteva
  // (il bianco veniva scartato), ma il punto è: il risultato deve essere ROSSO.
  const W = 64, H = 64;
  const px = makeFavicon(W, H, (x, y) => {
    const inLogo = x >= 24 && x < 40 && y >= 24 && y < 40;
    return inLogo ? [220, 20, 20, 255] : [255, 255, 255, 255];
  });
  const out = TC.extractIdentityFromPixels(px, W, H);
  const h = hueDeg(out);
  assert.ok(h < 20 || h > 340, `tinta rossa attesa, ottenuto hue ${h}° (${out})`);
});

test('logo bicolore (giallo + blu, caso Poste): i due colori NON si annullano in un grigio', () => {
  // Metà sinistra gialla, metà destra blu, entrambi saturi e centrali. La media
  // ingenua su tutti i pixel cromatici darebbe un grigio/verdastro. Il
  // clustering per tinta deve invece restituire UNO dei due brand puri.
  const W = 64, H = 64;
  const yellow = [240, 200, 20], blue = [20, 60, 220];
  const px = makeFavicon(W, H, (x) => (x < W / 2 ? [...yellow, 255] : [...blue, 255]));
  const out = TC.extractIdentityFromPixels(px, W, H);
  const [r, g, b] = rgbParts(out);
  // Non dev'essere un grigio (croma alta) e dev'essere o giallo o blu.
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 60, `atteso colore saturo, ottenuto ${out}`);
  const h = hueDeg(out);
  const isYellow = h > 40 && h < 70;
  const isBlue = h > 210 && h < 250;
  assert.ok(isYellow || isBlue, `atteso giallo o blu, ottenuto hue ${h}° (${out})`);
});

test('favicon acromatico (bianco, es. Wikipedia/X) → grigio chiaro, non null', () => {
  const W = 32, H = 32;
  const px = makeFavicon(W, H, () => [250, 250, 250, 255]);
  const out = TC.extractIdentityFromPixels(px, W, H);
  const [r, g, b] = rgbParts(out);
  assert.equal(r, g); assert.equal(g, b);          // grigio puro
  assert.ok(r > 200, `atteso grigio chiaro, ottenuto ${out}`);
});

test('centralità: logo centrale vince su rumore saturo ai bordi', () => {
  // Verde al centro, pochi pixel rossi negli angoli. La centralità deve far
  // vincere il verde anche se il rosso è ugualmente saturo.
  const W = 64, H = 64;
  const px = makeFavicon(W, H, (x, y) => {
    const cornerRed = (x < 4 || x >= W - 4) && (y < 4 || y >= H - 4);
    if (cornerRed) return [230, 20, 20, 255];
    const inLogo = x >= 26 && x < 38 && y >= 26 && y < 38;
    return inLogo ? [20, 200, 60, 255] : [255, 255, 255, 255];
  });
  const out = TC.extractIdentityFromPixels(px, W, H);
  const h = hueDeg(out);
  assert.ok(h > 90 && h < 160, `atteso verde (centrale), ottenuto hue ${h}° (${out})`);
});
