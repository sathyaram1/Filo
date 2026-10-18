// #839 — dalla pagina d'errore di Filo «Salva per dopo» mette da parte il sito che non si è caricato:
// la voce ha l'indirizzo vero, e risalvare il sito quando torna aggiorna la stessa voce invece di farne un'altra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const archivio = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => ({ [k]: archivio[k] }),
  set: async (o) => { Object.assign(archivio, JSON.parse(JSON.stringify(o))); },
} } };
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'netError.js'));
require(join(ROOT, 'src', 'main', 'services', 'savedPages.js'));
const SavedPages = globalThis.SN_SAVED_PAGES;
const NE = globalThis.SN_NET_ERROR;

test('dalla pagina d\'errore si salva il sito, e il sito risalvato aggiorna la stessa voce', async () => {
  const sito = 'https://giornale.example/articolo?id=7';
  const errore = await SavedPages.save({ url: NE.buildUrl(sito, -105, 'ERR_NAME_NOT_RESOLVED'), title: 'giornale.example', favicon: 'filo://icons/filo.png' });
  assert.equal(errore.url, sito);
  assert.equal(errore.favicon, '', 'l\'icona della pagina d\'errore non è quella del sito');
  const tornato = await SavedPages.save({ url: sito, title: 'Articolo', favicon: 'https://giornale.example/favicon.ico' });
  assert.equal(tornato.id, errore.id);
  assert.equal((await SavedPages.list()).length, 1);

  // Una pagina d'errore senza un sito da riaprire resta com'è.
  const senza = await SavedPages.save({ url: 'filo://error/error.html?code=-2', title: 'Errore' });
  assert.equal(senza.url, 'filo://error/error.html?code=-2');
});
