// Unit test per src/shared/paneLayout.js — il calcolo delle larghezze delle
// colonne nei layout a divisori trascinabili (dashboard di gestione, deck
// builder). Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'paneLayout.js'));
const PL = globalThis.SN_PANE_LAYOUT;

const BASE = { gutters: 24, minLeft: 150, minRight: 180, minCenter: 320 };

test('si registra su globalThis con la sua API', () => {
  assert.ok(PL, 'SN_PANE_LAYOUT assente');
  assert.equal(typeof PL.fitWidths, 'function');
});

test('se c\'è spazio, le larghezze scelte dall\'utente restano intatte', () => {
  const r = PL.fitWidths({ ...BASE, avail: 1400, left: 400, right: 500 });
  assert.deepEqual(r, { left: 400, right: 500 });
});

test('con poco spazio le colonne esterne si restringono e il centro sopravvive', () => {
  // 900 disponibili: 24 di divisori + 320 di centro → 556 per le due esterne.
  const r = PL.fitWidths({ ...BASE, avail: 900, left: 500, right: 500 });
  assert.ok(r.left + r.right <= 556, `esterne troppo larghe: ${r.left}+${r.right}`);
  const center = 900 - 24 - r.left - r.right;
  assert.ok(center >= 320, `centro schiacciato a ${center}`);
});

test('la riduzione è proporzionale a quanto ogni colonna può cedere', () => {
  // La colonna larga cede più spazio di quella già vicina al minimo.
  const r = PL.fitWidths({ ...BASE, avail: 900, left: 600, right: 200 });
  assert.ok(r.left < 600, 'la colonna larga non è stata ridotta');
  assert.ok(r.right >= BASE.minRight);
  assert.ok((600 - r.left) > (200 - r.right), 'la riduzione non è proporzionale');
});

test('nessuna colonna scende mai sotto il proprio minimo, nemmeno in finestre minuscole', () => {
  const r = PL.fitWidths({ ...BASE, avail: 300, left: 400, right: 400 });
  assert.equal(r.left, 150);
  assert.equal(r.right, 180);
});

test('preferenze assurde o mancanti ricadono sul minimo, mai su NaN', () => {
  const r = PL.fitWidths({ ...BASE, avail: 1400, left: undefined, right: 'x' });
  assert.equal(r.left, 150);
  assert.equal(r.right, 180);
  const r2 = PL.fitWidths({ ...BASE, avail: 1400, left: 10, right: 10 });
  assert.equal(r2.left, 150);
  assert.equal(r2.right, 180);
});

test('senza spazio misurabile (pannello nascosto) le preferenze non vengono toccate', () => {
  const r = PL.fitWidths({ ...BASE, avail: 0, left: 5000, right: 5000 });
  assert.deepEqual(r, { left: 5000, right: 5000 });
});

test('le esterne + i divisori stanno sempre dentro il contenitore quando ci possono stare', () => {
  for (const avail of [700, 900, 1100, 1280, 1600]) {
    const r = PL.fitWidths({ ...BASE, avail, left: 3000, right: 3000 });
    const used = r.left + r.right + 24;
    if (avail >= 150 + 180 + 24 + 320) {
      assert.ok(used + 320 <= avail + 1, `a ${avail}px il centro non ha il suo minimo (usati ${used})`);
    }
  }
});
