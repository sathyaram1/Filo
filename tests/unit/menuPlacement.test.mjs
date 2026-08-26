// Unit test per la geometria del menu contestuale (`computePlacement` in
// src/content/menu.js): dove si posa il menu, quando si ribalta, quando diventa
// scorrevole e — feedback #500 — cosa succede quando CRESCE dopo essere stato
// posato (la spiegazione AI che passa da una riga a tre).
// Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'content', 'menu.js'));
const Menu = globalThis.SN_MENU;

// Finestra di riferimento: la stessa del feedback (800px di altezza).
const VW = 1280, VH = 800;
const place = (o) => Menu.computePlacement({ vw: VW, vh: VH, scale: 1, from: null, ...o });

// Il menu sta dentro la finestra, tetto compreso.
function assertDentro(p, h, { vh = VH, scale = 1 } = {}) {
  const visH = (p.maxHeight != null ? p.maxHeight : h) * scale;
  assert.ok(p.top >= 0, `top negativo: ${p.top}`);
  assert.ok(p.top + visH <= vh, `sfora il bordo basso di ${p.top + visH - vh}px`);
}

test('si registra su globalThis con la geometria esposta', () => {
  assert.ok(Menu, 'SN_MENU assente');
  assert.equal(typeof Menu.computePlacement, 'function');
});

test('con spazio abbondante il menu nasce esattamente sotto al cursore', () => {
  const p = place({ x: 300, y: 120, w: 240, h: 384 });
  assert.deepEqual({ left: p.left, top: p.top }, { left: 300, top: 120 });
  assert.equal(p.maxHeight, null);
});

test('cliccando in basso il menu si apre verso l\'alto', () => {
  const p = place({ x: 300, y: 700, w: 240, h: 384 });
  assert.equal(p.top, 700 - 384);
  assertDentro(p, 384);
});

test('vicino al bordo destro il menu rientra', () => {
  const p = place({ x: 1270, y: 100, w: 240, h: 200 });
  assert.equal(p.left, VW - 240 - 8);
});

// --- #500: il menu cresce DOPO essere stato posato -------------------------

test('#500 la spiegazione arriva, il menu cresce: rientra invece di farsi tagliare', () => {
  // Posa iniziale (menu corto): sotto al cursore, ci stava.
  const primo = place({ x: 300, y: 428, w: 240, h: 340 });
  assert.equal(primo.top, 428);
  // Il riquadro passa a tre righe: 384px, e ora sforerebbe di 12px.
  const dopo = place({ x: 300, y: 428, w: 240, h: 384, from: { left: primo.left, top: primo.top } });
  assertDentro(dopo, 384);
  assert.equal(dopo.top, VH - 384 - 8);
});

test('#500 crescendo il menu scivola del minimo, non salta sopra al cursore', () => {
  const dopo = place({ x: 300, y: 428, w: 240, h: 384, from: { left: 300, top: 428 } });
  // Scivolata di 20px: se invece si ribaltasse finirebbe a 44 (428 - 384).
  assert.equal(428 - dopo.top, 20);
});

test('#500 il menu di una scheda filmato più collegamento (655px) resta dentro', () => {
  const primo = place({ x: 300, y: 157, w: 240, h: 600 });
  assert.equal(primo.top, 157);
  const dopo = place({ x: 300, y: 157, w: 240, h: 655, from: { left: primo.left, top: primo.top } });
  assert.equal(dopo.top, VH - 655 - 8);
  assertDentro(dopo, 655);
});

test('#500 se crescendo supera la finestra intera diventa scorrevole', () => {
  const dopo = place({ x: 300, y: 300, w: 240, h: 900, from: { left: 300, top: 300 } });
  assert.equal(dopo.maxHeight, VH - 16);
  assertDentro(dopo, 900);
});

test('#500 un menu che si ACCORCIA perde il tetto e torna intero', () => {
  // La misura arriva sempre dall'altezza naturale: se il contenuto è rientrato
  // nella finestra non resta nessun tetto addosso (niente barra di scorrimento
  // su un menu che ci starebbe tutto).
  const p = place({ x: 300, y: 100, w: 240, h: 300, from: { left: 300, top: 100 } });
  assert.equal(p.maxHeight, null);
});

// --- #405: dentro un riquadro incorporato lo spazio è poco -----------------

test('#405 in un riquadro più basso del menu, il menu diventa scorrevole', () => {
  const p = Menu.computePlacement({ x: 40, y: 100, w: 240, h: 384, vw: 600, vh: 220, scale: 1, from: null });
  assert.equal(p.maxHeight, 220 - 16);
  assertDentro(p, 384, { vh: 220 });
});

// --- zoom: il menu è disegnato scalato, conta quello che occupa davvero -----

test('con lo zoom della pagina l\'altezza che conta è quella a schermo', () => {
  // Pagina zoomata: la finestra misura 400px CSS e il menu è disegnato a metà
  // scala, quindi occupa 192px veri. Ci sta: niente tetto, niente scorrimento.
  const p = Menu.computePlacement({ x: 100, y: 100, w: 240, h: 384, vw: 640, vh: 400, scale: 0.5, from: null });
  assert.equal(p.maxHeight, null);
  assert.equal(p.top, 100);
  assertDentro(p, 384, { vh: 400, scale: 0.5 });
});

test('con lo zoom il tetto è in px di layout, non di schermo', () => {
  const p = Menu.computePlacement({ x: 100, y: 100, w: 240, h: 1200, vw: 640, vh: 400, scale: 0.5, from: null });
  // 384px a schermo (400 - 16) = 768px di layout, che scalati fanno 384.
  assert.equal(p.maxHeight, (400 - 16) / 0.5);
  assertDentro(p, 1200, { vh: 400, scale: 0.5 });
});
