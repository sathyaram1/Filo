// L'archivio delle schede chiuse sta in file suoi e non ha tetti (#825).
//
// Parte da uno storage.json con l'archivio dentro, come l'ha lasciato la
// versione di prima, e asserisce quello che l'utente deve ritrovare: le stesse
// schede con riassunti e vettori, fuori da storage.json; più di 5000 schede
// senza che la prima sparisca; una scheda cancellata che non si trova più in
// nessun file della cartella dati; l'incognito che non vede e non scrive.
// Electron è finto (come in storageFlushRace.test.mjs), il disco è vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const userData = cartellaTemporanea('filo-archivio-');
process.env.FILO_USER_DATA = userData;
const electronFinto = {
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronFinto;
  return caricaOriginale.call(this, request, parent, isMain);
};

// Com'era l'archivio in storage.json: il più recente in testa, riassunti e vettori dentro.
const VECCHIE = 5000;
const vecchia = (i) => ({
  id: `vecchia-${i}`,
  url: `https://vecchio-${i}.test/`,
  title: `Vecchia ${i}`,
  favicon: '',
  identityColor: null,
  openedAt: null,
  closedAt: new Date(Date.UTC(2025, 0, 1) + i * 3600_000).toISOString(),
  reason: 'manual',
  coOpenUrls: [],
  scrollPosition: null,
  proxy: null,
  summary: `Riassunto della pagina vecchia numero ${i}`,
  snippet: `pagina ${i}`,
  embedding: i < 3000 ? [i % 100, 1, -1] : null,
  embedModel: i < 3000 ? 'modello-vecchio' : undefined,
});
const archivioVecchio = [];
for (let i = VECCHIE - 1; i >= 0; i--) archivioVecchio.push(vecchia(i));
writeFileSync(join(userData, 'storage.json'), JSON.stringify({
  settings: { theme: 'light' },
  archivedTabs: archivioVecchio,
}), 'utf8');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
const Disco = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
require(join(ROOT, 'src', 'main', 'shim', 'chrome-api.js'));
require(join(ROOT, 'src', 'main', 'services', 'archivedTabs.js'));
const A = globalThis.SN_ARCHIVED_TABS;

function fileDellaCartellaDati(dir = userData) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...fileDellaCartellaDati(p));
    else out.push(p);
  }
  return out;
}
const trovaSuDisco = (ago) => fileDellaCartellaDati().filter((f) => readFileSync(f, 'latin1').includes(ago));

test('la migrazione porta tutte le schede fuori da storage.json, con riassunti e vettori', async () => {
  const lista = await A.list();
  assert.equal(lista.length, VECCHIE);
  assert.deepEqual(lista.map((t) => t.id), archivioVecchio.map((t) => t.id));
  const prima = lista.find((t) => t.id === 'vecchia-0');
  assert.equal(prima.summary, 'Riassunto della pagina vecchia numero 0');
  assert.deepEqual(prima.embedding, [0, 1, -1]);
  assert.equal(prima.embedModel, 'modello-vecchio');
  await Disco.whenSettled();
  const suDisco = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
  assert.equal(suDisco.archivedTabs, undefined);
  assert.equal(suDisco.settings.theme, 'light');
});

test('oltre le 5000 non sparisce niente, e chiudere una scheda resta rapido', async () => {
  const tempi = [];
  for (let i = 0; i < 1200; i++) {
    const t0 = performance.now();
    await A.archive({ url: `https://nuova-${i}.test/`, title: `Nuova ${i}` });
    tempi.push(performance.now() - t0);
  }
  tempi.sort((a, b) => a - b);
  const mediana = tempi[Math.floor(tempi.length / 2)];
  console.log(`[misura] archiviare con ${VECCHIE}+ schede: mediana ${mediana.toFixed(2)} ms, peggiore ${tempi.at(-1).toFixed(2)} ms`);
  assert.ok(mediana < 20, `mediana ${mediana} ms`);
  const lista = await A.list();
  assert.equal(lista.length, VECCHIE + 1200);
  assert.equal(lista[0].title, 'Nuova 1199');
  const piuVecchia = lista.at(-1);
  assert.equal(piuVecchia.id, 'vecchia-0');
  assert.deepEqual(piuVecchia.embedding, [0, 1, -1], 'il vettore della più vecchia resta');
  const a = await A.update('vecchia-4999', { embedding: [5, 5, 5], embedModel: 'nuovo' });
  assert.deepEqual(a.embedding, [5, 5, 5]);
  assert.deepEqual((await A.list()).find((t) => t.id === 'vecchia-4999').embedding, [5, 5, 5]);
});

test('cancellata una scheda, il suo indirizzo non è più in nessun file della cartella dati', async () => {
  const url = 'https://da-cancellare-825.test/pagina-privata';
  const s = await A.archive({ url, title: 'Da cancellare', closedAt: '2025-03-02T10:00:00.000Z' });
  await A.update(s.id, { summary: 'riassunto-privato-825' });
  const vicina = await A.archive({ url: 'https://vicina.test/', title: 'Vicina', coOpenUrls: [url, 'https://altra.test/'] });
  await Disco.whenSettled();
  assert.ok(trovaSuDisco(url).length > 0);

  const lista = await A.remove(s.id);
  assert.ok(!lista.some((t) => t.id === s.id));
  assert.deepEqual(trovaSuDisco(url), []);
  assert.deepEqual(trovaSuDisco('riassunto-privato-825'), []);
  assert.deepEqual((await A.list()).find((t) => t.id === vicina.id).coOpenUrls, ['https://altra.test/']);

  const r = await A.removeMany(['vecchia-1', 'vecchia-2', 'inesistente']);
  assert.deepEqual(r, { removed: 2, remaining: VECCHIE + 1200 + 1 - 2 });
  assert.deepEqual(trovaSuDisco('https://vecchio-1.test/'), []);
});

test('l\'incognito non vede l\'archivio e non ci scrive', async () => {
  const prima = (await A.list()).length;
  const dentro = await Disco.runIncognito(async () => ({
    lista: await A.list(),
    archiviata: await A.archive({ url: 'https://incognito-825.test/', title: 'Privata' }),
    tolte: await A.removeMany((await A.list()).map((t) => t.id)),
    svuotato: await A.clear(),
  }));
  assert.deepEqual(dentro.lista, []);
  assert.equal(dentro.archiviata, null);
  assert.equal(dentro.tolte.removed, 0);
  assert.equal((await A.list()).length, prima);
  assert.deepEqual(trovaSuDisco('incognito-825.test'), []);
});

test('«cancella tutti i dati» svuota anche l\'archivio, dal disco', async () => {
  await globalThis.chrome.storage.local.clear();
  assert.deepEqual(await A.list(), []);
  await Disco.whenSettled();
  assert.deepEqual(trovaSuDisco('Nuova 3'), []);
  assert.deepEqual(trovaSuDisco('vecchio-3'), []);
});
