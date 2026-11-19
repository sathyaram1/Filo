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

test('il selettore propone i formati che entrano ridisegnati, non quelli che il browser non apre', () => {
  const A = globalThis.SN_FEEDBACK_ATTACH;
  const voci = A.ACCEPT.split(',');
  for (const v of ['image/avif', '.avif', '.jfif']) assert.ok(voci.includes(v), v);
  for (const v of ['.heic', '.tiff', 'image/svg+xml', '.svg']) assert.ok(!voci.includes(v), v);
});

const gif = (fotogrammi) => {
  const f = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
  const commento = [0x21, 0xfe, 0x03, 0x41, 0x42, 0x43, 0x00];
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff,
    ...commento, ...Array.from({ length: fotogrammi }, () => f).flat(), 0x3b]);
};

test('i fotogrammi di una GIF si contano dai blocchi, commenti compresi', () => {
  assert.equal(IC.fotogrammiGif(gif(1)), 1);
  assert.equal(IC.fotogrammiGif(gif(3)), 3);
  assert.equal(IC.fotogrammiGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 0);
});

test('dalla chat parte la versione ridisegnata solo per le voci da preparare, e solo se si legge e sta nel tetto', () => {
  require(join(radice, 'src', 'shared', 'allegatiSegnalazione.js'));
  const AS = globalThis.SN_ALLEGATI_SEGNALAZIONE;
  const grande = { id: 'file:/f.jpg', tipo: 'immagine', nome: 'f.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', byte: 5e6, daPreparare: true, problema: 'troppo grande' };
  const normale = { id: 'immagine:1', tipo: 'immagine', nome: 'immagine 1.png', dataUrl: 'data:image/png;base64,AAAA' };
  const pronta = 'data:image/jpeg;base64,QUJD';
  const [g, n] = AS.conPreparati([grande, normale], { 'file:/f.jpg': pronta, 'immagine:1': 'data:image/png;base64,QkJC' });
  assert.equal(g.dataUrl, pronta);
  assert.equal(AS.problemaDi(g), '');
  assert.equal(n.dataUrl, normale.dataUrl, 'una voce già buona non si sostituisce');
  assert.equal(AS.conPreparati([grande], { 'file:/f.jpg': 'data:image/svg+xml;base64,PHN2Zz4=' })[0].problema, 'troppo grande');
  assert.equal(AS.conPreparati([grande], {})[0].problema, 'troppo grande');
  assert.ok(AS.anteprime([grande])[0].daPreparare);
});
