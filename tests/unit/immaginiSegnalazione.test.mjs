// #1664 — quali immagini fuori dai tipi ammessi una segnalazione prova a ridisegnare (src/shared/immaginiChat.js), e
// che ogni casella che allega passi da lì prima di rifiutare un'immagine. La conversione vera: tests/feedback-immagini-grandi.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const radice = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(radice, 'src', 'shared', 'feedbackAttachTypes.js'));
require(join(radice, 'src', 'shared', 'immaginiChat.js'));

const IC = globalThis.SN_IMMAGINI_CHAT;
const prova = (name, type) => IC.daRidisegnare({ name, type });

test('un formato d\'immagine fuori elenco si prova a ridisegnare, l\'SVG mai', () => {
  assert.equal(prova('scansione.avif', 'image/avif'), true);
  assert.equal(prova('IMG_1.HEIC', 'image/heic'), true);
  assert.equal(prova('foglio.tiff', 'image/tiff'), true);
  assert.equal(prova('IMG_1.heic', ''), true);
  assert.equal(prova('foto.avif', 'application/octet-stream'), true);
  assert.equal(prova('logo.svg', 'image/svg+xml'), false);
  assert.equal(prova('logo.svg', ''), false);
});

test('quello che è già ammesso, o non è un\'immagine, non passa da qui', () => {
  assert.equal(prova('foto.jpg', 'image/jpeg'), false);
  assert.equal(prova('foto.JPG', ''), false);
  assert.equal(prova('pagina.html', 'text/html'), false);
  assert.equal(prova('finto.avif', 'text/html'), false);
  assert.equal(prova('note.txt', 'text/plain'), false);
  assert.equal(IC.daRidisegnare(null), false);
});

test('ogni casella che allega un\'immagine la prepara prima di rifiutarla', () => {
  for (const f of ['src/content/feedback.js', 'src/pages/feedback/feedback.js', 'src/pages/manage/manageAllegati.js']) {
    const testo = readFileSync(join(radice, f), 'utf8');
    assert.match(testo, /perLaSegnalazione/, `${f} non rimpicciolisce le immagini oltre il tetto`);
    assert.match(testo, /daRidisegnare/, `${f} rifiuta i formati che si possono ridisegnare`);
  }
});
