// La sentinella del lanciatore degli unit test.
//
// PERCHÉ ESISTE
//   Dal 18/08/2026 la pubblicazione agli utenti si è fermata per giorni, e non
//   perché un test fosse rosso: `npm run test:unit` era
//   `node --test "tests/unit/**/*.test.mjs"`, e quel glob lo espande QUALCUNO —
//   in locale Node 22, sul runner della pubblicazione (Node 20, bash su
//   Windows) nessuno. Là Node cercava un file chiamato letteralmente
//   `tests\unit\**\*.test.mjs`, non lo trovava, e usciva con errore: cancello
//   rosso, nessuna versione pubblicata, e in locale tutto verde — quindi
//   invisibile.
//
//   Questi test sorvegliano due cose diverse:
//     1) che il comando NON torni a dipendere dall'espansione di una shell
//        (è l'unico modo per accorgersene senza avere un runner sottomano);
//     2) che il lanciatore trovi davvero tutti i file, anche in sottocartelle,
//        e funzioni lanciato da una cartella qualsiasi.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { collectTestFiles, isTestFile, UNIT_DIR, REPO_ROOT } from '../../scripts/run-unit-tests.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const LANCIATORE = resolve(ROOT, 'scripts', 'run-unit-tests.mjs');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

describe('il comando non deve dipendere dal glob della shell', () => {
  test('test:unit non contiene un pattern da espandere', () => {
    const cmd = String(pkg.scripts['test:unit'] || '');
    assert.ok(cmd, 'manca lo script test:unit');
    // `*` in un argomento significa "che qualcuno lo espanda": in locale lo fa
    // Node, sul runner non lo fa nessuno. Se questo assert diventa rosso, la
    // pubblicazione si sta per fermare di nuovo.
    assert.ok(!cmd.includes('*'),
      `test:unit è tornato a dipendere da un glob ("${cmd}"): sul runner non lo espande nessuno.`);
    assert.ok(!/node\s+--test\s+["']?tests/.test(cmd),
      `test:unit passa un percorso a node --test ("${cmd}"): i file li deve raccogliere il lanciatore.`);
  });

  test('test:unit lancia uno script che esiste davvero', () => {
    const cmd = String(pkg.scripts['test:unit'] || '');
    const m = cmd.match(/node\s+(\S+\.mjs)/);
    assert.ok(m, `test:unit deve lanciare uno script node: "${cmd}"`);
    assert.ok(existsSync(resolve(ROOT, m[1])), `lo script ${m[1]} non esiste`);
  });
});

describe('raccolta dei file di test', () => {
  test('trova TUTTI i *.test.mjs della cartella vera, non un sottoinsieme', () => {
    const attesi = readdirSync(UNIT_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
      .map((e) => join(UNIT_DIR, e.name))
      .sort();
    const trovati = collectTestFiles().filter((f) => dirname(f) === UNIT_DIR).sort();
    assert.deepEqual(trovati, attesi);
    // La suite è grande: se un giorno ne restassero quattro, qualcosa si è
    // rotto nella raccolta e non nei test.
    assert.ok(trovati.length > 100, `solo ${trovati.length} file di test raccolti`);
  });

  test('i percorsi sono assoluti (è ciò che rende il lancio indipendente dalla cartella)', () => {
    for (const f of collectTestFiles()) assert.ok(isAbsolute(f), `percorso relativo: ${f}`);
  });

  test('scende nelle sottocartelle, e ignora quello che non è un test', () => {
    const casa = mkdtempSync(join(tmpdir(), 'filo-runner-'));
    try {
      mkdirSync(join(casa, 'dentro'), { recursive: true });
      mkdirSync(join(casa, 'node_modules'), { recursive: true });
      mkdirSync(join(casa, '.cache'), { recursive: true });
      writeFileSync(join(casa, 'uno.test.mjs'), '');
      writeFileSync(join(casa, 'dentro', 'due.test.mjs'), '');
      writeFileSync(join(casa, 'aiuto.mjs'), '');            // non è un test
      writeFileSync(join(casa, 'tre.test.js'), '');          // non è .mjs
      writeFileSync(join(casa, 'node_modules', 'x.test.mjs'), '');
      writeFileSync(join(casa, '.cache', 'y.test.mjs'), '');
      const trovati = collectTestFiles(casa).map((f) => f.slice(casa.length + 1));
      assert.deepEqual(trovati.sort(), [join('dentro', 'due.test.mjs'), 'uno.test.mjs'].sort());
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('cartella assente o vuota: nessun file, e nessuna eccezione', () => {
    const vuota = mkdtempSync(join(tmpdir(), 'filo-runner-vuota-'));
    try {
      assert.deepEqual(collectTestFiles(vuota), []);
      assert.deepEqual(collectTestFiles(join(vuota, 'non-esiste')), []);
    } finally { rmSync(vuota, { recursive: true, force: true }); }
  });

  test('isTestFile riconosce solo i *.test.mjs', () => {
    assert.ok(isTestFile('a.test.mjs'));
    assert.ok(!isTestFile('a.test.js'));
    assert.ok(!isTestFile('test.mjs'));
    assert.ok(!isTestFile(''));
  });
});

describe('il lanciatore lanciato da fuori', () => {
  test('da una cartella qualunque trova comunque i test del repo', () => {
    const altrove = mkdtempSync(join(tmpdir(), 'filo-altrove-'));
    try {
      const r = spawnSync(process.execPath, [LANCIATORE, '--list'], {
        cwd: altrove, encoding: 'utf8',
      });
      assert.equal(r.status, 0, `uscita ${r.status}: ${r.stderr}`);
      const righe = r.stdout.split(/\r?\n/).filter(Boolean);
      assert.ok(righe.length > 100, `solo ${righe.length} file elencati da fuori`);
      // Questo stesso file dev'essere nell'elenco: se non c'è, il lanciatore
      // sta guardando la cartella sbagliata.
      assert.ok(righe.some((f) => f.endsWith('unitRunner.test.mjs')), 'manca il file della sentinella');
      assert.equal(REPO_ROOT, ROOT);
    } finally { rmSync(altrove, { recursive: true, force: true }); }
  });

  test('zero test trovati = uscita ROSSA, mai un verde silenzioso', () => {
    const vuota = mkdtempSync(join(tmpdir(), 'filo-vuota-'));
    try {
      const r = spawnSync(process.execPath, [LANCIATORE], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_UNIT_DIR: vuota },
      });
      assert.equal(r.status, 1, 'una suite vuota deve fallire');
      assert.match(r.stderr, /nessun file/);
    } finally { rmSync(vuota, { recursive: true, force: true }); }
  });
});
