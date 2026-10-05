// Sentinella: le cartelle temporanee dei test se ne vanno, comunque finisca la prova (#717).
// Lasciate lì erano 13.000 cartelle e 17 GB, e col disco pieno cadevano prove sane. La regola sta in
// tests/helpers/percorsi.mjs; qui si prova da fuori, in processi veri, con la temporanea e la casa spostate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SPAZIO, ORFANA_DOPO_MS, cartellaTemporanea, togliCartelleOrfane } from '../helpers/percorsi.mjs';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PERCORSI = pathToFileURL(join(RADICE, 'tests', 'helpers', 'percorsi.mjs')).href;

// Una temporanea e una casa tutte per la prova: chi gira in parallelo non vede niente di quello che si toglie qui.
function banco() {
  const base = cartellaTemporanea('filo-pulizia-');
  const tmp = join(base, 'tmp');
  const casa = join(base, 'casa');
  mkdirSync(tmp);
  mkdirSync(casa);
  const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: casa, USERPROFILE: casa };
  // Con questa il figlio si crede una sotto-prova di chi lo lancia, ed esce verde anche da rosso.
  delete env.NODE_TEST_CONTEXT;
  return { base, tmp, casa, env, rapporto: join(base, 'fatte.json') };
}

// Crea le due cartelle che un test può chiedere e scrive dove stanno, solo se esistono davvero.
const crea = (rapporto) => `
import { cartellaTemporanea, cartellaInCasa } from ${JSON.stringify(PERCORSI)};
import { existsSync, writeFileSync } from 'node:fs';
const fatte = [cartellaTemporanea('filo-uscita-'), cartellaInCasa('filo-uscita-')];
writeFileSync(${JSON.stringify(rapporto)}, JSON.stringify(fatte.filter((d) => existsSync(d))));
`;

const fatte = (rapporto) => JSON.parse(readFileSync(rapporto, 'utf8'));

function vecchia(dir) {
  const ieri = new Date(Date.now() - 2 * ORFANA_DOPO_MS);
  utimesSync(dir, ieri, ieri);
  return dir;
}

for (const [come, finale, uscitaAttesa] of [
  ['finisce bene', '', 0],
  ['esce con un codice', 'process.exit(3);', 3],
  ['si rompe con un errore non preso', 'throw new Error("rotto");', 1],
  ['si rompe con una promessa respinta', 'await Promise.reject(new Error("rotto"));', 1],
]) {
  test(`le cartelle di un processo che ${come} se ne vanno con lui`, () => {
    const b = banco();
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', crea(b.rapporto) + finale], { env: b.env, encoding: 'utf8' });
    assert.equal(r.status, uscitaAttesa, r.stderr);
    const dirs = fatte(b.rapporto);
    assert.equal(dirs.length, 2, 'il processo ha avuto tutte e due le sue cartelle');
    assert.ok(dirs[0].startsWith(b.tmp) && dirs[1].startsWith(b.casa), `dove le aspettavo: ${dirs}`);
    for (const d of dirs) assert.ok(!existsSync(d), `rimasta dopo l'uscita: ${d}`);
  });
}

test('le cartelle di un test rosso se ne vanno quando finisce il suo file', () => {
  const b = banco();
  const file = join(b.base, 'rosso.test.mjs');
  writeFileSync(file, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${crea(b.rapporto)}\n`
    + "test('rosso', () => { assert.equal(1, 2); });\n");
  const r = spawnSync(process.execPath, ['--test', file], { env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 1, 'la prova è davvero rossa');
  const dirs = fatte(b.rapporto);
  assert.equal(dirs.length, 2);
  for (const d of dirs) assert.ok(!existsSync(d), `rimasta dopo una prova rossa: ${d}`);
});

test('le cartelle di un processo ucciso restano finché sono giovani, e la corsa del giorno dopo le toglie', async () => {
  const b = banco();
  const figlio = spawn(process.execPath, ['--input-type=module', '-e', `${crea(b.rapporto)}setInterval(() => {}, 1000);`],
    { env: b.env, stdio: 'ignore' });
  const fine = Date.now() + 20_000;
  while (!existsSync(b.rapporto) && Date.now() < fine) await new Promise((ok) => setTimeout(ok, 50));
  assert.ok(existsSync(b.rapporto), 'il figlio non ha creato le sue cartelle in 20 secondi');
  figlio.kill('SIGKILL');
  await once(figlio, 'exit');
  const dirs = fatte(b.rapporto);
  for (const d of dirs) assert.ok(existsSync(d), `un processo ucciso non vede la sua uscita: ${d}`);

  assert.deepEqual(togliCartelleOrfane({ dove: [b.tmp, b.casa] }), [], 'una cartella di oggi può essere di una corsa viva');
  const tolte = togliCartelleOrfane({ dove: [b.tmp, b.casa], oraMs: Date.now() + ORFANA_DOPO_MS + 60_000 });
  assert.deepEqual(tolte.sort(), [...dirs].sort());
  for (const d of dirs) assert.ok(!existsSync(d), `rimasta dopo la pulizia: ${d}`);
});

test('la pulizia tocca solo le cartelle col nome dei test, e lo dice prima', () => {
  const b = banco();
  const nostra = join(b.tmp, `filo-x-${SPAZIO}AbC123`);
  mkdirSync(join(nostra, 'Default', 'Cache'), { recursive: true });
  writeFileSync(join(nostra, 'Default', 'Cache', 'dati'), 'x'.repeat(1000));
  const altre = [join(b.tmp, 'filo-x-AbC123'), join(b.tmp, `filo-x-${SPAZIO}AbC12`), join(b.casa, 'Documenti con spazio')];
  for (const d of altre) mkdirSync(d);
  const file = join(b.tmp, `filo-y-${SPAZIO}ZzZ999`);
  writeFileSync(file, 'non è una cartella');
  for (const p of [nostra, ...altre, file]) vecchia(p);

  const annunci = [];
  const tolte = togliCartelleOrfane({ dove: [b.tmp, b.casa], annuncia: (n) => annunci.push(n) });
  assert.deepEqual(tolte, [nostra]);
  assert.deepEqual(annunci, [1]);
  assert.ok(!existsSync(nostra));
  for (const p of [...altre, file]) assert.ok(existsSync(p), `non era dei test: ${p}`);
});

// Le due porte da cui passa ogni corsa: il lanciatore degli unit test e il globalSetup di Playwright.
function orfanaEGiovane(b) {
  const orfana = join(b.tmp, `filo-resto-${SPAZIO}Orf4n0`);
  mkdirSync(join(orfana, 'dentro'), { recursive: true });
  vecchia(orfana);
  const giovane = join(b.casa, `filo-viva-${SPAZIO}G1ov4n`);
  mkdirSync(giovane);
  return { orfana, giovane };
}

test('npm run test:unit toglie i resti delle corse uccise prima di cominciare', () => {
  const b = banco();
  const { orfana, giovane } = orfanaEGiovane(b);
  const unit = join(b.base, 'unit');
  mkdirSync(unit);
  writeFileSync(join(unit, 'ok.test.mjs'), "import { test } from 'node:test';\ntest('ok', () => {});\n");
  const r = spawnSync(process.execPath, [join(RADICE, 'scripts', 'run-unit-tests.mjs')],
    { env: { ...b.env, FILO_UNIT_DIR: unit }, cwd: RADICE, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(!existsSync(orfana), 'la cartella di una corsa di ieri è rimasta');
  assert.ok(existsSync(giovane), 'una cartella di oggi può essere di una corsa viva');
  assert.match(r.stderr, /tolgo 1 cartelle temporanee/);
});

test('il globalSetup di Playwright toglie i resti delle corse uccise', async () => {
  const config = readFileSync(join(RADICE, 'playwright.config.js'), 'utf8');
  const nome = (config.match(/globalSetup:\s*['"]([^'"]+)['"]/) || [])[1];
  assert.ok(nome, 'playwright.config.js non ha un globalSetup');
  const { default: primaDellaCorsa } = await import(pathToFileURL(join(RADICE, nome)).href);
  const b = banco();
  const { orfana, giovane } = orfanaEGiovane(b);
  const chiavi = ['TMPDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'];
  const prima = Object.fromEntries(chiavi.map((k) => [k, process.env[k]]));
  try {
    for (const k of chiavi) process.env[k] = b.env[k];
    await primaDellaCorsa();
  } finally {
    for (const k of chiavi) { if (prima[k] === undefined) delete process.env[k]; else process.env[k] = prima[k]; }
  }
  assert.ok(!existsSync(orfana), 'la cartella di una corsa di ieri è rimasta');
  assert.ok(existsSync(giovane), 'una cartella di oggi può essere di una corsa viva');
});
