// Sentinella: le cartelle temporanee dei test se ne vanno, comunque finisca la prova (#717).
// Lasciate lì erano 13.000 cartelle e 17 GB, e col disco pieno cadevano prove sane. La regola sta in
// tests/helpers/percorsi.mjs; qui si prova da fuori, in processi veri, con la temporanea e la casa spostate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SPAZIO, ORFANA_DOPO_MS, PREFISSO_CORSA, cartellaTemporanea, togliCartelleOrfane } from '../helpers/percorsi.mjs';

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
  assert.ok(tolte.length, 'la pulizia del giorno dopo non ha tolto niente');
  for (const d of dirs) assert.ok(!existsSync(d), `rimasta dopo la pulizia: ${d}`);
  assert.deepEqual(readdirSync(b.tmp), [], 'nella temporanea resta qualcosa che la pulizia non riconosce');
});

test('la pulizia tocca solo le cartelle col nome dei test, e lo dice prima', () => {
  const b = banco();
  const nostra = join(b.tmp, `filo-x-${SPAZIO}AbC123`);
  mkdirSync(join(nostra, 'Default', 'Cache'), { recursive: true });
  writeFileSync(join(nostra, 'Default', 'Cache', 'dati'), 'x'.repeat(1000));
  const corsa = join(b.tmp, `${PREFISSO_CORSA}Q1w2E3`);
  mkdirSync(join(corsa, 'scoped_dirAbC123'), { recursive: true });
  const altre = [join(b.tmp, 'filo-x-AbC123'), join(b.tmp, `filo-x-${SPAZIO}AbC12`), join(b.casa, 'Documenti con spazio'),
    join(b.tmp, `mia-${PREFISSO_CORSA}AbC123`)];
  for (const d of altre) mkdirSync(d);
  const file = join(b.tmp, `filo-y-${SPAZIO}ZzZ999`);
  writeFileSync(file, 'non è una cartella');
  for (const p of [nostra, corsa, ...altre, file]) vecchia(p);

  const annunci = [];
  const tolte = togliCartelleOrfane({ dove: [b.tmp, b.casa], annuncia: (n) => annunci.push(n) });
  assert.deepEqual(tolte.sort(), [nostra, corsa].sort());
  assert.deepEqual(annunci, [2]);
  assert.ok(!existsSync(nostra) && !existsSync(corsa));
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
    const dopo = await primaDellaCorsa();
    if (typeof dopo === 'function') await dopo();
  } finally {
    for (const k of chiavi) { if (prima[k] === undefined) delete process.env[k]; else process.env[k] = prima[k]; }
  }
  assert.ok(!existsSync(orfana), 'la cartella di una corsa di ieri è rimasta');
  assert.ok(existsSync(giovane), 'una cartella di oggi può essere di una corsa viva');
});

// Il codice provato scrive nella temporanea per conto suo (i file di consegna di dispatch, le cartelle di Chromium):
// nessuna prova la chiede, quindi nessuna la toglie. Ogni corsa ne ha una sua, e se ne va con lei.
const scriveDaSolo = (rosso) => "import { test } from 'node:test';\nimport { mkdirSync, writeFileSync } from 'node:fs';\n"
  + "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\n"
  + "test('scrive', () => { const d = join(tmpdir(), 'filo-consegna-' + Math.random().toString(16).slice(2));\n"
  + `  mkdirSync(d); writeFileSync(join(d, 'pezzo.txt'), 'x'); ${rosso ? "throw new Error('rosso');" : ''} });\n`;

for (const rosso of [false, true]) {
  test(`npm run test:unit non lascia nella temporanea quello che il codice provato ci scrive da solo${rosso ? ', anche da rosso' : ''}`, () => {
    const b = banco();
    const unit = join(b.base, 'unit');
    mkdirSync(unit);
    writeFileSync(join(unit, 'scrive.test.mjs'), scriveDaSolo(rosso));
    const r = spawnSync(process.execPath, [join(RADICE, 'scripts', 'run-unit-tests.mjs')],
      { env: { ...b.env, FILO_UNIT_DIR: unit }, cwd: RADICE, encoding: 'utf8' });
    assert.equal(r.status, rosso ? 1 : 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /# pass [01]/, 'la prova è girata davvero');
    assert.deepEqual(readdirSync(b.tmp), [], 'rimasto nella temporanea dopo la corsa');
  });
}

// Lanciato da solo, senza il lanciatore: è caricare le regole delle cartelle che dà al file la sua corsa.
test('un file di prova lanciato da solo non lascia nella temporanea quello che il codice provato ci scrive', () => {
  const b = banco();
  const file = join(b.base, 'scrive.test.mjs');
  writeFileSync(file, `import ${JSON.stringify(PERCORSI)};\n${scriveDaSolo(true)}`);
  const r = spawnSync(process.execPath, ['--test', file], { env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /# fail 1/, 'la prova è girata davvero');
  assert.deepEqual(readdirSync(b.tmp), [], 'rimasto nella temporanea dopo la prova');
});

test('npm run test:unit interrotto lascia solo quello che la pulizia del giorno dopo riconosce', async () => {
  const b = banco();
  const unit = join(b.base, 'unit');
  mkdirSync(unit);
  writeFileSync(join(unit, 'appesa.test.mjs'), "import { test } from 'node:test';\ntest('appesa', () => new Promise(() => setInterval(() => {}, 1000)));\n");
  const figlio = spawn(process.execPath, [join(RADICE, 'scripts', 'run-unit-tests.mjs')],
    { env: { ...b.env, FILO_UNIT_DIR: unit }, cwd: RADICE, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
  let uscita = '';
  figlio.stdout.on('data', (d) => { uscita += d; });
  const fine = Date.now() + 30_000;
  while (!/appesa|Subtest|gruppo/.test(uscita) && Date.now() < fine) await new Promise((ok) => setTimeout(ok, 50));
  await new Promise((ok) => setTimeout(ok, 500));
  // Come un Ctrl+C: arriva a tutto il gruppo, lanciatore e prove.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(figlio.pid), '/T', '/F']);
  else process.kill(-figlio.pid, 'SIGINT');
  await once(figlio, 'exit');
  assert.notDeepEqual(readdirSync(b.tmp), [], 'la corsa non ha lasciato niente: la prova non prova l\'interruzione');
  togliCartelleOrfane({ dove: [b.tmp], oraMs: Date.now() + ORFANA_DOPO_MS + 60_000 });
  assert.deepEqual(readdirSync(b.tmp), [], 'resta qualcosa che la pulizia del giorno dopo non riconosce');
});

test('il globalSetup di Playwright dà alla corsa una temporanea sua, e la toglie con quello che c\'è dentro', async () => {
  const config = readFileSync(join(RADICE, 'playwright.config.js'), 'utf8');
  const nome = (config.match(/globalSetup:\s*['"]([^'"]+)['"]/) || [])[1];
  const { default: primaDellaCorsa } = await import(pathToFileURL(join(RADICE, nome)).href);
  const b = banco();
  const chiavi = ['TMPDIR', 'TEMP', 'TMP'];
  const prima = Object.fromEntries(chiavi.map((k) => [k, process.env[k]]));
  let temp;
  let dopo;
  try {
    for (const k of chiavi) process.env[k] = b.env[k];
    dopo = await primaDellaCorsa();
    temp = tmpdir();
  } finally {
    for (const k of chiavi) { if (prima[k] === undefined) delete process.env[k]; else process.env[k] = prima[k]; }
  }
  assert.notEqual(temp, b.tmp, 'i lavoratori ereditano ancora la temporanea di sistema');
  assert.ok(temp.startsWith(b.tmp), `la temporanea della corsa sta fuori da quella di sistema: ${temp}`);
  // Su Mac Chromium mette il suo socket lì sotto, e oltre 104 caratteri di percorso Electron non parte.
  assert.ok(temp.length <= join(b.tmp, `${PREFISSO_CORSA}AbC123`).length, `temporanea della corsa troppo lunga: ${temp}`);
  mkdirSync(join(temp, 'scoped_dirAbC123'));
  assert.equal(typeof dopo, 'function', 'nessuno toglie la temporanea a fine corsa');
  await dopo();
  assert.deepEqual(readdirSync(b.tmp), [], 'rimasto nella temporanea dopo la corsa');
});
