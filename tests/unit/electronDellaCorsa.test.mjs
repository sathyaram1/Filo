// Una corsa di Playwright con un Electron di un'altra major del lockfile si ferma prima di partire (#1123.5): sulla 33
// le prove degli appunti scritte per la 44 cadevano su `clipboard.read()` e sembravano rotte nel codice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  binarioElectron, confrontaElectron, controllaElectronDellaCorsa, electronDichiarato, versioneDelBinario,
} from '../helpers/electronDellaCorsa.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function repoFinto({ lock = '44.7.0', pathTxt = 'electron', binario = true } = {}) {
  const dir = cartellaTemporanea('filo-electron-corsa-');
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/electron': { version: lock } } }));
  const pacchetto = join(dir, 'node_modules', 'electron');
  mkdirSync(join(pacchetto, 'dist'), { recursive: true });
  if (pathTxt !== null) writeFileSync(join(pacchetto, 'path.txt'), pathTxt);
  if (binario && pathTxt) writeFileSync(join(pacchetto, 'dist', pathTxt), '');
  return dir;
}

test('un binario di un\'altra major ferma la corsa, e il motivo dice le due versioni e il rimedio', () => {
  const { errore, avviso } = confrontaElectron({ dichiarata: '44.7.0', inUso: '33.4.11' });
  assert.ok(errore, 'Electron 33 con il lockfile sulla 44 deve fermare la corsa');
  assert.equal(avviso, undefined);
  assert.match(errore, /33\.4\.11/);
  assert.match(errore, /44\.7\.0/);
  assert.match(errore, /npm ci/);
});

test('con ELECTRON_OVERRIDE_DIST_PATH il rimedio indica quella variabile, non i pacchetti', () => {
  const { errore } = confrontaElectron({ dichiarata: '44.7.0', inUso: '33.4.11', altrove: '/opt/electron-33' });
  assert.match(errore, /ELECTRON_OVERRIDE_DIST_PATH/);
  assert.match(errore, /\/opt\/electron-33/);
});

test('stessa major con un\'altra versione: la corsa parte, con un avviso', () => {
  const r = confrontaElectron({ dichiarata: '44.7.0', inUso: '44.8.1' });
  assert.equal(r.errore, undefined);
  assert.match(r.avviso, /44\.8\.1/);
});

test('versioni uguali, o un dato che manca: nessun errore e nessun avviso', () => {
  assert.deepEqual(confrontaElectron({ dichiarata: '44.7.0', inUso: '44.7.0' }), {});
  assert.deepEqual(confrontaElectron({ dichiarata: '44.7.0', inUso: null }), {});
  assert.deepEqual(confrontaElectron({ dichiarata: null, inUso: '33.4.11' }), {});
  assert.deepEqual(confrontaElectron({ dichiarata: '44.7.0', inUso: 'undefined' }), {});
});

test('il lockfile del repo dichiara una versione di Electron che il controllo sa leggere', () => {
  assert.match(String(electronDichiarato(ROOT)), /^\d+\.\d+\.\d+/);
});

test('il binario è lo stesso file che darebbe require(\'electron\'), anche spostato altrove', () => {
  const dir = repoFinto();
  try {
    assert.equal(binarioElectron(dir, {}), join(dir, 'node_modules', 'electron', 'dist', 'electron'));
    const altrove = cartellaTemporanea('filo-electron-altrove-');
    try {
      assert.equal(binarioElectron(dir, { ELECTRON_OVERRIDE_DIST_PATH: altrove }), null, 'nella cartella indicata non c\'è niente');
      writeFileSync(join(altrove, 'electron'), '');
      assert.equal(binarioElectron(dir, { ELECTRON_OVERRIDE_DIST_PATH: altrove }), join(altrove, 'electron'));
    } finally { togliCartella(altrove); }
  } finally { togliCartella(dir); }
});

test('un binario non ancora scaricato non ferma niente: lo scarica il primo lancio', () => {
  const senzaPath = repoFinto({ pathTxt: null });
  const senzaFile = repoFinto({ binario: false });
  try {
    assert.equal(binarioElectron(senzaPath, {}), null);
    assert.equal(binarioElectron(senzaFile, {}), null);
    assert.deepEqual(controllaElectronDellaCorsa(senzaFile, {}, { leggiVersione: () => '33.4.11' }), {});
  } finally { togliCartella(senzaPath); togliCartella(senzaFile); }
});

test('la corsa legge la versione dal binario che lancerebbe e la confronta col lockfile', () => {
  const dir = repoFinto({ lock: '44.7.0' });
  try {
    const letti = [];
    const r = controllaElectronDellaCorsa(dir, {}, { leggiVersione: (f) => { letti.push(f); return '33.4.11'; } });
    assert.deepEqual(letti, [join(dir, 'node_modules', 'electron', 'dist', 'electron')]);
    assert.ok(r.errore);
    assert.deepEqual(controllaElectronDellaCorsa(dir, {}, { leggiVersione: () => '44.7.0' }), {});
  } finally { togliCartella(dir); }
});

test('un eseguibile che non risponde come Electron non dà una versione, quindi non ferma la corsa', () => {
  assert.equal(versioneDelBinario(process.execPath), null, 'Node con ELECTRON_RUN_AS_NODE non ha process.versions.electron');
  assert.equal(versioneDelBinario(join(ROOT, 'non-esiste-electron')), null);
});
