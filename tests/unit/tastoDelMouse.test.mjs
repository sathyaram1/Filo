// Il tasto del mouse premuto si legge da `button` (Electron 44) o dai modificatori (fino alla 33): chi lo legge altrove
// perde il tasto destro dei permessi (#591.4) e il trascinamento di una scheda verso la barra laterale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { tastoPremuto } = createRequire(import.meta.url)('../../src/main/tastoDelMouse.js');

test('il tasto premuto arriva da button o dai modificatori; senza tasti è null', () => {
  assert.equal(tastoPremuto({ type: 'mouseDown', button: 'right', x: 1, y: 2 }), 'right');
  assert.equal(tastoPremuto({ type: 'mouseMove', button: 'left' }), 'left');
  assert.equal(tastoPremuto({ type: 'mouseMove', button: 'none' }), null);
  assert.equal(tastoPremuto({ type: 'mouseDown', modifiers: ['rightbuttondown'] }), 'right');
  assert.equal(tastoPremuto({ type: 'mouseMove', modifiers: ['shift', 'leftButtonDown'] }), 'left');
  assert.equal(tastoPremuto({ type: 'mouseMove', modifiers: ['shift'] }), null);
  assert.equal(tastoPremuto({ type: 'mouseMove' }), null);
  assert.equal(tastoPremuto(null), null);
});
