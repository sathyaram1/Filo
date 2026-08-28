// Unit test per la geometria del menu contestuale (`computeCap` e
// `computeOffset` in src/content/menu.js): quanto può essere alto il menu, dove
// si posa, quando si ribalta e — feedback #500 — cosa succede quando CRESCE
// dopo essere stato posato (la spiegazione AI che passa da una riga a tre).
// Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// La geometria vive in `src/shared/overlayPlacement.js` (condivisa col riquadro
// della risposta di Filo); il menu la ri-espone. Va caricata prima.
require(join(ROOT, 'src', 'shared', 'overlayPlacement.js'));
require(join(ROOT, 'src', 'content', 'menu.js'));
const Menu = globalThis.SN_MENU;

// Finestra di riferimento: la stessa del feedback (800px di altezza).
const VW = 1280, VH = 800;

// Fa quello che fa `place()` nel browser: tetto, poi posa con l'altezza vera.
function posa({ x, y, w, h, vw = VW, vh = VH, scale = 1, from = null }) {
  const cap = Menu.computeCap({ h, vh, scale });
  const hVero = cap != null ? Math.min(h, cap) : h;
  const p = Menu.computeOffset({
    x, y, visW: w * scale, visH: hVero * scale, vw, vh, from,
  });
  return { ...p, cap, visH: hVero * scale };
}

function assertDentro(p, vh = VH) {
  assert.ok(p.top >= 0, `top negativo: ${p.top}`);
  assert.ok(p.top + p.visH <= vh, `sfora il bordo basso di ${p.top + p.visH - vh}px`);
}

test('si registra su globalThis con la geometria esposta', () => {
  assert.ok(Menu, 'SN_MENU assente');
  assert.equal(typeof Menu.computeCap, 'function');
  assert.equal(typeof Menu.computeOffset, 'function');
  assert.equal(typeof Menu.computeSubOffset, 'function');
});

test('con spazio abbondante il menu nasce esattamente sotto al cursore', () => {
  const p = posa({ x: 300, y: 120, w: 240, h: 384 });
  assert.equal(p.cap, null);
  assert.deepEqual({ left: p.left, top: p.top }, { left: 300, top: 120 });
});

test('cliccando in basso il menu si apre verso l\'alto', () => {
  const p = posa({ x: 300, y: 700, w: 240, h: 384 });
  assert.equal(p.top, 700 - 384);
  assertDentro(p);
});

test('vicino al bordo destro il menu rientra', () => {
  const p = posa({ x: 1270, y: 100, w: 240, h: 200 });
  assert.equal(p.left, VW - 240 - 8);
});

// --- #500: il menu cresce DOPO essere stato posato -------------------------

test('#500 la spiegazione arriva, il menu cresce: rientra invece di farsi tagliare', () => {
  // Posa iniziale (menu corto): sotto al cursore, ci stava.
  const primo = posa({ x: 300, y: 428, w: 240, h: 340 });
  assert.equal(primo.top, 428);
  // Il riquadro passa a tre righe: 384px, e ora sforerebbe di 12px.
  const dopo = posa({ x: 300, y: 428, w: 240, h: 384, from: { left: primo.left, top: primo.top } });
  assert.equal(dopo.top, VH - 384 - 8);
  assertDentro(dopo);
});

test('#500 crescendo il menu scivola del minimo, non salta sopra al cursore', () => {
  const dopo = posa({ x: 300, y: 428, w: 240, h: 384, from: { left: 300, top: 428 } });
  // Scivolata di 20px: se invece si ribaltasse finirebbe a 44 (428 - 384).
  assert.equal(428 - dopo.top, 20);
});

test('#500 il menu di una scheda filmato più collegamento (655px) resta dentro', () => {
  const primo = posa({ x: 300, y: 157, w: 240, h: 600 });
  assert.equal(primo.top, 157);
  const dopo = posa({ x: 300, y: 157, w: 240, h: 655, from: { left: primo.left, top: primo.top } });
  assert.equal(dopo.top, VH - 655 - 8);
  assertDentro(dopo);
});

test('#500 se crescendo supera la finestra intera diventa scorrevole', () => {
  const dopo = posa({ x: 300, y: 300, w: 240, h: 900, from: { left: 300, top: 300 } });
  assert.equal(dopo.cap, VH - 16);
  assertDentro(dopo);
});

test('#500 un menu che si ACCORCIA perde il tetto e torna intero', () => {
  // La misura arriva sempre dall'altezza naturale: se il contenuto è rientrato
  // nella finestra non resta nessun tetto addosso (niente barra di scorrimento
  // su un menu che ci starebbe tutto).
  const p = posa({ x: 300, y: 100, w: 240, h: 300, from: { left: 300, top: 100 } });
  assert.equal(p.cap, null);
});

// --- #500: la FINESTRA si accorcia sotto un menu fermo ---------------------
// Lo stesso difetto preso dall'altro verso: là si allungava il menu sotto una
// finestra ferma, qui si accorcia la finestra sotto un menu fermo. In tutti e
// due i casi il fondo esce dal bordo e le ultime voci diventano irraggiungibili,
// quindi il conto va rifatto uguale.

test('#500 la finestra si accorcia: il menu rientra invece di restare mezzo fuori', () => {
  const primo = posa({ x: 300, y: 400, w: 240, h: 300 });
  assert.equal(primo.top, 400);
  // Da 800 a 460px di altezza: dov'è, il menu sforerebbe di 248px.
  const dopo = posa({ x: 300, y: 400, w: 240, h: 300, vh: 460, from: { left: primo.left, top: primo.top } });
  assert.equal(dopo.top, 460 - 300 - 8);
  assertDentro(dopo, 460);
});

test('#500 la finestra scende sotto l\'altezza del menu: tetto e scorrimento', () => {
  const dopo = posa({ x: 300, y: 400, w: 240, h: 600, vh: 300, from: { left: 300, top: 400 } });
  assert.equal(dopo.cap, 300 - 16);
  assertDentro(dopo, 300);
});

test('#500 la finestra si stringe: il menu rientra anche di lato', () => {
  const dopo = posa({ x: 900, y: 100, w: 240, h: 200, vw: 700, from: { left: 900, top: 100 } });
  assert.equal(dopo.left, 700 - 240 - 8);
});

test('#500 rimpicciolendo la finestra il menu scivola, non si ribalta sopra al cursore', () => {
  // Ribaltare vorrebbe dire top = 400 - 300 = 100. Scivolare è il minimo: 152.
  const dopo = posa({ x: 300, y: 400, w: 240, h: 300, vh: 460, from: { left: 300, top: 400 } });
  assert.equal(dopo.top, 152);
});

// --- #500: il pannello ancorato si muove col menu --------------------------

// Come `placeSub()` nel browser, ma coi numeri in chiaro: un menu alto `mH`
// posato a `mTop`, e dentro di lui la freccetta a `aTop` (misurata dall'alto
// del menu).
function posaPannello({ mTop, mLeft = 300, mW = 240, aTop, aH = 28, w = 200, h = 120, mode = 'anchor', vw = VW, vh = VH }) {
  return Menu.computeSubOffset({
    aTop: mTop + aTop, aLeft: mLeft, aRight: mLeft + mW,
    mLeft, mRight: mLeft + mW,
    w, h, vw, vh, mode,
  });
}

test('#500 il pannello nasce allineato alla freccetta che l\'ha aperto', () => {
  const p = posaPannello({ mTop: 100, aTop: 8 });
  assert.equal(p.top, 108);
  assert.equal(p.left, 300 + 240 + 4);
});

test('#500 il menu scivola in su e il pannello scivola con lui, dello stesso tanto', () => {
  const prima = posaPannello({ mTop: 400, aTop: 8 });
  const dopo = posaPannello({ mTop: 380, aTop: 8 });
  assert.equal(prima.top - dopo.top, 20);
});

test('#500 il menu scorre di 180px sotto al pannello: il pannello lo segue', () => {
  // La freccetta sta in cima al menu: scorrendo il contenuto risale, e il
  // pannello deve risalire con lei invece di restare a mezz\'aria.
  const prima = posaPannello({ mTop: 8, aTop: 200 });
  const dopo = posaPannello({ mTop: 8, aTop: 20 });
  assert.equal(prima.top - dopo.top, 180);
});

test('#500 un pannello alto ricade verso l\'alto invece di sforare in basso', () => {
  const p = posaPannello({ mTop: 600, aTop: 100, h: 300 });
  assert.equal(p.top, VH - 300 - 8);
});

test('#500 se a destra non ci sta il pannello passa a sinistra del menu', () => {
  const p = posaPannello({ mTop: 100, mLeft: VW - 260, aTop: 8, w: 200 });
  assert.equal(p.left, VW - 260 - 200 - 4);
});

test('#500 la cronologia incolla resta attaccata al bordo del menu', () => {
  const p = posaPannello({ mTop: 100, aTop: 40, mode: 'edge' });
  assert.equal(p.left, 300 + 240 - 2);
  assert.equal(p.top, 140);
});

// --- #405: dentro un riquadro incorporato lo spazio è poco -----------------

test('#405 in un riquadro più basso del menu, il menu diventa scorrevole', () => {
  const p = posa({ x: 40, y: 100, w: 240, h: 384, vw: 600, vh: 220 });
  assert.equal(p.cap, 220 - 16);
  assertDentro(p, 220);
});

// --- zoom: il menu è disegnato scalato, conta quello che occupa davvero -----

test('con lo zoom della pagina l\'altezza che conta è quella a schermo', () => {
  // Pagina zoomata: la finestra misura 400px CSS e il menu è disegnato a metà
  // scala, quindi occupa 192px veri. Ci sta: niente tetto, niente scorrimento.
  const p = posa({ x: 100, y: 100, w: 240, h: 384, vw: 640, vh: 400, scale: 0.5 });
  assert.equal(p.cap, null);
  assert.equal(p.top, 100);
  assertDentro(p, 400);
});

test('con lo zoom il tetto è in px di layout, non di schermo', () => {
  const p = posa({ x: 100, y: 100, w: 240, h: 1200, vw: 640, vh: 400, scale: 0.5 });
  // 384px a schermo (400 - 16) = 768px di layout, che scalati fanno 384.
  assert.equal(p.cap, (400 - 16) / 0.5);
  assertDentro(p, 400);
});
