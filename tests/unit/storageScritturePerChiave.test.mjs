// #1089 — lo storage riserializza solo le chiavi cambiate, scarta le scritture identiche e ricifra le chiavi API
// solo quando cambiano; il file resta byte per byte quello di JSON.stringify. Electron è finto come in
// storageFlushRace.test.mjs; FILO_USER_DATA punta a una cartella isolata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { rapportoFraCosti } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const userData = cartellaTemporanea('filo-storage-chiavi-');
process.env.FILO_USER_DATA = userData;

let cifraturaAccesa = false;
let cifrature = 0;
const electronMock = {
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => cifraturaAccesa,
    // Come quella vera: due cifrature dello stesso testo danno blob diversi.
    encryptString: (s) => { cifrature++; return Buffer.from(`${cifrature}|${s}`); },
    decryptString: (b) => b.toString().slice(b.toString().indexOf('|') + 1),
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};
const Storage = require(join(__dirname, '..', '..', 'src', 'main', 'shim', 'storage.js'));
const FILE = join(userData, 'storage.json');

// Il file lo scrive scritturaAtomica (#1087): si contano le sue scritture, non quelle di fs.
const Disco = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'scritturaAtomica.js'));
let scritture = 0;
const scriviVero = Disco.scrivi;
Disco.scrivi = function (...a) { if (a[0] === FILE) scritture++; return scriviVero.apply(this, a); };

const leggiFile = () => readFileSync(FILE, 'utf8');

// Quanti caratteri passano da JSON.stringify mentre gira fn: è il lavoro che il flush fa sul processo principale.
async function caratteriSerializzati(fn) {
  const vero = JSON.stringify;
  let n = 0;
  JSON.stringify = function (...a) { const s = vero.apply(this, a); if (typeof s === 'string') n += s.length; return s; };
  try { await fn(); } finally { JSON.stringify = vero; }
  return n;
}

function grandeStorage() {
  const voci = [];
  for (let i = 0; i < 20000; i++) voci.push({ id: i, testo: 'voce di prova numero ' + i + ' '.repeat(150), quando: 1700000000000 + i });
  return voci;
}

// Un orologio che corre solo nel flush, dalla partenza a quando passa il file al disco: è il lavoro del processo
// principale. Il disco qui non scrive, così la misura non paga 4 MB di I/O a campione.
let nelFlush = 0;
async function flushSenzaDisco() {
  const vero = Disco.scrivi;
  const t0 = performance.now();
  Disco.scrivi = function (p, ...r) {
    if (p !== FILE) return vero.call(this, p, ...r);
    nelFlush += performance.now() - t0;
    return Promise.resolve(true);
  };
  try { await Storage.flushNow(); } finally { Disco.scrivi = vero; }
}

test('4 MB di storage: una scritta su una chiave piccola non riserializza il resto e il flush costa una frazione di uno pieno', async () => {
  const grande = grandeStorage();
  await Storage.set({ cronologiaGrande: grande, piccola: 0 });
  await Storage.whenSettled();
  assert.ok(leggiFile().length > 4 * 1024 * 1024, 'il file di prova deve pesare almeno 4 MB');

  for (let i = 1; i <= 5; i++) {
    let testo = '';
    const caratteri = await caratteriSerializzati(async () => {
      await Storage.set({ piccola: i });
      const vero = Disco.scrivi;
      Disco.scrivi = function (p, txt, ...r) { if (p === FILE) testo = txt; return vero.call(this, p, txt, ...r); };
      try { await Storage.flushNow(); } finally { Disco.scrivi = vero; }
    });
    assert.ok(testo.length > 4 * 1024 * 1024, 'il flush deve passare al disco il file intero');
    assert.ok(caratteri < 1000, `una chiave piccola ha fatto riserializzare ${caratteri} caratteri`);
  }

  // Non millisecondi fissi (#1228): riserializzare o clonare i 4 MB porterebbe il flush piccolo vicino al pieno, e
  // misurati a turno il carico pesa su tutti e due. Visto: 0,1–0,2 volte il pieno, anche a macchina carica.
  let giro = 0;
  const pieno = async () => { grande[0].quando = ++giro; await Storage.set({ cronologiaGrande: grande }); await flushSenzaDisco(); };
  const piccolo = async () => { await Storage.set({ piccola: `giro ${++giro}` }); await flushSenzaDisco(); };
  const costo = await rapportoFraCosti(pieno, piccolo, { tetto: 0.5, ora: () => nelFlush });
  assert.ok(costo.entro, `il flush di una chiave piccola costa quanto riscrivere tutto: ${costo.come}`);

  await Storage.set({ piccola: 'fine' });
  await Storage.whenSettled();
  const suDisco = JSON.parse(leggiFile());
  assert.equal(suDisco.piccola, 'fine');
  assert.equal(suDisco.cronologiaGrande.length, grande.length);
  assert.equal(suDisco.cronologiaGrande[0].quando, grande[0].quando);
  await Storage.remove('cronologiaGrande');
  await Storage.whenSettled();
});

test('una scrittura identica non tocca il disco e non manda eventi', async () => {
  await Storage.set({ preferenza: { tema: 'caldo', voci: [1, 2, 3] } });
  await Storage.whenSettled();
  const eventi = [];
  const stacca = Storage.onChanged((c) => eventi.push(Object.keys(c)));
  try {
    const prima = scritture;
    for (let i = 0; i < 10; i++) await Storage.set({ preferenza: { tema: 'caldo', voci: [1, 2, 3] } });
    await Storage.whenSettled();
    assert.equal(scritture, prima, 'valori identici hanno riscritto il file');
    assert.deepEqual(eventi, []);

    await Storage.set({ preferenza: { tema: 'freddo', voci: [1, 2, 3] } });
    await Storage.whenSettled();
    assert.equal(scritture, prima + 1);
    assert.deepEqual(eventi, [['preferenza']]);
    assert.equal(JSON.parse(leggiFile()).preferenza.tema, 'freddo');
  } finally {
    stacca();
  }
});

test('chi cambia il valore letto e lo riscrive con lo stesso riferimento viene salvato', async () => {
  await Storage.set({ lista: ['a'] });
  await Storage.whenSettled();
  const { lista } = await Storage.get('lista');
  lista.push('b');
  await Storage.set({ lista });
  await Storage.whenSettled();
  assert.deepEqual(JSON.parse(leggiFile()).lista, ['a', 'b']);
});

test('un valore cambiato senza set lo salva il controllo periodico, e la chiusura comunque', async () => {
  await Storage.set({ registro: { n: 1 } });
  await Storage.whenSettled();
  const { registro } = await Storage.get('registro');
  const avvisi = [];
  const warn = console.warn;
  console.warn = (...a) => avvisi.push(a.join(' '));
  try {
    registro.n = 2;
    assert.deepEqual(Storage.verificaMutazioni(), ['registro']);
    await Storage.whenSettled();
    assert.equal(JSON.parse(leggiFile()).registro.n, 2);
    assert.ok(avvisi.some((a) => a.includes('registro')));
  } finally {
    console.warn = warn;
  }
  registro.n = 3;
  Storage.flushSync();
  assert.equal(JSON.parse(leggiFile()).registro.n, 3);
  await Storage.set({ registro: { n: 3 } });
  assert.deepEqual(Storage.verificaMutazioni(), []);
});

test('tornare al valore su disco prima del flush lascia il valore giusto', async () => {
  await Storage.set({ contatore: 0 });
  await Storage.whenSettled();
  await Storage.set({ contatore: 1 });
  await Storage.set({ contatore: 0 });
  await Storage.whenSettled();
  assert.equal((await Storage.get('contatore')).contatore, 0);
  assert.equal(JSON.parse(leggiFile()).contatore, 0);
});

test('un valore cambiato dopo set ma prima del flush arriva su disco', async () => {
  const v = { passi: [1] };
  await Storage.set({ inVolo: v });
  v.passi.push(2);
  await Storage.whenSettled();
  assert.deepEqual(JSON.parse(leggiFile()).inVolo.passi, [1, 2]);
});

test('il file è identico a JSON.stringify: ordine delle chiavi, chiavi numeriche, valori undefined, chiavi tolte', async () => {
  await Storage.set({ 'z-ultima': 1, 10: 'dieci', 2: 'due', vuota: undefined, testo: 'a"b\\c ' });
  await Storage.remove('contatore');
  await Storage.whenSettled();
  assert.equal(leggiFile(), JSON.stringify(await Storage.get(null)));
  await Storage.clear();
  await Storage.whenSettled();
  assert.equal(leggiFile(), '{}');
});

test('le chiavi API si cifrano solo quando cambiano', async () => {
  cifraturaAccesa = true;
  try {
    const n0 = cifrature;
    await Storage.set({ settings: { tema: 'caldo', apiKeys: { openrouter: 'sk-uno' } } });
    await Storage.whenSettled();
    const primo = JSON.parse(leggiFile()).settings;
    assert.equal(primo.apiKeys, undefined, 'le chiavi API sono finite in chiaro');
    assert.match(primo.apiKeysEnc, /^safeStorage:v1:/);
    assert.equal(cifrature, n0 + 1);

    await Storage.set({ settings: { tema: 'freddo', apiKeys: { openrouter: 'sk-uno' } } });
    await Storage.set({ altro: 1 });
    await Storage.whenSettled();
    const secondo = JSON.parse(leggiFile()).settings;
    assert.equal(cifrature, n0 + 1, 'le chiavi API sono state ricifrate senza essere cambiate');
    assert.equal(secondo.apiKeysEnc, primo.apiKeysEnc);
    assert.equal(secondo.tema, 'freddo');

    await Storage.set({ settings: { tema: 'freddo', apiKeys: { openrouter: 'sk-due' } } });
    await Storage.whenSettled();
    assert.equal(cifrature, n0 + 2);
    const blob = JSON.parse(leggiFile()).settings.apiKeysEnc.slice('safeStorage:v1:'.length);
    assert.match(Buffer.from(blob, 'base64').toString(), /sk-due/);
    // In memoria restano in chiaro per chi legge le impostazioni.
    assert.equal((await Storage.get('settings')).settings.apiKeys.openrouter, 'sk-due');
  } finally {
    cifraturaAccesa = false;
  }
});
