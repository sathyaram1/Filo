// Unit test per scripts/lib/feedback-storage.mjs — solo la logica pura
// (mimeForPath). L'upload vero (uploadImageBuffer/uploadScreenshotFile) tocca la
// rete e non si testa qui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mimeForPath } from '../../scripts/lib/feedback-storage.mjs';

test('mimeForPath: estensioni note → mime corretto', () => {
  assert.equal(mimeForPath('shot.png'), 'image/png');
  assert.equal(mimeForPath('/tmp/A.PNG'), 'image/png');
  assert.equal(mimeForPath('foto.jpg'), 'image/jpeg');
  assert.equal(mimeForPath('foto.jpeg'), 'image/jpeg');
  assert.equal(mimeForPath('anim.gif'), 'image/gif');
  assert.equal(mimeForPath('x.webp'), 'image/webp');
});

test('mimeForPath: estensione ignota o assente → default png', () => {
  assert.equal(mimeForPath('senza-estensione'), 'image/png');
  assert.equal(mimeForPath('strano.bmp'), 'image/png');
});
