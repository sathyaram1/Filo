// #1668 — il main prende gli allegati di una segnalazione dalla conversazione: i file delle righe «File:» si leggono dal
// disco coi tipi e il tetto del riquadro «Invia feedback»; quelli che non possono partire lo dicono, mai tagliati.
// Le regole pure: tests/unit/allegatiSegnalazione.test.mjs.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/feedback.js');
require('../../src/shared/feedbackAttachTypes.js');
require('../../src/shared/allegatiSegnalazione.js');
const Allegati = require('../../src/main/services/allegatiDellaChat.js');
const CF = require('../../src/main/services/contestoFilo.js');

const dir = cartellaTemporanea('allegati-chat-');
after(() => togliCartella(dir));
const nota = join(dir, 'nota.txt');
const grande = join(dir, 'grande.log');
const pagina = join(dir, 'pagina.html');
writeFileSync(nota, 'ciao');
writeFileSync(grande, Buffer.alloc(4 * 1024 * 1024 + 1, 'a'));
writeFileSync(pagina, '<script>x</script>');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const chat = {
  id: 'c1',
  messages: [
    { role: 'user', ts: 't1', text: `guarda\nFile: ${nota}\nFile: ${grande}\nFile: ${pagina}`, images: 1 },
  ],
};
globalThis.SN_FILO_CHATS = { get: async (id) => (id === 'c1' ? chat : null) };

test('un file della conversazione parte coi suoi byte e il suo tipo; uno troppo grande o di un tipo attivo lo dice', async () => {
  const { voci, scartati } = await Allegati.voci({ allegati: [nota, grande, pagina, join(dir, 'altro.txt')] }, 'c1');
  assert.deepEqual(scartati, ['altro.txt']);
  const [n, g, p] = voci;
  assert.equal(n.dataUrl, `data:text/plain;base64,${Buffer.from('ciao').toString('base64')}`);
  assert.equal(n.type, 'text/plain');
  assert.equal(n.problema, undefined);
  assert.match(g.problema, /troppo grande/);
  assert.equal(g.dataUrl, undefined, 'un file oltre il tetto non si legge');
  assert.equal(p.problema, 'tipo di file non ammesso');
  const r = globalThis.SN_ALLEGATI_SEGNALAZIONE.payload({ text: 'x' }, voci);
  assert.match(r.errore, /grande\.log/);
  const solo = globalThis.SN_ALLEGATI_SEGNALAZIONE.payload({ text: 'x' }, [n]);
  assert.deepEqual(solo.payload.files, [{ name: 'nota.txt', type: 'text/plain', dataUrl: n.dataUrl }]);
});

test('le immagini e la schermata arrivano dalla memoria della chat, non da altre chat', async () => {
  // Il main tiene le foto della chat finché possono tornare al modello: qui le mette come farebbe l'archivio.
  const storage = require('../../src/main/shim/storage');
  const incognito = storage.inIncognito;
  storage.inIncognito = () => false;
  try {
    CF.ricordaImmagini('c1', 't1', [PNG]);
    CF.ricordaSchermata('c1', { dataUrl: PNG, nome: 'Calcolatrice' });
    const { voci } = await Allegati.voci({ allegati: ['1', 'schermata'] }, 'c1');
    assert.deepEqual(voci.map((v) => [v.id, v.dataUrl === PNG]), [['immagine:1', true], ['schermata', true]]);
    const altra = await Allegati.voci({ allegati: ['1', 'schermata'] }, 'c2');
    assert.deepEqual(altra.voci, []);
    assert.deepEqual(altra.scartati, ['immagine 1', 'schermata']);
    const ant = await Allegati.anteprima({ allegati: ['1', nota] }, 'c1');
    assert.equal(ant.allegati[0].anteprima, PNG);
    assert.equal(ant.allegati[1].anteprima, undefined);
    assert.deepEqual(ant.limiti, { immagini: 5, file: 5, byte: 4 * 1024 * 1024 });
    CF.dimentica('c1');
    assert.equal(CF.schermataDi('c1'), null);
  } finally {
    storage.inIncognito = incognito;
  }
});
