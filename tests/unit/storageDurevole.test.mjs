// storage.json non si perde (#1087): un file rovinato non diventa uno storage vuoto che la prima scrittura salva
// sopra quello vero, una scrittura fallita lascia il file di prima e lo dice una volta, la chiusura non torna indietro.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PERCORSO = join(__dirname, '..', '..', 'src', 'main', 'shim', 'storage.js');
const fsp = fs.promises;

const electronMock = { app: { getPath: () => process.env.FILO_USER_DATA }, safeStorage: { isEncryptionAvailable: () => false } };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

const ripristini = [];
function sostituisci(obj, nome, fn) {
  const vero = obj[nome];
  obj[nome] = fn(vero);
  ripristini.push(() => { obj[nome] = vero; });
}
const cartelle = [];
const errore = (code) => Object.assign(new Error(`${code}: simulato`), { code });
// Come writeFileSync quando il disco si riempie: il file (o il descrittore) aperto in scrittura riceve solo l'inizio.
function scritturaInterrotta(dest, dati) {
  const fd = typeof dest === 'number' ? dest : fs.openSync(dest, 'w');
  fs.writeSync(fd, Buffer.from(dati), 0, 4);
  if (fd !== dest) fs.closeSync(fd);
  throw errore('ENOSPC');
}

let aperto = null;
// Ogni prova ha la sua cartella dei dati e un modulo appena caricato: è un avvio di Filo.
function avvio(file = {}) {
  const dir = cartellaTemporanea('filo-storage-durevole-');
  cartelle.push(dir);
  for (const [nome, testo] of Object.entries(file)) fs.writeFileSync(join(dir, nome), testo);
  process.env.FILO_USER_DATA = dir;
  delete require.cache[require.resolve(PERCORSO)];
  aperto = require(PERCORSO);
  return { dir, Storage: aperto, file: (n = 'storage.json') => join(dir, n) };
}

const tace = () => {
  const veri = [console.error, console.warn];
  console.error = () => {}; console.warn = () => {};
  ripristini.push(() => { [console.error, console.warn] = veri; });
};

afterEach(async () => {
  while (ripristini.length) ripristini.pop()();
  // La copia dell'avvio può essere ancora in scrittura: a cartella tolta fallisce, e l'avviso esce nella prova dopo.
  await aperto?.statoDisco().copia;
  aperto = null;
  while (cartelle.length) togliCartella(cartelle.pop());
});

test('un file con il BOM di PowerShell si legge, e si riscrive senza', async () => {
  const { Storage, file } = avvio({ 'storage.json': '﻿{"settings":{"tema":"scuro"},"note":["a"]}' });
  assert.deepEqual(await Storage.get(['settings', 'note']), { settings: { tema: 'scuro' }, note: ['a'] });
  await Storage.set({ note: ['a', 'b'] });
  await Storage.whenSettled();
  const testo = fs.readFileSync(file(), 'utf8');
  assert.notEqual(testo.charCodeAt(0), 0xFEFF);
  assert.deepEqual(JSON.parse(testo), { settings: { tema: 'scuro' }, note: ['a', 'b'] });
  assert.equal(Storage.statoDisco().avvisi.length, 0);
});

test('una lettura buona all\'avvio diventa la copia di riserva', async () => {
  const { Storage, file } = avvio({ 'storage.json': '{"a":1}' });
  await Storage.get(null);
  await Storage.statoDisco().copia;
  assert.deepEqual(JSON.parse(fs.readFileSync(file('storage.json.bak'), 'utf8')), { a: 1 });
});

test('file troncato con la copia di riserva: tornano i dati della copia, il rovinato resta accanto, e l\'utente lo sa', async () => {
  tace();
  const { dir, Storage, file } = avvio({ 'storage.json': '{"a":1,"chat":[{"t":"ciao"}],"b":', 'storage.json.bak': '{"a":1,"chat":[{"t":"ciao"}],"b":2}' });
  assert.deepEqual(await Storage.get(null), { a: 1, chat: [{ t: 'ciao' }], b: 2 });

  const rovinati = fs.readdirSync(dir).filter((n) => n.startsWith('storage.json.rovinato-'));
  assert.equal(rovinati.length, 1);
  assert.equal(fs.readFileSync(join(dir, rovinati[0]), 'utf8'), '{"a":1,"chat":[{"t":"ciao"}],"b":');

  // Il file vero torna subito: un arresto adesso non deve far ripartire vuoto il prossimo avvio.
  await Storage.whenSettled();
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { a: 1, chat: [{ t: 'ciao' }], b: 2 });
  await Storage.set({ c: 3 });
  await Storage.whenSettled();
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { a: 1, chat: [{ t: 'ciao' }], b: 2, c: 3 });

  const [avviso] = Storage.statoDisco().avvisi;
  assert.match(avviso.testo, /copia di riserva/);
  assert.ok(avviso.testo.includes(rovinati[0]), 'l\'avviso dice dove sta il file rovinato');
  assert.equal(Storage.statoDisco().solaMemoria, false);
});

test('file vuoto (una scrittura interrotta delle versioni vecchie) senza copia: si riparte da zero ma il file non si cancella', async () => {
  tace();
  const { dir, Storage } = avvio({ 'storage.json': '' });
  assert.deepEqual(await Storage.get(null), {});
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('storage.json.rovinato-')).length, 1);
  assert.match(Storage.statoDisco().avvisi[0].testo, /non c'era una copia di riserva/);
});

test('un file che non è un oggetto JSON conta come rovinato', async () => {
  tace();
  const { Storage } = avvio({ 'storage.json': '[1,2,3]', 'storage.json.bak': '{"a":1}' });
  assert.deepEqual(await Storage.get(null), { a: 1 });
});

test('un file che non si lascia leggere non viene sovrascritto: si lavora in memoria, e lo si dice', async () => {
  tace();
  const { Storage, file } = avvio({ 'storage.json': '{"memorie":["tante"]}' });
  const bersaglio = file();
  sostituisci(fsp, 'readFile', (vero) => async (p, ...a) => { if (p === bersaglio) throw errore('EIO'); return vero(p, ...a); });
  assert.deepEqual(await Storage.get(null), {});
  await Storage.set({ memorie: [] });
  await Storage.flushNow();
  Storage.flushSync();
  assert.deepEqual(JSON.parse(fs.readFileSync(bersaglio, 'utf8')), { memorie: ['tante'] });
  assert.equal(Storage.statoDisco().solaMemoria, true);
  assert.match(Storage.statoDisco().avvisi[0].testo, /non salva niente/);
});

test('una scrittura che fallisce a metà lascia il file di prima leggibile, avvisa una volta sola e poi riprova', async () => {
  tace();
  const { dir, Storage, file } = avvio({ 'storage.json': '{"v":1}' });
  await Storage.get(null);
  // Sotto carico la copia dell'avvio è ancora in scrittura, e il suo temporaneo non è della scrittura che fallisce.
  await Storage.statoDisco().copia;
  sostituisci(fsp, 'open', (vero) => async (p, ...resto) => {
    const fh = await vero(p, ...resto);
    if (String(p).includes('storage.json.tmp-')) {
      const scrivi = fh.writeFile.bind(fh);
      fh.writeFile = async (buf) => { await scrivi(buf.subarray(0, Math.floor(buf.length / 2))); throw errore('ENOSPC'); };
    }
    return fh;
  });
  await Storage.set({ v: 2, grande: 'x'.repeat(4096) });
  await Storage.flushNow();
  await Storage.set({ v: 3 });
  await Storage.flushNow();

  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { v: 1 });
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp')), []);
  assert.equal(Storage.statoDisco().ultimoErrore.code, 'ENOSPC');
  const avvisi = Storage.statoDisco().avvisi;
  assert.equal(avvisi.length, 1, 'una volta per sessione');
  assert.match(avvisi[0].testo, /disco è pieno/);

  ripristini.pop()();
  await Storage.flushNow();
  assert.equal(JSON.parse(fs.readFileSync(file(), 'utf8')).v, 3);
  assert.equal(Storage.statoDisco().ultimoErrore, null);
  assert.match(Storage.statoDisco().avvisi.at(-1).testo, /di nuovo salvati/);
});

test('file occupato tre volte e poi libero: sul disco il valore nuovo, senza errori né avvisi', async () => {
  const { Storage, file } = avvio({ 'storage.json': '{"v":1}' });
  await Storage.get(null);
  let rifiuti = 0;
  sostituisci(fsp, 'rename', (vero) => async (da, a) => {
    if (a === file() && rifiuti < 3) { rifiuti++; throw errore('EBUSY'); }
    return vero(da, a);
  });
  await Storage.set({ v: 2 });
  await Storage.whenSettled();
  assert.equal(rifiuti, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { v: 2 });
  assert.equal(Storage.statoDisco().ultimoErrore, null);
  assert.deepEqual(Storage.statoDisco().avvisi, []);
});

test('la scrittura di chiusura non viene coperta da una scrittura più vecchia ancora in volo', async () => {
  const { Storage, file } = avvio({ 'storage.json': '{"schede":["a"]}' });
  await Storage.get(null);
  let sblocca;
  const fermo = new Promise((r) => { sblocca = r; });
  let inVolo;
  const partita = new Promise((r) => { inVolo = r; });
  sostituisci(fsp, 'open', (vero) => async (p, ...resto) => {
    if (String(p).includes('storage.json.tmp-')) { inVolo(); await fermo; }
    return vero(p, ...resto);
  });
  await Storage.set({ schede: ['a', 'b'] });
  const vecchia = Storage.flushNow();
  await partita;
  Storage.setSync({ schede: ['a', 'b', 'c'] });
  sblocca();
  await vecchia;
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { schede: ['a', 'b', 'c'] });
});

test('la scrittura di chiusura che si ferma a metà lascia il file di prima', async () => {
  tace();
  const { Storage, file } = avvio({ 'storage.json': '{"v":1}' });
  await Storage.get(null);
  sostituisci(fs, 'writeFileSync', () => scritturaInterrotta);
  Storage.setSync({ v: 2 });
  ripristini.pop()();
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { v: 1 });
});

// Chiudere mentre una scrittura asincrona è a metà lascia il suo temporaneo: la chiusura non può aspettarla.
test('i temporanei di una chiusura a metà scrittura li toglie l\'avvio dopo, e i dati restano quelli', async () => {
  const altro = process.pid + 1;
  const { dir, Storage, file } = avvio({
    'storage.json': '{"v":2}',
    'storage.json.bak': '{"v":1}',
    [`storage.json.bak.tmp-${altro}-3`]: '{"v":2,"me',
    [`storage.json.tmp-${altro}-4`]: '{"v":3',
  });
  assert.deepEqual(await Storage.get(null), { v: 2 });
  await Storage.whenSettled();
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp')), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file('storage.json.bak'), 'utf8')), { v: 2 });
});

test('cancellare tutto porta via anche la copia di riserva e i file rovinati', async () => {
  tace();
  const { dir, Storage } = avvio({ 'storage.json': '{"a":"privato-1087",', 'storage.json.bak': '{"a":"privato-1087"}' });
  await Storage.get(null);
  await Storage.clear();
  await Storage.whenSettled();
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('rovinato')), []);
  for (const n of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(join(dir, n), 'utf8').includes('privato-1087'), n);
});

test('quello che l\'utente cancella esce anche dalla copia di riserva, senza aspettare il prossimo avvio', async () => {
  const { dir, Storage } = avvio({ 'storage.json': '{"memorie":["indirizzo-privato-1087","altro"],"tema":"chiaro"}' });
  await Storage.get(null);
  await Storage.statoDisco().copia;
  assert.ok(fs.readFileSync(join(dir, 'storage.json.bak'), 'utf8').includes('indirizzo-privato-1087'));
  await Storage.set({ memorie: ['altro'] });
  await Storage.whenSettled();
  for (const n of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(join(dir, n), 'utf8').includes('indirizzo-privato-1087'), n);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'storage.json.bak'), 'utf8')), { memorie: ['altro'], tema: 'chiaro' });
});

test('chiudere Filo subito dopo aver cancellato aggiorna anche la copia di riserva', async () => {
  const { dir, Storage } = avvio({ 'storage.json': '{"segreto":"chiave-privata-1087"}' });
  await Storage.get(null);
  await Storage.statoDisco().copia;
  await Storage.remove('segreto');
  await Storage.flushNow();
  Storage.flushSync();
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'storage.json.bak'), 'utf8')), {});
});
