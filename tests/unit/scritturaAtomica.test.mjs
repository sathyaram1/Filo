// Il modulo unico di scrittura e lettura dei file che non si possono perdere (#1087): una scrittura che si ferma a
// metà lascia il file di prima leggibile, un file occupato per un attimo si ritenta, un guasto di lettura non è «non c'è».

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Disco = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'scritturaAtomica.js'));
const fsp = fs.promises;

const ripristini = [];
function sostituisci(obj, nome, fn) {
  const vero = obj[nome];
  obj[nome] = fn(vero);
  ripristini.push(() => { obj[nome] = vero; });
}
const cartelle = [];
function cartella() {
  const d = cartellaTemporanea('filo-atomica-');
  cartelle.push(d);
  return d;
}
afterEach(() => {
  while (ripristini.length) ripristini.pop()();
  while (cartelle.length) togliCartella(cartelle.pop());
});

const errore = (code) => Object.assign(new Error(`${code}: simulato`), { code });
// Come writeFileSync quando il disco si riempie: il file (o il descrittore) aperto in scrittura riceve solo l'inizio.
function scritturaInterrotta(dest, dati) {
  const fd = typeof dest === 'number' ? dest : fs.openSync(dest, 'w');
  fs.writeSync(fd, Buffer.from(dati), 0, 4);
  if (fd !== dest) fs.closeSync(fd);
  throw errore('ENOSPC');
}
const temporanei = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.tmp'));

test('sincrona: una scrittura che si ferma a metà lascia il file di prima intatto, e niente temporanei', () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  fs.writeFileSync(f, '{"versione":1}');
  sostituisci(fs, 'writeFileSync', () => scritturaInterrotta);
  assert.throws(() => Disco.scriviSync(f, JSON.stringify({ versione: 2, riempitivo: 'x'.repeat(1000) })), { code: 'ENOSPC' });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { versione: 1 });
  assert.deepEqual(temporanei(dir), []);
});

test('asincrona: una scrittura che si ferma a metà lascia il file di prima intatto, e niente temporanei', async () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  fs.writeFileSync(f, '{"versione":1}');
  sostituisci(fsp, 'open', (vero) => async (p, ...resto) => {
    const fh = await vero(p, ...resto);
    if (String(p).includes('.tmp-')) {
      const scrivi = fh.writeFile.bind(fh);
      fh.writeFile = async (buf) => { await scrivi(buf.subarray(0, Math.floor(buf.length / 2))); throw errore('ENOSPC'); };
    }
    return fh;
  });
  await assert.rejects(Disco.scrivi(f, JSON.stringify({ versione: 2, riempitivo: 'x'.repeat(1000) })), { code: 'ENOSPC' });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { versione: 1 });
  assert.deepEqual(temporanei(dir), []);
});

test('sincrona: rename occupata tre volte e poi libera → sul disco il valore nuovo', () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  fs.writeFileSync(f, 'vecchio');
  let rifiuti = 0;
  sostituisci(fs, 'renameSync', (vero) => (...a) => { if (rifiuti < 3) { rifiuti++; throw errore('EBUSY'); } return vero(...a); });
  Disco.scriviSync(f, 'nuovo');
  assert.equal(rifiuti, 3);
  assert.equal(fs.readFileSync(f, 'utf8'), 'nuovo');
  assert.deepEqual(temporanei(dir), []);
});

test('asincrona: rename occupata tre volte e poi libera → sul disco il valore nuovo', async () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  fs.writeFileSync(f, 'vecchio');
  let rifiuti = 0;
  sostituisci(fsp, 'rename', (vero) => async (...a) => { if (rifiuti < 3) { rifiuti++; throw errore('EPERM'); } return vero(...a); });
  assert.equal(await Disco.scrivi(f, 'nuovo'), true);
  assert.equal(rifiuti, 3);
  assert.equal(fs.readFileSync(f, 'utf8'), 'nuovo');
});

test('rename sempre occupata: si arrende dopo i suoi tentativi, il file di prima resta e il temporaneo se ne va', async () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  fs.writeFileSync(f, 'vecchio');
  let tentativi = 0;
  sostituisci(fsp, 'rename', () => async () => { tentativi++; throw errore('EBUSY'); });
  await assert.rejects(Disco.scrivi(f, 'nuovo'), { code: 'EBUSY' });
  assert.equal(tentativi, Disco.TENTATIVI_RINOMINA);
  assert.equal(fs.readFileSync(f, 'utf8'), 'vecchio');
  assert.deepEqual(temporanei(dir), []);
});

test('un errore che non è «occupato» non si ritenta', () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  let tentativi = 0;
  sostituisci(fs, 'renameSync', () => () => { tentativi++; throw errore('EXDEV'); });
  assert.throws(() => Disco.scriviSync(f, 'x'), { code: 'EXDEV' });
  assert.equal(tentativi, 1);
});

test('chi annulla prima della rename non tocca il file', async () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  fs.writeFileSync(f, 'più nuovo');
  assert.equal(await Disco.scrivi(f, 'più vecchio', { primaDiRinominare: () => false }), false);
  assert.equal(fs.readFileSync(f, 'utf8'), 'più nuovo');
  assert.deepEqual(temporanei(dir), []);
});

test('il permesso chiesto vale anche quando il file esiste già', { skip: process.platform === 'win32' && 'su Windows i permessi POSIX non ci sono' }, () => {
  const dir = cartella();
  const f = join(dir, 'segreto.bin');
  fs.writeFileSync(f, 'x', { mode: 0o644 });
  Disco.scriviSync(f, Buffer.from('y'), { mode: 0o600 });
  assert.equal(fs.statSync(f).mode & 0o077, 0);
});

test('lettura: assente è null, un guasto che passa si ritenta, uno che resta si lancia', async () => {
  const dir = cartella();
  const f = join(dir, 'dati.json');
  assert.equal(Disco.leggiSync(f), null);
  assert.equal(await Disco.leggi(f), null);
  fs.writeFileSync(f, 'ciao');

  let guasti = 0;
  sostituisci(fs, 'readFileSync', (vero) => (...a) => { if (guasti < 2) { guasti++; throw errore('EIO'); } return vero(...a); });
  assert.equal(Disco.leggiSync(f).toString(), 'ciao');

  sostituisci(fsp, 'readFile', () => async () => { throw errore('EBUSY'); });
  await assert.rejects(Disco.leggi(f), { code: 'EBUSY' });
});

test('il BOM di PowerShell se ne va, il resto del testo no', () => {
  assert.equal(Disco.togliBom('﻿{"a":1}'), '{"a":1}');
  assert.equal(Disco.togliBom('{"a":1}'), '{"a":1}');
  assert.equal(Disco.togliBom(''), '');
});

test('un file messo da parte resta intatto accanto, con un nome valido anche su Windows', async () => {
  const dir = cartella();
  const f = join(dir, 'storage.json');
  fs.writeFileSync(f, '{"tronc');
  const dest = await Disco.mettiDaParte(f);
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"tronc');
  assert.match(dest.slice(dir.length + 1), /^storage\.json\.rovinato-[\w-]+$/);
});

test('i temporanei di un arresto a metà se ne vanno, quelli di questo processo restano', async () => {
  const dir = cartella();
  const f = join(dir, 'storage.json');
  for (const n of ['storage.json.tmp', 'storage.json.tmp-1-1', `storage.json.tmp-${process.pid}-9`, 'altro.json.tmp-1-1', 'storage.json']) {
    fs.writeFileSync(join(dir, n), 'x');
  }
  assert.equal(await Disco.togliTemporanei(f), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['altro.json.tmp-1-1', 'storage.json', `storage.json.tmp-${process.pid}-9`].sort());
});

test('anche i temporanei della copia di riserva se ne vanno, e la copia e il file rovinato restano', async () => {
  const dir = cartella();
  const f = join(dir, 'storage.json');
  const restano = ['storage.json', 'storage.json.bak', 'storage.json.rovinato-2026-10-12T01-50-51-051Z', `storage.json.bak.tmp-${process.pid}-4`];
  for (const n of [...restano, 'storage.json.bak.tmp-999999-3']) fs.writeFileSync(join(dir, n), 'x');
  assert.equal(await Disco.togliTemporanei(f), 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), restano.sort());
});
