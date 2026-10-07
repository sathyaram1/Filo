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

// ------------------------------------------------------------
// Fondo di una scheda non attiva (#821): Pipeline 3-4 della spec, senza
// attenuazioni in più. Le due barre sono il neutro delle schede di shell.css.
// ------------------------------------------------------------

const BARRE = { chiaro: [239, 227, 203], scuro: [42, 36, 29] };
const vicino = (got, want, msg) => {
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) <= 1, `${msg}: ${got} invece di ${want}`);
};

test('fondo della scheda non attiva = adattato × opacità + barra × (1 − opacità), nei due temi', () => {
  const adattato = [255, 0, 0];
  for (const [tema, barra] of Object.entries(BARRE)) {
    for (const op of [0, 0.25, 0.6, 0.9, 1]) {
      const got = TC.inactiveTabBackground('rgb(255, 0, 0)', barra, { opacita_tab: op });
      const want = [0, 1, 2].map((i) => adattato[i] * op + barra[i] * (1 - op));
      vicino(got, want, `${tema}, opacità ${op}`);
    }
  }
});

test('saturazione e opacità a 1: la scheda di YouTube è rosso YouTube; a 0 è la barra', () => {
  for (const barra of Object.values(BARRE)) {
    assert.deepEqual(TC.inactiveTabBackground('rgb(255, 0, 0)', barra, { saturazione_tab: 1, opacita_tab: 1 }), [255, 0, 0]);
    assert.deepEqual(TC.inactiveTabBackground('rgb(255, 0, 0)', barra, { opacita_tab: 0 }), barra);
  }
});

test('coi valori predefiniti il rosso resta rosso vivo, non il grigiastro della vecchia regola', () => {
  const got = TC.inactiveTabBackground('rgb(255, 0, 0)', BARRE.chiaro, TC.defaultParams());
  vicino(got, [249, 91, 81], 'predefiniti, tema chiaro');
  const [h, s] = TC.rgbToHsl(...got);
  assert.ok(h < 0.02 || h > 0.98, `tinta rossa, ottenuto ${h * 360}°`);
  assert.ok(s > 0.9, `saturazione viva (la vecchia regola dava ~0.18), ottenuto ${s}`);
});

test('saturazione_tab pesa per intero: 0 spegne la tinta, 1 la accende', () => {
  const grigia = TC.inactiveTabBackground('rgb(255, 0, 0)', BARRE.chiaro, { saturazione_tab: 0, opacita_tab: 1 });
  assert.equal(TC.chroma(`rgb(${grigia.join(',')})`), 0);
  const piena = TC.inactiveTabBackground('rgb(255, 0, 0)', BARRE.chiaro, { saturazione_tab: 1, opacita_tab: 1 });
  assert.equal(TC.chroma(`rgb(${piena.join(',')})`), 255);
});

test('«colori più vivaci» dai predefiniti dà una differenza che si vede', () => {
  const prima = TC.inactiveTabBackground('rgb(255, 0, 0)', BARRE.chiaro, TC.defaultParams());
  const preset = { ...TC.defaultParams(), saturazione_tab: 1, opacita_tab: 0.9 };
  const dopo = TC.inactiveTabBackground('rgb(255, 0, 0)', BARRE.chiaro, preset);
  const dist = Math.hypot(...[0, 1, 2].map((i) => dopo[i] - prima[i]));
  assert.ok(dist > 60, `differenza troppo piccola: ${prima} → ${dopo}`);
});

test('adattamento: tinta del sito coi parametri, acromatico inalterato, riapplicarlo non cambia niente', () => {
  const ripiego = TC.adaptIdentity('rgb(220, 30, 90)', { saturazione_tab: 1, luminosita_tab: 0.5 });
  const [h, s, l] = TC.rgbToHsl(...ripiego);
  assert.ok(Math.abs(h - TC.rgbToHsl(220, 30, 90)[0]) < 0.01, 'stessa tinta');
  assert.ok(s > 0.98 && Math.abs(l - 0.5) < 0.01, `saturazione e luminosità dai parametri: ${ripiego}`);
  assert.deepEqual(TC.adaptIdentity('rgb(250, 250, 250)', TC.defaultParams()), [250, 250, 250]);
  assert.deepEqual(TC.adaptIdentity('rgb(24, 23, 23)', TC.defaultParams()), [24, 23, 23]);
  const gia = TC.adaptIdentity([255, 0, 0], TC.defaultParams());
  assert.deepEqual(TC.adaptIdentity(gia, TC.defaultParams()), gia);
  assert.equal(TC.inactiveTabBackground(null, BARRE.chiaro, TC.defaultParams()), null);
  assert.equal(TC.inactiveTabBackground('non-un-colore', BARRE.chiaro, TC.defaultParams()), null);
});

test('il titolo regge 4,5:1 su ogni colore, a riposo e in hover, nei due temi', () => {
  const temi = {
    chiaro: { barra: BARRE.chiaro, pagina: [253, 246, 236], fg: [42, 34, 26] },
    scuro: { barra: BARRE.scuro, pagina: [29, 26, 22], fg: [241, 231, 214] },
    incognito: { barra: [52, 44, 71], pagina: [42, 36, 56], fg: [236, 231, 245] },
  };
  const identita = ['rgb(250, 250, 250)', 'rgb(30, 30, 30)', 'rgb(128, 128, 128)'];
  for (let h = 0; h < 360; h += 10) identita.push(TC.hslToRgb(h / 360, 1, 0.5));
  const peggiore = { r: Infinity };
  for (const [tema, t] of Object.entries(temi)) {
    for (const op of [0.05, 0.35, 0.6, 0.9, 1]) {
      for (const lum of [0.2, 0.5, 0.8]) {
        for (const id of identita) {
          const params = { opacita_tab: op, luminosita_tab: lum };
          const bg = TC.inactiveTabBackground(id, t.barra, params);
          const { ink, hover } = TC.inkAndHover(bg, t.fg, t.pagina);
          const r = Math.min(TC.contrastRatio(ink, bg), TC.contrastRatio(ink, hover));
          if (r < peggiore.r) Object.assign(peggiore, { r, tema, op, lum, id, bg, ink });
        }
      }
    }
  }
  assert.ok(peggiore.r >= 4.5, `contrasto ${peggiore.r.toFixed(2)} in ${JSON.stringify(peggiore)}`);
});

test('hover di una scheda colorata: va verso il polo lontano dall\'inchiostro', () => {
  const scuro = [42, 34, 26], chiaro = [253, 246, 236];
  const giallo = TC.inkAndHover([249, 219, 81], scuro, chiaro);
  assert.deepEqual(giallo.ink, scuro);
  assert.ok(TC.relativeLuminance(giallo.hover) > TC.relativeLuminance([249, 219, 81]));
  const blu = TC.inkAndHover([96, 91, 234], scuro, chiaro);
  assert.deepEqual(blu.ink, chiaro);
  assert.ok(TC.relativeLuminance(blu.hover) < TC.relativeLuminance([96, 91, 234]));
});

test('inchiostro: col fondo chiaro vince quello scuro del tema, col fondo scuro quello chiaro', () => {
  const scuro = [42, 34, 26], chiaro = [253, 246, 236];
  assert.deepEqual(TC.readableInk([[249, 219, 81]], [scuro, chiaro]), scuro);
  assert.deepEqual(TC.readableInk([[170, 14, 12]], [scuro, chiaro]), chiaro);
  // Inchiostri del tema che non reggono (token dell'utente): si ripiega su nero o bianco.
  assert.deepEqual(TC.readableInk([[128, 128, 128]], [[120, 120, 120], [140, 140, 140]]), [0, 0, 0]);
  assert.ok(Math.abs(TC.contrastRatio([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
});
