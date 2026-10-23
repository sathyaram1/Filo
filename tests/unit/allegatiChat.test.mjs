// #1623 — le immagini lasciate in Filo vanno alla chat: la cronologia dell'Aiuto porta solo immagini in linea, il main
// legge dal disco solo immagini e oltre il tetto dà alla home il percorso e all'Aiuto il conto. #1298: le frasi.
// La prova del gesto vero sta in tests/rilascio-nella-chat.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/cmdClassify.js');
require('../../src/shared/actionLevels.js');
const { PROMPTS, ALLEGATI_CHAT } = require('../../src/shared/constants.js') && globalThis.SN_CONST;
const { storiaAiuto } = require('../../src/main/services/storiaAiuto.js');
const { prepara } = require('../../src/main/rilascioNellaChat.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DATA = `data:image/png;base64,${PNG.toString('base64')}`;

test('la cronologia dell’Aiuto tiene testo e immagini in linea, e butta un’immagine che il fornitore andrebbe a prendere', () => {
  const storia = storiaAiuto([
    { role: 'user', content: 'ciao' },
    { role: 'user', content: [
      { type: 'text', text: 'guarda' },
      { type: 'image_url', image_url: { url: DATA } },
      { type: 'image_url', image_url: { url: 'https://sito.example/spia.png' } },
      { type: 'image_url', image_url: { url: 'data:text/html;base64,PGI+' } },
      { type: 'file', file: { url: 'file:///etc/passwd' } },
    ] },
  ]);
  assert.equal(storia[0].content, 'ciao');
  assert.deepEqual(storia[1].content.map((p) => p.type), ['text', 'image_url']);
  assert.equal(storia[1].content[1].image_url.url, DATA);
  assert.deepEqual(storiaAiuto(undefined), []);
});

test('il modello sa che le immagini le ha allegate l’utente e non sono la pagina; da sole, che non ha scritto niente', () => {
  assert.equal(PROMPTS.allegatiAiuto(0), '');
  assert.match(PROMPTS.allegatiAiuto(1), /l’immagine di questo messaggio l’ha allegata l’utente: non è la pagina/);
  assert.match(PROMPTS.allegatiAiuto(3), /le 3 immagini di questo messaggio/);
  assert.match(PROMPTS.soloAllegatiAiuto(), /senza scrivere niente/);
});

test('#1298: oltre il tetto un’immagine non sparisce in silenzio, la frase dice cosa fare', () => {
  assert.equal(ALLEGATI_CHAT.tettoImmagineByte, 4 * 1024 * 1024);
  assert.match(ALLEGATI_CHAT.fraseTroppoGrandi(1), /^L’immagine supera i 4 MB.*trascinala da lì/);
  assert.match(ALLEGATI_CHAT.fraseTroppoGrandi(3), /^3 immagini superano i 4 MB/);
  assert.match(ALLEGATI_CHAT.fraseTroppoGrandiAiuto(2), /^2 immagini superano i 64 MB: l’Aiuto non le può vedere/);
  assert.ok(ALLEGATI_CHAT.tettoLetturaByte > ALLEGATI_CHAT.tettoImmagineByte);
  assert.match(ALLEGATI_CHAT.fraseNonImmaginiAiuto(1), /^Un file non è un’immagine/);
  assert.match(ALLEGATI_CHAT.fraseNonImmaginiAiuto(2), /^2 file non sono immagini/);
});

test('nel filo un messaggio dell’Aiuto con immagini dice quante erano, anche senza testo', () => {
  assert.equal(ALLEGATI_CHAT.testoNelFilo('ciao', 0), 'ciao');
  assert.equal(ALLEGATI_CHAT.testoNelFilo('', 1), '(un’immagine allegata)');
  assert.equal(ALLEGATI_CHAT.testoNelFilo('  ', 3), '(3 immagini allegate)');
  assert.equal(ALLEGATI_CHAT.testoNelFilo('cos’è?', 2), 'cos’è?\n(2 immagini allegate)');
});

test('dalla fila delle schede: il main legge solo immagini dal disco; oltre il tetto la home ha il percorso e l’Aiuto l’immagine da rimpicciolire; gli altri file non spariscono', async () => {
  const dir = cartellaTemporanea('filo-allegati-');
  try {
    const piccola = join(dir, 'piccola.png');
    const grande = join(dir, 'grande.jpg');
    const testo = join(dir, 'segreto.txt');
    writeFileSync(piccola, PNG);
    writeFileSync(grande, Buffer.alloc(ALLEGATI_CHAT.tettoImmagineByte + 1));
    writeFileSync(testo, 'non un’immagine');
    const voci = [
      { nome: 'piccola.png', percorso: piccola },
      { nome: 'grande.jpg', percorso: grande },
      { nome: 'segreto.txt', percorso: testo },
      { nome: 'relativa.png', percorso: 'relativa.png' },
      { nome: 'mancante.png', percorso: join(dir, 'mancante.png') },
      { nome: 'da finestra.png', dataUrl: DATA },
      { nome: 'html', dataUrl: 'data:text/html;base64,PGI+' },
      { nome: 'senza percorso.pdf', altro: true },
    ];
    const casa = await prepara(voci, { casa: true });
    assert.deepEqual(casa.immagini.map((i) => i.nome), ['piccola.png', 'da finestra.png']);
    assert.equal(casa.immagini[0].dataUrl, DATA);
    assert.equal(casa.immagini[0].percorso, piccola);
    assert.deepEqual(casa.file, [grande, testo]);
    assert.equal(casa.grandi, 0);
    const aiuto = await prepara(voci, { casa: false });
    assert.deepEqual(aiuto.file, []);
    assert.deepEqual(aiuto.immagini.map((i) => [i.nome, i.percorso]), [['piccola.png', ''], ['grande.jpg', ''], ['da finestra.png', '']]);
    assert.equal(aiuto.grandi, 0);
    assert.equal(aiuto.altri, 2);
    const enorme = `data:image/png;base64,${'A'.repeat(Math.ceil(ALLEGATI_CHAT.tettoImmagineByte * 4 / 3) + 8)}`;
    assert.equal((await prepara([{ dataUrl: enorme }], { casa: true })).grandi, 1);
  } finally {
    togliCartella(dir);
  }
});
