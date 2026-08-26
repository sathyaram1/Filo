// Unit test per la geometria del riquadro della risposta di Filo — quello che
// si apre chiedendo di spiegare o tradurre e si riempie mentre la risposta
// arriva (#502; stesso difetto del menu del tasto destro, #500).
//
// Il riquadro viene posato quando è ancora VUOTO (~200px: sta caricando). Poi
// la risposta arriva e lo porta al suo tetto (480px). Se nessuno lo rimisura il
// fondo esce dalla finestra: la riga col modello e il costo tagliata a metà, il
// campo della domanda successiva del tutto fuori — la conversazione finisce lì.
//
// Qui si prova la geometria pura (`src/shared/overlayPlacement.js`), la stessa
// che regge anche il menu del tasto destro. Logica pura → niente Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'overlayPlacement.js'));
const Place = globalThis.SN_PLACE;

// Finestra di riferimento: la stessa della segnalazione (800px di altezza).
const VW = 1280, VH = 800;
// Le misure vere del riquadro: `.sn-popup` è largo 380 e non passa i 480 di
// altezza; vuoto, in attesa della risposta, sta sotto i 200.
const W = 380, H_VUOTO = 200, H_PIENO = 480;
// Sotto questa altezza sparirebbero la riga del modello e il campo della
// domanda: è il minimo che `popup.js` difende.
const MIN_H = 180;
// Il riquadro nasce un filo sotto al punto cliccato.
const BIAS = 8;

// Fa quello che fa `placePopup()` nel browser: tetto, poi posa con l'altezza
// vera. `pinned` = l'utente l'ha trascinato a mano, quindi non si sposta più:
// il tetto si calcola sullo spazio che resta sotto di lui.
function posa({ x, y, h, vw = VW, vh = VH, scale = 1, from = null, pinned = false }) {
  let cap = Place.computeCap({ h, vh, scale, min: MIN_H });
  if (pinned && from) {
    const limit = Place.computePinnedLimit({ top: from.top, vh, scale, min: MIN_H });
    if (h > limit) cap = cap == null ? limit : Math.min(cap, limit);
  }
  const hVero = cap != null ? Math.min(h, cap) : h;
  const p = Place.computeOffset({
    x, y, visW: W * scale, visH: hVero * scale, vw, vh, from, bias: BIAS,
  });
  return { ...p, cap, altezza: hVero, visH: hVero * scale };
}

function assertDentro(p, vh = VH) {
  assert.ok(p.top >= 0, `top negativo: ${p.top}`);
  assert.ok(p.top + p.visH <= vh, `sfora il bordo basso di ${p.top + p.visH - vh}px`);
}

test('si registra su globalThis con la geometria esposta', () => {
  assert.ok(Place, 'SN_PLACE assente');
  for (const n of ['computeCap', 'computeOffset', 'computePinnedLimit', 'readScale', 'applyCap', 'observeGrowth']) {
    assert.equal(typeof Place[n], 'function', `manca ${n}`);
  }
});

test('con spazio abbondante il riquadro nasce appena sotto al punto cliccato', () => {
  const p = posa({ x: 300, y: 120, h: H_VUOTO });
  assert.equal(p.cap, null);
  assert.deepEqual({ left: p.left, top: p.top }, { left: 300, top: 128 });
});

test('cliccando in basso il riquadro si apre verso l\'alto', () => {
  const p = posa({ x: 300, y: 700, h: H_PIENO });
  assert.equal(p.top, 700 - H_PIENO - BIAS);
  assertDentro(p);
});

test('vicino al bordo destro il riquadro rientra', () => {
  const p = posa({ x: 1270, y: 100, h: H_VUOTO });
  assert.equal(p.left, VW - W - 8);
});

// --- #502: la risposta arriva e il riquadro cresce -------------------------

test('#502 la risposta arriva, il riquadro cresce: rientra invece di farsi tagliare', () => {
  // Posa iniziale, riquadro ancora vuoto: metà schermo, ci stava.
  const primo = posa({ x: 300, y: 400, h: H_VUOTO });
  assert.equal(primo.top, 408);
  // La risposta lo porta a 480: così com'è finirebbe 96px sotto il bordo.
  assert.ok(primo.top + H_PIENO > VH);
  const dopo = posa({ x: 300, y: 400, h: H_PIENO, from: { left: primo.left, top: primo.top } });
  assert.equal(dopo.cap, null, 'ci sta: basta spostarlo, non serve tagliarlo');
  assert.equal(dopo.top, VH - H_PIENO - 8);
  assertDentro(dopo);
});

test('#502 crescendo il riquadro scivola del minimo, non salta sopra al cursore', () => {
  const dopo = posa({ x: 300, y: 400, h: H_PIENO, from: { left: 300, top: 408 } });
  // Scivolata di 96px: ribaltandosi finirebbe a -88, cioè fuori in cima.
  assert.equal(408 - dopo.top, 96);
});

test('#502 un riquadro che non ha bisogno di muoversi non si muove di un pixel', () => {
  const dopo = posa({ x: 300, y: 100, h: H_PIENO, from: { left: 300, top: 108 } });
  assert.deepEqual({ left: dopo.left, top: dopo.top }, { left: 300, top: 108 });
});

test('#502 in una finestra più bassa del riquadro compare la barra di scorrimento', () => {
  const p = posa({ x: 100, y: 100, h: H_PIENO, vw: 900, vh: 420, from: { left: 100, top: 108 } });
  assert.equal(p.cap, 420 - 16);
  assertDentro(p, 420);
});

test('#502 se la risposta poi si accorcia il tetto sparisce', () => {
  // L\'altezza di partenza è sempre quella naturale: rientrato nella finestra,
  // il riquadro non si tiene addosso una barra che non gli serve più.
  const p = posa({ x: 300, y: 100, h: 240, from: { left: 300, top: 108 } });
  assert.equal(p.cap, null);
});

// --- #502: trascinato a mano, non si sposta più ----------------------------

test('#502 trascinato a mano, il riquadro che cresce resta dov\'è e scorre', () => {
  const from = { left: 500, top: 500 };
  const p = posa({ x: 300, y: 400, h: H_PIENO, from, pinned: true });
  assert.deepEqual({ left: p.left, top: p.top }, from, 'si è mosso sotto le dita dell\'utente');
  // Il tetto è lo spazio che resta sotto di lui: 800 - 500 - 8.
  assert.equal(p.cap, VH - 500 - 8);
  assertDentro(p);
});

test('#502 trascinato in alto, il riquadro cresce per intero senza barra', () => {
  const from = { left: 500, top: 60 };
  const p = posa({ x: 300, y: 400, h: H_PIENO, from, pinned: true });
  assert.equal(p.cap, null);
  assert.equal(p.top, 60);
});

test('#502 trascinato a filo del bordo basso, scivolare è il male minore', () => {
  // Meno di `MIN_H` di spazio sotto: tagliandolo lì sparirebbero la riga del
  // modello e il campo della domanda, cioè tutto il motivo per cui esiste.
  const from = { left: 500, top: VH - 60 };
  const p = posa({ x: 300, y: 400, h: H_PIENO, from, pinned: true });
  assert.equal(p.cap, MIN_H);
  assert.equal(p.top, VH - MIN_H - 8);
  assertDentro(p);
});

// --- zoom: il riquadro è disegnato scalato ---------------------------------

test('con lo zoom della pagina l\'altezza che conta è quella a schermo', () => {
  // Finestra di 400px CSS, riquadro disegnato a metà scala: occupa 240px veri.
  const p = posa({ x: 100, y: 100, h: H_PIENO, vw: 640, vh: 400, scale: 0.5 });
  assert.equal(p.cap, null);
  assert.equal(p.top, 108);
  assertDentro(p, 400);
});

test('con lo zoom il tetto del riquadro trascinato è in px di layout', () => {
  const limit = Place.computePinnedLimit({ top: 100, vh: 400, scale: 0.5, min: MIN_H });
  // 292px a schermo (400 - 100 - 8) = 584px di layout, che scalati fanno 292.
  assert.equal(limit, (400 - 100 - 8) / 0.5);
});
