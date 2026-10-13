// Sentinella: chi lancia Electron per provare Filo si ferma se il motore installato non è quello del lock, e dice perché
// (#1141.4: Electron 33 rimasto in node_modules sotto prove scritte per la 44 dava rossi che sembravano del codice).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronDelLock, richiediElectronDelLock } from '../../scripts/lib/electron-del-lock.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function repoFinto({ lock = '44.7.0', pacchetto = '44.7.0', binario = '44.7.0' } = {}) {
  const dir = cartellaTemporanea('filo-electron-lock-');
  if (lock) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/electron': { version: lock } } }));
  const el = join(dir, 'node_modules', 'electron');
  mkdirSync(join(el, 'dist'), { recursive: true });
  if (pacchetto) writeFileSync(join(el, 'package.json'), JSON.stringify({ name: 'electron', version: pacchetto }));
  if (binario) writeFileSync(join(el, 'dist', 'version'), binario);
  return dir;
}

function conRepo(opzioni, fn) {
  const dir = repoFinto(opzioni);
  try { return fn(dir); } finally { togliCartella(dir); }
}

test('node_modules rimasto alla 33 sotto un lock della 44: fermo, con le due versioni e il rimedio', () => conRepo({ pacchetto: '33.2.0', binario: '33.2.0' }, (dir) => {
  const e = electronDelLock(dir, { env: {} });
  assert.equal(e.ok, false);
  assert.match(e.motivo, /33\.2\.0/);
  assert.match(e.motivo, /44\.7\.0/);
  assert.match(e.motivo, /npm ci/);
  assert.throws(() => richiediElectronDelLock(dir, { env: {} }), /Electron non è quello del lock: .*33\.2\.0.*44\.7\.0/s);
}));

test('pacchetto, binario e lock uguali: si parte', () => conRepo({}, (dir) => {
  const e = electronDelLock(dir, { env: {} });
  assert.equal(e.ok, true, e.motivo);
  assert.deepEqual([e.lock, e.pacchetto, e.binario], ['44.7.0', '44.7.0', '44.7.0']);
  assert.doesNotThrow(() => richiediElectronDelLock(dir, { env: {} }));
}));

test('pacchetto giusto ma binario di prima: fermo, e il motivo nomina il binario', () => conRepo({ binario: 'v33.2.0' }, (dir) => {
  const e = electronDelLock(dir, { env: {} });
  assert.equal(e.ok, false);
  assert.match(e.motivo, /binario in node_modules\/electron\/dist è Electron 33\.2\.0/);
}));

test('il «v» davanti alla versione del binario non conta', () => conRepo({ binario: 'v44.7.0\n' }, (dir) => {
  assert.equal(electronDelLock(dir, { env: {} }).ok, true);
}));

test('binario non ancora scaricato, o lock assente: niente da confrontare, si parte', () => {
  conRepo({ binario: null }, (dir) => assert.equal(electronDelLock(dir, { env: {} }).ok, true));
  conRepo({ lock: null, pacchetto: '33.2.0' }, (dir) => assert.equal(electronDelLock(dir, { env: {} }).ok, true));
});

test('con ELECTRON_OVERRIDE_DIST_PATH si confronta il binario che partirà davvero', () => conRepo({}, (dir) => {
  const altro = join(dir, 'altro-dist');
  mkdirSync(altro);
  writeFileSync(join(altro, 'version'), '33.2.0');
  const e = electronDelLock(dir, { env: { ELECTRON_OVERRIDE_DIST_PATH: altro } });
  assert.equal(e.ok, false);
  assert.match(e.motivo, /ELECTRON_OVERRIDE_DIST_PATH .*Electron 33\.2\.0.*Togli la variabile/s);
}));

test('ensure-electron non dice «già pronto» su un pacchetto rimasto indietro: esce con 1 e il motivo', { skip: process.platform !== 'linux' || process.arch !== 'x64' ? 'agisce solo su Linux x64' : false }, () => conRepo({ pacchetto: '33.2.0', binario: '33.2.0' }, (dir) => {
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'ensure-electron.mjs'), join(dir, 'scripts', 'ensure-electron.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'lib', 'electron-del-lock.mjs'), join(dir, 'scripts', 'lib', 'electron-del-lock.mjs'));
  writeFileSync(join(dir, 'node_modules', 'electron', 'path.txt'), 'electron');
  writeFileSync(join(dir, 'node_modules', 'electron', 'dist', 'electron'), '');
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'ensure-electron.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /già pronto/);
  assert.match(r.stdout, /Electron 33\.2\.0 e package-lock\.json chiede la 44\.7\.0/);
}));

test('ogni strada che lancia Electron per provare Filo chiede prima il controllo', () => {
  const porte = {
    'tests/fixtures/prima-della-corsa.mjs': /richiediElectronDelLock\(/,
    'tests/smoke.mjs': /richiediElectronDelLock\(ROOT\);\s*\nconst electronExe = /,
    'tests/agent/driver.mjs': /richiediElectronDelLock\(APP_ROOT, \{ env \}\);\s*\n\s*const app = await electron\.launch/,
    'scripts/ensure-electron.mjs': /electronDelLock\(ROOT\)/,
  };
  for (const [file, re] of Object.entries(porte)) assert.match(readFileSync(join(ROOT, file), 'utf8'), re, file);
  assert.match(readFileSync(join(ROOT, 'playwright.config.js'), 'utf8'), /globalSetup: '\.\/tests\/fixtures\/prima-della-corsa\.mjs'/);
});
