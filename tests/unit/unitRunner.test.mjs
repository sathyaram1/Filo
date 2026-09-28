// Sentinella del lanciatore degli unit test: il comando non dipende da un glob da espandere (sul runner Node 20 non
// lo espande nessuno), trova tutti i file da qualunque cartella, e la riga di comando sta nel tetto di Windows (#765).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { collectTestFiles, isTestFile, UNIT_DIR, REPO_ROOT, gruppiDiLancio, perLaRiga } from '../../scripts/run-unit-tests.mjs';
import { costoArgomentoWindows } from '../../scripts/lib/riga-di-comando.mjs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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
    const casa = cartellaTemporanea('filo-runner-');
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
    const vuota = cartellaTemporanea('filo-runner-vuota-');
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
    const altrove = cartellaTemporanea('filo-altrove-');
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
    const vuota = cartellaTemporanea('filo-vuota-');
    try {
      const r = spawnSync(process.execPath, [LANCIATORE], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_UNIT_DIR: vuota },
      });
      assert.equal(r.status, 1, 'una suite vuota deve fallire');
      assert.match(r.stderr, /nessun file/);
    } finally { rmSync(vuota, { recursive: true, force: true }); }
  });
});

// Windows rifiuta una riga oltre 32.767 caratteri (CreateProcess): prima ogni file era un percorso assoluto, e in una
// cartella di lavoro dal nome lungo `npm run test:unit` usciva con ENAMETOOLONG senza eseguire niente.
const TETTO_WINDOWS = 32767;
const lunghezzaRiga = (gruppo, flags = []) =>
  [process.execPath, '--test', ...flags, ...gruppo].reduce((n, a) => n + costoArgomentoWindows(a), 0);

describe('la riga di comando sta nel tetto di Windows', () => {
  test('la riga non cresce col percorso della cartella di lavoro', () => {
    const veri = collectTestFiles();
    const corta = gruppiDiLancio(veri);
    const lunga = 'C:\\Users\\agenti AI\\Documents\\Filo\\.claude\\worktrees\\' + 'nome-lunghissimo-'.repeat(12);
    const altrove = resolve(lunga);
    const spostati = veri.map((f) => join(altrove, relative(REPO_ROOT, f)));
    assert.deepEqual(gruppiDiLancio(spostati, { root: altrove }), corta, 'stessi gruppi, stessi argomenti, qualunque sia la root');
    for (const g of corta) for (const f of g) assert.ok(!isAbsolute(f) && f.startsWith('tests/unit/'), `argomento non relativo: ${f}`);
  });

  test('ogni gruppo sta nel tetto, e insieme sono tutti i file nell’ordine', () => {
    const veri = collectTestFiles();
    const tanti = Array.from({ length: 4000 }, (_, i) => join(UNIT_DIR, `prova-${String(i).padStart(4, '0')}-${'x'.repeat(30)}.test.mjs`));
    for (const files of [veri, tanti]) {
      const flags = ['--test-reporter=spec', '--test-name-pattern=una "frase" con spazi'];
      const gruppi = gruppiDiLancio(files, { flags });
      assert.deepEqual(gruppi.flat(), files.map((f) => perLaRiga(f)), 'nessun file perso, duplicato o spostato');
      for (const g of gruppi) assert.ok(lunghezzaRiga(g, flags) <= TETTO_WINDOWS, `riga di ${lunghezzaRiga(g, flags)} caratteri`);
    }
    assert.ok(gruppiDiLancio(tanti).length > 1, '4.000 file non stanno in una riga sola');
  });

  test('con la suite di oggi un gruppo solo: l’uscita resta quella di un `node --test` qualunque', () => {
    assert.equal(gruppiDiLancio(collectTestFiles()).length, 1);
  });

  test('un file fuori dalla root resta assoluto, e le barre sono quelle normali', () => {
    const fuori = resolve(REPO_ROOT, '..', 'altrove', 'a.test.mjs');
    assert.equal(perLaRiga(fuori), fuori);
    assert.equal(perLaRiga(join(REPO_ROOT, 'tests', 'unit', 'sotto', 'b.test.mjs')), 'tests/unit/sotto/b.test.mjs');
  });

  test('a gruppi: girano tutti, i flag arrivano a ciascuno, e un gruppo rosso fa rossa l’uscita', () => {
    const casa = cartellaTemporanea('filo-runner-gruppi-');
    const marche = join(casa, 'marche');
    const prove = join(casa, 'prove');
    try {
      mkdirSync(marche, { recursive: true });
      mkdirSync(prove, { recursive: true });
      const scrivi = (nome, rosso) => writeFileSync(join(prove, nome), [
        "import { test } from 'node:test';",
        "import { writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `test('${nome}', () => { writeFileSync(join(process.env.FILO_MARCHE, '${nome}'), ''); ${rosso ? "throw new Error('rosso voluto');" : ''} });`,
      ].join('\n'));
      scrivi('a.test.mjs', false);
      scrivi('b.test.mjs', true);
      scrivi('c.test.mjs', false);
      // Tetto minimo: ogni file va nel suo gruppo, come succederebbe su Windows con una suite enorme.
      // Senza NODE_TEST_CONTEXT: dentro `node --test` il `node --test` annidato riferirebbe al padre, non a noi.
      const { NODE_TEST_CONTEXT: _, ...ambiente } = process.env;
      const lancia = () => spawnSync(process.execPath, [LANCIATORE, '--test-reporter=tap'], {
        cwd: ROOT, encoding: 'utf8',
        env: { ...ambiente, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '1', FILO_MARCHE: marche },
      });
      const r = lancia();
      assert.notEqual(r.status, 0, 'un gruppo rosso deve fare rossa l’uscita');
      assert.deepEqual(readdirSync(marche).sort(), ['a.test.mjs', 'b.test.mjs', 'c.test.mjs'], 'il gruppo dopo il rosso deve girare lo stesso');
      assert.equal((r.stdout.match(/TAP version/g) || []).length, 3, 'il flag deve arrivare a ogni gruppo');
      assert.match(r.stdout, /gruppo 3 di 3/);
      assert.match(r.stdout, /ROSSO: gruppo 2 di 3/);

      scrivi('b.test.mjs', false);
      rmSync(marche, { recursive: true, force: true }); mkdirSync(marche);
      const verde = lancia();
      assert.equal(verde.status, 0, verde.stdout + verde.stderr);
      assert.equal(readdirSync(marche).length, 3);
      assert.match(verde.stdout, /verde: 3 gruppi, 3 file/);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
