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
  allaLettera, nomeNonLanciabile, NODE_LEGGE_MODELLI, rapportiDaRiunire, separaArgomenti, unisciRapporti, chiedeWatch, chiedeCopertura,
  conTettoDiTempo, TETTO_FILE_MS,
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
    assert.match(testo, /riepilogo di 2 gruppi, 2 file: 5 test, 1 passato, 1 fallito, 1 annullato, 1 saltato, 1 da fare\./);
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
      assert.match(coda, /riepilogo di 3 gruppi, 3 file: 3 test, 2 passati, 1 fallito\./);
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

const { NODE_TEST_CONTEXT: _contesto, ...AMBIENTE } = process.env;
const lanciaSu = (dir, args = [], extra = {}) => spawnSync(process.execPath, [LANCIATORE, ...args], {
  cwd: ROOT, encoding: 'utf8', env: { ...AMBIENTE, FILO_UNIT_DIR: dir, ...extra },
});

describe('a gruppi, ciò che node fa una volta per corsa resta uno', () => {
  test('una destinazione su file passa per una copia di gruppo; stdout e stderr restano', () => {
    const r = rapportiDaRiunire(
      ['--test-reporter=junit', '--test-reporter-destination=out.xml', '--test-reporter=spec', '--test-reporter-destination', 'stdout',
        '--test-reporter=tap', '--test-reporter-destination', 'b.tap'],
      (k) => `COPIA${k}`,
    );
    assert.deepEqual(r.rapporti, ['out.xml', 'b.tap']);
    assert.deepEqual(r.accodati, ['stdout', 'b.tap'], 'spec e tap restano uno per gruppo, file o stdout che sia');
    assert.deepEqual(r.flags, ['--test-reporter=junit', '--test-reporter-destination=COPIA0', '--test-reporter=spec',
      '--test-reporter-destination=stdout', '--test-reporter=tap', '--test-reporter-destination=COPIA1']);
  });

  test('un documento su stdout, junit o lcov, passa anch’esso per una copia; i formati che scorrono restano su stdout', () => {
    const c = (k) => `COPIA${k}`;
    assert.deepEqual(rapportiDaRiunire(['--test-reporter=junit'], c),
      { flags: ['--test-reporter=junit', '--test-reporter-destination=COPIA0'], rapporti: ['stdout'], accodati: [] });
    assert.deepEqual(rapportiDaRiunire(['--test-reporter', 'lcov', '--test-reporter-destination', 'stdout'], c).rapporti, ['stdout']);
    assert.deepEqual(rapportiDaRiunire(['--test-reporter=spec'], c).rapporti, []);
    const misti = ['--test-reporter=dot', '--test-reporter=junit', '--test-reporter-destination=x'];
    assert.deepEqual(rapportiDaRiunire(misti, c), { flags: misti, rapporti: [], accodati: [] }, 'numeri diversi: decide node, che rifiuta');
  });

  test('i file dati a mano si separano dalle opzioni, anche dai valori scritti dopo l’opzione', () => {
    assert.deepEqual(
      separaArgomenti(['--test-reporter', 'spec', 'a.test.mjs', '--test-name-pattern', 'b.test.mjs', '--experimental-test-coverage', 'c.mjs']),
      { opzioni: ['--test-reporter', 'spec', '--test-name-pattern', 'b.test.mjs', '--experimental-test-coverage'], posizionali: ['a.test.mjs', 'c.mjs'] },
    );
  });

  test('a gruppi un junit su stdout è un documento solo, e stdout non porta altro', () => {
    const casa = cartellaTemporanea('filo-runner-junit-stdout-');
    try {
      for (const n of ['uno', 'due', 'tre']) writeFileSync(join(casa, `${n}.test.mjs`), `import { test } from 'node:test';\ntest('caso-${n}', () => {});\n`);
      const r = lanciaSu(casa, ['--test-reporter=junit'], { FILO_UNIT_TETTO_RIGA: '1' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /3 file in 3 gruppi/);
      assert.match(r.stderr, /riuniti sull'uscita standard/);
      assert.match(r.stdout.trim(), /^<\?xml[^>]*\?>\s*<testsuites>[\s\S]*<\/testsuites>$/);
      assert.equal((r.stdout.match(/<\?xml/g) || []).length, 1);
      for (const n of ['uno', 'due', 'tre']) assert.match(r.stdout, new RegExp(`name="caso-${n}"`));
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('un rapporto che non si può scrivere fa rosso l’esito, e il riepilogo non lo dà per riunito', () => {
    const casa = cartellaTemporanea('filo-runner-rapporto-perso-');
    try {
      for (const n of ['a', 'b']) writeFileSync(join(casa, `${n}.test.mjs`), `import { test } from 'node:test';\ntest('${n}', () => {});\n`);
      const dest = join(casa, 'manca', 'r.xml');
      const r = lanciaSu(casa, ['--test-reporter=junit', `--test-reporter-destination=${dest}`], { FILO_UNIT_TETTO_RIGA: '1' });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /riuniti/);
      assert.match(r.stdout, /non è stato scritto/);
      assert.match(r.stdout.trim().split('\n').pop(), /^\[test:unit\] ROSSO: rapporto non scritto\.$/);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('a gruppi un tap su file non si dice riunito: il riepilogo dice che ha un rapporto per gruppo', () => {
    const casa = cartellaTemporanea('filo-runner-tap-file-');
    try {
      for (const n of ['a', 'b']) writeFileSync(join(casa, `${n}.test.mjs`), `import { test } from 'node:test';\ntest('${n}', () => {});\n`);
      const dest = join(casa, 'r.tap');
      const r = lanciaSu(casa, ['--test-reporter=tap', `--test-reporter-destination=${dest}`], { FILO_UNIT_TETTO_RIGA: '1' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /riuniti/);
      assert.ok(r.stdout.includes(`in ${dest} c'è un rapporto per gruppo, uno dopo l'altro`), r.stdout);
      assert.match(r.stdout, /i conti di tutta la suite sono in questo riepilogo/);
      assert.equal((readFileSync(dest, 'utf8').match(/^TAP version/gm) || []).length, 2);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('a gruppi un file dato a mano gira una volta, e i conti tornano', () => {
    const casa = cartellaTemporanea('filo-runner-argomento-');
    const fuori = cartellaTemporanea('filo-runner-argomento-extra-');
    try {
      for (const n of ['a', 'b']) writeFileSync(join(casa, `${n}.test.mjs`), `import { test } from 'node:test';\ntest('${n}', () => {});\n`);
      const extra = join(fuori, 'extra.test.mjs');
      writeFileSync(extra, "import { test } from 'node:test';\ntest('extra', () => {});\n");
      const r = lanciaSu(casa, [extra, join(casa, 'a.test.mjs')], { FILO_UNIT_TETTO_RIGA: '1' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal((r.stdout.match(/ok \d+ - extra/g) || []).length, 1);
      assert.equal((r.stdout.match(/ok \d+ - a\b/g) || []).length, 1, 'un file già trovato non gira due volte');
      assert.match(r.stdout, /2 file: 3 test, 3 passati, 0 falliti/);
    } finally {
      rmSync(casa, { recursive: true, force: true });
      rmSync(fuori, { recursive: true, force: true });
    }
  });

  test('dei junit dei gruppi resta un documento solo con tutti i casi; gli altri formati si accodano', () => {
    const j = (c) => `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n\t<testcase name="${c}"/>\n</testsuites>\n`;
    const uno = unisciRapporti([j('a'), j('b')]);
    assert.equal((uno.match(/<testsuites>/g) || []).length, 1);
    assert.equal((uno.match(/<\?xml/g) || []).length, 1);
    assert.match(uno, /name="a"[\s\S]*name="b"/);
    assert.equal(unisciRapporti(['uno\n', 'due\n']), 'uno\ndue\n');
  });

  test('il rapporto chiesto su file, a gruppi, contiene i test di ogni gruppo', () => {
    const casa = cartellaTemporanea('filo-runner-rapporto-');
    try {
      for (const n of ['uno', 'due', 'tre']) writeFileSync(join(casa, `${n}.test.mjs`), `import { test } from 'node:test';\ntest('caso-${n}', () => {});\n`);
      const xml = join(casa, 'rapporto.xml');
      const testo = join(casa, 'rapporto.txt');
      const r = lanciaSu(casa, ['--test-reporter=junit', `--test-reporter-destination=${xml}`, '--test-reporter=spec', '--test-reporter-destination', testo],
        { FILO_UNIT_TETTO_RIGA: '1' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /3 file in 3 gruppi/);
      const junit = readFileSync(xml, 'utf8');
      assert.equal((junit.match(/<testsuites>/g) || []).length, 1, 'un documento junit solo');
      for (const n of ['uno', 'due', 'tre']) {
        assert.match(junit, new RegExp(`name="caso-${n}"`));
        assert.match(readFileSync(testo, 'utf8'), new RegExp(`caso-${n}`));
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('--watch a gruppi si rifiuta con la ragione, invece di fermarsi al primo gruppo per sempre', () => {
    assert.ok(chiedeWatch(['--watch']) && chiedeWatch(['--watch-path=src']) && !chiedeWatch(['--test-only']));
    const casa = cartellaTemporanea('filo-runner-watch-');
    try {
      for (const n of ['a', 'b']) writeFileSync(join(casa, `${n}.test.mjs`), `import { test } from 'node:test';\ntest('${n}', () => {});\n`);
      const r = lanciaSu(casa, ['--watch'], { FILO_UNIT_TETTO_RIGA: '1' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /--watch/);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('copertura e rapporti su file a gruppi si dichiarano nel riepilogo; il rosso senza test rimanda anche al file', () => {
    assert.ok(chiedeCopertura(['--experimental-test-coverage']) && !chiedeCopertura(['--test-only']));
    const testo = testoRiepilogo({ somma: sommaRiepiloghi([[], []]), gruppi: 2, file: 4, esiti: [0, 1], rapporti: ['r.xml'], copertura: true });
    assert.match(testo, /nella sua uscita, sopra o nel rapporto in r\.xml/);
    assert.match(testo, /rapporti di tutti i gruppi sono riuniti in r\.xml/);
    assert.match(testo, /copertura è per gruppo/);
    // «dei 8», «dei 11»: l'articolo davanti a un numero cambia con la sua lettura.
    const otto = testoRiepilogo({ somma: sommaRiepiloghi(Array(8).fill([])), gruppi: 8, file: 8, esiti: Array(8).fill(0), rapporti: ['r.xml'] });
    assert.doesNotMatch(otto, /\bdei (8|11)\b/);
    const misti = testoRiepilogo({ somma: sommaRiepiloghi([[], []]), gruppi: 2, file: 2, esiti: [0, 0], rapporti: ['r.xml', 'b.tap'], accodati: ['stdout', 'b.tap'] });
    assert.match(misti, /rapporti di tutti i gruppi sono riuniti in r\.xml\./);
    assert.match(misti, /sull'uscita standard c'è un rapporto per gruppo, uno dopo l'altro/);
    assert.match(misti, /in b\.tap c'è un rapporto per gruppo, uno dopo l'altro/);
    assert.doesNotMatch(misti, /riuniti[^\n]*b\.tap/);
  });
});

describe('un file trovato è un file che gira', () => {
  test('per un node che legge modelli, i caratteri speciali del nome si prendono alla lettera', () => {
    assert.equal(allaLettera('tests/unit/caso [1] (b).test.mjs'), 'tests/unit/caso [[]1[]] [(]b[)].test.mjs');
    assert.deepEqual(fileArgs([join(REPO_ROOT, 'tests', 'unit', 'a [1].test.mjs')], REPO_ROOT, { modelli: true }), ['tests/unit/a [[]1[]].test.mjs']);
    assert.deepEqual(fileArgs([join(REPO_ROOT, 'tests', 'unit', 'a [1].test.mjs')], REPO_ROOT, { modelli: false }), ['tests/unit/a [1].test.mjs']);
    assert.equal(NODE_LEGGE_MODELLI, Number(process.versions.node.split('.')[0]) >= 21);
  });

  test('un test rosso in un file con quadre o tonde nel nome rende rosso l’esito, da solo e a gruppi', () => {
    const casa = cartellaTemporanea('filo-runner-nomi-');
    try {
      writeFileSync(join(casa, 'verde.test.mjs'), "import { test } from 'node:test';\ntest('verde', () => {});\n");
      writeFileSync(join(casa, 'caso [1] (b).test.mjs'), "import { test } from 'node:test';\ntest('rosso-nel-nome-strano', () => { throw new Error('x'); });\n");
      for (const extra of [{}, { FILO_UNIT_TETTO_RIGA: '1' }]) {
        const r = lanciaSu(casa, [], extra);
        assert.notEqual(r.status, 0, `il file con le quadre non è girato: ${JSON.stringify(extra)}`);
        assert.match(r.stdout, /rosso-nel-nome-strano/);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  test('un nome con graffe che node espanderebbe ferma la corsa e lo nomina, mai un verde senza quel file', () => {
    assert.ok(nomeNonLanciabile('a{b,c}.test.mjs') && nomeNonLanciabile('a{1..2}.test.mjs') && !nomeNonLanciabile('a{b}.test.mjs'));
    if (!NODE_LEGGE_MODELLI) return;
    const casa = cartellaTemporanea('filo-runner-graffe-');
    try {
      writeFileSync(join(casa, 'a{b,c}.test.mjs'), "import { test } from 'node:test';\ntest('g', () => {});\n");
      const r = lanciaSu(casa);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /a\{b,c\}\.test\.mjs/);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});

// Un file appeso (col disco pieno, #717) teneva ferma la corsa per sempre, senza dire quale fosse.
test('ogni corsa ha un tetto di tempo per file, largo, a meno che chi lancia non ne dia uno suo', () => {
  assert.ok(TETTO_FILE_MS >= 10 * 60 * 1000, 'un tetto stretto fa rossi sui Windows lenti');
  assert.deepEqual(conTettoDiTempo(['--test-only']), [`--test-timeout=${TETTO_FILE_MS}`, '--test-only']);
  assert.deepEqual(conTettoDiTempo([]), [`--test-timeout=${TETTO_FILE_MS}`]);
  assert.deepEqual(conTettoDiTempo(['--test-timeout', '5000']), ['--test-timeout', '5000']);
  assert.deepEqual(conTettoDiTempo(['--test-timeout=5000']), ['--test-timeout=5000']);
});

test('un file appeso diventa un rosso col suo nome, e la corsa finisce', () => {
  const dir = cartellaTemporanea('filo-appeso-');
  try {
    writeFileSync(join(dir, 'appeso.test.mjs'), "import { test } from 'node:test';\ntest('appeso', async () => { setInterval(() => {}, 1000); await new Promise(() => {}); });\n");
    const env = { ...process.env, FILO_UNIT_DIR: dir };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'run-unit-tests.mjs'), '--test-timeout=1500'],
      { env, cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(r.error?.code, 'ETIMEDOUT', 'la corsa è rimasta appesa');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /appeso\.test\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
