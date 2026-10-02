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
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  collectTestFiles, fileArgs, isTestFile, UNIT_DIR, REPO_ROOT, TETTO_WINDOWS, TETTO_RIGA,
  gruppiDiLancio, perLaRiga, flagsConRiepilogo, sommaRiepiloghi, testoRiepilogo,
} from '../../scripts/run-unit-tests.mjs';
import { costoArgomentoWindows, lottiPerRigaDiComando } from '../../scripts/lib/riga-di-comando.mjs';
import { lottiPerRigaDiComando as lottiDiFinish } from '../../scripts/finish-local.mjs';
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

  test('a node --test arrivano relativi alla root: la riga di comando non cresce con la cartella del repo', () => {
    const files = collectTestFiles();
    const args = fileArgs(files);
    assert.equal(args.length, files.length);
    for (const a of args) {
      assert.ok(!isAbsolute(a) && a.startsWith('tests/unit/'), `argomento inatteso: ${a}`);
      assert.ok(existsSync(resolve(REPO_ROOT, a)), `non esiste dalla root: ${a}`);
    }
    // Il tetto di Windows è 32767 caratteri per tutta la riga: che il repo stia in una cartella lunga non deve contare.
    const profonda = resolve(REPO_ROOT, 'x'.repeat(200));
    assert.deepEqual(fileArgs(files.map((f) => resolve(profonda, f.slice(REPO_ROOT.length + 1))), profonda), args);
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

// #765: Windows rifiuta una riga oltre 32.767 caratteri (CreateProcess) e `npm run test:unit` usciva con ENAMETOOLONG
// senza eseguire niente. La riga si misura intera, eseguibile e flag compresi, mai a numero di file.
const lunghezzaRiga = (execPath, flags, gruppo) =>
  [execPath, '--test', ...flags, ...gruppo].reduce((n, a) => n + costoArgomentoWindows(a), 0);
const LUNGO = 'C:\\Users\\agenti AI\\Desktop\\Filo\\Filo\\.claude\\worktrees\\' + 'nome-lunghissimo-'.repeat(12);

describe('la riga di comando sta nel tetto di Windows', () => {
  test('il tetto è sotto il limite vero, con margine', () => {
    assert.equal(TETTO_WINDOWS, 32767);
    assert.ok(TETTO_RIGA < TETTO_WINDOWS && TETTO_RIGA >= 28000, `tetto ${TETTO_RIGA}`);
  });

  test('una riga oltre il tetto si spezza: ogni gruppo ci sta, e insieme sono tutti i file nell’ordine', () => {
    const tanti = Array.from({ length: 4000 }, (_, i) => join(UNIT_DIR, `prova-${String(i).padStart(4, '0')}-${'x'.repeat(30)}.test.mjs`));
    const flags = flagsConRiepilogo(['--test-name-pattern=una "frase" con spazi'], join(LUNGO, 'gruppo-0001.jsonl'));
    const gruppi = gruppiDiLancio(tanti, { flags });
    assert.ok(gruppi.length > 1, '4.000 file non stanno in una riga sola');
    assert.deepEqual(gruppi.flat(), tanti.map((f) => perLaRiga(f)), 'nessun file perso, duplicato o spostato');
    for (const g of gruppi) {
      const n = lunghezzaRiga(process.execPath, flags, g);
      assert.ok(n <= TETTO_RIGA, `riga di ${n} caratteri`);
    }
  });

  test('un percorso di cartella di lavoro lungo non porta mai la riga oltre il tetto', () => {
    const veri = collectTestFiles();
    const nodeLungo = join(LUNGO, 'node', 'node.exe');
    const flags = flagsConRiepilogo([], join(LUNGO, 'tmp', 'gruppo-0001.jsonl'), { tty: true });
    const spostati = veri.map((f) => join(LUNGO, relative(REPO_ROOT, f)));
    const gruppi = gruppiDiLancio(spostati, { root: LUNGO, flags, execPath: nodeLungo });
    assert.deepEqual(gruppi, gruppiDiLancio(veri, { flags, execPath: nodeLungo }), 'stessi gruppi qualunque sia la root');
    for (const g of gruppi) {
      for (const f of g) assert.ok(!isAbsolute(f) && f.startsWith('tests/unit/'), `argomento non relativo: ${f}`);
      assert.ok(lunghezzaRiga(nodeLungo, flags, g) <= TETTO_RIGA);
    }
    // Anche con una root lunghissima: la cartella non entra nella riga.
    const enorme = 'D:\\' + 'x'.repeat(100_000);
    assert.deepEqual(gruppiDiLancio(veri.map((f) => join(enorme, relative(REPO_ROOT, f))), { root: enorme }), gruppiDiLancio(veri));
  });

  test('con la suite di oggi un gruppo solo: l’uscita resta quella di un `node --test` qualunque', () => {
    assert.equal(gruppiDiLancio(collectTestFiles(), { flags: flagsConRiepilogo([], join(LUNGO, 'g.jsonl')) }).length, 1);
  });

  test('un file fuori dalla root resta assoluto, e le barre sono quelle normali', () => {
    const fuori = resolve(REPO_ROOT, '..', 'altrove', 'a.test.mjs');
    assert.equal(perLaRiga(fuori), fuori);
    assert.equal(perLaRiga(join(REPO_ROOT, 'tests', 'unit', 'sotto', 'b.test.mjs')), 'tests/unit/sotto/b.test.mjs');
  });

  test('i lotti degli spec della chiusura sono la stessa funzione, col tetto di cmd.exe', () => {
    assert.equal(lottiDiFinish, lottiPerRigaDiComando);
    assert.deepEqual(lottiPerRigaDiComando(['a', 'b', 'c'], 4), [['a', 'b'], ['c']]);
    assert.deepEqual(lottiPerRigaDiComando(['abcdef'], 4), [['abcdef']], 'una voce più lunga del tetto va da sola, non sparisce');
  });
});

describe('il riepilogo di una suite a gruppi', () => {
  test('il reporter del riepilogo si aggiunge senza spegnere quello che si vede', () => {
    assert.deepEqual(flagsConRiepilogo([], 'R', { tty: true }),
      ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./scripts/lib/riepilogo-unit.mjs', '--test-reporter-destination=R']);
    assert.equal(flagsConRiepilogo([], 'R', { tty: false })[0], '--test-reporter=tap', 'fuori dal terminale node usa tap, e tap si legge nei log del cancello');
    assert.deepEqual(flagsConRiepilogo(['--test-reporter=dot'], 'R').slice(0, 2), ['--test-reporter=dot', '--test-reporter-destination=stdout']);
    assert.equal(flagsConRiepilogo(['--test-reporter=dot', '--test-reporter=tap', '--test-reporter-destination=x'], 'R'), null);
  });

  test('somma i gruppi contando come node, e i rossi sono le cause, non i genitori', () => {
    const t = (esito, nome, extra = {}) => ({ esito, nome, file: join(REPO_ROOT, 'tests', 'unit', 'a.test.mjs'), riga: 3, suite: false, causa: null, skip: false, todo: false, ...extra });
    const somma = sommaRiepiloghi([
      [t('pass', 'uno'), t('fail', 'due', { causa: 'testCodeFailure' }), t('fail', 'S', { suite: true, causa: 'subtestsFailed' })],
      [t('pass', 'tre', { skip: true }), t('fail', 'quattro', { todo: true }), t('fail', 'figlio', { causa: 'cancelledByParent' }),
        t('fail', 'H', { suite: true, causa: 'hookFailed' })],
    ]);
    assert.deepEqual({ ...somma, rossi: somma.rossi.map((r) => `${r.gruppo}:${r.nome}`) },
      { test: 5, pass: 1, fail: 1, annullati: 1, saltati: 1, todo: 1, rossi: ['1:due', '2:H'] });
    const testo = testoRiepilogo({ somma, gruppi: 2, file: 2, esiti: [1, 1] });
    assert.match(testo, /riepilogo di 2 gruppi, 2 file: 5 test, 1 passati, 1 falliti, 1 annullati, 1 saltati, 1 da fare\./);
    assert.match(testo, /✖ tests\/unit\/a\.test\.mjs:3 {2}due {2}\(gruppo 1\)/);
    assert.match(testo, /ROSSO: gruppi 1, 2 di 2\.$/);
  });

  test('un gruppo rosso senza un test rosso registrato non sparisce dal riepilogo', () => {
    const testo = testoRiepilogo({ somma: sommaRiepiloghi([[], []]), gruppi: 2, file: 9, esiti: [0, 1] });
    assert.match(testo, /il gruppo 2 è uscito rosso senza un test rosso registrato/);
    assert.match(testo, /ROSSO: gruppo 2 di 2\.$/);
  });

  test('a gruppi: girano tutti, un gruppo rosso fa rossa l’uscita, e alla fine c’è il conto di tutti', () => {
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
        `test('prova ${nome}', () => { writeFileSync(join(process.env.FILO_MARCHE, '${nome}'), ''); ${rosso ? "throw new Error('rosso voluto');" : ''} });`,
      ].join('\n'));
      scrivi('a.test.mjs', false);
      scrivi('b.test.mjs', true);
      scrivi('c.test.mjs', false);
      // Tetto minimo: ogni file nel suo gruppo, come su Windows con una suite enorme. Senza NODE_TEST_CONTEXT,
      // o il `node --test` annidato riferirebbe al processo di questa prova invece che al lanciatore.
      const { NODE_TEST_CONTEXT: _, ...ambiente } = process.env;
      const lancia = () => spawnSync(process.execPath, [LANCIATORE], {
        cwd: ROOT, encoding: 'utf8',
        env: { ...ambiente, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '1', FILO_MARCHE: marche },
      });
      const r = lancia();
      assert.notEqual(r.status, 0, 'un gruppo rosso deve fare rossa l’uscita');
      assert.deepEqual(readdirSync(marche).sort(), ['a.test.mjs', 'b.test.mjs', 'c.test.mjs'], 'il gruppo dopo il rosso deve girare lo stesso');
      assert.equal((r.stdout.match(/^TAP version/gm) || []).length, 3, 'ogni gruppo stampa la sua uscita');
      assert.match(r.stdout, /^not ok 1 - prova b\.test\.mjs/m, 'il registro del cancello cerca le righe «not ok»');
      const coda = r.stdout.slice(r.stdout.lastIndexOf('[test:unit] riepilogo'));
      assert.match(coda, /riepilogo di 3 gruppi, 3 file: 3 test, 2 passati, 1 falliti\./);
      assert.match(coda, /✖ .*b\.test\.mjs:4 {2}prova b\.test\.mjs {2}\(gruppo 2\)/);
      assert.match(coda, /ROSSO: gruppo 2 di 3\.\s*$/);

      scrivi('b.test.mjs', false);
      rmSync(marche, { recursive: true, force: true }); mkdirSync(marche);
      const verde = lancia();
      assert.equal(verde.status, 0, verde.stdout + verde.stderr);
      assert.equal(readdirSync(marche).length, 3);
      assert.match(verde.stdout, /3 test, 3 passati, 0 falliti\.\s+\[test:unit\] verde: 3 gruppi, 3 file\.\s*$/);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
