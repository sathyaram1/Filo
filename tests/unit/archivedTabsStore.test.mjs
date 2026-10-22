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
import { rapportoFraCosti } from '../helpers/tempoRelativo.mjs';
import { spiaDiscoSincrono } from '../helpers/spiaDisco.mjs';

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
// L'indice per contenuto sa delle schede nuove da qui: ogni strada d'ingresso deve passarci.
const entrate = [];
A.suEntrate((voci) => entrate.push(...voci.map((t) => t.id)));

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
  assert.deepEqual([...entrate].sort(), archivioVecchio.map((t) => t.id).sort(), 'le migrate si annunciano all\'indice');
});

test('ogni scheda che entra in archivio si annuncia all\'indice: chiusa, importata, migrata', async () => {
  entrate.length = 0;
  const chiusa = await A.archive({ url: 'https://chiusa-825.test/', title: 'Chiusa' });
  assert.equal(await A.importa([{ id: 'imp-1', url: 'https://importata-825.test/', title: 'Importata' }, { id: chiusa.id, url: 'x' }]), 1);
  assert.deepEqual(entrate, [chiusa.id, 'imp-1'], 'una già presente non si riannuncia');
  await Disco.runIncognito(() => A.archive({ url: 'https://incognito-entrata.test/', title: 'Privata' }));
  assert.deepEqual(entrate, [chiusa.id, 'imp-1']);
  await A.removeMany([chiusa.id, 'imp-1']);
});

// Lo stesso archivio in un'altra istanza, su una cartella dati quasi vuota: il termine di paragone per il tempo.
async function archivioPiccolo() {
  const modulo = require.resolve(join(ROOT, 'src', 'main', 'services', 'archivedTabs.js'));
  const grande = globalThis.SN_ARCHIVED_TABS;
  const dati = process.env.FILO_USER_DATA;
  delete require.cache[modulo];
  require(modulo);
  const piccolo = globalThis.SN_ARCHIVED_TABS;
  globalThis.SN_ARCHIVED_TABS = grande;
  process.env.FILO_USER_DATA = cartellaTemporanea('filo-archivio-piccolo-');
  // La cartella si legge quando l'archivio si apre, cioè adesso: dopo si può rimettere quella vera.
  const aperto = piccolo.list();
  process.env.FILO_USER_DATA = dati;
  await aperto;
  return piccolo;
}

test('oltre le 5000 non sparisce niente, e chiudere una scheda resta rapido', async () => {
  for (let i = 0; i < 1200; i++) await A.archive({ url: `https://nuova-${i}.test/`, title: `Nuova ${i}` });
  const lista = await A.list();
  assert.equal(lista.length, VECCHIE + 1200);
  assert.equal(lista[0].title, 'Nuova 1199');
  const piuVecchia = lista.at(-1);
  assert.equal(piuVecchia.id, 'vecchia-0');
  assert.deepEqual(piuVecchia.embedding, [0, 1, -1], 'il vettore della più vecchia resta');
  const a = await A.update('vecchia-4999', { embedding: [5, 5, 5], embedModel: 'nuovo' });
  assert.deepEqual(a.embedding, [5, 5, 5]);
  assert.deepEqual((await A.list()).find((t) => t.id === 'vecchia-4999').embedding, [5, 5, 5]);

  // Il disco non dipende dal tempo: con 6200 schede, chiuderne una aggiunge la sua riga e non rilegge né riscrive niente.
  const aggiunte = [];
  const visto = await spiaDiscoSincrono(join(userData, 'archivio-schede'),
    async () => { aggiunte.push(await A.archive({ url: 'https://una-ancora.test/', title: 'Una ancora' })); });
  assert.deepEqual(visto.map(({ n, righe }) => [n, righe]), [['appendFileSync', 1]], JSON.stringify(visto));

  // Il lavoro in memoria si misura a turno con l'archivio quasi vuoto, così il carico della macchina cade su tutti e due.
  const piccolo = await archivioPiccolo();
  let n = 0;
  const chiudi = (archivio) => async () => {
    const t = await archivio.archive({ url: `https://misura-${++n}.test/`, title: `Misura ${n}` });
    if (archivio === A) aggiunte.push(t);
  };
  const r = await rapportoFraCosti(chiudi(piccolo), chiudi(A), { tetto: 3 });
  // Le prove dopo contano le schede: quelle della misura se ne vanno.
  await A.removeMany(aggiunte.map((t) => t.id));
  console.log(`[misura] archiviare con ${VECCHIE}+ schede: ${r.come}`);
  assert.ok(r.entro, `con ${VECCHIE}+ schede chiuderne una costa ${r.come} rispetto all'archivio quasi vuoto`);
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

// #1525 — indirizzi e titolo li sceglie il sito: tagliati alla misura, col segno, e una voce tagliata non si riapre intera.
test('indirizzi e titolo lunghissimi escono tagliati e segnati, anche fra le schede aperte insieme', async () => {
  const lungo = (n) => `https://lungo-1525.test/?q=${n}` + 'x'.repeat(100_000);
  const t = await A.archive({ url: lungo(0), title: 'T'.repeat(5000), coOpenUrls: ['https://corta.test/', lungo(1), lungo(2)] });
  const riletta = (await A.list()).find((x) => x.id === t.id);
  assert.equal(riletta.url.length, 8192);
  assert.equal(riletta.urlTagliato, true);
  assert.equal(riletta.title.length, 1024);
  assert.equal(riletta.titleTagliato, true);
  assert.deepEqual(riletta.coOpenUrls.map((u) => u.length), ['https://corta.test/'.length, 8192, 8192]);
  assert.deepEqual(riletta.coOpenUrlsTagliati, [1, 2]);
  // Tolta la scheda corta, i segni seguono le voci che restano.
  const corta = await A.archive({ url: 'https://corta.test/', title: 'Corta' });
  await A.remove(corta.id);
  assert.deepEqual((await A.list()).find((x) => x.id === t.id).coOpenUrlsTagliati, [0, 1]);
  const normale = await A.archive({ url: 'https://normale-1525.test/', title: 'Normale', coOpenUrls: ['https://a.test/'] });
  assert.equal(normale.urlTagliato, undefined);
  assert.equal(normale.coOpenUrlsTagliati, undefined);
  await A.removeMany([t.id, normale.id]);
});

// #1525 giro 1 — anche l'icona la sceglie il sito: un data: lungo un mega non entra a ogni chiusura, una normale sì.
test('l’icona di un sito oltre la misura non entra nell’archivio, quella normale resta', async () => {
  const icona = 'data:image/svg+xml,' + 'a'.repeat(1_000_000);
  const lunga = await A.archive({ url: 'https://icona-1525.test/', title: 'Icona', favicon: icona });
  // Quella normale arriva come i byte che la scheda ha già scaricato, e l'archivio ne tiene la copia (#1273).
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC';
  const breve = await A.archive({ url: 'https://icona-breve-1525.test/', title: 'Breve', favicon: png });
  const lista = await A.list();
  assert.equal(lista.find((x) => x.id === lunga.id).favicon, '');
  assert.match(lista.find((x) => x.id === breve.id).favicon, /^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
  await A.removeMany([lunga.id, breve.id]);
});

test('«cancella tutti i dati» svuota anche l\'archivio, dal disco', async () => {
  await globalThis.chrome.storage.local.clear();
  assert.deepEqual(await A.list(), []);
  await Disco.whenSettled();
  assert.deepEqual(trovaSuDisco('Nuova 3'), []);
  assert.deepEqual(trovaSuDisco('vecchio-3'), []);
});
