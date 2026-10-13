// Una corsa di prove su un Electron diverso da quello del lock si ferma subito e dice perché, invece di dare rossi
// che sembrano del codice (#1141.5: tre prove del visore PDF rosse su Electron 33 col codice scritto per il 44).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { assicuraMotore, electronDelLock, motoreDelleProve, verdettoMotore } from '../helpers/motoreDelleProve.mjs';
import primaDellaCorsa from '../fixtures/prima-della-corsa.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function progetto({ lock = '44.7.0', pacchetto = '44.7.0', binario = null } = {}) {
  const dir = cartellaTemporanea('motore-');
  writeFileSync(join(dir, 'package.json'), '{"name":"finto"}');
  if (lock) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/electron': { version: lock } } }));
  if (pacchetto) {
    mkdirSync(join(dir, 'node_modules', 'electron', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'electron', 'package.json'), JSON.stringify({ name: 'electron', version: pacchetto }));
    if (binario) writeFileSync(join(dir, 'node_modules', 'electron', 'dist', 'version'), binario);
  }
  return dir;
}

test('il lock del repo fissa una versione di Electron che la guardia sa leggere', () => {
  const v = electronDelLock(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.match(v || '', /^\d+\.\d+\.\d+/, 'senza la versione del lock la guardia del motore tace per sempre');
  const range = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies.electron;
  assert.equal(v.split('.')[0], range.replace(/^\D+/, '').split('.')[0], `lock ${v} fuori da package.json ${range}`);
});

test('stesso motore, o binario non ancora scaricato: si corre', () => {
  assert.equal(verdettoMotore({ atteso: '44.7.0', pacchetto: '44.7.0', binario: '44.7.0' }).ok, true);
  assert.equal(verdettoMotore({ atteso: '44.7.0', pacchetto: '44.7.0', binario: null }).ok, true);
  assert.equal(verdettoMotore({ atteso: null, pacchetto: '33.4.11', binario: '33.4.11' }).ok, true, 'senza lock non c\'è un metro');
});

test('binario o pacchetto rimasti da un\'installazione vecchia: stop, coi due numeri e il rimedio', () => {
  for (const [pacchetto, binario] of [['44.7.0', '33.4.11'], ['33.4.11', '33.4.11'], ['33.4.11', null]]) {
    const v = verdettoMotore({ atteso: '44.7.0', pacchetto, binario });
    assert.equal(v.ok, false, `${pacchetto}/${binario}`);
    assert.match(v.motivo, /Electron 33\.4\.11/);
    assert.match(v.motivo, /chiede 44\.7\.0/);
    assert.match(v.motivo, /npm ci && node scripts\/ensure-electron\.mjs/);
  }
});

test('dal disco: lock, pacchetto e binario del progetto, col «v» davanti e l\'a capo di dist/version', () => {
  const casi = [
    [{ binario: 'v44.7.0\n' }, true],
    [{ binario: 'v33.4.11\n' }, false],
    [{ pacchetto: '33.4.11' }, false],
    [{ pacchetto: null }, true],
  ];
  for (const [opz, ok] of casi) {
    const dir = progetto(opz);
    try {
      const m = motoreDelleProve({ radice: dir, env: {} });
      assert.equal(m.ok, ok, JSON.stringify({ opz, m }));
      assert.equal(m.atteso, '44.7.0');
    } finally { togliCartella(dir); }
  }
});

test('un binario indicato con ELECTRON_OVERRIDE_DIST_PATH è una scelta: lo si dice, senza fermare', () => {
  const dir = progetto();
  const altro = cartellaTemporanea('motore-altro-');
  try {
    writeFileSync(join(altro, 'version'), 'v33.4.11');
    const m = motoreDelleProve({ radice: dir, env: { ELECTRON_OVERRIDE_DIST_PATH: altro } });
    assert.deepEqual([m.ok, m.scelto, m.binario], [false, true, '33.4.11']);
    assert.match(m.motivo, /per scelta/);
    const avvisi = [];
    const warn = console.warn;
    console.warn = (s) => avvisi.push(s);
    try { assicuraMotore({ radice: dir, env: { ELECTRON_OVERRIDE_DIST_PATH: altro } }); } finally { console.warn = warn; }
    assert.equal(avvisi.length, 1);
  } finally { togliCartella(dir); togliCartella(altro); }
});

test('anche i lanci fuori dal corridore di Playwright (smoke, shoot, explore) passano dalla guardia', () => {
  for (const f of ['tests/smoke.mjs', 'tests/agent/driver.mjs']) {
    assert.match(readFileSync(join(ROOT, f), 'utf8'), /\bassicuraMotore\(\{ radice: /, f);
  }
});

test('il globalSetup di Playwright si ferma sul motore sbagliato, prima di preparare la corsa', () => {
  const dir = progetto({ binario: '33.4.11' });
  const prima = process.env.TMPDIR;
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
  try {
    assert.throws(() => primaDellaCorsa({ configFile: join(dir, 'playwright.config.js') }), /Electron 33\.4\.11, ma il progetto chiede 44\.7\.0/);
    assert.equal(process.env.TMPDIR, prima, 'la corsa è stata preparata lo stesso');
  } finally {
    if (override !== undefined) process.env.ELECTRON_OVERRIDE_DIST_PATH = override;
    togliCartella(dir);
  }
});

test('ensure-electron non dice «già pronto» su un pacchetto rimasto indietro: esce con 1 e il motivo', { skip: process.platform !== 'linux' || process.arch !== 'x64' ? 'agisce solo su Linux x64' : false }, () => {
  const dir = progetto({ pacchetto: '33.2.0', binario: '33.2.0' });
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'ensure-electron.mjs'), join(dir, 'scripts', 'ensure-electron.mjs'));
    writeFileSync(join(dir, 'node_modules', 'electron', 'path.txt'), 'electron');
    writeFileSync(join(dir, 'node_modules', 'electron', 'dist', 'electron'), '');
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'ensure-electron.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /già pronto/);
    assert.match(r.stdout, /Electron 33\.2\.0 e package-lock\.json chiede la 44\.7\.0/);
  } finally { togliCartella(dir); }
});
