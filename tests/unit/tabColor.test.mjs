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

// ────────────────────── scelta della tinta (#429) ──────────────────────────
// La scheda attiva è la continuazione della pagina che ha sotto: la sua tinta è
// il colore campionato dalla cima pagina. Il ripiego sul colore identità serve
// a un caso solo — chrome neutra che nasconde un marchio colorato (YouTube) —
// e quindi vale solo se quel colore un colore ce l'ha. Prima il ripiego
// scattava su QUALSIASI identityColor: sulle pagine interne di Filo, il cui
// favicon è monocromatico, il grigio del ripiego acromatico prendeva il posto
// del bianco caldo della pagina e la scheda attiva smetteva di continuarla.

test('scheda attiva: cima pagina colorata → vince la cima pagina', () => {
  assert.equal(
    TC.pickActiveTint('rgb(20, 40, 200)', 'rgb(220, 30, 90)'),
    'rgb(20, 40, 200)',
  );
});

test('scheda attiva: cima neutra + marchio colorato → vince il marchio (caso YouTube)', () => {
  assert.equal(
    TC.pickActiveTint('rgb(255, 255, 255)', 'rgb(220, 30, 90)'),
    'rgb(220, 30, 90)',
  );
});

test('scheda attiva: cima neutra + identità neutra → resta la pagina, non il grigio', () => {
  // Il caso delle pagine interne di Filo: sfondo bianco caldo, favicon
  // monocromatico che l'estrazione risolve in un grigio.
  assert.equal(
    TC.pickActiveTint('rgb(248, 246, 240)', 'rgb(228, 228, 228)'),
    'rgb(248, 246, 240)',
  );
});

test('scheda attiva: senza nessun colore → null (la shell tiene il suo default)', () => {
  assert.equal(TC.pickActiveTint(null, null), null);
  assert.equal(TC.pickActiveTint(null, 'rgb(228, 228, 228)'), null);
  // Ma un identityColor VERO vale anche senza campionamento della pagina.
  assert.equal(TC.pickActiveTint(null, 'rgb(220, 30, 90)'), 'rgb(220, 30, 90)');
});

test('bagliore audio: senza un colore vero ritorna null (accento di Filo)', () => {
  // Un alone grigio è un alone che non si vede: meglio l'accento.
  assert.equal(TC.pickGlowTint('rgb(248, 246, 240)', 'rgb(228, 228, 228)'), null);
  assert.equal(TC.pickGlowTint('rgb(20, 40, 200)', null), 'rgb(20, 40, 200)');
  assert.equal(TC.pickGlowTint('rgb(255, 255, 255)', 'rgb(220, 30, 90)'), 'rgb(220, 30, 90)');
});

// ─── #429: il nome della scheda deve restare leggibile su QUALSIASI tinta ───
// Al buio, la scheda in secondo piano di un sito dal marchio chiaro (Wikipedia,
// GitHub, le pagine di Filo) diventava un rettangolo grigio chiaro col nome
// scritto nel grigio caldo del tema scuro: 1,08 a 1 di contrasto.

test('readableOn sceglie il testo che contrasta di più, non una soglia secca', () => {
  // Fondo chiaro → testo scuro; fondo scuro → testo chiaro.
  assert.equal(TC.readableOn('rgb(248, 246, 240)'), TC.TESTO_SCURO);
  assert.equal(TC.readableOn('rgb(30, 29, 27)'), TC.TESTO_CHIARO);
  // Il caso che una soglia di luminanza a 0.45 sbagliava: il grigio di mezzo.
  // Luminanza relativa ~0.32 (sotto 0.45) ma il nero contrasta il doppio.
  const grigio = 'rgb(154, 151, 148)';
  assert.equal(TC.readableOn(grigio), TC.TESTO_SCURO);
  assert.ok(
    TC.contrastRatio(grigio, TC.TESTO_SCURO) > TC.contrastRatio(grigio, TC.TESTO_CHIARO),
    'sul grigio di mezzo il testo scuro contrasta di più',
  );
});

test('readableOn dà sempre il migliore dei due, su tutta la scala dei grigi', () => {
  for (let v = 0; v <= 255; v += 5) {
    const bg = `rgb(${v}, ${v}, ${v})`;
    const scelto = TC.readableOn(bg);
    const altro = scelto === TC.TESTO_SCURO ? TC.TESTO_CHIARO : TC.TESTO_SCURO;
    assert.ok(
      TC.contrastRatio(bg, scelto) >= TC.contrastRatio(bg, altro),
      `grigio ${v}: scelto il testo meno leggibile`,
    );
    // Col nero e il bianco di Filo il peggior fondo possibile (il grigio a metà
    // strada) dà 4,06: sotto quello non si scende mai.
    assert.ok(TC.contrastRatio(bg, scelto) >= 4.0, `grigio ${v}: contrasto troppo basso`);
  }
});

test('softOn attenua il nome delle schede in secondo piano senza renderlo illeggibile', () => {
  // La tinta che rendeva illeggibile il nome al buio: marchio chiaro (228)
  // mescolato al 60% col fondo scuro della barra (#2a241d).
  const tinta = TC.mixSrgb('rgb(228, 228, 228)', 'rgb(42, 36, 29)', 0.6);
  assert.equal(tinta, 'rgb(154, 151, 148)');
  const soft = TC.softOn(tinta);
  const c = TC.contrastRatio(tinta, soft);
  assert.ok(c >= 4.5, `il nome attenuato resta leggibile (contrasto ${c.toFixed(2)})`);
  // e resta comunque più spento del testo pieno
  assert.ok(c < TC.contrastRatio(tinta, TC.readableOn(tinta)), 'è attenuato, non pieno');
  // il grigio caldo del tema scuro, quello di prima, era a 1,08: mai più.
  assert.ok(TC.contrastRatio(tinta, 'rgb(170, 156, 132)') < 1.2, 'la pre-condizione del difetto');
});

test('softOn regge tutta la scala dei grigi e i colori pieni', () => {
  const fondi = [];
  for (let v = 0; v <= 255; v += 5) fondi.push(`rgb(${v}, ${v}, ${v})`);
  fondi.push('rgb(190, 40, 40)', 'rgb(20, 90, 200)', 'rgb(30, 120, 60)', 'rgb(240, 220, 40)');
  for (const bg of fondi) {
    const soft = TC.softOn(bg);
    const c = TC.contrastRatio(bg, soft);
    // O l'attenuazione sta sopra 4,5, o la cintura è scattata e il colore è
    // quello pieno: mai una via di mezzo illeggibile.
    assert.ok(c >= 4.5 || soft === TC.readableOn(bg), `${bg}: contrasto ${c.toFixed(2)}`);
    assert.ok(c >= 4.0, `${bg}: contrasto ${c.toFixed(2)} sotto il minimo assoluto`);
  }
});

test('mixSrgb replica color-mix(in srgb, a p%, b)', () => {
  assert.equal(TC.mixSrgb('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 0.5), 'rgb(100, 50, 25)');
  assert.equal(TC.mixSrgb('rgb(10, 20, 30)', 'rgb(10, 20, 30)', 0.3), 'rgb(10, 20, 30)');
});

test('colori illeggibili non fanno esplodere niente', () => {
  assert.equal(TC.readableOn(null), null);
  assert.equal(TC.readableOn('non-un-colore'), null);
  assert.equal(TC.softOn(''), null);
  assert.equal(TC.mixSrgb('boh', 'rgb(0,0,0)', 0.5), null);
  assert.equal(TC.contrastRatio('boh', 'rgb(0,0,0)'), null);
});
