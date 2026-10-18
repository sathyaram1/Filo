// La prima lettura di storage.json è una sola: chi scrive mentre un'altra lettura è in volo
// non si vede rimettere il file sopra la sua scrittura (all'avvio, la coda dei percorsi
// buttata tornava indietro, #897). Electron è mockato come in storageFlushRace.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const userData = cartellaTemporanea('filo-storage-lettura-');
process.env.FILO_USER_DATA = userData;
writeFileSync(join(userData, 'storage.json'), JSON.stringify({ pathsOutbox: [1, 2, 3], settings: { a: 1 } }));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } };
  }
  return origLoad.call(this, request, parent, isMain);
};
const Storage = require(join(__dirname, '..', '..', 'src', 'main', 'shim', 'storage.js'));

test('una scrittura fatta mentre un’altra lettura iniziale è ancora in volo non va persa', async () => {
  const prima = Storage.get('pathsOutbox');
  const seconda = Storage.get('settings');
  assert.deepEqual((await prima).pathsOutbox, [1, 2, 3]);
  await Storage.set({ pathsOutbox: [] });
  assert.deepEqual((await seconda).settings, { a: 1 });
  assert.deepEqual((await Storage.get('pathsOutbox')).pathsOutbox, [],
    'la seconda lettura del file ha rimesso i percorsi sopra la scrittura');
});
